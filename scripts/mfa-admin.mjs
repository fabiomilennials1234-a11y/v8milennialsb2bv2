/**
 * mfa-admin — caminho de recuperação de MFA, fora do app.
 *
 * Existe porque quem perde o celular (formatou, trocou de aparelho, apagou o
 * app sem exportar) fica trancado fora e NENHUM outro master consegue destravar
 * pela interface: `mfa.unenroll()` age só sobre a conta do próprio JWT. Sem esta
 * saída, o primeiro incidente vira intervenção manual no banco.
 *
 * Precisa existir ANTES de o gate de aal2 ser ligado — depois já é tarde.
 *
 * Uso:
 *   node scripts/mfa-admin.mjs list <email>
 *   node scripts/mfa-admin.mjs remove <email>          # remove todos os fatores
 *   node scripts/mfa-admin.mjs remove <email> <factor_id>
 *
 * Token do keychain do Supabase CLI, igual scripts/prod-sql.mjs. Nada é logado.
 */
import { execSync } from 'node:child_process';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';
const [action, email, factorArg] = process.argv.slice(2);

if (!action || !email || !['list', 'remove'].includes(action)) {
  console.error('uso: node scripts/mfa-admin.mjs <list|remove> <email> [factor_id]');
  process.exit(1);
}

let mgmt = execSync('security find-generic-password -s "Supabase CLI" -w', {
  encoding: 'utf8',
}).trim();
if (mgmt.startsWith('go-keyring-base64:')) {
  mgmt = Buffer.from(mgmt.slice('go-keyring-base64:'.length), 'base64')
    .toString('utf8')
    .trim();
}

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${mgmt}` },
  })
).json();
const service = keys.find((k) => k.name === 'service_role')?.api_key;
if (!service) {
  console.error('service_role key não encontrada');
  process.exit(1);
}

const authHeaders = {
  apikey: service,
  Authorization: `Bearer ${service}`,
  'Content-Type': 'application/json',
};

// Resolve o usuário pelo e-mail.
const listRes = await fetch(
  `https://${PROJECT_REF}.supabase.co/auth/v1/admin/users?page=1&per_page=1000`,
  { headers: authHeaders },
);
const { users } = await listRes.json();
const user = users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`usuário não encontrado: ${email}`);
  process.exit(1);
}

const factorsRes = await fetch(
  `https://${PROJECT_REF}.supabase.co/auth/v1/admin/users/${user.id}/factors`,
  { headers: authHeaders },
);
const factors = await factorsRes.json();
const list = Array.isArray(factors) ? factors : (factors.factors ?? []);

console.log(`${user.email}  (${user.id})`);
if (list.length === 0) {
  console.log('  nenhum fator cadastrado');
  process.exit(0);
}
for (const f of list) {
  console.log(`  ${f.id}  ${f.factor_type ?? f.type}  ${f.status}  ${f.friendly_name ?? ''}`);
}

if (action === 'list') process.exit(0);

const targets = factorArg ? list.filter((f) => f.id === factorArg) : list;
if (targets.length === 0) {
  console.error(`fator não encontrado: ${factorArg}`);
  process.exit(1);
}

for (const f of targets) {
  const del = await fetch(
    `https://${PROJECT_REF}.supabase.co/auth/v1/admin/users/${user.id}/factors/${f.id}`,
    { method: 'DELETE', headers: authHeaders },
  );
  console.log(`removido ${f.id} -> HTTP ${del.status}`);
}

console.log('\nAtenção: com o gate de aal2 ligado, este usuário fica sem acesso master');
console.log('até cadastrar um fator novo em /seguranca/mfa.');
