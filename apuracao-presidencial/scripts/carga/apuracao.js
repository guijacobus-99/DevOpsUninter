// Teste de carga com k6: imita navegadores fazendo polling da apuração.
// Mistura de rotas parecida com a do front-end: resultado da abrangência aberta (maioria BR),
// resumo por estado e, de vez em quando, uma UF. Cada usuário virtual guarda o ETag e
// revalida com If-None-Match, como o navegador faz com `cache: 'no-cache'`.
//
// Variáveis: BASE (padrão http://web:8080), TAXA (req/s no patamar), PATAMAR (duração).
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://web:8080';
const TAXA = Number(__ENV.TAXA || 2000);
const PATAMAR = __ENV.PATAMAR || '1m';
const UFS = ['sp', 'mg', 'rj', 'ba', 'rs', 'pr', 'pe', 'ce', 'pa', 'sc', 'go', 'zz'];

export const options = {
  discardResponseBodies: true,
  scenarios: {
    navegadores: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 3000,
      stages: [
        { target: TAXA, duration: '15s' },
        { target: TAXA, duration: PATAMAR },
        { target: 0, duration: '5s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const etags = {}; // por usuário virtual (cada VU tem seu próprio escopo de módulo)

function escolherRota() {
  const r = Math.random();
  if (r < 0.6) return '/api/v1/resultados/br';
  if (r < 0.9) return '/api/v1/resultados';
  return `/api/v1/resultados/${UFS[Math.floor(Math.random() * UFS.length)]}`;
}

export default function () {
  const rota = escolherRota();
  const headers = etags[rota] ? { 'If-None-Match': etags[rota] } : {};
  const res = http.get(`${BASE}${rota}`, { headers, tags: { rota: rota.startsWith('/api/v1/resultados/') && rota !== '/api/v1/resultados/br' ? 'uf' : rota } });
  if (res.headers.Etag) etags[rota] = res.headers.Etag;
  check(res, { '200 ou 304': (r) => r.status === 200 || r.status === 304 });
}
