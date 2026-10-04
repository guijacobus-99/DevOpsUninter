// Aplica os arquivos de sql/ em ordem alfabética. Cada arquivo é idempotente; o ingestor só
// chama isto depois de virar líder, então nunca há duas instâncias aplicando DDL ao mesmo tempo.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIRETORIO = fileURLToPath(new URL('../sql/', import.meta.url));

export async function aplicarMigracoes(executar, log) {
  const arquivos = (await readdir(DIRETORIO)).filter((n) => n.endsWith('.sql')).sort();
  for (const nome of arquivos) {
    await executar(await readFile(join(DIRETORIO, nome), 'utf8'));
    log.info('migração aplicada', { arquivo: nome });
  }
}
