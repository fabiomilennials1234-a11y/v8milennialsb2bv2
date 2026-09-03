/**
 * SCRUM-639 — instrumento da janela de 7 dias que autoriza o DROP dos espelhos.
 *
 * POR QUE UM SCRIPT E NÃO UMA QUERY
 * ---------------------------------
 * `pg_stat_statements` não tem `last_call` na 1.11 (é 1.12+). O que ele tem é
 * `calls` acumulado desde `stats_since`. "Ninguém leu nos últimos 7 dias" só se
 * mede por DIFERENÇA entre dois instantes — e a diferença precisa de um lugar
 * onde o instante anterior fique guardado. É este script: 1 execução/dia,
 * commitando o JSON, e o dia em que TODOS os deltas derem 0 começa a contar.
 *
 * LIMITE, dito na cara: pgss está em ~4880/5000 entradas e evicta por LRU.
 * Presença de entrada PROVA chamada; ausência NÃO prova silêncio — uma entrada
 * evictada e recriada volta com `calls` menor que o baseline, e o delta sai
 * NEGATIVO. Delta negativo NÃO é "zero leitor": é "perdi a régua". O script
 * marca esse caso como `EVICTED` e ele invalida o dia, não o aprova.
 *
 * `runtime_logs` foi descartado como fonte: 381.726 linhas em 7 dias, ZERO
 * mencionando qualquer um dos 6 nomes. Ele registra ação de negócio, não nome
 * de relação — não enxerga leitura de view.
 *
 * Uso:
 *   node scripts/medir-leitores-espelhos.mjs            # mede e compara
 *   node scripts/medir-leitores-espelhos.mjs --baseline # grava o 1º snapshot
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';
const DIR = '.specs/features/funis-unificacao/medicoes';

const ALVOS = [
  'pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas',
  'custom_pipe_entries', 'custom_pipelines', 'custom_pipeline_stages',
  'bulk_add_to_custom_pipe', 'custom_pipeline_delete_impact',
  'delete_custom_pipeline', 'delete_system_pipeline',
  'get_custom_filtered_lead_ids', 'get_custom_pipeline_stage_counts',
  'system_pipeline_delete_impact', 'system_stage_role',
];

// Mesmo filtro da guarda G3 da migration: só papéis de aplicação, sem DDL nem
// meta-consulta. Se este filtro mudar, mude nos dois lugares — a migration
// compara contra o número que este script produz.
const SQL = `
with alvo(nome) as (values ${ALVOS.map((n) => `('${n}')`).join(',')})
select a.nome,
       coalesce(sum(s.calls),0)::text as calls,
       count(s.queryid) as stmts,
       coalesce(max(s.stats_since)::text,'') as newest_stats_since
  from alvo a
  left join pg_stat_statements s
    on s.query ~ ('\\m'||a.nome||'\\M')
   and s.userid in (select oid from pg_roles where rolname in ('authenticated','anon','service_role'))
   and s.query !~* '(^\\s*(create|drop|comment|grant|revoke|alter|do)\\M|pg_stat_statements|pg_get_functiondef|pg_get_viewdef|demolicao_dos_espelhos)'
 group by 1 order by 1`;

let token = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
const linhas = await res.json();

mkdirSync(DIR, { recursive: true });
const agora = new Date().toISOString();
const arquivo = join(DIR, `${agora.slice(0, 10)}.json`);

const anteriores = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.json') && join(DIR, f) !== arquivo).sort()
  : [];
const anterior = anteriores.length ? JSON.parse(readFileSync(join(DIR, anteriores.at(-1)), 'utf8')) : null;

writeFileSync(arquivo, JSON.stringify({ medido_em: agora, linhas }, null, 2) + '\n');

if (!anterior) {
  console.log(`Baseline gravado em ${arquivo}. Rode de novo amanhã para ter delta.`);
  for (const l of linhas) console.log(`  ${l.nome.padEnd(34)} calls=${l.calls}`);
  process.exit(0);
}

const antes = new Map(anterior.linhas.map((l) => [l.nome, Number(l.calls)]));
console.log(`Janela: ${anterior.medido_em} → ${agora}\n`);
let veredito = 'ZERO';
for (const l of linhas) {
  const d = Number(l.calls) - (antes.get(l.nome) ?? 0);
  let marca;
  if (d > 0) { marca = 'LEITOR VIVO'; veredito = 'REPROVA'; }
  else if (d < 0) { marca = 'EVICTED — dia inválido'; if (veredito !== 'REPROVA') veredito = 'INVALIDO'; }
  else marca = 'zero';
  console.log(`  ${l.nome.padEnd(34)} ${String(d).padStart(8)}  ${marca}`);
}
console.log(`\nVEREDITO DO DIA: ${veredito}`);
console.log(veredito === 'ZERO'
  ? '  Conta este dia na janela de 7. Sete ZEROs seguidos liberam o DROP.'
  : '  A janela ZERA. Não aplique a 20270920000000.');
process.exit(veredito === 'ZERO' ? 0 : 1);
