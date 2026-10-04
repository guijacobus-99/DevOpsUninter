#!/usr/bin/env bash
# Teste de fumaça ponta a ponta contra o ambiente do docker compose.
# Uso: ./scripts/smoke-test.sh [url-base]   (padrão: http://localhost:8080)
# Com SMOKE_SO_HTTP=1, roda só as verificações HTTP (para produção, sem Docker local).
set -euo pipefail

BASE="${1:-http://localhost:8080}"
PROMETHEUS="${PROMETHEUS_URL:-http://127.0.0.1:9090}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok()    { echo "  ✔ $*"; }
falha() { echo "  ✘ $*" >&2; exit 1; }

echo "1. Aguardando o primeiro resultado nacional..."
for _ in $(seq 1 60); do
  if curl -fsS -o "$TMP/br.json" "$BASE/api/v1/resultados/br" 2>/dev/null; then break; fi
  sleep 2
done
[ -s "$TMP/br.json" ] || falha "API não respondeu 200 em 120 s"
ok "GET /api/v1/resultados/br = 200"

echo "2. Validando invariantes do JSON publicado..."
python3 - "$TMP/br.json" <<'PY' || falha "JSON publicado viola invariantes"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["abrangencia"] == "BR", "abrangência"
assert d["candidatos"], "lista de candidatos vazia"
assert sum(c["votos"] for c in d["candidatos"]) == d["votos"]["validos"], "soma dos candidatos"
assert d["secoes"]["totalizadas"] <= d["secoes"]["total"], "seções"
votos = [c["votos"] for c in d["candidatos"]]
assert votos == sorted(votos, reverse=True), "ordenação"
print(f"    {d['secoes']['pct']}% das seções, gerado em {d['geradoEm']}, fonte={d['fonte']}")
PY
ok "soma dos candidatos = votos válidos; seções coerentes; candidatos ordenados"

echo "3. Verificando cache na borda..."
curl -fsS -o /dev/null "$BASE/api/v1/resultados/br"
# nginx local: X-Cache-Status: HIT | CloudFront: X-Cache: Hit from cloudfront
STATUS_CACHE="$(curl -fsS -D - -o /dev/null "$BASE/api/v1/resultados/br" | tr -d '\r' |
  awk -F': ' 'tolower($1)=="x-cache-status" || tolower($1)=="x-cache" {print $2}')"
[[ "$STATUS_CACHE" =~ ^(HIT|STALE|UPDATING|REVALIDATED|Hit|RefreshHit) ]] || falha "esperava resposta do cache, veio '$STATUS_CACHE'"
ok "cache: $STATUS_CACHE"

echo "4. Verificando respostas de erro e o front-end..."
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/resultados/xx")" = 404 ] || falha "abrangência inválida deveria dar 404"
ok "abrangência inválida = 404"
curl -fsS "$BASE/" | grep -q '<div id="root">' || falha "index.html não servido"
ok "front-end servido"

if [ "${SMOKE_SO_HTTP:-0}" = 1 ]; then
  echo "Verificações HTTP ok (SMOKE_SO_HTTP=1: Postgres e Prometheus não verificados)."
  exit 0
fi

echo "5. Verificando trilha de auditoria no Postgres..."
ACEITOS="$(docker compose exec -T postgres psql -U apuracao -d apuracao -tAc "SELECT count(*) FROM snapshot_bruto WHERE status = 'aceito'")"
[ "${ACEITOS:-0}" -gt 0 ] || falha "nenhum snapshot aceito no banco"
ok "$ACEITOS snapshots aceitos registrados"

echo "6. Verificando alvos do Prometheus..."
# Num ambiente recém-criado, o primeiro scrape e a descoberta por DNS levam alguns segundos.
python3 - "$PROMETHEUS" <<'PY' || falha "alvo do Prometheus fora do ar"
import json, sys, time, urllib.request
for tentativa in range(30):
    alvos = json.load(urllib.request.urlopen(f"{sys.argv[1]}/api/v1/targets"))["data"]["activeTargets"]
    jobs = {a["labels"]["job"] for a in alvos}
    fora = [f'{a["scrapeUrl"]} ({a["health"]})' for a in alvos if a["health"] != "up"]
    if {"ingestor", "api"} <= jobs and not fora:
        print(f"    {len(alvos)} alvos up")
        sys.exit(0)
    time.sleep(2)
print(f"    jobs: {jobs}; fora do ar: {fora}", file=sys.stderr)
sys.exit(1)
PY
ok "ingestor e API sendo coletados"

echo "Tudo certo."
