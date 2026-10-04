// Logs estruturados em JSON (uma linha por evento) para facilitar a coleta centralizada.
function escrever(nivel, msg, campos) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel, servico: 'ingestor', msg, ...campos }));
}

export const log = {
  info: (msg, campos) => escrever('info', msg, campos),
  warn: (msg, campos) => escrever('warn', msg, campos),
  error: (msg, campos) => escrever('error', msg, campos),
};
