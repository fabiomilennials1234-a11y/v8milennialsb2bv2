/**
 * Baixa TODAS as imagens da KB da Forever Bella (agente Bia) para inspeção visual,
 * nomeando cada arquivo pelo file_name cadastrado. Serve para verificar se o
 * CONTEÚDO (bytes) de cada foto corresponde ao nome/descrição no cadastro.
 *
 * Requer service_role (bucket agent-documents é privado). NÃO commitar a chave.
 *
 * Uso (PowerShell):
 *   $env:SERVICE_ROLE="sb_secret_xxx"; node scripts/baixar-fotos-bia.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ORG = 'bf08ec2b-b7df-4fb7-b47a-f29dfbe2e6ea'; // Forever Bella
const BUCKET = 'agent-documents';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const service = process.env.SERVICE_ROLE || env.match(/^SERVICE_ROLE=(.+)$/m)?.[1]?.trim();

if (!url || !service) {
  console.error('Faltando VITE_SUPABASE_URL (.env.local) ou SERVICE_ROLE (env var).');
  process.exit(1);
}

const outDir = join(__dirname, '..', '_bia-kb-download');
mkdirSync(outDir, { recursive: true });

const supabase = createClient(url, service, { auth: { persistSession: false } });

const { data: docs, error } = await supabase
  .from('copilot_agent_documents')
  .select('file_name, file_path, file_type')
  .eq('organization_id', ORG)
  .eq('file_type', 'image')
  .order('file_name');

if (error) {
  console.error('Erro ao listar docs:', error.message);
  process.exit(1);
}

console.log(`${docs.length} imagens na KB. Baixando para ${outDir} ...`);

for (const d of docs) {
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(d.file_path);
  if (dlErr || !blob) {
    console.error(`  FALHOU: ${d.file_name} -> ${dlErr?.message}`);
    continue;
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  // nome seguro para o filesystem, preservando o nome cadastrado
  const safe = d.file_name.replace(/[\\/:*?"<>|]/g, '_');
  writeFileSync(join(outDir, safe), buf);
  console.log(`  OK: ${d.file_name} (${buf.length} bytes)`);
}

console.log('Pronto. Pasta: _bia-kb-download');
