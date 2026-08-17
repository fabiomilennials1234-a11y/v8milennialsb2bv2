// Prova final: login real via GoTrue (password grant) + revogação da sessão.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const URL = env.match(/^VITE_SUPABASE_URL="(.+)"$/m)[1];
const KEY = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY="(.+)"$/m)[1];

// ⚠️ SENHAS REDIGIDAS — preencher antes de rodar. As reais ficam fora do repo.
const USERS = [
  ['rafthel@rafthel.com.br', '<SENHA_RAFAEL>'],
  ['vendas6@rafthel.com.br', '<SENHA_TATIELE>'],
  ['vendas4@rafthel.com.br', '<SENHA_CARINA>'],
];

for (const [email, password] of USERS) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();

  if (!res.ok || !body.access_token) {
    console.log(`FALHOU  ${email}  HTTP ${res.status}  ${JSON.stringify(body)}`);
    continue;
  }

  const out = await fetch(`${URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${body.access_token}` },
  });

  console.log(
    `OK      ${email}  access_token=${body.access_token.slice(0, 18)}...  ` +
      `user=${body.user.id}  role=${body.user.role}  logout=${out.status}`
  );
}
