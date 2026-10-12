<a id="readme-top"></a>

<div align="center">

<h1>eks-corp-v2</h1>

<p>
Highly available Kubernetes on AWS: a multi-AZ Amazon EKS cluster built entirely
with Terraform, running a containerized Node.js backend and PostgreSQL from a
private container registry.
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
  replicas, one in each zone, next to a PostgreSQL StatefulSet on an EBS volume

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built With

* [![Terraform][terraform-shield]][terraform-url]
* [![AWS][aws-shield]][aws-url]
* [![Amazon EKS][eks-shield]][eks-url]
* [![Amazon ECR][ecr-shield]][ecr-url]
* [![Kubernetes][k8s-shield]][k8s-url]
* [![Docker][docker-shield]][docker-url]
* [![Node.js][node-shield]][node-url]
* [![Express][express-shield]][express-url]
* [![PostgreSQL][pg-shield]][pg-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

```
                          Internet
                             │
                   (planned) ALB  ◄── AWS Load Balancer Controller
                             │
┌──────────────────────── VPC 10.0.0.0/16 · eu-north-1 ─────────────────────────┐
│  PUBLIC subnets      NAT Gateway                [ALB – planned]                │
│                                                                                │
│  PRIVATE subnets                                                               │
│   ┌─ eu-north-1a ──────┐  ┌─ eu-north-1b ──────┐  ┌─ eu-north-1c ──────┐       │
│   │ node t3.medium     │  │ node t3.medium     │  │ node t3.medium     │       │
│   │  storage pod       │  │  storage pod       │  │  storage pod       │       │
│   │  storage-db-0      │  │                    │  │                    │       │
│   │   └ EBS gp3 5 GiB  │  │                    │  │                    │       │
│   └────────────────────┘  └────────────────────┘  └────────────────────┘       │
│                                                                                │
│  (planned) DB subnets → RDS PostgreSQL Multi-AZ                                │
└────────────────────────────────────────────────────────────────────────────────┘
  EKS control plane: AWS-managed, multi-AZ
  Private ECR ──► nodes pull images through the NAT gateway with the node IAM role
```

**Design decisions**

- **Private worker nodes.** Nodes have no public IP. The public subnets hold only the
  NAT gateway now, and later the load balancer, which will be the single public entry
  point.
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
- **Single NAT gateway.** A cost decision for a dev environment; production would use
  one per AZ.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project Structure

```
eks-corp-v2/
├── app/
│   └── storage/                 # Node.js / Express backend
│       ├── Dockerfile
│       ├── index.js
│       └── package.json
├── k8s/
│   ├── storageclass.yaml        # gp3, encrypted, WaitForFirstConsumer
│   ├── secret.example.yaml      # Template for the DB secret (real one is git-ignored)
│   ├── storage-db.yaml          # PostgreSQL StatefulSet + Service
│   └── storage.yaml             # Backend Deployment + Service
└── terraform/
    ├── providers.tf             # AWS provider, default tags
    ├── variables.tf             # Region and project name
    ├── vpc.tf                   # VPC, subnets in 3 AZs, NAT gateway, LB subnet tags
    ├── eks.tf                   # EKS cluster, addons, managed node group
    ├── iam.tf                   # Pod Identity IAM role for the EBS CSI driver
    ├── ecr.tf                   # Private ECR repository, scan on push
    └── outputs.tf               # Cluster name, kubeconfig command, ECR URL
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

2. Create the infrastructure (takes about 15–20 minutes)

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
   docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/eks-corp/backend:v1 ../app/storage
   docker push <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/eks-corp/backend:v1
```

   > On Windows PowerShell the piped login can fail with `400 Bad Request`. Use
   > `docker login --username AWS --password (aws ecr get-login-password --region eu-north-1) <AWS_ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com`

5. Create the database secret from the template and set your own password

```sh
   cd ..
   cp k8s/secret.example.yaml k8s/secret.yaml
```

6. Set your account ID in the `image` field of `k8s/storage.yaml`, then deploy

```sh
   kubectl apply -f k8s/storageclass.yaml
   kubectl apply -f k8s/secret.yaml
   kubectl apply -f k8s/storage-db.yaml
   kubectl apply -f k8s/storage.yaml
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

Check that the pods are spread across the zones and that the database volume was
created:

```sh
kubectl get pods -o wide
kubectl get pvc
```

The PVC should be `Bound`, which means the EBS CSI driver created a gp3 volume in AWS.

There is no public load balancer yet, so reach the backend through a port-forward:

```sh
kubectl port-forward svc/storage-service 8080:3000
```

```sh
curl http://localhost:8080/healthz
```

```json
{ "status": "ok", "service": "storage" }
```

```sh
curl http://localhost:8080/files
```

```json
[]
```

The empty list is the important one: it shows the backend reached PostgreSQL and
created its table.

Tear everything down when you are finished. Kubernetes-created AWS resources (the EBS
volume) are not in the Terraform state, so delete them first:

```sh
kubectl delete -f k8s/storage.yaml
kubectl delete -f k8s/storage-db.yaml
kubectl delete pvc --all
cd terraform
terraform destroy
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Security Notes

- **State files are not committed.** `terraform.tfstate` stores resource attributes in
  plain text, so it is excluded in `.gitignore`. A production setup would keep it in a
  remote S3 backend with locking.
- **No real secrets in the repository.** Only `secret.example.yaml` with a placeholder
  password is committed; `k8s/secret.yaml` is git-ignored. The backend reads all
  database settings from environment variables.
- **No static AWS keys in the cluster.** Nodes pull from ECR with the node IAM role,
  and the EBS CSI driver uses Pod Identity.
- **Kubernetes Secrets are only base64-encoded.** For the managed database the plan is
  IAM database authentication through Pod Identity, so no static DB password is needed
  at all.
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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] VPC with public and private subnets across three availability zones
- [x] Multi-AZ EKS cluster with a managed node group (2–6 nodes)
- [x] EKS addons managed in Terraform
- [x] EBS CSI driver with Pod Identity and an encrypted gp3 StorageClass
- [x] Private ECR repository with scan on push
- [x] Backend spread across zones, PostgreSQL StatefulSet on EBS
- [ ] AWS Load Balancer Controller + Ingress → one ALB with HTTPS (ACM)
- [ ] RDS PostgreSQL Multi-AZ with IAM database authentication via Pod Identity
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