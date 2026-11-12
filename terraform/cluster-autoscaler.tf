module "cluster_autoscaler_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.0"

  name = "${var.project_name}-cluster-autoscaler"

  attach_cluster_autoscaler_policy = true
  cluster_autoscaler_cluster_names = [module.eks.cluster_name]

  associations = {
    this = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = "cluster-autoscaler"
    }
  }
}

resource "helm_release" "cluster_autoscaler" {
  name       = "cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  version    = "9.60.0"
  namespace  = "kube-system"

  values = [yamlencode({
    cloudProvider = "aws"
    awsRegion     = var.region
    autoDiscovery = {
      clusterName = module.eks.cluster_name
    }
    image = {
      tag = "v1.36.1"
    }
    rbac = {
      serviceAccount = {
        create = true
        name   = "cluster-autoscaler"
      }
    }
    extraArgs = {
      "scale-down-unneeded-time"   = "2m"
      "scale-down-delay-after-add" = "2m"
    }
  })]

  depends_on = [module.eks, module.cluster_autoscaler_pod_identity]
}