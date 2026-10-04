// Receptor de webhook do Alertmanager para o ambiente local: imprime cada alerta numa linha.
import { createServer } from 'node:http';

createServer((req, res) => {
  let corpo = '';
  req.on('data', (parte) => { corpo += parte; });
  req.on('end', () => {
    try {
      const { status, alerts = [] } = JSON.parse(corpo);
      for (const a of alerts) {
        const onde = a.labels.abrangencia ? ` [${a.labels.abrangencia}]` : '';
        console.log(`${new Date().toISOString()} ${req.url.slice(1)} ${(a.status ?? status).toUpperCase()} ${a.labels.alertname}${onde} (${a.labels.severidade ?? '-'}): ${a.annotations?.resumo ?? ''}`);
      }
    } catch {
      console.log(`${new Date().toISOString()} payload inválido: ${corpo.slice(0, 200)}`);
    }
    res.end('ok');
  });
}).listen(8080, () => console.log('receptor de alertas ouvindo na porta 8080'));
