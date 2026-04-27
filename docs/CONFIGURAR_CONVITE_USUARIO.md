# Como configurar o convite de usuários

A mensagem **"Configure VITE_INVITE_API_URL..."** aparece quando nenhuma das variáveis de convite está definida. Você pode configurar de **duas formas**:

---

## Opção A — Com backend (recomendado)

O frontend chama **seu backend**; o backend valida o admin e chama a Edge Function com a chave interna.

1. **Deploy um backend** que:
   - Recebe `POST` com `Authorization: Bearer <JWT>` e body `{ email, name, role, organization_id }`
   - Valida o JWT e confirma que o usuário é admin da organização
   - Chama a Edge Function com header `X-Internal-Api-Key` e o mesmo body

   Exemplo de código: `docs/invite-user-api-example.ts` (adaptar para Vercel, Netlify ou Express).

2. **No Supabase** (Edge Function):
   - Secrets da função `create-org-user`: defina `INTERNAL_API_KEY` (ex: `openssl rand -hex 32`).

3. **No seu backend** (variáveis de ambiente):
   - `INTERNAL_API_KEY`: mesmo valor da Edge Function
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

4. **No frontend** (arquivo `.env`):
   ```env
   VITE_INVITE_API_URL=https://seu-dominio.com/api/invite-user
   ```
   (Substitua pela URL real do seu backend.)

5. Reinicie o app (ex: `npm run dev`) e teste "Convidar usuário por email".

---

## Opção B — Atalho sem backend

O frontend chama **direto a Edge Function** com a chave interna. A chave fica no bundle do frontend (menos seguro); use para desenvolvimento ou se ainda não tiver backend.

1. **No Supabase** (Edge Function):
   - Secrets da função `create-org-user`: defina `INTERNAL_API_KEY` (ex: `openssl rand -hex 32`).
   - Faça o deploy: `supabase functions deploy create-org-user`

2. **No frontend** (arquivo `.env`):
   ```env
   VITE_INTERNAL_API_KEY=o_mesmo_valor_que_você_colocou_em_INTERNAL_API_KEY
   ```
   Use exatamente o mesmo valor que está na secret `INTERNAL_API_KEY` da Edge Function.

3. **Não defina** `VITE_INVITE_API_URL` — o app usa o atalho quando só `VITE_INTERNAL_API_KEY` (e `VITE_SUPABASE_URL`) estão definidos.

4. Reinicie o app e teste "Convidar usuário por email".

---

## Resumo

| Objetivo              | O que definir no `.env`                          |
|-----------------------|--------------------------------------------------|
| Usar backend          | `VITE_INVITE_API_URL=https://...` (URL do backend) |
| Atalho sem backend    | `VITE_INTERNAL_API_KEY=seu_secret` (mesmo da Edge Function) |

Em ambos os casos, a Edge Function precisa da secret **INTERNAL_API_KEY** configurada no Supabase (Edge Functions → create-org-user → Secrets).
