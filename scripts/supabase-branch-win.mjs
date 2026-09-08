// Transporte Windows do runbook de preview: sem Docker, CLI/psql ou credenciais no log.
// A entrada canônica continua scripts/supabase-branch.sh.
import { readFile } from 'node:fs/promises';
const parent = 'jsjsmuncfkbsbzqzqhfq';
const retired = 'bcfadphgsibjzivtbjvc';
const [action, target, file] = process.argv.slice(2);
const envFile = await readFile('.env.development', 'utf8');
const token = process.env.SUPABASE_ACCESS_TOKEN || envFile.split(/\r?\n/).filter((line) => line.startsWith('SUPABASE_ACCESS_TOKEN=')).map((line) => line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')).find((value) => value.startsWith('sbp_'));
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente');
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.supabase.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : null;
}
const branches = await api(`projects/${parent}/branches`);
if (action === 'listar') {
  console.log(JSON.stringify(branches.map(({ id, name, project_ref, is_default, status }) => ({ id, name, project_ref, is_default, status }))));
} else if (action === 'criar') {
  if (!/^qa-studio-[a-z0-9-]+$/.test(target ?? '')) throw new Error('Use nome qa-studio-<slug>');
  if (branches.some((branch) => !branch.is_default)) throw new Error('Já existe uma branch de preview; não criar uma segunda');
  const branch = await api(`projects/${parent}/branches`, 'POST', { branch_name: target, persistent: false, with_data: false });
  console.log(JSON.stringify({ name: branch.name, ref: branch.project_ref, status: branch.status }));
  console.log('Preview criada, ainda NÃO preparada. Conferir o ledger fantasma e aplicar o baseline conforme runbook antes de validar. Encerrar no mesmo dia.');
} else {
  if (!/^[a-z]{20}$/.test(target ?? '') || [parent, retired].includes(target)) throw new Error('Alvo recusado: só ref de preview');
  const branch = branches.find((item) => item.project_ref === target);
  if (!branch || branch.is_default || !branch.name.startsWith('qa-studio-')) throw new Error('Preview não pertence a esta validação');
  if (action === 'sql') {
    if (!file) throw new Error('Informe arquivo SQL revisado');
    console.log(JSON.stringify(await api(`projects/${target}/database/query`, 'POST', { query: await readFile(file, 'utf8') })));
  } else if (action === 'derrubar') {
    await api(`branches/${branch.id}`, 'DELETE');
    console.log(`Preview ${target} encerrada. Nenhum dado de produção foi removido.`);
  } else throw new Error('Ações: listar | criar qa-studio-<slug> | sql <preview-ref> <arquivo> | derrubar <preview-ref>');
}
