# Público por exigência do CloudFront sem domínio próprio: só aceita os IPs de origem do
# CloudFront (security group) e, entre eles, só quem envia o cabeçalho secreto (regra abaixo).
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "api" {
  name                       = "${local.nome}-api"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.publica[*].id
  drop_invalid_header_fields = true
  idle_timeout               = 60
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.nome}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.principal.id
  deregistration_delay = 15

  health_check {
    path                = "/health/ready"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Segredo compartilhado entre CloudFront e ALB: requisição sem ele é recusada, mesmo que alguém
# descubra o endereço do ALB.
resource "random_password" "segredo_origem" {
  length  = 40
  special = false
}

# HTTP entre CloudFront e ALB. Com domínio próprio, trocar por HTTPS (certificado ACM) e
# origin_protocol_policy = "https-only" no CloudFront.
#trivy:ignore:AVD-AWS-0054
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "acesso direto negado"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "via_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origem-Cloudfront"
      values           = [random_password.segredo_origem.result]
    }
  }
}
