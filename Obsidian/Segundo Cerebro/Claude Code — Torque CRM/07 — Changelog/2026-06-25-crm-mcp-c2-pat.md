---
type: changelog
title: "crm-mcp C2 — PAT infra + client RLS-scoped per-user + tracer lead.get"
status: partial
created: 2026-06-25
updated: 2026-06-25
tags: [crm-mcp, mcp, pat, security, rls, multi-tenancy, edge-function, identity]
related:
  - "[[2026-06-23]]"
  - "docs/adr/0012-crm-mcp-customer-facing-pat.md"
  - "docs/adr/0011-torque-mcp-internal-ops-server.md"
  - ".specs/features/crm-mcp/DESIGN.md"
owner: engenheiro
---

# 2026-06-25 — crm-mcp C2: PAT infra + client RLS-scoped per-user + tracer `lead.get`

> **Backend #889** (`d9487b3a`) **mergeado em `main`**. **UI #890** (`24f9c166`) **NÃO está
> em `main`** — vive na branch `feat/crm-mcp/c2-ui-pat` (stacked sobre `c2-pat-infra`).
> Nada aplicado nem deployado (default dev) — ver Follow-ups. Por isso `status: partial`.

## Contexto

O `crm-mcp` é o **cenário B** que a ADR 0011 (torque-mcp interno, ops-master) adiou: cada
cliente Torque pluga o **próprio LLM** nos próprios dados de CRM, via Streamable HTTP,
autenticado por um **Personal Access Token (PAT)** emitido no CRM. O caller deixa de ser
ops-master e passa a ser um **tenant real** — um único bug de RLS aqui é vazamento
cross-tenant de PII, não o sintoma benigno "master vê vazio". A C1 (#878) já tinha extraído
a espinha auth-agnóstica para `_shared/mcp/`; C2 troca **só a auth** e adiciona o primeiro
tracer read-only.

## Mudanças

- **crm-mcp (C2 backend, #889)**: infra de PAT do MCP customer-facing. Um PAT resolve para
  `(user_id, organization_id)`; a função minta um JWT de usuário curto e roda toda query
  como aquele usuário — **RLS ON, nunca master, nunca service_role, nunca BYPASSRLS**, e
  **sem claim `organization_id`** no token (a org viaja só no `ToolContext`).
  - Tabela `personal_access_tokens` (hash-only, display-once, expiry obrigatório) + RLS
    owner/admin/master-ghost + trigger de imutabilidade + RPC resolver hermética
    `crm_mcp_resolve_token`.
  - Pipeline em `crm-mcp/index.ts`: `parse → hash → resolve → classify → eligibility
    (master-reject H1, org-drift M5) → mint → assertWellFormedJwt (fail-closed H3a) →
    client per-user → dispatch` com `toolFilter` fail-closed de cliente.
  - Tracer **`lead.get`** customer-scoped (org vem do PAT, nunca do argumento;
    `.eq(organization_id)` explícito como defesa-em-profundidade camada 3).
- **crm-mcp (C2 UI, #890 — branch, NÃO em `main`)**: aba **"IA / MCP"** (ex-"Tokens IA") em Configurações. Usuário
  cria um PAT pessoal read-only que herda exatamente a própria visão RLS, cola no próprio
  client de IA/MCP, e gerencia (lista/revoga) os tokens — tudo sob RLS. Edge fn `create-pat`
  gera o token, grava **só o hash**, retorna o plaintext **1×**, e recusa callers master
  (ops de master vivem no torque-mcp). Card informativo sempre-visível (o que é MCP +
  endpoint copiável + esquema Bearer) e aviso role-aware (token de admin enxerga quase a
  org inteira).

## Arquivos tocados

**Backend (#889)**
- `supabase/migrations/20270101000000_crm_mcp_personal_access_tokens.sql` — **novo**. Tabela
  + RLS (owner/admin/master-ghost) + trigger imutável + `crm_mcp_resolve_token`
  (`SECURITY DEFINER`, hermética: identidade-only no match exato de `token_hash`, vazia no
  miss — sem oráculo not-found vs revoked, dobra `is_master` + org ids ativos num round-trip,
  executável por anon pré-auth).
- `supabase/functions/crm-mcp/index.ts` — **novo**. Wiring L1+L2 do pipeline acima.
- `supabase/functions/crm-mcp/lib/pat.ts` (+ `pat.test.ts`) — **novo**. Formato de token +
  CRC32, hash, mint ES256 via `jose`, classificadores puros, `assertEligiblePrincipal`
  (fail-CLOSED em `is_master` não-estritamente-false).
- `supabase/functions/crm-mcp/lib/config.ts` (+ `config.test.ts`) — **novo**. `loadConfig`
  com **assert-absent** de secrets de ops (`SUPABASE_SERVICE_ROLE_KEY`/`MCP_MASTER_*`/
  `MCP_GATEWAY_SECRET`) no boot (H3 — invariante testada, não convenção).
- `supabase/functions/crm-mcp/lib/phone.ts` (+ `phone.test.ts`) — **novo**. Normalize PT em
  TS (anti-bypass HOLE 1, golden parity) — nunca via `db.rpc` no user client.
- `supabase/functions/crm-mcp/tools/lead.ts` + `tools/index.ts` (+ `lead.test.ts`) — **novo**.
  Tracer `lead.get` + allowlist `CUSTOMER_TOOLS`.
- `supabase/functions/_shared/mcp/{types,registry,dispatch}.ts` (+ `registry.test.ts`) —
  `ToolDef.customerExposed?`, `ToolContext.orgId/userId/scopes?`, `visibleTools` toolFilter,
  `DispatchContext.toolFilter?`. **Não-breaking** — torque-mcp inalterado.
- `supabase/functions/deno.json` + `deno.lock` — import map `jose@5.9.6`.
- `supabase/config.toml` — `[functions.crm-mcp] verify_jwt=false`.
- `tests/integration/crm-mcp-pat.test.ts` — **novo**. Anchor CI do resolver + RLS da tabela.
- `docs/adr/0012-crm-mcp-customer-facing-pat.md` — **novo**. Decisão formal.
- `.specs/features/crm-mcp/DESIGN.md` — §7.6 reconciliado (resolver anon-callable hermético).

**UI (#890 — branch `feat/crm-mcp/c2-ui-pat`, ainda NÃO em `main`)**
- `supabase/functions/create-pat/index.ts` — **novo**. Gera token via `crm-mcp/lib/pat.ts`
  (paridade de formato/hash com o resolver), grava só o hash, retorna plaintext 1×, INSERT
  sob JWT do caller (RLS `pat_owner_insert`), recusa master. `verify_jwt` default true.
- `src/modules/platform/components/settings/PersonalAccessTokensPanel.tsx` — **novo**.
- `src/modules/platform/hooks/usePersonalAccessTokens.ts` — **novo** (list/create/revoke).
- `src/modules/platform/lib/pat-display.ts` (+ `tests/unit/pat-display.test.ts`) — **novo**.
- `src/modules/platform/pages/Configuracoes.tsx` + `src/modules/platform/index.ts` — wiring
  da nova aba.

## Decisões (ADR 0012, accepted)

- **Função separada, RLS-pura per-user** — reusa a espinha, troca só a auth. Nunca master,
  nunca service_role, nunca BYPASSRLS.
- **Mint ES256 com chave DEDICADA** (não o legacy/service_role secret): vazá-la forja
  qualquer *usuário*, não service_role. TTL hard-cap 60s (teto de propagação de revoke);
  mint malformado falha fechado antes de qualquer client.
- **PAT de usuário master é RECUSADO no resolve** (403 a cada request) — senão o endpoint de
  cliente viraria leitor cross-org via as policies `is_master_user`.
- **Resolver hermético `crm_mcp_resolve_token`** — roda pré-auth via anon-key; vazio no miss
  (sem oráculo); resolve o dilema §7.6 a favor de "anon-callable + hermético".
- **Allowlist positiva fail-closed** — crm-mcp passa `(t) => t.readonly && t.customerExposed`
  e **não importa** tools de ops (dupla barreira: bundle + runtime).
- **Defense-in-depth (camada 3, load-bearing)** — todo handler ignora `org_id` de argumento e
  aplica `.eq("organization_id", token.org_id)`; barreira que conteria uma regressão de RLS.

## Verificação

- #889: `deno test crm-mcp/ torque-mcp/ _shared/mcp/` → **131 passed | 0 failed**; lint/fmt/
  type-check limpos (só o erro pré-existente `_shared/sentry.ts:251`).
- #890: `npm run build` OK (panel lazy-chunked), `tsc --noEmit` 0 erros, eslint 0 erros
  (2 warnings `no-explicit-any` herdados do padrão `useApiKeys`), `pat-display.test.ts` → 4 passed.

## Follow-ups

- **UI da C2 (#890) implementada mas NÃO mergeada** — criar/listar/revogar PAT vive na branch
  `feat/crm-mcp/c2-ui-pat`; falta merge em `main` + deploy da edge fn `create-pat`. Sem a UI,
  não há caminho de produto p/ o usuário emitir o PAT (só backend resolve/valida).
- **Deploy (não-automático)**: aplicar a migration `20270101000000` em **dev**; setar secrets
  `CRM_MCP_JWT_SIGNING_KEY` / `CRM_MCP_JWT_KID` (+ `CRM_MCP_PAT_PEPPER` opcional) e **confiar a
  chave pública ES256** no JWKS do projeto (senão a RLS não honra os JWTs mintados); canary
  round-trip no boot. Default dev; prod só com OK explícito.
- Re-confirmar `is_master_user unpinned=0` em prod antes do ship (já pinada pela
  `20261227000000`; guard, não bloqueador).
- ⚠️ Coexiste com `api_keys` (REST org-level) — coerência de produto a decidir.
- Próximas fatias: **C3** read pack, **C4** rate limit, **C5** lifecycle/auditoria/
  offboarding-revoke. Nenhuma tool *mutating* de cliente — read-only duro em v1.
