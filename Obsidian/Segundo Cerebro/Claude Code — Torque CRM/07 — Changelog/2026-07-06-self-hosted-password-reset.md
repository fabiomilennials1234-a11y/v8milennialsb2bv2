---
tipo: changelog
data: 2026-07-06
área: identity
tags: [changelog, auth, password-reset, security, resend, rate-limit, multi-tenancy]
---

# Feature — "Esqueci minha senha" self-hosted (fora do mailer/PKCE do Supabase)

## Pendências de ativação (operador)

Antes de o fluxo funcionar em dev/prod, o operador precisa:

1. **Secret Resend** — `supabase secrets set RESEND_API_KEY=... --project-ref <ref>`
   (dev `bcfadphgsibjzivtbjvc`, prod `jsjsmuncfkbsbzqzqhfq`). Sem a key, a linha de
   token ainda é criada mas o e-mail é **pulado** (log warn) — o reset não chega.
   Opcionais: `RESET_EMAIL_FROM` (default `no-reply@send.torquecrm.com.br`) e
   `APP_URL` (default `https://app.torquecrm.com.br`).
2. **Domínio no Resend** — verificar `send.torquecrm.com.br` no painel do Resend
   (registros DNS SPF/DKIM). **DNS pendente.** Sem verificação, o Resend recusa o envio.
3. **Migration** — aplicar `20270107000000_password_reset_tokens.sql` em dev → prod
   (com aval do CTO). Cria as tabelas + RPCs; nada roda até aplicar.
4. **Deploy edge** — `supabase functions deploy forgot-password reset-password --project-ref <ref>`.

## O que mudou

O "esqueci minha senha" dependia de `supabase.auth.resetPasswordForEmail` + link de
recovery PKCE do Supabase Auth. Frágil na prática: e-mail não entregava, redirect
quebrado, PKCE falha cross-device, e scanners de segurança de e-mail **consomem o
link one-time** antes do humano clicar. Decisão (aprovada pelo CTO): sair do mailer
do Supabase e **hospedar o fluxo inteiro** — token próprio, e-mail próprio (Resend),
página de reset própria. Modelado no fluxo do RallyAPI (NestJS/Prisma).

Fluxo em 2 etapas:

1. `POST forgot-password { email }` → valida formato, rate-limit por IP (5/15min),
   busca o usuário (case-insensitive, ativo). Se existe: invalida tokens antigos não
   usados, gera token cru (32 bytes aleatórios, hex), salva **só o SHA-256** com
   `expires_at = now()+1h`, e-mail via Resend (fire-and-forget). Resposta **sempre
   genérica** exista ou não a conta (anti-enumeração).
2. `POST reset-password { token, password }` → rate-limit por IP (10/15min), valida a
   senha (política forte 12+ com complexidade), SHA-256 do token, consome via RPC
   atômica `claim_password_reset_token` (uso-único), troca a senha via
   `admin.updateUserById`. A sessão **não** é criada — o front manda pro `/auth`.

## Arquivos tocados

- `supabase/migrations/20270107000000_password_reset_tokens.sql` — **novo.** Tabelas
  `password_reset_tokens` (hash-only) e `auth_rate_limits`, ambas **RLS deny-all**
  (sem policy anon/authenticated, sem grant — só service_role). RPCs SECURITY DEFINER
  com `search_path = public, extensions` (ADR-2026-06-23):
  `check_auth_rate_limit(ip, endpoint, max, window)` (atômica via
  `INSERT ... ON CONFLICT DO UPDATE`) e `claim_password_reset_token(hash)` (uso-único
  via UPDATE condicional row-locked, `RETURNING user_id`).
- `supabase/functions/_shared/password-reset.ts` — **novo.** Primitivas puras (Web
  Crypto): `PWD_RE`/`isStrongPassword`, `isValidEmail`, `generateRawToken`,
  `sha256Hex`/`hashRawToken`, `resetTokenExpiryFromNow`, `isResetTokenUsable` (decisão
  pura de expiração/uso-único, unit-testável sem DB).
- `supabase/functions/forgot-password/index.ts` — **novo.** Passo 1.
- `supabase/functions/reset-password/index.ts` — **novo.** Passo 2.
- `supabase/config.toml` — `verify_jwt = false` pros dois (endpoints públicos,
  rate-limited no handler).
- `src/modules/identity/pages/Auth.tsx` — `handleForgotPassword` chama
  `functions.invoke('forgot-password')` (era `resetPasswordForEmail`); erro tratado
  genericamente (não vaza existência de conta).
- `src/modules/identity/pages/ResetPassword.tsx` — reescrita: removido
  `onAuthStateChange`/`PASSWORD_RECOVERY`/`getSession`/timeout de 5s. Lê `token` via
  `useParams()`; sem token → estado "link inválido". Submit chama
  `functions.invoke('reset-password')`; sucesso → CTA "Acessar o sistema" vai pro
  `/auth` (sessão não é criada automaticamente). `minLength` corrigido 6 → 12.
- `src/App.tsx` — rota `/reset-password/:token` (+ mantém `/reset-password` p/ o
  estado "link inválido").
- `supabase/functions/CLAUDE.md` — tabela do BC identity (9 → 11 funções).
- `tests/unit/password-reset.test.ts`, `tests/integration/password-reset-flow.test.ts`
  — **novos.**

## Decisões

- **Rate-limit DB-backed, não in-memory.** O `whatsapp-api-proxy` usa rate-limit
  in-memory por-org, que não serve aqui (endpoints anônimos, por-IP, precisam
  sobreviver a cold start / múltiplos isolates). Criada tabela `auth_rate_limits` +
  RPC atômica. IP nulo/vazio cai num bucket `unknown` compartilhado (nunca fail-open).
- **`search_path = public, extensions`** (não `public` puro nem `''`): alinhado ao
  ADR-2026-06-23 e ao padrão do repo (migration crm-mcp). Fecha hijack de search_path
  mantendo `public` (evita a classe 42883 do scar leads_uf).
- **Lookup de usuário via `admin.listUsers` paginado** (schema `auth` não é exposto
  via PostgREST) — mesmo caminho de `list-unassigned-users`. "Inativo" = banido em
  auth (`banned_until` futuro).
- **Anti-enumeração**: resposta genérica idêntica (200 + mesma mensagem) exista ou
  não a conta, no back **e** no front. Rate-limit roda **antes** do lookup (sem
  oracle por trabalho/tempo).
- **Sessão não é criada** no reset (sem PKCE) → CTA de sucesso manda pro login.

## Segurança

- Token nunca em texto claro — só SHA-256 no banco. Token cru/link **nunca** logados.
- `RESEND_API_KEY` só via env; nunca hardcoded.
- RLS deny-all nas duas tabelas; RPCs SECURITY DEFINER com search_path fixo.
- Política de senha forte validada no back (`isStrongPassword`) **e** no front
  (`validatePassword`).

## Follow-ups

- Executar os testes de integração exige Supabase local + migration aplicada
  (`npm run test:integration`).
- Canary HTTP pós-deploy: forgot→e-mail→reset ponta-a-ponta (Resend + admin API +
  resposta idêntica anti-enumeração) — validar no deploy, fora do suite DB-only.
- Housekeeping opcional: cron pra purgar `password_reset_tokens`/`auth_rate_limits`
  vencidos (não bloqueante — volume baixo).
