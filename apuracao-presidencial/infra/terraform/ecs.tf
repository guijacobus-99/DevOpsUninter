resource "aws_ecs_cluster" "principal" {
  name = local.nome
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "servico" {
  for_each          = toset(["api", "ingestor"])
  name              = "/ecs/${local.nome}/${each.key}"
  retention_in_days = 30
}

# ---------------------------------------------------------------- IAM
data "aws_iam_policy_document" "assumir_tarefa" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Papel usado pelo ECS para baixar a imagem, escrever logs e ler segredos.
resource "aws_iam_role" "execucao" {
  name               = "${local.nome}-execucao"
  assume_role_policy = data.aws_iam_policy_document.assumir_tarefa.json
}

resource "aws_iam_role_policy_attachment" "execucao" {
  role       = aws_iam_role.execucao.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ler_segredos" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      aws_db_instance.principal.master_user_secret[0].secret_arn,
      var.credenciais_registro_arn,
    ])
  }
}

resource "aws_iam_role_policy" "ler_segredos" {
  name   = "ler-segredos"
  role   = aws_iam_role.execucao.id
  policy = data.aws_iam_policy_document.ler_segredos.json
}

# Papel da aplicação: sem permissões, os serviços não chamam APIs da AWS.
resource "aws_iam_role" "tarefa" {
  name               = "${local.nome}-tarefa"
  assume_role_policy = data.aws_iam_policy_document.assumir_tarefa.json
}

# ---------------------------------------------------------------- definições de tarefa
locals {
  redis_url = "rediss://${aws_elasticache_replication_group.principal.primary_endpoint_address}:6379"
  # Sem senha na URL: ela chega como PGPASSWORD, lida do Secrets Manager.
  # TODO: trocar sslmode=no-verify por verify-full com o bundle de CA do RDS na imagem.
  database_url = "postgres://apuracao@${aws_db_instance.principal.address}:5432/apuracao?sslmode=no-verify"

  credenciais_registro = var.credenciais_registro_arn == null ? {} : {
    repositoryCredentials = { credentialsParameter = var.credenciais_registro_arn }
  }

  log = {
    for servico in ["api", "ingestor"] : servico => {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.servico[servico].name
        awslogs-region        = var.regiao
        awslogs-stream-prefix = servico
      }
    }
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.nome}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memoria
  execution_role_arn       = aws_iam_role.execucao.arn
  task_role_arn            = aws_iam_role.tarefa.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge({
    name                   = "api"
    image                  = "${var.registro_imagens}/apuracao-api:${var.tag_imagem}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = "3000" },
      { name = "REDIS_URL", value = local.redis_url },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health/live || exit 1"]
      interval    = 10
      timeout     = 3
      retries     = 3
      startPeriod = 10
    }
    logConfiguration = local.log["api"]
  }, local.credenciais_registro)])
}

resource "aws_ecs_task_definition" "ingestor" {
  family                   = "${local.nome}-ingestor"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ingestor_cpu
  memory                   = var.ingestor_memoria
  execution_role_arn       = aws_iam_role.execucao.arn
  task_role_arn            = aws_iam_role.tarefa.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge({
    name                   = "ingestor"
    image                  = "${var.registro_imagens}/apuracao-ingestor:${var.tag_imagem}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 9100, protocol = "tcp" }]
    environment = [
      { name = "ELEICAO", value = var.eleicao },
      { name = "TURNO", value = tostring(var.turno) },
      { name = "FONTE_URL_TEMPLATE", value = var.fonte_url_template },
      { name = "FONTE_NOME", value = "tse" },
      { name = "INTERVALO_COLETA_MS", value = "5000" },
      { name = "DATABASE_URL", value = local.database_url },
      { name = "REDIS_URL", value = local.redis_url },
    ]
    secrets = [
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.principal.master_user_secret[0].secret_arn}:password::" },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:9100/health/live || exit 1"]
      interval    = 10
      timeout     = 3
      retries     = 3
      startPeriod = 20
    }
    logConfiguration = local.log["ingestor"]
  }, local.credenciais_registro)])
}

# ---------------------------------------------------------------- serviços
resource "aws_ecs_service" "api" {
  name                               = "api"
  cluster                            = aws_ecs_cluster.principal.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api_tarefas_min
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 30
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.privada[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Quem decide a quantidade é o autoscaling.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_appautoscaling_target" "api" {
  min_capacity       = var.api_tarefas_min
  max_capacity       = var.api_tarefas_max
  resource_id        = "service/${aws_ecs_cluster.principal.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.nome}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 50
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# Duas tarefas: uma líder (advisory lock no Postgres) e uma em espera. Num deploy, as novas
# sobem em espera e assumem quando as antigas param.
resource "aws_ecs_service" "ingestor" {
  name                               = "ingestor"
  cluster                            = aws_ecs_cluster.principal.id
  task_definition                    = aws_ecs_task_definition.ingestor.arn
  desired_count                      = 2
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.privada[*].id
    security_groups  = [aws_security_group.ingestor.id]
    assign_public_ip = false
  }
}
