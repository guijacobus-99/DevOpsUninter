export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];
// BR = consolidado nacional; ZZ = votos no exterior (contam para presidente).
export const ABRANGENCIAS = ['BR', ...UFS, 'ZZ'];

const env = process.env;

export const config = {
  eleicao: env.ELEICAO ?? '9001',
  turno: Number(env.TURNO ?? 1),
  // Padrão de URL do layout de 2022; confirmar o código da eleição de 2026 no ele-c.json do TSE.
  fonteUrlTemplate:
    env.FONTE_URL_TEMPLATE ??
    'http://mock-tse:8080/oficial/ele2026/{eleicao}/dados-simplificados/{abr}/{abr}-c0001-e{eleicao6}-r.json',
  fonteNome: env.FONTE_NOME ?? 'simulada',
  intervaloMs: Number(env.INTERVALO_COLETA_MS ?? 5000),
  timeoutMs: Number(env.TIMEOUT_COLETA_MS ?? 4000),
  concorrencia: Number(env.CONCORRENCIA_COLETA ?? 8),
  databaseUrl: env.DATABASE_URL ?? 'postgres://apuracao:apuracao@localhost:5432/apuracao',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  portaMetricas: Number(env.PORTA_METRICAS ?? 9100),
};

export function urlDaFonte(abr) {
  return config.fonteUrlTemplate
    .replaceAll('{eleicao}', config.eleicao)
    .replaceAll('{eleicao6}', config.eleicao.padStart(6, '0'))
    .replaceAll('{abr}', abr.toLowerCase());
}
