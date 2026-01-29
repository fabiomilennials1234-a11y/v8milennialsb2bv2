# Edge Function: create-org-user

Criação de usuários e pré-cadastro de emails no SaaS multi-tenant. Duas formas de autenticação:

1. **JWT (frontend)** + `user_creation_key` no body: validação via chave da organização no Supabase (evita "JWT inválido" no gateway).
2. **X-Internal-Api-Key** (backend): uso por backend que já validou o admin.

Modos: **invite** (envia convite por email) ou **pre_register** (só insere em `pending_org_invites`; o usuário entra na org ao se cadastrar na página inicial).

## Quem pode chamar

- **Frontend (admin)**: com `Authorization: Bearer <session JWT>` e body com `user_creation_key` (chave da organização, `organizations.user_creation_key`) e `mode` (`invite` ou `pre_register`). A função valida o JWT, que o usuário é admin da org e que a chave corresponde à organização.
- **Backend**: com header `X-Internal-Api-Key` e body com `organization_id`, `email`, `role`, etc. (e opcionalmente `mode`).

## Configuração

1. **Migration**: execute a migration que adiciona `organizations.user_creation_key` e a tabela `pending_org_invites`.

2. **Secrets da Edge Function** (Supabase Dashboard → Edge Functions → create-org-user → Secrets):
   - `INTERNAL_API_KEY`: para chamadas do backend (ex: `openssl rand -hex 32`).
   - `SUPABASE_ANON_KEY`: obrigatório para validar JWT do frontend (use o mesmo “anon” / chave pública do projeto em Project Settings → API).
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: já injetados pelo Supabase.
   - `SITE_URL` (opcional): URL de redirect após o usuário definir a senha (modo invite).

## Request

- **Método:** `POST`
- **Headers:** `Content-Type: application/json` e **um** dos:
  - `Authorization: Bearer <JWT do usuário admin>` (frontend) + body com `user_creation_key`
  - `X-Internal-Api-Key: <INTERNAL_API_KEY>` (backend)
- **Body:**
  - `email` (string, obrigatório)
  - `role` (string, ex: `sdr`, `closer`)
  - `organization_id` (string UUID, obrigatório)
  - `name` (string, opcional)
  - `mode` (string, opcional): `invite` (padrão) ou `pre_register`
  - `user_creation_key` (string UUID, obrigatório quando usar JWT): valor de `organizations.user_creation_key` da organização.

## Modo pre_register

Quando `mode === "pre_register"`:
- Não envia convite por email.
- Insere o email em `pending_org_invites` (organização + role).
- Quando essa pessoa se cadastrar na **página inicial** (login/signup), a Edge Function `attach-to-org-by-pending-invite` vincula o usuário à organização automaticamente.

## Respostas

- **invite**: `{ "success": true, "message": "Convite enviado...", "user_id": "..." }`
- **pre_register**: `{ "success": true, "message": "Email pré-cadastrado. Quando essa pessoa se cadastrar na página inicial, entrará na sua organização." }`
- `401`: JWT inválido ou `X-Internal-Api-Key` ausente/inválido.
- `403`: Não é admin da org, `user_creation_key` não corresponde à org ou limite do plano.
- `409`: Email já cadastrado / já convidado / já na lista de pré-cadastro.
