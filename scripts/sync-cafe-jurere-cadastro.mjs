// Ensaio por padrão. --apply executa o preenchimento solicitado na Café Jurerê.
// O token de administração deve vir do ambiente, nunca de argumentos ou logs.
const project = 'jsjsmuncfkbsbzqzqhfq';
const organization = '4922638c-4909-494e-ba10-12282ec0b161';
const apply = process.argv.includes('--apply');
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Configure SUPABASE_ACCESS_TOKEN no ambiente.');

const query = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "select value from public.cron_config where key = 'cron_secret'" }),
});
if (!query.ok) throw new Error(`Não foi possível obter autenticação operacional (${query.status}).`);
const config = await query.json();
const secret = config[0]?.value;
if (!secret) throw new Error('Autenticação operacional indisponível.');
const response = await fetch(`https://${project}.supabase.co/functions/v1/toth-sync-clientes`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
  body: JSON.stringify({ organization_id: organization, cadastro_visivel_only: true, dry_run: !apply }),
  signal: AbortSignal.timeout(180_000),
});
const result = await response.json().catch(() => ({}));
// Não imprimir resposta arbitrária: nem um erro do fornecedor pode vazar PII.
if (!response.ok || typeof result.visible !== 'number') throw new Error(`Preenchimento não confirmado (HTTP ${response.status}). Consulte os logs da função.`);
console.log(JSON.stringify(Object.fromEntries(['dry_run', 'visible', 'received', 'planned', 'updated', 'unchanged', 'missing'].map(key => [key, result[key]]))));
