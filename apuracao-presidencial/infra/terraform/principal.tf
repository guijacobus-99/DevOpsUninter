locals {
  nome = "${var.nome}-${var.ambiente}"
  tags = {
    projeto        = var.nome
    ambiente       = var.ambiente
    gerenciado_por = "terraform"
  }
  azs     = slice(data.aws_availability_zones.disponiveis.names, 0, 3)
  qtd_nat = var.nat_por_az ? 3 : 1
}

data "aws_availability_zones" "disponiveis" {
  state = "available"
}
