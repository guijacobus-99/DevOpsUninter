#!/usr/bin/env bash
# Roda o teste de carga contra a borda (ou contra a origem, com ALVO=origem) e compara quantas
# requisições chegaram à API, para medir o efeito do cache e da coalescência.
#
#   TAXA=3000 PATAMAR=1m ./scripts/carga/rodar.sh
#   ALVO=origem TAXA=3000 ./scripts/carga/rodar.sh      # direto na API, sem borda
set -euo pipefail
cd "$(dirname "$0")/../.."

ALVO="${ALVO:-borda}"
TAXA="${TAXA:-2000}"
PATAMAR="${PATAMAR:-1m}"
PROMETHEUS="${PROMETHEUS_URL:-http://127.0.0.1:9090}"
REDE="$(docker compose ps -q web | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
BASE="http://web:8080"
[ "$ALVO" = "origem" ] && BASE="http://api:3000"

total_origem() {
  curl -fsS "$PROMETHEUS/api/v1/query" --data-urlencode \
    'query=sum(http_requisicoes_total{rota=~"/api/.*"})' |
    python3 -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else 0)'
}

antes="$(total_origem)"
docker run --rm -i --network "$REDE" -e BASE="$BASE" -e TAXA="$TAXA" -e PATAMAR="$PATAMAR" \
  -v "$PWD/scripts/carga:/scripts:ro" grafana/k6:1.3.0 run --quiet /scripts/apuracao.js
sleep 6 # espera o próximo scrape do Prometheus
depois="$(total_origem)"
python3 -c "print(f'\nRequisições que chegaram à origem (API) durante o teste: {float($depois) - float($antes):.0f}')"
