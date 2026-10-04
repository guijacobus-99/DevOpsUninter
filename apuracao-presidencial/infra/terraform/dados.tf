# PostgreSQL Multi-AZ (auditoria e histórico; fora do caminho de leitura).
resource "aws_db_subnet_group" "principal" {
  name       = local.nome
  subnet_ids = aws_subnet.privada[*].id
}

resource "aws_db_instance" "principal" {
  identifier            = local.nome
  engine                = "postgres"
  engine_version        = "17"
  instance_class        = var.rds_classe
  allocated_storage     = 50
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "apuracao"
  username = "apuracao"
  # Senha gerada e rotacionada pelo RDS no Secrets Manager; a tarefa recebe como PGPASSWORD.
  manage_master_user_password = true

  multi_az               = true
  db_subnet_group_name   = aws_db_subnet_group.principal.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period      = 7
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  deletion_protection          = var.protecao_exclusao
  skip_final_snapshot          = !var.protecao_exclusao
  final_snapshot_identifier    = var.protecao_exclusao ? "${local.nome}-final" : null
}

# Redis com réplica e failover automático entre zonas.
resource "aws_elasticache_subnet_group" "principal" {
  name       = local.nome
  subnet_ids = aws_subnet.privada[*].id
}

resource "aws_elasticache_replication_group" "principal" {
  replication_group_id       = local.nome
  description                = "Snapshot atual da apuracao e pub/sub para as APIs"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_tipo
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.principal.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}
