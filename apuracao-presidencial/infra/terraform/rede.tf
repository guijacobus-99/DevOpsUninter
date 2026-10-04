# VPC em 3 zonas: sub-redes públicas (ALB e NAT) e privadas (tarefas, banco e Redis).
resource "aws_vpc" "principal" {
  cidr_block           = var.cidr_vpc
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.nome }
}

resource "aws_internet_gateway" "principal" {
  vpc_id = aws_vpc.principal.id
  tags   = { Name = local.nome }
}

resource "aws_subnet" "publica" {
  count             = 3
  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(var.cidr_vpc, 8, count.index)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.nome}-publica-${local.azs[count.index]}" }
}

resource "aws_subnet" "privada" {
  count             = 3
  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(var.cidr_vpc, 8, count.index + 10)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.nome}-privada-${local.azs[count.index]}" }
}

resource "aws_eip" "nat" {
  count  = local.qtd_nat
  domain = "vpc"
  tags   = { Name = "${local.nome}-nat-${count.index}" }
}

# Saída para a internet das sub-redes privadas (o ingestor precisa alcançar o TSE).
resource "aws_nat_gateway" "principal" {
  count         = local.qtd_nat
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.publica[count.index].id
  tags          = { Name = "${local.nome}-nat-${count.index}" }
  depends_on    = [aws_internet_gateway.principal]
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principal.id
  }
  tags = { Name = "${local.nome}-publica" }
}

resource "aws_route_table_association" "publica" {
  count          = 3
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

resource "aws_route_table" "privada" {
  count  = 3
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.principal[var.nat_por_az ? count.index : 0].id
  }
  tags = { Name = "${local.nome}-privada-${local.azs[count.index]}" }
}

resource "aws_route_table_association" "privada" {
  count          = 3
  subnet_id      = aws_subnet.privada[count.index].id
  route_table_id = aws_route_table.privada[count.index].id
}
