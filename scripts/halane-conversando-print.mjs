/**
 * Gera um HTML print-friendly dos leads da Halane (Hellayne) na coluna "Conversando".
 * Lê o SUPABASE_ACCESS_TOKEN do .env.local (mesmo padrão do prod-sql-win.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const token = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)[1].trim();

const query = `
SELECT row_number() OVER (ORDER BY l.updated_at DESC) AS n,
       l.name, l.phone, to_char(l.updated_at,'DD/MM/YYYY') AS atualizado
FROM pipeline_entries pe
JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug='whatsapp'
JOIN leads l ON l.id = pe.lead_id
WHERE pe.organization_id='163874dd-d05c-4ae2-811a-d6772b05dac5'
  AND pe.stage_key='respondeu'
  AND l.responsible_id='b7a0a031-7f87-45d6-b8d2-777728c34440'
ORDER BY l.updated_at DESC;
`;

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const rows = await res.json();

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const trs = rows
  .map(
    (r) =>
      `<tr><td class="n">${r.n}</td><td>${esc(r.name)}</td><td class="tel">${esc(r.phone)}</td><td class="dt">${esc(r.atualizado)}</td></tr>`
  )
  .join('\n');

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Leads Halane — Conversando</title>
<style>
  body{font-family:Inter,Arial,sans-serif;background:#0f1115;color:#e7e9ee;margin:0;padding:32px}
  .card{max-width:820px;margin:0 auto;background:#161a21;border:1px solid #262c37;border-radius:16px;overflow:hidden}
  .head{padding:24px 28px;border-bottom:1px solid #262c37}
  .head h1{margin:0;font-size:20px}
  .head p{margin:6px 0 0;color:#9aa3b2;font-size:14px}
  .badge{display:inline-block;background:#1d5b3a;color:#7ff0b0;font-weight:600;padding:4px 12px;border-radius:999px;font-size:13px;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:10px 28px;border-bottom:1px solid #20252e}
  th{color:#9aa3b2;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.n{color:#6b7280;width:44px}
  td.tel{color:#c7cdd8;font-variant-numeric:tabular-nums}
  td.dt{color:#9aa3b2;white-space:nowrap}
  tr:hover td{background:#1a1f27}
</style></head><body>
<div class="card">
  <div class="head">
    <h1>Leads da Hellayne — coluna “Conversando”</h1>
    <p>Funil WhatsApp · Basic4u · gerado em 09/07/2026</p>
    <span class="badge">${rows.length} leads aparecendo</span>
  </div>
  <table>
    <thead><tr><th>#</th><th>Nome</th><th>Telefone</th><th>Atualizado</th></tr></thead>
    <tbody>
${trs}
    </tbody>
  </table>
</div>
</body></html>`;

const out = 'C:/Users/Lucas/Desktop/Leads-Halane-Conversando.html';
writeFileSync(out, html, 'utf8');
console.log(`OK — ${rows.length} leads. Arquivo: ${out}`);
