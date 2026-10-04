variable "regiao" {
  description = "Região AWS principal. sa-east-1 (São Paulo) fica perto do TSE e dos usuários."
  type        = string
  default     = "sa-east-1"
}

variable "nome" {
  description = "Prefixo dos recursos."
  type        = string
  default     = "apuracao"
}

variable "ambiente" {
  description = "Nome do ambiente (homologacao, producao)."
  type        = string
  default     = "producao"
}

variable "cidr_vpc" {
  description = "Bloco CIDR da VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "nat_por_az" {
  description = "Um NAT Gateway por zona (alta disponibilidade da saída para o TSE). false usa um só, mais barato."
  type        = bool
  default     = true
}

variable "registro_imagens" {
  description = "Registro das imagens publicadas pelo CD."
  type        = string
  default     = "ghcr.io/guijacobus-99"
}

variable "tag_imagem" {
  description = "Tag das imagens a implantar (o CD passa o SHA do commit)."
  type        = string
  default     = "latest"
}

variable "credenciais_registro_arn" {
  description = "ARN de um segredo do Secrets Manager com usuário/token do registro, se as imagens forem privadas."
  type        = string
  default     = null
}

variable "eleicao" {
  description = "Código da eleição no TSE (confirmar no ele-c.json)."
  type        = string
}

variable "turno" {
  description = "Turno da eleição."
  type        = number
  default     = 1
}

variable "fonte_url_template" {
  description = "Padrão de URL dos arquivos de resultado."
  type        = string
  default     = "https://resultados.tse.jus.br/oficial/ele2026/{eleicao}/dados-simplificados/{abr}/{abr}-c0001-e{eleicao6}-r.json"
}

variable "api_tarefas_min" {
  description = "Mínimo de tarefas da API (uma por zona, no mínimo)."
  type        = number
  default     = 3
}

variable "api_tarefas_max" {
  description = "Máximo de tarefas da API no autoscaling."
  type        = number
  default     = 30
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memoria" {
  type    = number
  default = 1024
}

variable "ingestor_cpu" {
  type    = number
  default = 512
}

variable "ingestor_memoria" {
  type    = number
  default = 1024
}

variable "rds_classe" {
  description = "Classe da instância PostgreSQL."
  type        = string
  default     = "db.t4g.medium"
}

variable "redis_tipo" {
  description = "Tipo de nó do ElastiCache."
  type        = string
  default     = "cache.t4g.small"
}

variable "waf_limite_por_ip" {
  description = "Requisições por IP a cada 5 minutos antes do bloqueio. Generoso por causa de CGNAT nas operadoras móveis."
  type        = number
  default     = 6000
}

variable "protecao_exclusao" {
  description = "Protege o banco contra exclusão e exige snapshot final."
  type        = bool
  default     = true
}
