// Transporte Windows do runbook de preview: sem Docker, CLI/psql ou credenciais no log.
// A entrada canônica continua scripts/supabase-branch.sh.
import { readFile } from 'node:fs/promises';
import { withSupabasePreview } from './supabase-preview-lifecycle.mjs';
const parent = 'jsjsmuncfkbsbzqzqhfq';
const retired = 'bcfadphgsibjzivtbjvc';
const [action, target, file] = process.argv.slice(2);
const envFile = process.env.SUPABASE_ACCESS_TOKEN ? '' : await readFile('.env.development', 'utf8');
const token = process.env.SUPABASE_ACCESS_TOKEN || envFile.split(/\r?\n/).filter((line) => line.startsWith('SUPABASE_ACCESS_TOKEN=')).map((line) => line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')).find((value) => value.startsWith('sbp_'));
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente');
async function api(path, method = 'GET', body, timeoutMs = 180_000) {
  const response = await fetch(`https://api.supabase.com/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : null;
}
const branches = await api(`projects/${parent}/branches`);
if (action === 'ensaio') {
  const files = process.argv.slice(4).filter((arg) => !['--allow-concurrent', '--ui'].includes(arg));
  if (!files.length) throw new Error('Informe os arquivos SQL do ensaio');
  // Ler os arquivos antes de criar: erro de caminho não deve gerar cobrança.
  const statements = await Promise.all(files.map(async (path) => ({ path, query: await readFile(path, 'utf8') })));
  await withSupabasePreview({
    name: target,
    allowConcurrent: process.argv.includes('--allow-concurrent'),
    list: () => api(`projects/${parent}/branches`),
    create: (name) => api(`projects/${parent}/branches`, 'POST', { branch_name: name, persistent: false, with_data: false }),
    remove: (id) => api(`branches/${id}`, 'DELETE'),
    onEvent: (event) => console.log(JSON.stringify(event)),
    test: async (ref) => {
      let ready = false;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        try {
          const branch = (await api(`projects/${parent}/branches`)).find((item) => item.project_ref === ref);
          if (['MIGRATIONS_FAILED', 'FUNCTIONS_DEPLOYED', 'ACTIVE_HEALTHY'].includes(branch?.status)) {
            const rows = await api(`projects/${ref}/database/query`, 'POST', {
              query: "SELECT to_regclass('auth.users') IS NOT NULL AND to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ready",
            }, 20_000);
            if (rows?.[0]?.ready === true) { ready = true; break; }
          }
        } catch { /* Provisionamento transitório; prazo limitado e cleanup no finally. */ }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (!ready) throw new Error('Preview não ficou pronta; encerrar sem testar');
      for (const statement of statements) {
        console.log('SQL: ' + statement.path);
        console.log(JSON.stringify(await api(`projects/${ref}/database/query`, 'POST', { query: statement.query })));
      }
      if (process.argv.includes('--ui')) {
        const { verifyStudioUI } = await import('./verify-studio-ui.mjs');
        await verifyStudioUI({ ref, token, api });
      }
    },
  });
} else if (action === 'listar') {
  console.log(JSON.stringify(branches.map(({ id, name, project_ref, is_default, status }) => ({ id, name, project_ref, is_default, status }))));
} else if (action === 'criar') {
  if (!/^qa-studio-[a-z0-9-]+$/.test(target ?? '')) throw new Error('Use nome qa-studio-<slug>');
  if (branches.some((branch) => !branch.is_default)) throw new Error('Já existe uma branch de preview; não criar uma segunda');
  const branch = await api(`projects/${parent}/branches`, 'POST', { branch_name: target, persistent: false, with_data: false });
  console.log(JSON.stringify({ name: branch.name, ref: branch.project_ref, status: branch.status }));
  console.log('Preview criada, ainda NÃO preparada. Conferir o ledger fantasma e aplicar o baseline conforme runbook. Excluir e confirmar ausência imediatamente após o teste; preferir ensaio com cleanup automático.');
} else {
  if (!/^[a-z]{20}$/.test(target ?? '') || [parent, retired].includes(target)) throw new Error('Alvo recusado: só ref de preview');
  const branch = branches.find((item) => item.project_ref === target);
  if (!branch || branch.is_default || !branch.name.startsWith('qa-studio-')) throw new Error('Preview não pertence a esta validação');
  if (action === 'sql') {
    if (!file) throw new Error('Informe arquivo SQL revisado');
    console.log(JSON.stringify(await api(`projects/${target}/database/query`, 'POST', { query: await readFile(file, 'utf8') })));
  } else if (action === 'derrubar') {
    await api(`branches/${branch.id}`, 'DELETE');
    if ((await api(`projects/${parent}/branches`)).some((item) => item.id === branch.id || item.project_ref === target)) {
      throw new Error('Exclusão não confirmada: ' + target + '. Custo pode continuar; conferir Supabase.');
    }
    console.log(`Preview ${target} encerrada. Nenhum dado de produção foi removido.`);
  } else throw new Error('Ações: listar | criar qa-studio-<slug> | sql <preview-ref> <arquivo> | derrubar <preview-ref>');
}
