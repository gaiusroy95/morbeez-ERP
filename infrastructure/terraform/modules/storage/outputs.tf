output "uploads_bucket" {
  value = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "uploads_kms_key_arn" {
  value = aws_kms_key.uploads.arn
}

output "logs_bucket" {
  value = aws_s3_bucket.logs.id
}
