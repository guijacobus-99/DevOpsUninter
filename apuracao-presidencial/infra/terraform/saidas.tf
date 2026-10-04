output "url_site" {
  description = "Endereço público do site (CloudFront)."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "cloudfront_id" {
  description = "ID da distribuição (para invalidações)."
  value       = aws_cloudfront_distribution.site.id
}

output "bucket_estaticos" {
  description = "Bucket onde o CD publica o front-end."
  value       = aws_s3_bucket.estaticos.bucket
}

output "cluster_ecs" {
  value = aws_ecs_cluster.principal.name
}

output "alb_dns" {
  description = "DNS do ALB (só responde com o cabeçalho secreto do CloudFront)."
  value       = aws_lb.api.dns_name
}
