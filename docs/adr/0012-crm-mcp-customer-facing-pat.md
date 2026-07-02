# crm-mcp — MCP customer-facing (BYO-AI) com PAT per-user, RLS-puro

**Status:** accepted (2026-06-25)
**Relacionado:** `docs/adr/0011-torque-mcp-internal-ops-server.md` (cenário A; este é o cenário B que a 0011 adiou), `.specs/features/crm-mcp/DESIGN.md` (spec detalhada), `supabase/functions/_shared/mcp/` (espinha C1).

## Context

A 0011 entregou o `torque-mcp` (MCP interno de ops, ops-master cross-org) e **adiou o cenário B** (customer-facing) por amplificar a ferida multi-tenant aberta (vazamento anon ~60k registros; master-ghost recorrente em 5+ classes; RLS some em rebuild). A C1 extraiu a espinha auth-agnóstica para `_shared/mcp/`. O `crm-mcp` é o cenário B: cada cliente Torque pluga o próprio LLM nos próprios dados de CRM, sobre Streamable HTTP, autenticado por um Personal Access Token (PAT) emitido no CRM. O caller agora é um **tenant real** — um único bug de RLS aqui é vazamento cross-tenant de PII, não o sintoma benigno "master vê vazio".

## Decisões

1. **Função separada, RLS-pura per-user.** `supabase/functions/crm-mcp/` reusa a espinha (`dispatch`/`http`/`registry`/`crypto`/`redact`/`types`); troca **só** a auth. Um PAT resolve para `(user_id, organization_id)`; a fn minta um JWT de usuário e roda toda query como aquele usuário — **RLS ON, nunca master, nunca service_role, nunca BYPASSRLS**. `loadConfig` **falha o boot** se qualquer secret de ops (`SUPABASE_SERVICE_ROLE_KEY`/`MCP_MASTER_*`/`MCP_GATEWAY_SECRET`) estiver presente no env (assert-absent — vira invariante testada, não convenção).

2. **Mint de JWT self-signed com chave ES256 DEDICADA** (não o legacy/`service_role` secret do projeto). A fn carrega só a chave privada de assinatura, escopada a `aud:authenticated`; vazá-la forja qualquer *usuário*, **não** `service_role`. `role`/`aud` são literais não-parametrizáveis; **nenhuma claim `organization_id`** é mintada (a org viaja só no `ToolContext`). TTL **hard-cap 60s** (teto de propagação de revogação). Um mint malformado **falha fechado** antes de construir qualquer client (`assertWellFormedJwt`) — nunca cai pro role `anon`. **Rejeitado:** assinar com o legacy secret (= dar `service_role` a uma fn customer-facing); `generateLink`+`verifyOtp` (sessão GoTrue real, pesada — fica como fallback se a forja-de-usuário precisar ser estruturalmente eliminada, R1).

3. **PAT de usuário master é RECUSADO no resolve.** Como toda policy master-ghost é `is_master_user(auth.uid())`, mintar para um uid de master tornaria o endpoint de cliente um leitor cross-org. O resolve rejeita (403) qualquer uid em `master_users`, a cada request. Operações de master ficam no `torque-mcp`.

4. **Resolver hermético `crm_mcp_resolve_token`.** Roda **pré-auth** (não há JWT de usuário ainda) via o client anon-key da fn. É `SECURITY DEFINER`, devolve **só** identidade para um match exato de `token_hash` (nunca `SELECT *`), **vazio no miss** (não distingue not-found de revoked → sem oráculo), e dobra `is_master(user_id)` + `current_org_ids` ativos para a fn decidir elegibilidade em TS puro num único round-trip. A 0011/DESIGN previa "revoke from anon" — **resolvido aqui** a favor de "executável por anon + hermético": anon é o único role pré-sessão disponível, e o contrato hermético (mais 178 bits de entropia inquebráveis) é a parede; possuir o token é a única forma de resolvê-lo.

5. **Allowlist positiva de tools, fail-closed.** A espinha ganhou `ToolDef.customerExposed?` + `DispatchContext.toolFilter?` (não-breaking; torque-mcp inalterado). O crm-mcp passa `(t) => t.readonly && t.customerExposed` e **não importa** os tools de ops — dupla barreira (imports ausentes no bundle + filtro runtime). Tool readonly sem `customerExposed` é invisível por default.

6. **Defense-in-depth (camada 3, load-bearing).** Todo handler de cliente, **além** da RLS: ignora `org_id` de argumento (usa o do token; arg divergente → erro), e aplica `.eq("organization_id", token.org_id)` explícito. É a barreira que conteria uma regressão de RLS (a classe master-ghost/`is_team_member` é precedente **vivo**). Normalize de telefone é feito **em TS** (`lib/phone.ts`), nunca via `db.rpc` no user client — a lista de exceções definer no `ctx.db` é **vazia** (anti-bypass).

7. **Escopo C2 (esta entrega):** migration (`personal_access_tokens` + RLS + trigger de imutabilidade + RPC resolver), `lib/{config,pat,phone}.ts`, `crm-mcp/index.ts`, espinha estendida, tracer `lead.get` customer-scoped, e a suíte de unit + o anchor de integração do resolver/RLS. **Read-only duro** (sem tools mutating de cliente). UI de PAT (criar/listar/revogar), rate limit e lifecycle ficam para C3–C5.

## Consequências

- **Blast radius de um PAT vazado:** um tenant, ≤ a visão RLS do usuário que mintou (varia de uma fatia por responsabilidade a org-wide se o criador for admin) — **nunca** master, nunca a plataforma. Revoke do PAT mata no próximo resolve; um JWT em voo vive ≤60s (R2, aceito).
- **Residual R1:** quem tiver code-exec na fn ou a chave de assinatura forja qualquer *usuário* (não `service_role`). Inerente ao self-mint; ES256 dedicada reduz o acoplamento ao crown-jewel. Eliminação total = `generateLink`+`verifyOtp` (vetável).
- **Pré-requisito de deploy:** o projeto alvo precisa **confiar na chave pública ES256** do crm-mcp (JWT signing keys do Supabase) para a RLS honrar os JWTs mintados; secrets `CRM_MCP_JWT_SIGNING_KEY`/`CRM_MCP_JWT_KID` (+ `CRM_MCP_PAT_PEPPER` opcional) setados; canary round-trip valida no boot. Default **dev**; prod só com OK explícito.
- **`is_master_user` em `search_path`:** já pinado pela `20261227000000` (dinâmica, dev+prod, `unpinned=0`); C2 re-confirma em prod como guard antes do ship (não bloqueador).
- **Espinha agora serve dois callers** (ops-master e tenant) — o `toolFilter`/`customerExposed` mantêm o torque-mcp idêntico enquanto o crm-mcp estreita a superfície.
