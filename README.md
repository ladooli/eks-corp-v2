<a id="readme-top"></a>

<div align="center">

<h1>eks-corp-v2</h1>

<p>
Highly available Kubernetes on AWS: a multi-AZ Amazon EKS cluster built entirely
with Terraform, running a containerized Node.js backend that connects to a Multi-AZ
RDS PostgreSQL database with IAM authentication, with no static credentials.
</p>

<a href="#architecture">Architecture</a>
·
<a href="#getting-started">Getting Started</a>
·
<a href="#what-i-learned">What I Learned</a>

</div>

<details>
<summary>Table of Contents</summary>

- [About The Project](#about-the-project)
- [Built With](#built-with)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
- [Security Notes](#security-notes)
- [What I Learned](#what-i-learned)
- [Roadmap](#roadmap)
- [Contact](#contact)

</details>

---

## About The Project

This project provisions a production-style Kubernetes environment on AWS with
Terraform and runs a small backend service with its database on it.

The goal was to build a cluster that keeps working when an availability zone goes
down, without a single static AWS access key inside it, and that can be created and
destroyed completely from code.

What the stack does end to end:

- Terraform builds a VPC with public and private subnets across three availability
  zones, plus a NAT gateway for outbound traffic
- An EKS cluster runs a managed node group with one `t3.medium` worker node per zone,
  in private subnets only
- EKS addons (VPC CNI, CoreDNS, kube-proxy, Pod Identity Agent, EBS CSI Driver) are
  installed and versioned through Terraform
- The EBS CSI driver receives its AWS permissions through **EKS Pod Identity**, so a
  PersistentVolumeClaim automatically becomes an encrypted gp3 EBS volume
- A Node.js backend is pulled from a private ECR repository and runs with three
  replicas, one in each zone
- The backend connects to an **RDS PostgreSQL Multi-AZ** instance in dedicated
  database subnets using **IAM database authentication** through Pod Identity: there
  is no database password in the code, in Kubernetes or in the Terraform state
- The AWS Load Balancer Controller, installed with Helm from Terraform and authorized
  through Pod Identity, turns a Kubernetes Ingress into an internet-facing Application
  Load Balancer: the single public entry point of the cluster

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built With

* [![Terraform][terraform-shield]][terraform-url]
* [![AWS][aws-shield]][aws-url]
* [![Amazon EKS][eks-shield]][eks-url]
* [![Amazon ECR][ecr-shield]][ecr-url]
* [![Amazon RDS][rds-shield]][rds-url]
* [![Kubernetes][k8s-shield]][k8s-url]
* [![Helm][helm-shield]][helm-url]
* [![Docker][docker-shield]][docker-url]
* [![Node.js][node-shield]][node-url]
* [![Express][express-shield]][express-url]
* [![PostgreSQL][pg-shield]][pg-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

```
                          Internet
                             │
                   ALB (HTTP :80)  ◄── AWS Load Balancer Controller
                             │
┌──────────────────────── VPC 10.0.0.0/16 · eu-north-1 ─────────────────────────┐
│  PUBLIC subnets      NAT Gateway                ALB → pod IPs (target-type ip) │
│                                                                                │
│  PRIVATE subnets                                                               │
│   ┌─ eu-north-1a ──────┐  ┌─ eu-north-1b ──────┐  ┌─ eu-north-1c ──────┐       │
│   │ node t3.medium     │  │ node t3.medium     │  │ node t3.medium     │       │
│   │  storage pod       │  │  storage pod       │  │  storage pod       │       │
│   │                    │  │                    │  │                    │       │
│   └────────────────────┘  └────────────────────┘  └────────────────────┘       │
│                                                                                │
│  DATABASE subnets    RDS PostgreSQL 17 Multi-AZ (primary + standby in 2 AZs)   │
└────────────────────────────────────────────────────────────────────────────────┘
  EKS control plane: AWS-managed, multi-AZ
  Private ECR ──► nodes pull images through the NAT gateway with the node IAM role
  storage pod ──(Pod Identity → IAM auth token, TLS)──► RDS, port 5432 only from nodes
```

**Design decisions**

- **Private worker nodes, one public entry point.** Nodes have no public IP. The public
  subnets hold only the NAT gateway and the ALB, which is the single way in from the
  internet. The backend Service stays `ClusterIP`.
- **ALB straight to pod IPs.** The Ingress uses `target-type: ip`, so the ALB sends
  traffic directly to the pods (they have real VPC IPs through the VPC CNI) and
  health-checks `/healthz` on each pod, with no extra hop through the nodes.
- **Load Balancer Controller as code.** The controller is a Terraform `helm_release`
  with a pinned chart version, and its IAM permissions come from Pod Identity. The
  Helm provider uses its own repository config inside the project, so the setup does
  not depend on the Helm repositories configured on a developer's machine.
- **One node and one backend pod per zone.** The Auto Scaling Group spreads nodes
  across three AZs, and `topologySpreadConstraints` (`maxSkew: 1`) spreads the backend
  pods the same way, so losing one zone leaves the API running.
- **Pod Identity instead of node-level permissions.** The EBS CSI driver's service
  account gets its own IAM role. Other pods on the same node cannot use it, and there
  are no access keys to rotate. Simpler than IRSA: no OIDC provider per cluster.
- **Addons managed as code.** VPC CNI and the Pod Identity Agent are installed before
  the nodes (`before_compute`), so nodes join the cluster ready. Addon versions live
  in Terraform, so manual changes show up as drift.
- **`WaitForFirstConsumer` storage.** EBS volumes belong to one AZ, so the volume is
  created only after the scheduler places the pod, in the same zone.
- **Dependency-free health check.** Kubernetes probes call `/healthz`, which checks
  only the process itself. A failing downstream service does not restart healthy pods.
- **Pinned Kubernetes version and versioned image tags.** Upgrades and rollbacks are
  deliberate changes in code, not side effects of `latest`.
- **Managed, highly available database.** RDS PostgreSQL runs in its own database
  subnets with Multi-AZ: a synchronous standby in a second zone takes over
  automatically, behind the same endpoint. It is not publicly accessible, and its
  security group accepts port 5432 only from the EKS node security group.
- **No database password at all for the application.** The backend's IAM role may
  only `rds-db:connect` as the `storage_app` user of this one database. The AWS SDK
  signs a 15-minute auth token for every new connection, sent over TLS that is
  verified against the RDS CA bundle. The master password is generated by RDS and
  kept in AWS Secrets Manager.
- **Single NAT gateway.** A cost decision for a dev environment; production would use
  one per AZ.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project Structure

```
eks-corp-v2/
├── app/
│   └── storage/                 # Node.js / Express backend
│       ├── .dockerignore
│       ├── Dockerfile           # npm ci + RDS CA bundle
│       ├── index.js             # IAM auth token + TLS when DB_IAM_AUTH=true
│       ├── package.json
│       └── package-lock.json
├── k8s/
│   ├── storageclass.yaml        # gp3, encrypted, WaitForFirstConsumer
│   ├── secret.example.yaml      # Legacy: secret for the in-cluster PostgreSQL
│   ├── storage-db.yaml          # Legacy: in-cluster PostgreSQL (being replaced by RDS)
│   ├── storage.yaml             # ServiceAccount + backend Deployment + Service
│   └── ingress.yaml             # Internet-facing ALB in front of the backend
└── terraform/
    ├── providers.tf             # AWS and Helm providers, default tags
    ├── variables.tf             # Region and project name
    ├── vpc.tf                   # VPC: public, private and database subnets in 3 AZs
    ├── eks.tf                   # EKS cluster, addons, managed node group
    ├── iam.tf                   # Pod Identity IAM role for the EBS CSI driver
    ├── lb-controller.tf         # AWS Load Balancer Controller: Pod Identity + Helm release
    ├── rds.tf                   # RDS PostgreSQL Multi-AZ + security group
    ├── backend-iam.tf           # Backend IAM role (rds-db:connect) + Pod Identity
    ├── ecr.tf                   # Private ECR repository, scan on push
    └── outputs.tf               # Cluster, ECR and RDS outputs
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- An AWS account with programmatic access configured

  ```sh
  aws configure
  ```

- Terraform 1.6 or newer

  ```sh
  terraform -version
  ```

- kubectl and Docker

### Installation

1. Clone the repository

   ```sh
   git clone https://github.com/ladooli/eks-corp-v2.git
   cd eks-corp-v2
   ```

2. Create the infrastructure (takes about 25–30 minutes, RDS Multi-AZ included)

   ```sh
   cd terraform
   terraform init
   terraform plan
   terraform apply
   ```

3. Connect kubectl to the new cluster

   ```sh
   aws eks update-kubeconfig --region eu-north-1 --name eks-corp-cluster
   kubectl get nodes -L topology.kubernetes.io/zone
   ```

4. Build the backend image and push it to the private ECR repository. The repository
   URL is printed by `terraform output ecr_backend_url`.

   ```sh
   aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com
   docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/eks-corp/backend:v2 ../app/storage
   docker push <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/eks-corp/backend:v2
   ```

   > On Windows PowerShell the piped login can fail with `400 Bad Request`. Use
   > `docker login --username AWS --password (aws ecr get-login-password --region eu-north-1) <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com`

5. Create the database user for the backend. This is a one-time step for every new RDS
   instance. The database is only reachable from inside the VPC, so `psql` runs in a
   temporary pod, logged in as the master user whose password RDS keeps in Secrets
   Manager:

   ```sh
   DB_HOST=$(terraform output -raw rds_endpoint)
   DB_PASSWORD=$(aws secretsmanager get-secret-value --region eu-north-1 \
     --secret-id "$(terraform output -raw rds_master_secret_arn)" \
     --query SecretString --output text | jq -r .password)

   kubectl run psql-admin --rm -it --image=postgres:17-alpine --restart=Never \
     --env="PGPASSWORD=$DB_PASSWORD" -- \
     psql "host=$DB_HOST port=5432 dbname=storagedb user=dbadmin sslmode=require"
   ```

   ```sql
   CREATE USER storage_app;
   GRANT rds_iam TO storage_app;
   GRANT CONNECT ON DATABASE storagedb TO storage_app;
   GRANT USAGE, CREATE ON SCHEMA public TO storage_app;
   \q
   ```

   > PowerShell: `$pw = (aws secretsmanager get-secret-value --region eu-north-1 --secret-id (terraform output -raw rds_master_secret_arn) --query SecretString --output text | ConvertFrom-Json).password`

6. Deploy the backend and the ingress. `k8s/storage.yaml` contains two placeholders
   that are filled in at deploy time, so no account-specific values are committed:

   ```sh
   cd ..
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   sed -e "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/" -e "s/<RDS_ENDPOINT>/$DB_HOST/" k8s/storage.yaml | kubectl apply -f -
   kubectl apply -f k8s/ingress.yaml
   ```

   > PowerShell: `(Get-Content k8s/storage.yaml) -replace '<AWS_ACCOUNT_ID>','<id>' -replace '<RDS_ENDPOINT>','<endpoint>' | kubectl apply -f -`

7. Wait 2–3 minutes until the ALB is active, then get its address

   ```sh
   kubectl get ingress storage-ingress
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

Check that the pods are spread across the zones and connected to RDS with IAM auth:

```sh
kubectl get pods -o wide
kubectl logs deployment/storage
```

```
Storage DB ready (host: eks-corp-db.xxxxxxxx.eu-north-1.rds.amazonaws.com, IAM auth: true)
```

The backend is reachable through the ALB. Take the address from the `ADDRESS` column
of `kubectl get ingress storage-ingress`:

```sh
curl http://<ALB_ADDRESS>/healthz
```

```json
{ "status": "ok", "service": "storage" }
```

```sh
curl http://<ALB_ADDRESS>/files
```

```json
[]
```

The empty list is the important one: it shows the backend logged in to RDS with an
IAM token over TLS and created its table.

Tear everything down when you are finished. The ALB is created by Kubernetes, not by
Terraform, so the Ingress must be deleted first, while the Load Balancer Controller is
still running to remove it. RDS is deleted by Terraform without a final snapshot.

```sh
kubectl delete -f k8s/ingress.yaml
kubectl delete -f k8s/storage.yaml
cd terraform
terraform destroy
```

> If the legacy in-cluster PostgreSQL is deployed, also run
> `kubectl delete -f k8s/storage-db.yaml` and `kubectl delete pvc --all` before the
> destroy, so its EBS volume is removed.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Security Notes

- **State files are not committed.** `terraform.tfstate` stores resource attributes in
  plain text, so it is excluded in `.gitignore`. A production setup would keep it in a
  remote S3 backend with locking.
- **No database password for the application.** The backend authenticates to RDS with
  short-lived IAM tokens over verified TLS. The RDS master password is generated by
  RDS and stored in Secrets Manager; it never appears in code or in the Terraform
  state.
- **The database is private.** Database subnets, no public access, and a security
  group that allows port 5432 only from the EKS nodes. A connection test from outside
  the VPC fails.
- **No real secrets in the repository.** Account ID and RDS endpoint are placeholders
  filled in at deploy time; `k8s/secret.yaml` (legacy) is git-ignored.
- **No static AWS keys in the cluster.** Nodes pull from ECR with the node IAM role;
  the EBS CSI driver, the Load Balancer Controller and the backend each have their own
  Pod Identity role with only the permissions they need.
- **HTTP only for now.** HTTPS needs a domain and an ACM certificate on the ALB
  listener; it is on the roadmap.
- **The EKS API endpoint is public** but protected by IAM authentication and EKS access
  entries. It should be restricted to known IP ranges with
  `endpoint_public_access_cidrs`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What I Learned

- **Terraform needs to know `count` at plan time.** Leaving the Kubernetes version
  unset made the node group module depend on a value known only after apply, and the
  plan failed. Pinning the version fixed it and made upgrades explicit.
- **EBS volumes are bound to one availability zone.** That is why the StorageClass uses
  `WaitForFirstConsumer`, and why an in-cluster database is a single-AZ weak point that
  a Multi-AZ managed database solves.
- **Permissions belong to workloads, not machines.** With Pod Identity the IAM role is
  tied to one service account, not to every pod that happens to run on the node.
- **Kubernetes can create AWS resources Terraform does not know about.** A PVC creates
  an EBS volume outside the Terraform state, so the teardown order matters or the
  volume is left behind and keeps costing money.
- **A fresh EBS volume is not an empty directory.** It contains `lost+found`, which
  makes PostgreSQL refuse to initialize; pointing `PGDATA` to a subdirectory solves it.
- **Liveness probes should not depend on other services,** or one failing service
  restarts the healthy ones too.
- **Tooling can leak local state into infrastructure code.** The Terraform Helm
  provider read the global Helm repository list on my machine and failed on a stale
  entry. Giving the provider its own repository config inside the project made the
  setup reproducible on any machine.
- **A token-based password must be a function, not a value.** IAM auth tokens expire
  after 15 minutes, so the `pg` pool gets a function that signs a fresh token for every
  new connection instead of a token fetched once at startup.
- **PostgreSQL 15 locked down the `public` schema.** A new user can no longer create
  tables there by default, so the application user needs an explicit
  `GRANT CREATE ON SCHEMA public`.
- **Some setup cannot live in Terraform when the database is private.** The Terraform
  PostgreSQL provider would need to reach the database from my machine, which the
  security design forbids, so the application user is created from a temporary pod
  inside the cluster.
- **During a rolling update, `kubectl logs deployment/...` picks any pod,** old or new.
  Checking `kubectl get pods` first avoids reading the old version's logs by mistake.
- **Pod Identity credentials are injected when a pod starts.** The association has to
  exist before the controller pod is created, which is why the Helm release
  `depends_on` the Pod Identity module.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] VPC with public and private subnets across three availability zones
- [x] Multi-AZ EKS cluster with a managed node group (2–6 nodes)
- [x] EKS addons managed in Terraform
- [x] EBS CSI driver with Pod Identity and an encrypted gp3 StorageClass
- [x] Private ECR repository with scan on push
- [x] Backend spread across zones, PostgreSQL StatefulSet on EBS
- [x] AWS Load Balancer Controller with Pod Identity (Helm, managed by Terraform)
- [x] Internet-facing ALB Ingress with IP targets
- [ ] HTTPS on the ALB with an ACM certificate (requires a domain)
- [x] RDS PostgreSQL Multi-AZ in dedicated database subnets
- [x] Backend connects to RDS with IAM database authentication via Pod Identity
- [ ] Remove the legacy in-cluster PostgreSQL
- [ ] metrics-server + HorizontalPodAutoscaler, PodDisruptionBudget
- [ ] Cluster Autoscaler or Karpenter for node scaling
- [ ] NAT gateway per AZ and VPC endpoints for ECR
- [ ] Remote Terraform state in S3, restricted API endpoint
- [ ] CI pipeline running `terraform fmt`, `validate` and `plan` on pull requests

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Olivér — [LinkedIn](https://www.linkedin.com/in/oliv%C3%A9r-ladoniczki-28306b307/)

Project link: [https://github.com/ladooli/eks-corp-v2](https://github.com/ladooli/eks-corp-v2)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[terraform-shield]: https://img.shields.io/badge/Terraform-7B42BC?style=for-the-badge&logo=terraform&logoColor=white
[terraform-url]: https://www.terraform.io/
[aws-shield]: https://img.shields.io/badge/AWS-232F3E?style=for-the-badge&logo=amazonwebservices&logoColor=white
[aws-url]: https://aws.amazon.com/
[k8s-shield]: https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white
[k8s-url]: https://kubernetes.io/
[docker-shield]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[docker-url]: https://www.docker.com/
[node-shield]: https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org/
[pg-shield]: https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[pg-url]: https://www.postgresql.org/
[eks-shield]: https://img.shields.io/badge/Amazon_EKS-FF9900?style=for-the-badge&logo=amazonwebservices&logoColor=white
[eks-url]: https://aws.amazon.com/eks/
[ecr-shield]: https://img.shields.io/badge/Amazon_ECR-FF9900?style=for-the-badge&logo=amazonwebservices&logoColor=white
[ecr-url]: https://aws.amazon.com/ecr/
[express-shield]: https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white
[express-url]: https://expressjs.com/
[helm-shield]: https://img.shields.io/badge/Helm-0F1689?style=for-the-badge&logo=helm&logoColor=white
[helm-url]: https://helm.sh/
[rds-shield]: https://img.shields.io/badge/Amazon_RDS-527FFF?style=for-the-badge&logo=amazonwebservices&logoColor=white
[rds-url]: https://aws.amazon.com/rds/
