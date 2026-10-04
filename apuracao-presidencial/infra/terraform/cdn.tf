# ---------------------------------------------------------------- estáticos (S3 privado + OAC)
resource "aws_s3_bucket" "estaticos" {
  bucket_prefix = "${local.nome}-estaticos-"
}

resource "aws_s3_bucket_public_access_block" "estaticos" {
  bucket                  = aws_s3_bucket.estaticos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "estaticos" {
  bucket = aws_s3_bucket.estaticos.id
  versioning_configuration {
    status = "Enabled" # permite voltar o front-end para a versão anterior
  }
}

# Arquivos públicos do front-end: SSE-S3 basta, uma chave KMS própria não protege nada a mais.
#trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "estaticos" {
  bucket = aws_s3_bucket.estaticos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "estaticos" {
  name                              = "${local.nome}-estaticos"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "estaticos" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.estaticos.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "estaticos" {
  bucket = aws_s3_bucket.estaticos.id
  policy = data.aws_iam_policy_document.estaticos.json
}

# ---------------------------------------------------------------- políticas de cache e cabeçalhos
# Estáticos: respeita o Cache-Control do upload (index.html no-cache, assets imutáveis).
data "aws_cloudfront_cache_policy" "otimizado" {
  name = "Managed-CachingOptimized"
}

# API: o TTL vem da origem (max-age=5, stale-while-revalidate=30, stale-if-error=600).
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${local.nome}-api"
  comment     = "Respeita o Cache-Control da origem"
  min_ttl     = 0
  default_ttl = 5
  max_ttl     = 60

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "seguranca" {
  name = "${local.nome}-seguranca"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }
}

# ---------------------------------------------------------------- distribuição
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "Apuracao presidencial (${var.ambiente})"
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  # PriceClass_100/200 não incluem os pontos de presença da América do Sul.
  price_class = "PriceClass_All"
  web_acl_id  = aws_wafv2_web_acl.borda.arn

  origin {
    origin_id                = "estaticos"
    domain_name              = aws_s3_bucket.estaticos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.estaticos.id
  }

  origin {
    origin_id   = "api"
    domain_name = aws_lb.api.dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # com domínio próprio: certificado ACM no ALB e https-only
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origem-Cloudfront"
      value = random_password.segredo_origem.result
    }

    # Uma camada regional de cache na frente da origem: os ~600 pontos de presença pedem ao
    # Origin Shield, e só ele pede ao ALB.
    origin_shield {
      enabled              = true
      origin_shield_region = var.regiao
    }
  }

  default_cache_behavior {
    target_origin_id           = "estaticos"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.otimizado.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.seguranca.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.seguranca.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ---------------------------------------------------------------- WAF
locals {
  regras_gerenciadas = {
    "AWSManagedRulesAmazonIpReputationList" = 2
    "AWSManagedRulesCommonRuleSet"          = 3
    "AWSManagedRulesKnownBadInputsRuleSet"  = 4
  }
}

resource "aws_wafv2_web_acl" "borda" {
  provider = aws.us_east_1
  name     = "${local.nome}-borda"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "limite-por-ip"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.waf_limite_por_ip
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-por-ip"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.regras_gerenciadas
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.nome}-borda"
    sampled_requests_enabled   = true
  }
}
