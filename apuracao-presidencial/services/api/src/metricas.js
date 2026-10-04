import client from 'prom-client';

export const registro = new client.Registry();
client.collectDefaultMetrics({ register: registro });

export const requisicoes = new client.Counter({
  name: 'http_requisicoes_total',
  help: 'Requisições HTTP por rota e status',
  labelNames: ['rota', 'status'],
  registers: [registro],
});

export const duracao = new client.Histogram({
  name: 'http_requisicao_duracao_segundos',
  help: 'Latência das requisições HTTP',
  labelNames: ['rota'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registro],
});

// Idade do dado que esta réplica da API está servindo (visão "ponta a ponta").
export function registrarIdade(memoria) {
  new client.Gauge({
    name: 'api_dados_idade_segundos',
    help: 'Segundos desde a geração (no TSE) do snapshot servido por esta réplica',
    labelNames: ['abrangencia'],
    registers: [registro],
    collect() {
      const agora = Date.now();
      for (const [abr, s] of memoria.snapshots) {
        this.set({ abrangencia: abr }, (agora - Date.parse(s.modelo.geradoEm)) / 1000);
      }
    },
  });
}
