# Só o CloudFront alcança o ALB; só o ALB alcança a API; só API e ingestor alcançam o Redis;
# só o ingestor alcança o Postgres. Regras em recursos separados para os grupos poderem se
# referenciar sem criar ciclos.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.nome}-alb"
  description = "ALB da API: aceita apenas os IPs de origem do CloudFront"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "api" {
  name        = "${local.nome}-api"
  description = "Tarefas da API"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "ingestor" {
  name        = "${local.nome}-ingestor"
  description = "Tarefas do ingestor (sem entrada)"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "redis" {
  name        = "${local.nome}-redis"
  description = "ElastiCache Redis"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "rds" {
  name        = "${local.nome}-rds"
  description = "PostgreSQL"
  vpc_id      = aws_vpc.principal.id
}

# ---------------------------------------------------------------- ALB
resource "aws_vpc_security_group_ingress_rule" "alb_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP vindo do CloudFront"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Encaminha para as tarefas da API"
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

# ---------------------------------------------------------------- API
resource "aws_vpc_security_group_ingress_rule" "api_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "Trafego do ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "api_redis" {
  security_group_id            = aws_security_group.api.id
  description                  = "Redis"
  referenced_security_group_id = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

# HTTPS de saída: download da imagem no GHCR, CloudWatch Logs e Secrets Manager (via NAT).
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS (registro de imagens e APIs da AWS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# ---------------------------------------------------------------- ingestor
# HTTPS de saída: TSE (atrás de CDN, IPs variáveis), registro de imagens e APIs da AWS.
# Para restringir por domínio, usar AWS Network Firewall ou um proxy de saída.
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "ingestor_https" {
  security_group_id = aws_security_group.ingestor.id
  description       = "HTTPS (TSE, registro de imagens e APIs da AWS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "ingestor_postgres" {
  security_group_id            = aws_security_group.ingestor.id
  description                  = "PostgreSQL"
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "ingestor_redis" {
  security_group_id            = aws_security_group.ingestor.id
  description                  = "Redis"
  referenced_security_group_id = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

# ---------------------------------------------------------------- dados
resource "aws_vpc_security_group_ingress_rule" "redis" {
  for_each = {
    api      = aws_security_group.api.id
    ingestor = aws_security_group.ingestor.id
  }
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis a partir de ${each.key}"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_vpc_security_group_ingress_rule" "rds_ingestor" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Somente o ingestor"
  referenced_security_group_id = aws_security_group.ingestor.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
