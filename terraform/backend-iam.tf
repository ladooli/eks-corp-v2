data "aws_caller_identity" "current" {}

resource "aws_iam_role" "storage_backend" {
  name               = "${var.project_name}-storage-backend"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy" "storage_backend_rds_connect" {
  name = "rds-iam-connect"
  role = aws_iam_role.storage_backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = "arn:aws:rds-db:${var.region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.main.resource_id}/storage_app"
    }]
  })
}

resource "aws_eks_pod_identity_association" "storage_backend" {
  cluster_name    = module.eks.cluster_name
  namespace       = "default"
  service_account = "storage"
  role_arn        = aws_iam_role.storage_backend.arn
}