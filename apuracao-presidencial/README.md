# Apuração presidencial

Arquitetura e implementação de referência de um site que acompanha, em tempo real, a apuração da
eleição para Presidente a partir dos dados oficiais do TSE. Foi pensada para aguentar o pico da
noite da eleição, nunca publicar número inconsistente e ser monitorada pelo que importa: o
frescor e a qualidade do dado.

📐 **Documento de arquitetura completo: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)**

![Site](docs/img/site.png)

> Os dados acima são **fictícios**, gerados pelo simulador do TSE incluído no projeto.

## Visão rápida

```
TSE ──GET condicional──▶ Ingestor ──▶ PostgreSQL (auditoria + histórico)
                            │
                            └──SET + PUBLISH──▶ Redis ──▶ API (N réplicas, memória) ──▶ CDN/borda ──▶ navegador
                                                                                          cache 5 s
Prometheus ◀── métricas (ingestor, API) ──▶ Grafana · Alertmanager ──▶ sala de guerra / plantão
```

- **Ingestor:** coleta os 29 arquivos (BR, 27 UFs, exterior), deduplica por hash, normaliza,
  aplica regras de qualidade, grava a camada bruta e a normalizada e publica. Roda em duas
  instâncias: uma líder (advisory lock no Postgres) e uma em espera, que assume em ~5 s.
- **API:** somente leitura e sem estado; serve da memória com ETag e cabeçalhos de cache para a CDN.
- **Borda:** cache de 5 s, coalescência de requisições e "servir o último dado bom" se a origem cair.
- **Observabilidade:** idade do dado, snapshots rejeitados por regra, divergência BR × UFs,
  golden signals da API, 16 alertas roteados pelo Alertmanager e um painel provisionado.
- **Produção:** Terraform para AWS (CloudFront + WAF, ECS Fargate, RDS, ElastiCache) e CD que
  publica as imagens no GHCR e implanta.

## Estrutura

```
apuracao-presidencial/
├── docs/ARQUITETURA.md        # documento de arquitetura (diagramas, decisões, capacidade, SLOs)
├── docker-compose.yml         # ambiente completo local
├── docker-compose.replay.yml  # override: reproduz uma gravação real do feed
├── docker-compose.carga.yml   # override: teste de carga (sem limite por IP)
├── .env.example
├── services/
│   ├── mock-tse/              # simulador do TSE (dados fictícios, falhas, modo replay)
│   ├── ingestor/              # coleta → valida → Postgres → Redis
│   │   ├── sql/               # esquema (aplicado pelo ingestor líder no boot)
│   │   └── src/cli/feed.js    # valida e grava o feed real do TSE
│   └── api/                   # API somente leitura (origem da CDN)
├── web/                       # front-end React + nginx (papel da CDN no ambiente local)
├── infra/
│   ├── prometheus/            # coleta e regras de alerta
│   ├── alertmanager/          # roteamento, inibição e receptor local
│   ├── grafana/               # datasource e painel provisionados
│   └── terraform/             # infraestrutura na AWS
└── scripts/
    ├── smoke-test.sh          # teste de fumaça ponta a ponta (CI e produção)
    └── carga/                 # teste de carga com k6
```

Pipelines: [CI](../.github/workflows/apuracao-ci.yml) (testes, Trivy, Terraform, ponta a ponta) e
[CD](../.github/workflows/apuracao-cd.yml) (GHCR + implantação na AWS).

## Como rodar

Pré-requisito: Docker com Compose v2.

```bash
cd apuracao-presidencial
cp .env.example .env          # opcional: ajusta duração da simulação, taxa de falhas etc.
docker compose up -d --build
./scripts/smoke-test.sh       # confere se está tudo de pé
```

| Endereço | O quê |
|---|---|
| http://localhost:8080 | Site |
| http://localhost:8080/api/v1/resultados/br | API (também `/sp`, `/zz` … e `/api/v1/resultados` para o resumo) |
| http://localhost:3001 | Grafana (abre direto no painel; usuário `admin`, senha `admin`) |
| http://localhost:9090/alerts | Prometheus, com o estado dos alertas |
| http://localhost:9093 | Alertmanager (notificações em `docker compose logs -f receptor-alertas`) |
| http://localhost:8081 | Simulador do TSE |

Por padrão a apuração simulada leva 15 minutos para chegar a 100% (`SIM_DURACAO_S`). Para
recomeçar do zero: `docker compose down -v && docker compose up -d`.

![Painel do Grafana](docs/img/grafana.png)

## Desenvolvimento

```bash
# testes unitários (Node 22, test runner nativo)
cd services/ingestor && npm ci && npm test
cd services/api      && npm ci && npm test
cd services/mock-tse && npm test

# front-end com hot reload, usando o backend do compose
cd web && npm ci && npm run dev   # http://localhost:5173 (proxy de /api para :8080)
```

## Explorando os dados

O Postgres fica exposto só em `127.0.0.1:5432` (usuário/senha/banco `apuracao`):

```bash
docker compose exec postgres psql -U apuracao -d apuracao
```

```sql
-- o que foi rejeitado e por quê
SELECT abrangencia, recebido_em, motivo FROM snapshot_bruto WHERE status = 'rejeitado';

-- atraso entre a geração no TSE e a chegada ao banco
SELECT abrangencia, max(atraso) FROM vw_atraso_ingestao GROUP BY 1 ORDER BY 2 DESC;

-- evolução dos candidatos no Brasil
SELECT gerado_em, pct_secoes, nome, pct FROM vw_evolucao_candidato WHERE abrangencia = 'BR';
```

## Simulando falhas

| Cenário | Como | O que observar |
|---|---|---|
| TSE instável | `FALHA_TAXA_5XX=0.3 docker compose up -d mock-tse` | Painel "Coletas por resultado"; alerta `FonteComFalhas` |
| TSE publicando arquivo inconsistente | `FALHA_TAXA_INCONSISTENTE=0.2 docker compose up -d mock-tse` | Snapshots rejeitados no painel e em `snapshot_bruto`; o site não exibe o dado ruim |
| TSE fora do ar | `docker compose stop mock-tse` | O site segue com o último dado; aviso de desatualizado após 3 min |
| API inteira fora | `docker compose stop api` | A borda responde `X-Cache-Status: STALE` com o último dado |
| Redis perdeu tudo | `docker compose exec redis redis-cli flushall` | O ingestor republica em até 60 s; as APIs nem percebem |
| Ingestor líder cai | `docker kill apuracao-ingestor-1` (ou o que tiver `ingestor_lider 1`) | A instância em espera assume em ~5 s e reidrata a partir do Postgres |

Recriar o `mock-tse` reinicia a apuração simulada do zero. O ingestor publica os novos arquivos
(são mais recentes) e acusa `regressao_secoes`/`regressao_votos`: é o comportamento esperado e
serve para ver o alerta `RegressaoNaApuracao` em ação.

## Validando e gravando o feed real do TSE

A CLI do ingestor confere se o feed real bate com o que o adaptador espera e grava o feed para
reproduzir depois:

```bash
cd services/ingestor && npm ci
npm run feed -- validar                                   # descobre a eleição no ele-c.json
npm run feed -- validar --eleicao <código> --turno 1
npm run feed -- gravar --saida ../../gravacoes/$(date +%F) --intervalo 15 --parar-em-100
```

O `validar` mostra, para as 29 abrangências, o HTTP, o % de seções e as violações de regra, e
lista os campos esperados que não vieram e os que vieram e são ignorados. Sai com código 1 se
algo falhar.

Para reproduzir uma gravação no lugar da simulação (o `ELEICAO` precisa ser o da gravação):

```bash
REPLAY_DIR=./gravacoes/2026-10-04 ELEICAO=<código> REPLAY_VELOCIDADE=10 \
  docker compose -f docker-compose.yml -f docker-compose.replay.yml up -d
```

## Teste de carga

```bash
docker compose -f docker-compose.yml -f docker-compose.carga.yml up -d   # desliga o limite por IP
TAXA=3000 PATAMAR=1m ./scripts/carga/rodar.sh                           # contra a borda
ALVO=origem TAXA=3000 ./scripts/carga/rodar.sh                          # direto na API
```

Medido numa máquina de 4 vCPUs: 210 mil requisições na borda a 3.000 req/s com 0 erros e p99 de
3,2 ms, e só 194 chegaram à API (99,9% absorvidas pelo cache). Detalhes na seção 11.1 do
[documento de arquitetura](docs/ARQUITETURA.md#111-teste-de-carga-medido).

## Implantação na AWS

O Terraform em [`infra/terraform/`](infra/terraform) cria VPC em 3 zonas, CloudFront + WAF + S3,
ALB, ECS Fargate (API com autoscaling e ingestor líder/espera), RDS PostgreSQL e ElastiCache Redis,
todos Multi-AZ, em `sa-east-1`.

```bash
cd infra/terraform
cp backend.hcl.exemplo backend.hcl          # bucket do estado remoto
cp producao.tfvars.exemplo producao.tfvars  # código da eleição etc.
terraform init -backend-config=backend.hcl
terraform plan -var-file=producao.tfvars
```

O CD (`apuracao-cd.yml`) publica as imagens no GHCR a cada merge na `main` e, se o repositório
tiver as variáveis `AWS_ROLE_ARN`, `TF_STATE_BUCKET` e `ELEICAO`, aplica o Terraform (ambiente
`producao`, com aprovação), publica o front-end no S3 e roda o smoke test em produção.
Se os pacotes no GHCR ficarem privados (padrão em algumas contas), torne-os públicos ou crie um
segredo com usuário/token do GHCR e informe o ARN em `credenciais_registro_arn`.

## Usando o feed real do TSE

Depois de validar com a CLI acima, aponte o ingestor para o TSE no `.env` e marque a fonte como
oficial:

```bash
ELEICAO=<código da eleição no ele-c.json do TSE>
TURNO=1
FONTE_URL_TEMPLATE=https://resultados.tse.jus.br/oficial/ele2026/{eleicao}/dados-simplificados/{abr}/{abr}-c0001-e{eleicao6}-r.json
FONTE_NOME=tse
```

⚠️ O adaptador (`services/ingestor/src/normalizar.js`) segue o layout publicado pelo TSE em 2022 e
**ainda não foi validado contra o feed de 2026**. Antes de qualquer uso real, rode
`npm run feed -- validar` e confira o mapeamento campo a campo (seção 19 do
[documento de arquitetura](docs/ARQUITETURA.md#19-pendências-e-próximos-passos)).
Se o layout divergir, a regra de esquema rejeita os arquivos e o alerta `RejeicaoPersistente`
dispara; nenhum dado errado é publicado.
