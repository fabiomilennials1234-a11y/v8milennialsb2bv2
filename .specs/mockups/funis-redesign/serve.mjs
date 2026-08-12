// Servidor estático mínimo para o protótipo da aba de Funis do Torque.
// Uso: node serve.mjs  ->  http://localhost:8901
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8901);

// Onde procurar cada arquivo, em ordem. O segundo caminho resolve pra
// `src/assets` quando o protótipo mora em `.specs/mockups/funis-redesign/`
// dentro do repo — assim o logo é o arquivo real do produto e não uma cópia
// do binário. Fora do repo esse caminho simplesmente não existe e vale o
// primeiro, que é a própria pasta.
const BASES = [ROOT, fileURLToPath(new URL('../../../src/assets/', import.meta.url))];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pedido = url.pathname === '/' ? '/index.html' : url.pathname;
  const rel = normalize(pedido).replace(/^(\.\.[/\\])+/, '');

  for (const base of BASES) {
    try {
      const body = await readFile(join(base, rel));
      res.writeHead(200, {
        'Content-Type': MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    } catch { /* tenta a próxima base */ }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — não encontrado');
}).listen(PORT, () => {
  console.log(`\n  Protótipo da aba de Funis (Torque) rodando em:\n  http://localhost:${PORT}\n`);
});
