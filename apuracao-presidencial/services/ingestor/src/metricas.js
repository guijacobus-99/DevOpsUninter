import client from 'prom-client';

export const registro = new client.Registry();
client.collectDefaultMetrics({ register: registro });

const metrica = (Tipo, opcoes) => new Tipo({ registers: [registro], ...opcoes });

// resultado: novo | nao_modificado | duplicado | erro_http | erro_rede
export const coletas = metrica(client.Counter, {
  name: 'ingestor_coletas_total',
  help: 'Requisições à fonte (TSE) por resultado',
  labelNames: ['abrangencia', 'resultado'],
});

export const duracaoColeta = metrica(client.Histogram, {
  name: 'ingestor_coleta_duracao_segundos',
  help: 'Latência das requisições à fonte',
  labelNames: ['abrangencia'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4],
});

// status: aceito | rejeitado | desatualizado
export const snapshots = metrica(client.Counter, {
  name: 'ingestor_snapshots_total',
  help: 'Snapshots novos processados, por desfecho',
  labelNames: ['abrangencia', 'status'],
});

export const violacoes = metrica(client.Counter, {
  name: 'ingestor_violacoes_total',
  help: 'Violações de regras de qualidade de dados',
  labelNames: ['abrangencia', 'regra', 'severidade'],
});

export const falhasPersistencia = metrica(client.Counter, {
  name: 'ingestor_falhas_persistencia_total',
  help: 'Falhas ao gravar no Postgres ou publicar no Redis (o snapshot é reprocessado no próximo ciclo)',
  labelNames: ['destino'],
});

export const duracaoCiclo = metrica(client.Histogram, {
  name: 'ingestor_ciclo_duracao_segundos',
  help: 'Duração de um ciclo completo de coleta (todas as abrangências)',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const lider = metrica(client.Gauge, {
  name: 'ingestor_lider',
  help: '1 se esta instância é o ingestor líder (coleta e publica); 0 se está em espera',
});

export const ultimoCiclo = metrica(client.Gauge, {
  name: 'ingestor_ultimo_ciclo_timestamp_segundos',
  help: 'Momento em que o último ciclo de coleta terminou',
});

export const pctSecoes = metrica(client.Gauge, {
  name: 'apuracao_secoes_totalizadas_pct',
  help: 'Percentual de seções totalizadas no último snapshot aceito',
  labelNames: ['abrangencia'],
});

export const votosCandidato = metrica(client.Gauge, {
  name: 'apuracao_votos_candidato',
  help: 'Votos do candidato no último snapshot aceito',
  labelNames: ['abrangencia', 'candidato'],
});

export const divergencia = metrica(client.Gauge, {
  name: 'apuracao_divergencia_consolidacao',
  help: 'Diferença absoluta entre o arquivo BR e a soma de UFs + exterior',
  labelNames: ['campo'],
});

// Idade do dado (agora - data de geração no TSE), calculada no momento do scrape.
const geradoEmPorAbrangencia = new Map();
export function registrarGeradoEm(abr, iso) {
  geradoEmPorAbrangencia.set(abr, Date.parse(iso));
}
metrica(client.Gauge, {
  name: 'ingestor_dados_idade_segundos',
  help: 'Segundos desde a geração (no TSE) do último snapshot aceito',
  labelNames: ['abrangencia'],
  collect() {
    const agora = Date.now();
    for (const [abr, ts] of geradoEmPorAbrangencia) this.set({ abrangencia: abr }, (agora - ts) / 1000);
  },
});

// Contadores com rótulos só passam a existir no primeiro incremento, e `increase()` no
// Prometheus não enxerga o salto de "inexistente" para 1: a primeira rejeição de cada UF
// passaria sem alerta. Por isso todas as combinações conhecidas nascem com valor 0.
export function inicializarSeries(abrangencias, regras) {
  for (const abrangencia of abrangencias) {
    for (const resultado of ['novo', 'nao_modificado', 'duplicado', 'erro_http', 'erro_rede']) {
      coletas.inc({ abrangencia, resultado }, 0);
    }
    for (const status of ['aceito', 'rejeitado', 'desatualizado']) snapshots.inc({ abrangencia, status }, 0);
    for (const [regra, severidade] of regras) violacoes.inc({ abrangencia, regra, severidade }, 0);
  }
  for (const destino of ['postgres', 'redis']) falhasPersistencia.inc({ destino }, 0);
}
