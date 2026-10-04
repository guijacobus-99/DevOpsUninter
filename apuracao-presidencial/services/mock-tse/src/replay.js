// Modo replay: reproduz uma gravação real do feed (feita com `ingestor/src/cli/feed.js gravar`)
// em velocidade acelerada. Cada arquivo é servido no momento proporcional à sua geração no
// TSE, e a data/hora de geração é reescrita para o relógio atual, para que as métricas de
// frescor do ingestor continuem fazendo sentido.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// "04/10/2026" + "19:42:10" (Brasília, UTC-3) -> epoch em ms
export function epochBrasilia(dg, hg) {
  const [d, m, a] = String(dg).split('/').map(Number);
  const [h, min, s] = String(hg).split(':').map(Number);
  return Date.UTC(a, m - 1, d, h + 3, min, s);
}

function formatarBrasilia(ms) {
  const d = new Date(ms - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    dg: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hg: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
  };
}

// Lê <dir>/<ABR>/*.json. Retorna { porAbrangencia: Map(abr -> [{ t, arquivo }] ordenado), t0, tFim, eleicao, turno }.
export async function carregarGravacao(dir) {
  const porAbrangencia = new Map();
  let t0 = Infinity;
  let tFim = -Infinity;
  let eleicao;
  let turno;

  const entradas = await readdir(dir, { withFileTypes: true });
  for (const entrada of entradas) {
    if (!entrada.isDirectory() || !/^[A-Z]{2}$/.test(entrada.name)) continue;
    const versoes = [];
    for (const nome of (await readdir(join(dir, entrada.name))).filter((n) => n.endsWith('.json'))) {
      const arquivo = JSON.parse(await readFile(join(dir, entrada.name, nome), 'utf8'));
      const t = epochBrasilia(arquivo.dg, arquivo.hg);
      if (Number.isNaN(t)) continue;
      versoes.push({ t, arquivo });
      t0 = Math.min(t0, t);
      tFim = Math.max(tFim, t);
      eleicao ??= arquivo.ele;
      turno ??= arquivo.t;
    }
    versoes.sort((a, b) => a.t - b.t);
    if (versoes.length > 0) porAbrangencia.set(entrada.name, versoes);
  }
  if (porAbrangencia.size === 0) throw new Error(`nenhum arquivo de gravação encontrado em ${dir}`);
  return { porAbrangencia, t0, tFim, eleicao, turno };
}

export function criarReplay(gravacao, { velocidade = 10, inicio = Date.now() } = {}) {
  const { porAbrangencia, t0, tFim } = gravacao;
  const duracaoMs = (tFim - t0) / velocidade;

  return {
    duracaoMs,
    // Versão do arquivo de uma abrangência no instante `agora` (ou null se ainda não "publicada").
    arquivo(abr, agora = Date.now()) {
      const versoes = porAbrangencia.get(abr);
      if (!versoes) return null;
      const alvo = t0 + Math.min(agora - inicio, duracaoMs) * velocidade;
      let escolhida = null;
      for (const v of versoes) {
        if (v.t > alvo) break;
        escolhida = v;
      }
      if (!escolhida) return null;
      const { dg, hg } = formatarBrasilia(inicio + (escolhida.t - t0) / velocidade);
      return { ...structuredClone(escolhida.arquivo), dg, hg };
    },
  };
}
