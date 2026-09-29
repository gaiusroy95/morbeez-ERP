terraform {
  backend "s3" {
    bucket         = "morbeez-dev-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "morbeez-dev-terraform-locks"
  }
}
