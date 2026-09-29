# State lives in the production account itself, encrypted, versioned and
# locked — created once by hand before the first apply (runbooks/first-deploy.md,
# step 1); everything after that is Terraform.
terraform {
  backend "s3" {
    bucket         = "morbeez-prod-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "morbeez-prod-terraform-locks"
  }
}
