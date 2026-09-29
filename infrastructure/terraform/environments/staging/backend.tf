terraform {
  backend "s3" {
    bucket         = "morbeez-staging-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "morbeez-staging-terraform-locks"
  }
}
