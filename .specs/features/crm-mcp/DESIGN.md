# Design: crm-mcp — servidor MCP customer-facing "bring-your-own-AI" (RLS-puro, per-user)

**Status:** draft (2026-06-24) — aguardando revisão CTO. Endurecido após 3 reviews adversariais (lentes: multitenant, pat-forgery, rls-bypass).
**Autor:** engenheiro (lead)
**Relacionado:** `docs/adr/0011-torque-mcp-internal-ops-server.md` (cenário B, adiado lá → este doc), `.specs/features/torque-mcp/`, `supabase/functions/_shared/mcp/`

---

## 1. Contexto

### O que é

`crm-mcp` é um servidor **MCP (Model Context Protocol) customer-facing**, entregue como Edge Function Deno sobre **Streamable HTTP**, que deixa cada cliente Torque conectar o **seu próprio LLM** (Claude Desktop, um agente custom, n8n com nó MCP, etc.) aos **seus próprios dados de CRM** — leads, conversas, pipelines, status de instância WhatsApp. "Bring-your-own-AI": a Torque não roda o modelo; expõe uma superfície de tools curada e o cliente pluga a IA dele.

A autenticação é por **Personal Access Token (PAT)** emitido pelo próprio usuário dentro do CRM. Cada PAT mapeia para **um usuário + uma org**, e toda query roda **RLS-pura, per-user**: sem master, sem `service_role`, sem `BYPASSRLS`. O Postgres é a parede de tenant; o PAT só seleciona **qual** parede.

### Por que agora — e por que isto é a parte difícil

Este é o **cenário B explicitamente adiado** na ADR-0011 (linha 9):

> "O cenário B (customer-facing) fica adiado — amplifica a ferida multi-tenant aberta (vazamento anon ~60k registros; master-ghost recorrente em 5+ classes; RLS some em rebuild)."

O cenário A (`torque-mcp` interno) já está em produção e nos deu a **espinha auth-agnóstica** (`_shared/mcp/`, extraída na slice C1). O que muda no cenário B é a parte que a ADR-0011 chamou de ferida: **o caller agora é um tenant real, não a equipe de ops.** Um único bug de RLS num endpoint que autentica clientes reais não é "master vê vazio" (o sintoma benigno do master-ghost) — é **vazamento cross-tenant de PII**. Os dois precedentes que moldam todo este design:

- **Vazamento anon (2026-06-01):** anon SEM login leu ~60k registros de prod (PII de leads, conversas, pipeline) via views `*_compat` sem `security_invoker` + RLS divergente. Prova histórica de que **um modelo de confiança RLS-only já falhou em prod e expôs exatamente os dados que um MCP de cliente serviria.**
- **Master-ghost recorrente (5+ classes em MEMORY):** disparo audience RPCs, goals null-blind, chat V3 list, lead-trash RPCs, checklists, carteira periféricas, org-delete. RLS é demonstravelmente **a camada que quebra** nesta base. E quase nenhum desses incidentes tinha CI guard ("falta CI guard" é refrão na memória). Pior ainda: a classe **`is_team_member` ainda estava sendo varrida 6 dias antes deste doc** (`20261218000002`, fix de "member viu 892 orgs alheias" em `20261119000018`) — RLS quebra de forma **rolante**, não é história fechada.

Conclusão de design, não de cautela: o `crm-mcp` **herda RLS** (igual ao torque-mcp), mas trata RLS como **uma de três camadas**, não como a parede única. A camada 3 (defense-in-depth: `organization_id` explícito em toda query + assert do org do PAT) é **load-bearing, não redundância** — é a barreira que teria contido o leak `is_team_member` ativo. E o **CI guard de isolamento cross-org** é requisito de slice, não follow-up.

### Relação com a ADR-0011 (o que herda, o que inverte)

| Eixo | torque-mcp (cenário A) | crm-mcp (cenário B) |
|------|------------------------|---------------------|
| Principal | ops-master fixo, visão cross-org | **um usuário + uma org** (o dono do PAT) |
| Credencial | `x-mcp-secret` (1 secret compartilhado) | **PAT per-user** (`Authorization: Bearer`) |
| Sign-in | `signInWithPassword` (master, cacheável) | **mint de JWT per-PAT** (não cacheável por sessão) |
| Superfície | ops pack completo (`db.read_sql`, `cron.toggle`, …) | **read pack curado**, allowlist positiva |
| Blast radius de leak | **plataforma inteira** (toda PII de todo tenant) | **um tenant, ≤ a visão de um usuário** (ver §8.1 sobre a variação por role) |
| `service_role` | só p/ mutating armado (`cron.toggle`) | **não-acessível por construção** — não-trivial, ver §4.7 (não "estruturalmente impossível") |
| Master no caminho | é o ponto (ops-master) | **proibido** — PAT de master é rejeitado no resolve (§4.3.1, H1) |

Princípio nuclear preservado da ADR-0011 (decisão 2): *"o MCP não tem privilégio próprio de dado — tem o do principal, enforçado pelo Postgres."* No cenário B o principal é o usuário do cliente, não o master — **e nunca pode ser um master**, mesmo que o dono do PAT tenha row em `master_users` (§4.3.1).

---

## 2. Goals / Non-goals

### Goals

- **G1.** Endpoint MCP Streamable HTTP que um cliente Torque pluga no LLM dele, autenticado por PAT, retornando **só os dados que aquele usuário já vê** pela RLS dele.
- **G2.** **RLS-pura per-user:** zero master, zero `service_role`, zero `BYPASSRLS` no caminho de dados. O PAT resolve para `(user_id, organization_id)` e a query roda como aquele usuário. **PAT de um usuário que seja master é recusado no resolve** (§4.3.1) — `crm-mcp` nunca opera com semântica master-ghost.
- **G3.** **Reuso máximo da espinha** `_shared/mcp/` (C1): protocolo JSON-RPC, dispatch, gate de header, redact. O `crm-mcp` adiciona só o que é específico de cliente (auth PAT, mint per-user, rate limit, allowlist de tools).
- **G4.** **Read pack** de cliente curado por allowlist **positiva** (fail-closed), **enforçada em runtime já na C2** (não só por imports ausentes): tool nova é invisível a cliente até alguém opt-in deliberado.
- **G5.** PAT world-class: formato scanner-friendly, hash-only storage, display-once, expiry obrigatório, rotação, revogação (instantânea no nível do PAT; janela de replay do JWT mintado ≤60s — §4.6), escopos, auditoria.
- **G6.** **Defense-in-depth contra a classe master-ghost/anon-leak:** `organization_id` explícito em toda query + assert do org do PAT + **teste de integração cross-org seedado com membro não-admin** (org A não lê org B) como regression guard de slice.
- **G7.** Rate limit per-token e per-org, com 429 + `Retry-After` + `RateLimit-*` headers, sem infra nova (counter em Postgres).
- **G8.** UI no CRM para o usuário criar/listar/revogar os próprios PATs (e admin governar os da org), com **aviso role-aware**: um admin que cria PAT está mintando uma chave de leitura quase org-wide (§8.1).

### Non-goals

- **NG1.** OAuth 2.1 completo (RFC 9728 protected-resource metadata, RFC 8414 AS metadata, dynamic client registration, PKCE). PAT estático é o atalho spec-compatível do v1; o upgrade é roadmap (§9 C6).
- **NG2.** **Tools mutating para cliente.** v1 é read-only duro. `:write` é reservado na convenção de escopo mas nenhum tool mutating é exposto. Mutating cliente exige ADR própria.
- **NG3.** Org-owned service token (`tq_svc_…`, app-identity, sobrevive a saída de funcionário). Reservado no schema (`user_id` nullable + `created_by`), **não** entregue no v1.
- **NG4.** Migrar o projeto Supabase inteiro para chaves assimétricas como pré-requisito de ship. **Mas** o `mintUserJwt` do crm-mcp deve ir para **ES256 + `kid` já no v1/C2** (ver §4.4, H2): chave de assinatura dedicada, cujo material é desacoplado do legacy/`service_role` secret. Migrar o *projeto* todo continua roadmap; dar ao crm-mcp uma chave de assinatura própria, **não**.
- **NG5.** Redis/edge-KV para rate limit. Postgres é a fronteira de confiança e já é transacional com a request.
- **NG6.** Reusar a função `torque-mcp` com uma flag. `crm-mcp` é **função separada, namespace de secrets separado** — sem acesso a `MCP_MASTER_*` / `SUPABASE_SERVICE_ROLE_KEY` / `MCP_GATEWAY_SECRET`. O boot **falha loud** se qualquer um desses estiver presente no env (§3, §4.5).

---

## 3. Arquitetura (camadas)

Espelha o pipeline do `torque-mcp` (`supabase/functions/torque-mcp/index.ts`), trocando **só** a camada de auth (L2) e estreitando o dispatch (L3) com um `toolFilter`. L1/L4-protocolo são a espinha C1 reusada as-is.

```
                          POST /functions/v1/crm-mcp   (Streamable HTTP, JSON-RPC 2.0)
                          Authorization: Bearer tq_mcp_live_…
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│ L1 — HTTP / CORS / método                          [REUSO espinha + house]    │
│   getCorsHeaders + OPTIONS 204 + POST-only 405                                │
│   (NÃO há x-mcp-secret aqui — o bearer PAT É a credencial)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│ L2 — AUTH: PAT → cliente RLS-scoped per-user             [NOVO em crm-mcp]    │
│   1. extrai bearer, valida formato + checksum CRC32 (offline, UX/integridade) │
│   2. sha256/HMAC(token) → RPC SECURITY DEFINER mínima crm_mcp_resolve_token   │
│      (revoke execute FROM anon, authenticated — §7.6)                         │
│   3. checa revoked_at / expires_at / audience("crm-mcp")  → 401/403           │
│   3a. REJEITA se user_id ∈ master_users → 403 (PAT de master proibido, H1)    │
│   3b. ASSERTA pat.org_id ∈ get_my_organization_ids(pat.user_id) → 403 (M5)    │
│   4. rate limit per-token + per-org (RPC atômica)        → 429 + Retry-After  │
│   5. mintUserJwt(user_id, email) [ES256] → createClient(accessToken)          │
│      — HARD-FAIL se mint não produzir JWT bem-formado c/ sub UUID (H3a)       │
│      = cliente Supabase RLS-ON como AQUELE usuário                            │
│   6. throttled last_used_at                                                   │
│   ── secrets disponíveis aqui: CRM_MCP_JWT_SIGNING_KEY (priv), ANON_KEY ──    │
│   ── secrets cuja PRESENÇA derruba o boot: MCP_MASTER_*, SERVICE_ROLE_KEY,    │
│      MCP_GATEWAY_SECRET (assert-absent, §4.5, H3) ──                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │   ctx.db = userClient (RLS per-user)
                                      │   ctx.serviceDb = NUNCA (undefined sempre)
┌─────────────────────────────────────────────────────────────────────────────┐
│ L3 — DISPATCH JSON-RPC                          [REUSO espinha + toolFilter]  │
│   handleRpcPayload → dispatch: initialize / tools/list / tools/call           │
│   allowMutations = false (hard-pinned)                                        │
│   toolFilter = (t) => t.readonly === true && t.customerExposed === true (H4)  │
│   serverInfo = { name:"torque-crm", version } (SEM project: dev|prod)         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│ L4 — TOOLS (customer read pack)                  [NOVO array + REUSO handlers]│
│   array literal curado: SÓ tools com customerExposed=true (allowlist positiva)│
│   cada handler: assert args.org_id === token.org_id (ou preenche do token)    │
│                 + .eq("organization_id", token.org_id) explícito (DiD)        │
│   ZERO .rpc() de dado no user client (normalize de telefone é TS — §8.3, H1)  │
│   NÃO importa db.ts / rls.ts / cron.ts / schema.ts / leadRestoreTool          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Mapa de reuso vs novo

| Módulo `_shared/mcp/` | crm-mcp | Nota |
|---|---|---|
| `types.ts` (`ToolDef`, `ToolContext`, JSON-RPC) | **reuso** + estende `ToolDef.customerExposed?: boolean` | campo opt-in fail-closed |
| `dispatch.ts` (`dispatch`, `DispatchContext`) | **reuso** + novo `DispatchContext.toolFilter?` (opcional, default = comportamento atual) | crm-mcp passa `(t)=>t.readonly && t.customerExposed`; torque-mcp não passa nada → inalterado (H4) |
| `http.ts` (`handleRpcPayload`) | **reuso as-is** | (NB: `secretMatches` **não** está no hot-path do PAT — o lookup é `WHERE token_hash=$1`; não citar como "constant-time" — §4.2, H5) |
| `registry.ts` (`visibleTools`) | **reuso** — passa a aceitar/honrar o `toolFilter` | hoje filtra só `t.readonly`; insuficiente sozinho (§6.1) |
| `crypto.ts` (`sha256hex`, `stableStringify`) | **reuso** (`sha256hex`/HMAC p/ hash do PAT) | |
| `redact.ts` (`redact`) | **reuso** (logs/erros sem PII) | |
| `auth.ts` (`createCachedMasterClientProvider`) | **NÃO reusa o cache de sessão** (master é 1 principal; PAT é N principals) | ver §5 |
| `guardrails.ts` (`runMutation`) | **não usado no v1** (sem mutating cliente) | reservado p/ futuro `:write` |

### O que `crm-mcp` adiciona (novos arquivos)

```
supabase/functions/crm-mcp/
  index.ts                      # Deno.serve — L1+L2 wiring, allowMutations hard-false, toolFilter
  lib/
    config.ts                   # env: CRM_MCP_JWT_SIGNING_KEY (priv ES256), SUPABASE_URL, ANON_KEY
                                 #  boot THROW se SERVICE_ROLE_KEY/MCP_MASTER_*/MCP_GATEWAY_SECRET presentes (H3)
    pat.ts                      # parsePat (formato+CRC32), resolvePat (lookup+checks+master-reject), mintUserJwt
    rate-limit.ts               # chama RPC crm_mcp_rate_check; monta 429 + headers
    phone.ts                    # normalizeBrazilianPhone em TS (NÃO via db.rpc — §8.3, HOLE 1)
  tools/
    index.ts                    # CUSTOMER_TOOLS = [leadGetCustomer, conversationGetCustomer, …]
    lead.ts                     # lead.get customer-scoped (assert org + .eq explícito)
    conversation.ts             # conversation.get
    pipeline.ts                 # pipeline.list / stage.list
    whatsapp.ts                 # whatsapp.instance_status (booleans, sem secrets)
```

Os handlers de cliente **não** importam os tools de ops (`db.ts`, `rls.ts`, `cron.ts`, `schema.ts`, `leadRestoreTool`). A curadoria tem **duas barreiras**: (1) imports ausentes no build (a superfície de ops nem está no bundle) **e** (2) o `toolFilter` runtime fail-closed (§6.1). A barreira (1) sozinha é uma denylist-por-omissão que falha aberta no dia em que alguém adiciona um import — por isso (2) é shippada **na C2**, não diferida.

---

## 4. Modelo de auth (PAT)

### 4.1 Formato do token

Adoção do esquema GitHub (best-in-class, reconhecido por secret-scanning vendors), alinhado ao prefixo `tq_` que o repo já usa em `meeting-webhook` (`tq_live_…`):

```
tq_mcp_<env>_<30·base62 random><6·base62 CRC32>
└─┬─┘ └┬┘  └┬┘ └────────┬───────┘└──────┬───────┘
  │    │    │           │                └ CRC32 do corpo random, base62, pad-zero (validação offline, UX/integridade — NÃO é segurança)
  │    │    │           └ ≥178 bits de entropia (32 bytes CSPRNG → base62)
  │    │    └ "live" | "test" (espelha tq_live_/sk_test_ — separa superfície dev/prod)
  │    └ tipo de produto ("mcp"); reserva "svc" p/ org-owned token futuro
  └ vendor prefix Torque
```

Exemplo: `tq_mcp_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5X29ab4`. CSPRNG via `crypto.getRandomValues`.

Por quê:
- **Prefixo reconhecível → secret scanning.** Permite registrar padrão em GitHub secret scanning / GitGuardian e dropa falso-positivo a ~0.5%.
- **Separador `_`** não é char base62 → não colide com o corpo random e permite double-click selecionar o token inteiro.
- **Checksum CRC32 nos últimos 6 chars** rejeita token digitado errado **offline, antes de qualquer hit no DB**, e deixa scanner validar candidato sem chamar a API. **É type/UX/scanner-guard, não defesa:** um forjador computa um CRC32 válido trivialmente. O design não apoia nenhuma garantia de segurança no CRC32.
- **Entropia ≥178 bits** é o que torna o hashing rápido (SHA-256) seguro — ver 4.2.

### 4.2 Hashing / storage

**Armazena SHA-256 (ou HMAC-SHA256 com pepper — D2) hex, 64 chars, apenas. Nunca plaintext. Display-once.**

- **SHA-256, sem salt — e isto é o certo aqui, não um atalho.** Argon2/bcrypt são lentos de propósito para defender **senhas humanas de baixa entropia** contra brute-force. Um token CSPRNG de 178 bits é inviável de força-bruta independente da velocidade do hash, então a lentidão não compra nada — e adicionaria latência real a **toda request autenticada do MCP** (Argon2 a ~1k hashes/s no hot path = inaceitável). O hash existe só para que um leak de DB/backup não renda credencial viva. SHA-256 (rápido, determinístico, sem salt por-row) é o padrão exato para esse caso. Sem salt porque o input já é globalmente único e de alta entropia → rainbow table / reuse cross-account são irrelevantes.
- **Pepper opcional (belt-and-suspenders):** `HMAC-SHA256(token, CRM_MCP_PAT_PEPPER)` adiciona defesa contra atacante que tem o DB mas não o secret do app. Barato. **Decisão D2** (revisar com CTO) — default proposto: incluir pepper.
- **Display-once:** mostra o `tq_mcp_…` completo exatamente uma vez na criação; depois nunca mais. Armazena só hash + fragmento não-secreto (`token_prefix`).
- **Lookup é point-lookup indexado, NÃO "constant-time" — e o doc não vai chamar de constant-time** (correção do review pat-forgery H5). O índice B-tree não é constant-time sobre o keyspace, e o reject offline de CRC32 cria um fork de timing observável (token malformado → 401 sem DB; bem-formado → paga o DB). Com 178 bits de entropia isso **não** é caminho prático de forja (não dá pra brutar o corpo), então o risco residual é **baixo e aceito** — mas explicitado aqui em vez de mascarado como "constant-time". Não há comparação secundária em TS no hot-path do PAT (o `secretMatches` da espinha **não é invocado** aqui).

### 4.3 Lookup (hot path)

1. Extrai `Authorization: Bearer <token>` (nunca query string — RFC violation + vaza em log).
2. Valida formato + CRC32 **offline** (UX/integridade). Falha → `401` sem tocar o DB.
3. `sha256/HMAC(token)` → RPC `crm_mcp_resolve_token(p_hash)` (SECURITY DEFINER mínima, §7.6) retorna **apenas** `{id,user_id,organization_id,scopes,expires_at,revoked_at,audience}` da única row casada (ou row vazia — nunca "not found" vs "revoked" diferenciados, p/ não virar oráculo de existência).
4. Rejeita `revoked_at IS NOT NULL` → `401`; `expires_at < now()` → `401`; `audience <> 'crm-mcp'` → `403` (token de outro produto não vale aqui; análogo estático de RFC 8707).
5. Escopo insuficiente para o tool pedido → `403`.

#### 4.3.1 Rejeição de master (H1 — o breach cross-tenant que o draft original não cobria)

**`is_master_user(_user_id)` chaveia por `user_id` contra `master_users`** (`supabase/migrations/20260131200000:199-208`) — o **mesmo** `user_id` que o PAT minta em `sub`. Toda policy com branch master-ghost (`pat_master_ghost`, `master_all_*`, etc.) é `FOR ALL USING(is_master_user())`. Logo, se o dono de um PAT for um master (o CTO/Gabriel ou qualquer dev com row em `master_users`), o JWT mintado tem `sub` = uid de master → **toda tabela com branch master avalia TRUE → o "read pack de cliente" devolve dados CROSS-ORG**, por um endpoint projetado para confinar a um tenant. O `.eq("organization_id", token.org_id)` da §6.4 **não salva**: um master pode mintar um PAT para qualquer org B, o assert `arg.org_id === token.org_id` fica satisfeito, e a policy master libera tudo daquela org. Isto torna falsa a frase "blast radius estruturalmente inalcançável" para o principal master.

**Mitigação (obrigatória, C2):**
- No `resolvePat` (e idealmente também no `INSERT` de criação de PAT): **se `is_master_user(pat.user_id)` → `403`, nunca minta, audita `pat.auth_failed:master_principal`.** O `crm-mcp` recusa emitir token de sessão para qualquer uid presente em `master_users`. Isso também fecha o caso simétrico de alguém ser **adicionado** a `master_users` depois de o PAT existir (o check é no resolve, a cada request).
- **Teste-âncora de integração:** "PAT cujo `user_id` é master → resolve devolve 403 e lê ZERO rows cross-org." Sem esse teste, H1 é um caminho de uma linha de "CTO criou um token de conveniência" até egress de PII de toda a plataforma.
- **Documentar:** operações de master pertencem ao `torque-mcp`, nunca ao `crm-mcp`.

#### 4.3.2 Assert de membership atual (M5 — "um PAT = uma org" como invariante de servidor)

`get_my_organization_ids()` filtra `team_members.is_active = true`. Um funcionário desligado por `is_active=false` perde acesso a dado via RLS (bom), **mas o PAT dele não é revogado por essa ação** — o hot-path só checa `revoked_at`/`expires_at`. Pior: se o usuário for re-adicionado a **outra** org depois, o mesmo PAT (cuja `organization_id` está congelada na row) passa a resolver dado da **nova** org, porque a org efetiva vem de `team_members` por uid em tempo de query. Logo "um PAT = uma org" só vale se for invariante **de servidor**, não arg-check em TS.

**Mitigação (C2):** no resolve, **assertar `pat.organization_id IN get_my_organization_ids(pat.user_id)`**; se a org do PAT não for mais membership atual do uid → `403`. E no fluxo de **offboarding** (`team_members` deactivate/remove), **revogar os PATs do usuário** (trigger ou no flow de desligamento). Sem isso, "fired employee" não é evento de revogação e o token fica até 90 dias.

### 4.4 Mint do JWT per-user (o mecanismo nuclear)

Escolha (brief A, opção 1, **endurecida por H2/H3b**): **self-mint de um JWT Supabase-compatível**, passado ao client via callback `accessToken`. A RLS honra `auth.uid()`/`auth.jwt()` de um token self-signed porque o PostgREST só verifica a **assinatura contra a chave que o projeto confia** — não exige que o token venha do GoTrue.

**Assinatura: ES256 com chave dedicada, já no v1 (NG4 / H2).** O draft original assinava HS256 com o **legacy JWT secret do projeto** — e esse secret assina **tudo** que o projeto confia, inclusive `role:service_role`. Pôr esse secret num endpoint *customer-facing* significa que qualquer RCE/log-leak/dependency-compromise nessa função é **forja-de-qualquer-identidade completa** (incluindo `service_role`) — ou seja, equivalente a dar `service_role` à função. Isso é um downgrade frente ao `torque-mcp` (que só carrega uma credencial de conta RLS-bound). Portanto:
- O `crm-mcp` assina com uma **chave privada ES256 dedicada (`kid` próprio)**, cuja **metade pública** o PostgREST confia (via JWT signing keys do Supabase, GA out/2025). A função carrega **só a chave privada de assinatura**, escopada a `aud:authenticated`. Um leak do crm-mcp **deixa de ser** um leak do `service_role` secret.
- Isso **não elimina** "forja qualquer user" (quem tem a chave privada minta qualquer `sub`). O que elimina é o acoplamento ao crown-jewel da plataforma. A eliminação estrutural total de "forja qualquer identidade" só viria com `generateLink`+`verifyOtp` (D1 vetável) ou um microserviço de minting cujo material a superfície de cliente não lê — decisão consciente do CTO (§8.1, residual).
- **`role` e `aud` são literais não-parametrizáveis** dentro de `mintUserJwt` — nunca derivados de input. Constantes `"authenticated"`. Não há caminho de código que minte `service_role`.

**Por que não as alternativas** (detalhe em §11): `generateLink`+`verifyOtp` é uma sessão GoTrue real (efeitos colaterais, exige email, pesado p/ alta-QPS); `SET LOCAL request.jwt.claims` exige conexão Postgres direta (abandona o PostgREST que o MCP usa); nenhuma admin API devolve um access_token para um `user_id` arbitrário num call.

Claims mintadas (fiel a um access token GoTrue, TTL curtíssimo):

```jsonc
{
  "iss":  "https://<PROJECT_REF>.supabase.co/auth/v1",
  "aud":  "authenticated",            // literal, não-parametrizável
  "role": "authenticated",            // literal, não-parametrizável → auth.role()
  "sub":  "<user_id do PAT>",         // → auth.uid()  (UUID válido; sem isto, hard-fail — NÃO minta)
  "email": "<email do user>",
  "phone": "",
  "user_metadata": {},
  "session_id": "<uuid sintético>",   // não há sessão GoTrue real — inócuo p/ RLS padrão
  "aal": "aal1",
  "is_anonymous": false,
  "iat": <now>,
  "exp": <now + 60s>                  // hard-cap; é o teto de propagação de revogação (§4.6, H6)
}
```

> **`organization_id` NÃO é mintado na claim (H3b — fecha o "attractive nuisance").** O draft original mintava `app_metadata.organization_id` como "advisory". Removido: a RLS atual lê org de `team_members`/`get_my_organization_ids()` por `auth.uid()`, então a claim era inerte hoje — **mas** o repo tem policies vivas que leem `auth.jwt()->>'organization_id'` / `auth.org_id()` (`20260504000001_create_meetings.sql:74-172`, depois patcheado em `20260985000000`; `send_dedup_log`/`greeting_dispatches`). No momento em que **qualquer** migration futura (ou um drift de prod) confiar nessa claim, o caller crm-mcp controla o valor end-to-end → cross-tenant trivial. Solução: **não mintar a claim**. O `token.orgId` viaja **só** no `ToolContext` (TS) para o filtro `.eq` de defense-in-depth (§6.4), nunca no token assinado. Isso fecha o vetor permanentemente. **CI guard adicional:** grep que falha se qualquer policy RLS ler `auth.jwt()->>'organization_id'` ou `auth.org_id()` (landmines independentes do crm-mcp).

Implementação (Deno), atrás de **um seam único** `mintUserJwt()`:

```ts
// lib/pat.ts
const userJwt = await mintUserJwt(signingKey, pat);   // ES256; sub=pat.userId; role/aud literais
assertWellFormedJwt(userJwt);                          // sub é UUID, role:authenticated — senão THROW (H3a)
const userClient = createClient(SUPABASE_URL, ANON_KEY, {
  accessToken: async () => userJwt,   // anexa Authorization: Bearer <userJwt> a todo PostgREST/Realtime
});
// userClient.auth.* fica desabilitado quando accessToken está setado — ok p/ MCP.
// anon key continua como supabaseKey → header `apikey` presente. NUNCA service_role aqui.
```

Notas críticas:
- **Hard-fail-closed no mint (H3a).** O callback `accessToken` ainda envia o `apikey` = anon key. Se `mintUserJwt` retornar null/vazio/lançar e o código **não** falhar fechado, o PostgREST cai para o role `anon` — e o anon-leak de 2026-06-01 provou que `anon` **pode** ler ~60k rows quando há hole de view/policy. Portanto: **antes de construir o client, assertar que o JWT é bem-formado com `sub` UUID e `role:authenticated`; se o mint falhar, 401/500 e NUNCA construir o client.** Teste de integração: "anon key sozinha (sem bearer / bearer vazio) lê ZERO rows de `leads`."
- **`exp` curto é hard-cap, não config (H6).** `exp - iat <= 60s`, constante com comentário "este é o teto de propagação de revogação". O PostgREST **não consulta** `revoked_at` — revogação é instantânea no nível do *PAT* (próximo resolve falha), mas um JWT já mintado vale até `exp` independentemente. Por isso o teto é load-bearing. **Teste:** assertar `exp - iat <= 60` no token mintado. TTL **nunca** vira plan/config-driven (impedir alguém de subir p/ 300s "pro loop lento do LLM").
- **`role`/`aud` errados = bug master-ghost ao contrário.** Se o PostgREST não trocar para `authenticated`, a query roda como `anon` → RLS nega tudo → "resultado vazio" que parece gap de RLS (a classe exata que já mordeu a Torque). O canary de boot (round-trip — §8.7) é o que prova end-to-end que isso não acontece.

### 4.5 Secrets / config

- `CRM_MCP_JWT_SIGNING_KEY` — **chave privada ES256 dedicada** do crm-mcp (não o legacy secret do projeto — H2). Crown-jewel da função, mas **desacoplada do `service_role`/legacy secret**: vazá-la forja qualquer *user*, não emite `service_role` (a metade pública confiada pelo PostgREST é só `aud:authenticated`). Tratar com blast-radius alto mesmo assim. Rotação via rotação de signing key no dashboard.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — para o client (header `apikey`).
- `CRM_MCP_PAT_PEPPER` (se D2 = sim) — pepper do HMAC do hash.
- **Assert-absent no boot (H3, tested invariant):** `loadConfig` do crm-mcp **lança no boot** se `SUPABASE_SERVICE_ROLE_KEY`, `MCP_MASTER_EMAIL`, `MCP_MASTER_PASSWORD` ou `MCP_GATEWAY_SECRET` estiverem presentes no env. Isto converte "secret ausente" de convenção de deploy em **invariante enforçada** — necessário porque a MEMORY é cheia de incidentes "env errado em prod" (copy-paste do bundle de secrets do torque-mcp na função errada). Unit-test obrigatório.
- `config.toml`: `verify_jwt = false` para `crm-mcp` (o gateway recebe o **PAT**, não um JWT Supabase; a auth é feita dentro). Consistente com o padrão da casa.

### 4.6 Expiry / rotação / revogação

- **Expiry obrigatório, default 90 dias, máx 366 dias, sem opção "nunca"** (espelha o teto org de PAT do GitHub; "never" é o pior default deles). Presets 7/30/60/90/365.
- **Rotação = criar-novo + revogar-velho** (sem reveal in-place). UI avisa em T-7d (badge + email opcional). Overlap (velho+novo válidos brevemente) suportado p/ swap zero-downtime.
- **Revogação no nível do PAT é single-click, soft-delete** (`revoked_at` + `revoked_reason`; mantém a row p/ auditoria). Hot path rejeita `revoked_at IS NOT NULL OR expires_at < now()`. **Honestidade sobre a janela (H6):** revogar mata o PAT no **próximo resolve**; um JWT já mintado segue válido até `exp` (≤60s) porque o PostgREST não consulta `revoked_at`. "Revogação instantânea" é verdade para o PAT, com ceiling de ≤60s para qualquer JWT em voo. Esse ceiling é constante e testado (§4.4).
- **`last_used_at` com write throttled** (só grava se >5 min stale) p/ evitar 1 write por request. **Auto-revoke após 1 ano sem uso** (`auto_unused`), via pg_cron.
- **Revogação em offboarding (M5):** deactivate/remove em `team_members` revoga os PATs do usuário.

### 4.7 Por que NUNCA service_role — e o que essa garantia realmente significa

A ADR-0011 (decisão 2) baniu service_role no caminho de dados:

> "Rejeitado: gateway secret + `service_role` no client de dados — bypassa RLS, scoping volta pro código TS = exatamente o anti-pattern que causou o vazamento anon."

No cenário B isso é ainda mais grave: o caller é um tenant. Um `service_role` client num endpoint de cliente significa que **um bug de scoping em TS expõe toda a plataforma** (não só "master vê vazio").

**Enquadramento honesto (correção de H2/pat-forgery e da lente rls-bypass):** `service_role` **não é "estruturalmente impossível"** — é **não-acessível por construção**, o que é diferente e mais forte de afirmar com precisão:
- O secret `SUPABASE_SERVICE_ROLE_KEY` **não está no namespace** da função, e o boot **falha se estiver presente** (§4.5, H3) — convenção de deploy virou invariante enforçada e testada.
- `ctx.serviceDb` é sempre `undefined`; nenhum código lazy-builda um service client (inversão deliberada de `torque-mcp/index.ts:51-62`, que só constrói service client quando `allowMutations`).
- Com a migração para chave de assinatura **ES256 dedicada** (§4.4, H2), a chave que a função carrega minta `aud:authenticated`, não `service_role` — então mesmo um leak da chave de assinatura **não** é um leak de `service_role`.

O residual honesto: quem tiver code-exec na função ou a chave privada de assinatura forja qualquer *usuário* (não `service_role`, dado ES256+`aud` fixo). Isso é inerente a self-minting e está registrado como residual em §8.1.

---

## 5. Cliente RLS-scoped por-usuário (o seam)

O `torque-mcp` cacheia **uma** sessão master no isolate porque o principal é fixo (`createCachedMasterClientProvider` + `signInAsMaster`). No `crm-mcp` o principal **varia por PAT** — não dá para cachear uma sessão e reusar entre usuários (seria o exato leak de scoping que estamos blindando). O seam:

| Seam | torque-mcp | crm-mcp |
|------|-----------|---------|
| Sign-in | `signInAsMaster(config)` (credenciais, 1 master) | `resolvePat(token)` → `(user_id, org_id, email)` + master-reject + membership-assert → `mintUserJwt(...)` (per-PAT) |
| Cache | `createCachedMasterClientProvider` (1 sessão / isolate) | **sem cache de sessão por usuário.** Mint é local, barato, TTL ≤60s. Cliente criado **por request**. |
| Client | master JWT, RLS-ON, master-ghost dá cross-org | user JWT, RLS-ON, `get_my_organization_ids()` dá só a(s) org(s) daquele usuário |

> **A invariante de scoping correta (HOLE 2 — o draft a enunciava errada).** "Um usuário normal já vê só a org dele" é **oversimplificado**. A policy SELECT viva de `leads` (`20260818100000_fix_leads_rls_use_feature_permissions.sql:36`) é `organization_id IN (team_members do uid) AND ( is_user_admin() OR has_feature_permission('leads.view_all') OR can_see_lead_by_permissions(...) OR is_user_responsible_in_any_pipe(...) )`. Consequências reais:
> - PAT de **membro low-privilege** (sem `leads.view_all`, não-admin) retorna **só** os leads de que ele é SDR/closer/responsável — uma fatia parcial da org, governada pelo permission engine de 3 camadas.
> - PAT de **admin** vê a org inteira.
> Logo o **blast radius de um PAT vazado é função do role de quem mintou** — varia de uma fatia mínima ao tenant inteiro. A §8.1 está correta só se "a visão de um usuário" for entendida nesse range. **Implicações de design:** (a) a UI alerta mais alto quando um **admin** cria PAT (é uma chave de leitura quase org-wide); (b) o teste-âncora cross-org **deve seedar um membro NÃO-admin** na org A — um teste seedado com admin passaria trivialmente e não exercitaria os predicados de responsabilidade nem provaria nada sobre o blast radius realista. Isolamento de tenant continua Postgres-enforçado (a cláusula `organization_id IN team_members` chaveia por `auth.uid()`); o que se corrige é a *frase*, não a parede.

**Footgun multi-org `get_user_organization_id()` (singular) — flag de design.** Várias tabelas do read pack (`whatsapp_instances`, `lead_scores`, e afins por `20261218000002`) escopam via `get_user_organization_id()` = `team_members ... ORDER BY created_at ASC LIMIT 1`. Para usuário em N orgs isso resolve **uma org arbitrária (a mais antiga)**, ignorando o `token.org_id`. O `.eq("organization_id", token.org_id)` (§6.4) protege de vazar a org **errada** (intersecta a vazio), mas significa que um PAT escopado p/ a 2ª org do usuário **retorna vazio** para dado legítimo. Regra: qualquer tool de cliente que toque tabela gateada pelo helper **singular** é **quebrado p/ usuários multi-org** até a policy migrar para `get_my_organization_ids()` ou aceitar org param explícito. C3 audita cada tabela do pack contra esse helper antes de expor o tool.

**Caching — o que pode e o que não pode:**
- **NÃO** cachear `userClient` num escopo compartilhado entre requests/identidades. O callback `accessToken` fecha sobre **um** token; reusar vazaria o escopo de um usuário para outro. **Um `userClient` por request.** (Brief A, caveat 7 — os 3 reviews concordam que aqui o design está corretamente paranoico.)
- **PODE** cachear, no isolate, coisas imutáveis e não-sensíveis: a `CryptoKey` de assinatura importada 1× por isolate e o array `CUSTOMER_TOOLS`.
- O mint em si é assinatura ES256 — sub-ms. Mint por-request (replay window menor).

Esboço do `index.ts`:

```ts
// boot: importa a signing key 1× (cacheada no módulo); assert-absent de secrets de ops (H3);
//       canary ROUND-TRIP (§8.7): minta p/ user seed, lê tabela RLS real, prova self-org e nega foreign-org.
const signingKey = await importSigningKey(config.jwtSigningKey);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")    return json({ error: "POST a JSON-RPC body." }, 405, cors);

  const token = bearer(req.headers.get("authorization"));
  const pat = await resolvePat(token, signingKey); // parse+CRC32→hash→RPC resolve→checks→master-reject→membership-assert
  if (pat.kind === "unauthorized") return rpc401(cors);   // formato/revoked/expired
  if (pat.kind === "forbidden")    return rpc403(cors);   // audience/scope/master/org-drift

  const rl = await rateCheck(pat.id, pat.orgId);          // RPC atômica per-token+per-org
  if (!rl.ok) return rpc429(cors, rl.retryAfter, rl.headers);

  const userJwt = await mintUserJwt(signingKey, pat);     // exp +60s, role/aud literais
  assertWellFormedJwt(userJwt);                            // hard-fail-closed (H3a)
  const db = createClient(config.supabaseUrl, config.anonKey, { accessToken: async () => userJwt });

  const ctx: DispatchContext = {
    serverInfo: { name: "torque-crm", version: "0.1.0" }, // SEM project
    tools: CUSTOMER_TOOLS,
    allowMutations: false,                                 // hard-pinned
    toolFilter: (t) => t.readonly === true && t.customerExposed === true,  // H4
    toolContext: { db, serviceDb: undefined, orgId: pat.orgId, userId: pat.userId, scopes: pat.scopes },
  };
  const result = await handleRpcPayload(payload, ctx);
  await touchLastUsed(pat.id); // throttled
  return json(result, 200, { ...cors, ...rl.headers });
});
```

> `ToolContext` ganha `orgId`/`userId`/`scopes` opcionais (campos novos, não-breaking para o torque-mcp). `DispatchContext` ganha `toolFilter?` opcional (default = comportamento atual, torque-mcp inalterado). É o que o assert defense-in-depth (§6) e o gate de allowlist (H4) consomem.

---

## 6. Superfície de tools

### 6.1 Allowlist positiva, separada do `allowMutations`, enforçada em runtime na C2 (H4)

O gate `allowMutations` (`visibleTools` filtrando por `t.readonly`) é o **eixo errado** para cliente. `db.read_sql`, `rls.check_access`, `schema.audit_*` são todos `readonly: true` — passariam um filtro `allowMutations=false` e **ainda vazariam** SQL cru e a superfície de auditoria de RLS da plataforma para um tenant. "Pode mudar dado?" e "este caller deveria ver este tool?" são perguntas diferentes.

**Verificado:** `visibleTools` (`registry.ts:6-11`) filtra **só** por `t.readonly`; `dispatch.ts:53,64` não conhecem `customerExposed`. O segundo gate **não existe em código hoje** — é intenção de design. Por isso ele é shippado **na C2** (não diferido p/ C3): a barreira "imports ausentes" é boa, mas é denylist-por-omissão que falha aberta no dia em que um engenheiro adiciona `db.read_sql` (readonly) a `CUSTOMER_TOOLS` "por conveniência" ou importa um tool de ops transitivamente.

Solução: **segundo gate, independente e fail-closed.** Estende `ToolDef`:

```ts
export interface ToolDef {
  // ...existente...
  /** Default false (fail-closed): só tools opt-in aparecem no endpoint customer. */
  customerExposed?: boolean;
}
```

Mecanismo (sem tocar o torque-mcp): `DispatchContext.toolFilter?: (t: ToolDef) => boolean` opcional, default = comportamento atual. O crm-mcp passa `(t) => t.readonly === true && t.customerExposed === true`; `tools/list` e `tools/call` honram o filtro. Duas linhas de defesa:
1. **Imports ausentes (primária).** `CUSTOMER_TOOLS` é array literal curado; o build do `crm-mcp` **não importa** `db.ts`, `rls.ts`, `cron.ts`, `schema.ts`, nem `leadRestoreTool`. A superfície de ops nem está no bundle.
2. **Filtro runtime (defense-in-depth, C2).** O tool precisa satisfazer **ambos** (`customerExposed` E `readonly`). Allowlist positiva: tool novo default-invisível até opt-in deliberado.

**Teste (C2):** `tools/list` de cliente **não** contém `db.read_sql`/`rls.check_access`/`schema.audit_*`; um tool readonly sem `customerExposed` é invisível.

### 6.2 Read pack de cliente (v1)

Handlers novos, customer-scoped (não os de ops; ver §6.3). Todos `readonly:true` + `customerExposed:true`:

| Tool | Tabela(s) (RLS-ON, org do usuário) | Notas |
|------|-----------------------------------|-------|
| `lead.get` | `leads` + `pipeline_entries`/`pipelines` embed | resolve por id\|phone; assert org; sem PII além do que o user já vê |
| `lead.list` | `leads` | paginado, filtros básicos; sub-limit de rate (tool "pesado") |
| `conversation.get` | `whatsapp_messages` + `leads` | thread por telefone |
| `pipeline.list` | `pipelines` + `pipeline_stages` | estrutura dos pipes da org |
| `stage.list` | `pipeline_stages` | stages dinâmicas |
| `whatsapp.instance_status` | `whatsapp_instances` | **só booleans/health** — nunca `whatsapp_instance_secrets`, nunca tokens; auditar helper singular (§5) |

### 6.3 NUNCA expostos a cliente

`db.read_sql`, `rls.check_access`, `schema.audit_definer`, `schema.audit_triggers`, `cron.toggle`, `lead.restore`, `copilot.update_prompt`, `copilot.dump_prompt` (prompt é IP do cliente mas dump expõe scaffolding interno — fora do v1), e qualquer coisa que toque `whatsapp_instance_secrets`, `master_*`, ou outra org. `tools/list` de cliente só pode retornar a allowlist — a superfície de ops **não é nem descobrível**.

> **Por que handlers novos e não reusar `lead.get` de ops:** o `lead.get` de ops aceita `org_id` como argumento e confia nele (faz sentido p/ master cross-org). No cliente, confiar no `org_id` do argumento é o vetor de cross-tenant. O handler de cliente **sobrescreve/asserta** `org_id` contra o `token.org_id` (§6.4). Reusamos a *lógica de formatação* via `_shared`, **mas o normalize de telefone é feito em TS dentro do crm-mcp, não via `db.rpc`** (§8.3, HOLE 1).

### 6.4 Defense-in-depth: `organization_id` explícito + assert (camada 3, load-bearing)

Todo handler de cliente, **além** da RLS:
1. **Nunca confia no `org_id` do cliente.** Se o argumento `org_id` vier e divergir de `token.org_id` → **`403`** (não query silenciosa). Se omitido, o servidor preenche do token.
2. **`.eq("organization_id", token.org_id)` em toda query**, redundante com a RLS. Se a RLS regredir (master-ghost/anon-leak/`is_team_member` são precedente **vivo**, não histórico), este filtro fica entre um bug e um vazamento cross-tenant. É **a barreira que teria contido o leak `is_team_member` de `20261119000018`** — load-bearing, não paranoia.
3. **Um PAT = uma org**, enforçado **no servidor** (assert §4.3.2), não só em arg-check TS. Cap de blast radius a exatamente um tenant.

---

## 7. Data model

### 7.1 Migration sketch — `personal_access_tokens`

```sql
-- supabase/migrations/<ts>_crm_mcp_personal_access_tokens.sql
create table public.personal_access_tokens (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,                          -- "n8n produção", obrigatório
  -- SHA-256 (ou HMAC-SHA256 c/ pepper) hex do token completo. Único → point-lookup, sem salt.
  token_hash        char(64) not null,
  token_prefix      text not null,                          -- 'tq_mcp_live_a1b2c3d4' (não-secreto, UI)
  audience          text not null default 'crm-mcp',        -- binding de recurso (RFC 8707 estático)
  scopes            text[] not null default array['read'],  -- intersecta com RLS, nunca aditivo
  last_used_at      timestamptz,
  expires_at        timestamptz not null,                   -- obrigatório; app limita a created_at+366d
  revoked_at        timestamptz,                            -- soft-delete; mantém row p/ auditoria
  revoked_reason    text,                                   -- user | expired | auto_unused | compromise | master_principal | offboarding
  created_by        uuid references auth.users(id),         -- = user_id p/ PAT; difere p/ svc futuro
  created_at        timestamptz not null default now()
);

-- Hot path: hash único → 1 lookup indexado. Partial mantém o índice enxuto p/ tokens vivos.
create unique index pat_token_hash_uq on public.personal_access_tokens (token_hash);
create index pat_active_lookup on public.personal_access_tokens (token_hash) where revoked_at is null;
create index pat_user_idx on public.personal_access_tokens (user_id, created_at desc);
create index pat_org_idx  on public.personal_access_tokens (organization_id);

-- token_hash, scopes, owner, org E AUDIENCE imutáveis após insert (H4: audience entra no frozen set
-- p/ não virar confused-deputy quando um 2º produto/audience landar). Só revoked_*/last_used_at mudam.
create or replace function public.pat_block_immutable_update()
returns trigger language plpgsql as $$
begin
  if new.token_hash <> old.token_hash
     or new.scopes is distinct from old.scopes
     or new.organization_id <> old.organization_id
     or new.user_id <> old.user_id
     or new.audience is distinct from old.audience then
    raise exception 'personal_access_tokens: token_hash/scopes/owner/audience are immutable';
  end if;
  return new;
end $$;
create trigger pat_immutable before update on public.personal_access_tokens
  for each row execute function public.pat_block_immutable_update();
```

### 7.2 RLS (convenções Torque + master-ghost desde o dia 1)

Segue o CLAUDE.md: nunca `SELECT ... FROM team_members` inline (recursão sob Realtime); sempre os helpers `SECURITY DEFINER` `get_my_organization_ids()` / `get_my_admin_organization_ids()` / `is_master_user()`.

> **PRÉ-REQUISITO DE SHIP (H2 — verificar em prod, não assumir).** O draft afirmava "todos os helpers definer pinados em search_path (lição 20261227000000)". **Verificado FALSO para `is_master_user`:** `20260131200000:208` é `LANGUAGE plpgsql SECURITY DEFINER STABLE` **sem** `SET search_path`. É a exata classe 42883/search-path que já quebrou o precedente citado (leads_uf, `20261224000000`), e fica no hot-path de avaliação de **toda** policy master-ghost de que este design depende — agora exercitada por um caller **não-confiável**. A MEMORY nota "drift de raiz pendente" e migrations puladas em colisão. **Slice task em C2:** confirmar via `schema.audit_definer` (torque-mcp) que `is_master_user` está pinada **em PROD**; se não estiver, pinar (`SET search_path = public, extensions`) **antes** do crm-mcp shippar. O doc não assere "tudo pinado" — assere "verificar em prod".

```sql
alter table public.personal_access_tokens enable row level security;

-- Usuário gerencia só os próprios tokens.
create policy pat_owner_select on public.personal_access_tokens
  for select using (user_id = auth.uid());
create policy pat_owner_insert on public.personal_access_tokens
  for insert with check (
    user_id = auth.uid()
    and organization_id in (select public.get_my_organization_ids())
  );
-- Revoke-only (UPDATE gateado; o trigger 7.1 impede mudar hash/scopes/owner/audience).
create policy pat_owner_update on public.personal_access_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin da org lista/revoga tokens da própria org (governança).
create policy pat_admin_manage on public.personal_access_tokens
  for all using (organization_id in (select public.get_my_admin_organization_ids()))
       with check (organization_id in (select public.get_my_admin_organization_ids()));

-- Master-ghost desde o dia 1 (a classe que mordeu a Torque 5+ vezes) — para a UI de GESTÃO.
create policy pat_master_ghost on public.personal_access_tokens
  for all using (public.is_master_user()) with check (public.is_master_user());
```

> Nota: a RLS acima governa a **UI de gestão**. O hot-path de auth resolve a row via a RPC `SECURITY DEFINER` mínima `crm_mcp_resolve_token(p_hash)` (§7.6). **Importante (interação com H1):** a policy `pat_master_ghost` aqui é justamente por que um PAT de master, se mintado, leria cross-org — o que reforça que a defesa **não** está na RLS desta tabela, mas na **rejeição de master no resolve** (§4.3.1). A RLS master-ghost serve só para o CTO administrar tokens pela UI, nunca para o crm-mcp operar.

### 7.3 Rate limit — `crm_mcp_rate_limits` + RPC atômica

```sql
create table public.crm_mcp_rate_limits (
  bucket_key   text not null,            -- 'tok:<pat_id>' | 'org:<org_id>' | 'org_day:<org_id>'
  window_start timestamptz not null,     -- date_trunc('minute'|'day', now())
  count        integer not null default 0,
  primary key (bucket_key, window_start)
);

-- Increment-and-check atômico (evita read-modify-write race entre isolates).
create or replace function public.crm_mcp_rate_check(
  p_bucket_key text, p_window_start timestamptz, p_limit integer
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare v integer;
begin
  insert into public.crm_mcp_rate_limits (bucket_key, window_start, count)
    values (p_bucket_key, p_window_start, 1)
  on conflict (bucket_key, window_start)
    do update set count = public.crm_mcp_rate_limits.count + 1
  returning count into v;
  return v;  -- caller compara v > p_limit → 429
end $$;
```

A fn chama 3× (token/min, org/min, org/dia) por request; se qualquer `count > limit` → 429. Cleanup de janelas velhas via pg_cron diário.

> **Hardening (H7):** `crm_mcp_rate_check` é `SECURITY DEFINER` com escrita em tabela compartilhada por `bucket_key`. Se um caller alcançasse esta RPC com `bucket_key`/`window_start` controlados, seria primitiva de insert/increment cross-tenant (bloat / linhas alheias). É **server-only por design** — chamada só de `lib/rate-limit.ts` com chaves 100% derivadas do servidor (`pat.id`, `pat.orgId`, `date_trunc(now())`), **nunca** de params JSON-RPC, e **nunca** exposta como tool. Para garantir: `revoke execute on function public.crm_mcp_rate_check from anon, authenticated;` + `grant execute` só ao role que a função usa — assim **nem o JWT mintado** (`authenticated`) pode chamá-la via `/rest/v1/rpc/`.

### 7.4 Auditoria

Reusa `audit_log` (a mesma superfície que ficou cega em incidentes passados — ligar PATs desde o dia 1):

- **Issue:** `pat.created` — actor `user_id`, `organization_id`, `pat_id`, `name`, `scopes`, `expires_at`, IP/UA. **Nunca** o secret ou o hash completo.
- **Use:** **não** grava 1 row de audit por request (volume). Em vez disso: (a) `last_used_at` throttled; (b) request PAT-autenticada vai pra telemetria/Sentry normal **tagueada com `pat_id` + tool** → misuse fica queryable.
- **Falha de auth:** `pat.auth_failed` com causa (`revoked`/`expired`/`scope`/`audience`/`master_principal`/`org_drift`) — o sinal de segurança.
- **Revoke:** `pat.revoked` — actor, `pat_id`, reason, timestamp.

### 7.5 UI (módulo `platform/` ou `identity/`)

Tela "Tokens de acesso" (settings do usuário): criar (nome + escopo + expiry, **display-once** do token), listar (`name`, `token_prefix`, `scopes`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`), revogar (single-click, confirm). **Aviso role-aware (HOLE 2):** quando o criador é admin, a UI alerta que o token é uma chave de leitura **quase org-wide** (não "só a minha visão") — um admin e um membro têm blast radius muito diferentes. Admin: visão dos tokens da org (governança). Dark-first, padrão Linear/Stripe (a tela de API keys do Stripe é a referência).

### 7.6 RPC `crm_mcp_resolve_token` (a única RPC que devolve identidade — tem que ser hermética) (M6/H7)

Todo o argumento de pureza-RLS repousa nesta RPC devolver **só** os campos de identidade da row casada — nunca `SELECT *`, nunca um oráculo de enumeração.

```sql
create or replace function public.crm_mcp_resolve_token(p_hash char(64))
returns table (id uuid, user_id uuid, organization_id uuid,
               scopes text[], expires_at timestamptz, revoked_at timestamptz, audience text)
language sql security definer set search_path = public, extensions as $$
  select id, user_id, organization_id, scopes, expires_at, revoked_at, audience
    from public.personal_access_tokens
   where token_hash = p_hash
   limit 1;
$$;

revoke execute on function public.crm_mcp_resolve_token(char) from anon, authenticated;
grant  execute on function public.crm_mcp_resolve_token(char) to   <role_que_a_fn_usa>;
```

Pontos não-negociáveis:
- **`revoke execute ... from anon, authenticated`** — sem isto, o JWT mintado (que é `authenticated`) poderia chamar `crm_mcp_resolve_token(hash)` direto via `/rest/v1/rpc/` e transformá-la em oráculo de existência/identidade de token. Esta é a regra também aplicada a `crm_mcp_rate_check` (§7.3).
- **Qual role executa o resolve, dado que não há JWT ainda nesse ponto?** O resolve roda **antes** de mintar a sessão do usuário, então não pode usar o user client. Roda via um **handle separado** (jamais `ctx.db`): o client da função com a anon key, cuja request chega ao PostgREST como role `anon`. Por isso o `grant execute` precisa contemplar o role efetivo desse caminho (`anon`) **e mesmo assim** a função é hermética: devolve só identidade da row exata, sem SELECT arbitrário, sem diferenciar "not found" de "revoked" (retorna row vazia em ambos), sem mensagem de erro que vaze existência. É a única exceção definer pré-identidade, e é mínima por construção.
- Pinada em `search_path = public, extensions` (lição 20261227000000).

---

## 8. Modelo de segurança + threat analysis

### 8.1 Blast radius de um PAT vazado

| | `x-mcp-secret` (torque-mcp) | PAT vazado (crm-mcp) |
|---|---|---|
| Principal | ops-master, visão cross-org | **uma org, um usuário** — **nunca master** (§4.3.1) |
| Superfície | ops pack (`db.read_sql`, `cron.toggle`, …) | read pack curado (allowlist runtime, H4) |
| Impacto | **comprometimento total da plataforma** — PII de todo tenant | confinado a **um tenant**, **à visão do usuário que mintou** (varia de fatia mínima a org-wide conforme o role — §5, HOLE 2) |
| Mitigação de vida | rotação do secret (invalida tudo) | revoke do PAT (próximo resolve) + expiry curto + TTL do JWT mintado ≤60s (H6) |

Um PAT vazado **nunca** vira ops-master: a função não tem `MCP_MASTER_*` no namespace (boot falha se tiver — H3), e **PAT de master é recusado no resolve** (H1). `service_role` é não-acessível por construção (§4.7).

### 8.2 Isolamento cross-org (o argumento)

Três camadas independentes têm que falhar juntas para vazar cross-tenant:
1. **PAT → `user_id`/`org_id`** resolve para um único usuário não-master (§4.3.1), com a org assertada contra membership atual (§4.3.2); um PAT = uma org (§6.4.3).
2. **RLS** via `auth.uid()` (do JWT mintado) → `get_my_organization_ids()`/predicados de responsabilidade → só o que aquele usuário vê (range por role — §5).
3. **`.eq("organization_id", token.org_id)` explícito** + assert do arg (§6.4) — pega regressão de RLS.

A camada 3 existe **porque a 2 já falhou em prod e continua falhando de forma rolante** (anon-leak, master-ghost, `is_team_member` patcheado 6 dias antes deste doc). Não é redundância paranóica; é a resposta de design ao histórico **ativo** da base.

### 8.3 Anti-bypass (RLS-puro) — exceção de dado ZERADA no user client (HOLE 1)

Regra da ADR-0011 (decisão 4), reforçada para cliente: **tools de cliente nunca chamam RPC `SECURITY DEFINER` pelo user client** — RPC definer roda com privilégio do dono, bypassaria a RLS herdada e faria o teste-âncora passar falsamente. Tools de cliente fazem `.from(...).select(...)` direto via JWT do usuário (RLS-ON).

> **Correção do draft (HOLE 1):** o draft listava `normalize_brazilian_phone` como "exceção controlada, pura, sem dado" chamável via user client — e o handler reusado de ops (`torque-mcp/tools/lead.ts:56`) faz literalmente `await db.rpc("normalize_brazilian_phone", ...)`. Isso é **exatamente a forma mecânica** que o CI guard anti-bypass (`.rpc(` no user client) tem que banir — e um grep não distingue "função pura" de "definer que lê dado". Pior, não confirmamos `prosecdef`/volatilidade dessa função nas migrations ("não achei" ≠ "é INVOKER"). **Decisão:** o normalize de telefone é feito **em TS, dentro do crm-mcp** (`lib/phone.ts`), portando a lógica e pinando com golden test contra a função do DB se houver requisito de paridade com `normalized_phone`. Resultado: **a lista de exceções definer para o user client (`ctx.db`) é VAZIA.** O CI guard vira regra de zero-exceção: `no .rpc( on userClient`.

As duas RPCs definer do sistema — `crm_mcp_resolve_token` (pré-identidade) e `crm_mcp_rate_check` (counter) — rodam num **handle separado, nunca `ctx.db`**, são server-only e revogadas de `anon`/`authenticated` (§7.3, §7.6). Nenhuma RPC definer de **leitura de dado de tenant** é chamável de tool nem do user client.

### 8.4 Rate limit / abuso

- **Per-token:** 60 req/min sustentado (burst até ~100). **Per-org:** 300 req/min agregado (um cliente mintando N PATs não multiplica blast radius). **Daily ceiling per-org:** 50k/dia (backstop de custo — cada call pode fan-out p/ loop do LLM do cliente). Tools "pesados" (`lead.list`) têm sub-limit menor.
- **429** com `Retry-After: <s>` (obrigatório) + `RateLimit-Limit`/`-Remaining`/`-Reset` em toda resposta. Como é JSON-RPC sobre HTTP, o body também é envelope JSON-RPC válido (`error.code` negativo, message `"Rate limit exceeded"`) p/ o cliente MCP não engasgar.
- Tiers raisáveis por plano (futuro: ler de `subscription_plans`).

### 8.5 Spec MCP / Streamable HTTP

- Bearer em `Authorization`, **nunca** query string. `initialize` ecoa `protocolVersion` suportado (a espinha já faz). **`serverInfo` higienizado:** `name: "torque-crm"`, **sem** `project: dev|prod` (não vazar reconnaissance ao tenant — o torque-mcp expõe `project`, o crm-mcp **não**). `401` em token ausente/inválido; `403` em scope/audience/master/org-drift; `429` em rate limit.
- Roadmap (NG1): hospedar `/.well-known/oauth-protected-resource` (RFC 9728) + `WWW-Authenticate` no 401 quando sair do PAT estático. O modelo PAT é forward-compatible porque já tratamos a credencial como bearer opaco audience-bound.

### 8.6 Lições master-ghost / anon-leak aplicadas

- **Master proibido como principal** (§4.3.1, H1) — o único caminho de um endpoint de cliente virar master-ghost reader, fechado no resolve.
- **`org_id` explícito + assert** (§6.4) — a regressão de RLS não vira breach. É a barreira que teria contido `is_team_member` (`20261119000018`).
- **Org claim NÃO mintada no JWT** (§4.4, H3b) — fecha o vetor "policy futura confia em `auth.jwt()->>'organization_id'`". CI guard grepa policies que leiam essa claim ou `auth.org_id()`.
- **CI guard de isolamento cross-org** (§9, C2) — integração seedada com **membro não-admin** (HOLE 2): PAT da org A **não** lê rows da org B; arg `org_id` divergente é rejeitado; PAT de master é rejeitado; anon-sem-bearer lê zero. É o regression guard que a classe master-ghost **sempre** não teve.
- **Hard-fail-closed no mint** (§4.4, H3a) — mint vazio/quebrado nunca degrada para `anon` silenciosamente.
- **Helpers RLS pinados em `search_path`** — `crm_mcp_resolve_token`/`crm_mcp_rate_check` pinam; **e** verificar em prod que `is_master_user` está pinada (H2, §7.2) antes de shippar.
- **Secrets de ops assert-absent no boot** (§4.5, H3) — convenção de deploy vira invariante testada.

### 8.7 Risco: assinatura / migração de chaves + canary round-trip

Hoje o ecossistema aceita HS256 (legacy secret) e ES256 (signing keys, GA out/2025). O crm-mcp assina **ES256 dedicada** (§4.4) para não acoplar ao legacy/`service_role` secret. Riscos e mitigações:
- **Quebra silenciosa de assinatura** (chave errada, `kid` ausente, `aud` mismatch): o PostgREST cai para `anon` → RLS nega → "vazio" tipo master-ghost. **O canary de boot tem que ser ROUND-TRIP (HOLE 3), não decode-only:** mintar um JWT para um user seed conhecido, **bater numa tabela RLS-protegida real pelo client de verdade** e assertar (a) que retorna a row daquele user e (b) num segundo assert, que **não** retorna row de org alheia. Decode-only passaria mesmo com um token que o gateway rejeita — exatamente o silent-anon-fallback que mordeu a base. **Gate bloqueante, não advisory.**
- **Canary só roda no boot:** um isolate já quente não re-valida; uma rotação de chave enquanto o isolate está warm só trip no próximo cold-start. **Gap registrado/aceito** — mitigado por TTL ≤60s e por rotação coordenada (gate de processo abaixo).
- **Gate de processo:** rotação/revogação de qualquer material de assinatura só após validar o canary round-trip no ambiente alvo.

### 8.8 Riscos residuais explicitamente aceitos / diferidos

- **R1 — Self-mint = forja-de-qualquer-usuário inerente.** Mesmo com ES256 + `role`/`aud` literais, qualquer RCE/dependency-compromise nesta superfície customer-facing consegue mintar qualquer `sub` (não `service_role`). Eliminação estrutural total só com `generateLink`+`verifyOtp` (D1, vetável) ou microserviço de minting isolado. **Aceito no v1** como inerente ao self-mint; ES256 reduz para "forja user, não service_role". Decisão consciente do CTO (D1).
- **R2 — Janela de replay do JWT mintado ≤60s** (H6). PostgREST não consulta `revoked_at`; um JWT em voo vive até `exp`. Aceito; teto constante e testado.
- **R3 — Fork de timing no reject offline de CRC32** (H5). Distingue candidato bem-formado de lixo sem DB. Não-prático com 178 bits de entropia. **Aceito**, explicitado em vez de mascarado.
- **R4 — Canary não cobre rotação com isolate quente** (§8.7). Aceito; mitigado por TTL + gate de rotação.
- **R5 — Tabelas gateadas por `get_user_organization_id()` (singular) são quebradas p/ usuário multi-org** (§5). Não vaza (o `.eq` intersecta a vazio) mas **retorna vazio** para dado legítimo. Diferido: C3 audita cada tabela do pack; tool só exposto se a tabela usar helper plural ou aceitar org param. Migração das policies singulares é trabalho separado.

---

## 9. Slices (entrega vertical)

Cada slice é independentemente shippable. **C1 (extração da espinha `_shared/mcp/`) está DONE** — é o que o `torque-mcp` já consome.

### C2 — PAT infra + cliente RLS-scoped per-user + tracer tool + gate de allowlist runtime ⭐
O tracer-bullet vertical. Entrega ponta-a-ponta o caminho mais fino, **com todos os fixes HIGH embutidos** (não diferidos):
- Migration: `personal_access_tokens` (tabela + índices + trigger imutável incl. `audience` + RLS §7.1/7.2) — aplicada em **dev** (prod com OK explícito).
- RPC `crm_mcp_resolve_token(p_hash)` (definer, mínima, pinada, **revoke from anon/authenticated** §7.6).
- **Verificar em prod (H2):** `is_master_user` pinada em `search_path`; pinar antes de shippar se não estiver.
- `lib/pat.ts`: `parsePat` (formato+CRC32) + `resolvePat` (lookup+checks + **master-reject H1** + **membership-assert M5**) + `mintUserJwt` (**ES256, role/aud literais, sem org claim** H2/H3b) + `assertWellFormedJwt` (**hard-fail H3a**).
- `lib/phone.ts`: normalize em TS (**zero `.rpc` no user client** HOLE 1).
- `lib/config.ts`: **assert-absent de `SERVICE_ROLE_KEY`/`MCP_MASTER_*`/`MCP_GATEWAY_SECRET`** no boot (H3).
- `crm-mcp/index.ts`: L1+L2 wiring, `allowMutations=false` hard-pinned, **`toolFilter` runtime fail-closed** (H4), `serverInfo` sem project, **canary de boot ROUND-TRIP** (HOLE 3).
- Espinha: `DispatchContext.toolFilter?` + `ToolDef.customerExposed?` (não-breaking p/ torque-mcp).
- **Tracer tool:** `lead.get` customer-scoped (assert org + `.eq` explícito).
- **Teste-âncora (o guard da classe), seedado com MEMBRO NÃO-ADMIN na org A (HOLE 2):** integração — PAT do membro lê só os leads dele na org A; **não** lê org B; arg `org_id` divergente → 403; **PAT de master → 403 e zero rows cross-org** (H1); **anon-sem-bearer → zero rows** (H3a). Unit: parse/CRC32, mint→decode `role:authenticated`, `exp-iat<=60` (H6), allowlist fail-closed (`db.read_sql` ausente de `tools/list`, H4), config boot-fail com secret de ops (H3).
- UI mínima: criar/listar/revogar PAT (display-once) + **aviso role-aware** (HOLE 2).
- `config.toml` + ADR 0012 (esta decisão) + docs Obsidian.

### C3 — Read pack completo + allowlist `customerExposed`
- Handlers: `lead.list`, `conversation.get`, `pipeline.list`, `stage.list`, `whatsapp.instance_status`.
- **Auditar cada tabela do pack contra `get_user_organization_id()` singular (R5/§5)** — só expor tool se plural ou com org param.
- Cada um com assert org + `.eq` + teste cross-org no CI guard (parametrizado por tool, seed não-admin).
- Teste: `tools/list` de cliente retorna **só** a allowlist (nenhum tool de ops descobrível).

### C4 — Rate limit + abuse
- Migration `crm_mcp_rate_limits` + RPC `crm_mcp_rate_check` (**revoke from anon/authenticated**, server-only — H7).
- `lib/rate-limit.ts`: 3 buckets (token/min, org/min, org/dia) + 429 + `Retry-After`/`RateLimit-*` + envelope JSON-RPC. Chaves 100% server-derived.
- pg_cron de cleanup de janelas velhas.
- Sub-limit p/ tools pesados.

### C5 — Lifecycle + auditoria + governança
- `last_used_at` throttled; pg_cron auto-revoke 1 ano (`auto_unused`); aviso T-7d (badge + email opcional).
- **Revogação de PAT em offboarding** (trigger/flow em `team_members` deactivate — M5).
- `pat.created` / `pat.revoked` / `pat.auth_failed` (incl. `master_principal`/`org_drift`) em `audit_log`; telemetria Sentry tagueada `pat_id`+tool.
- UI admin (governança org) + rotação com overlap.

### C6 (futuro, fora do v1) — upgrade trail
- OAuth 2.1 metadata (RFC 9728/8414) + `WWW-Authenticate`.
- Org-owned service token `tq_svc_…`.
- Tiers de rate limit por `subscription_plans`.
- CI guard: falhar build se policy RLS ler `auth.jwt()->>'organization_id'`/`auth.org_id()` (landmine, H3b) — antecipar p/ C2 se barato.
- Mutating cliente (ADR própria) atrás de escopo `:write` + `runMutation` guardrails.

---

## 10. Decisões (revisar com CTO)

> Escolhas consequentes que tomei. Cada uma tem uma alternativa; o CTO pode vetar.

- **D1 — Mint de JWT self-signed via callback `accessToken`, com chave de assinatura ES256 dedicada (não o legacy/`service_role` secret).** Alternativa: `generateLink`+`verifyOtp` (sessão GoTrue real, única forma de eliminar estruturalmente "forja qualquer user"). Escolhi self-mint ES256: sem efeitos colaterais, sem email, ≤60s TTL, e desacoplado do crown-jewel da plataforma. Consequência (R1): a chave de assinatura forja qualquer *usuário* (não `service_role`). **Veto possível:** se o CTO quiser zero capacidade de forja na fn customer-facing, vamos pra `generateLink`+`verifyOtp` (mais pesado).
- **D2 — Hash do PAT = SHA-256 + pepper HMAC (`CRM_MCP_PAT_PEPPER`).** Alternativa: SHA-256 puro. Pepper é barato e defende leak de DB-sem-app-secret. **Veto:** dropar o pepper se preferir menos um secret.
- **D3 — Função separada `crm-mcp`, namespace de secrets separado + boot-fail se secrets de ops presentes.** Alternativa: flag no `torque-mcp`. A ADR-0011 e o brief C são enfáticos. **Não recomendo vetar.**
- **D4 — Allowlist positiva `customerExposed` runtime (fail-closed, na C2) + imports ausentes no build.** Alternativa: só `allowMutations` (denylist implícito) ou diferir o runtime gate p/ C3. Vetei ambos: `db.read_sql` é `readonly` e vazaria; e a barreira de imports falha aberta no 1º import errado. **Não recomendo vetar.**
- **D5 — PAT de master proibido (resolve rejeita uid ∈ `master_users`).** Sem alternativa razoável — é o fix de H1, a única forma de um endpoint de cliente virar master-ghost reader. Operações de master ficam no `torque-mcp`. **Não vetar.**
- **D6 — Org claim NÃO mintada no JWT.** Alternativa: mintar como "advisory" (draft original). Vetado: vira attractive nuisance no dia em que uma policy confiar nela; o repo tem policies que já leram `auth.jwt()->>'organization_id'`. `token.orgId` viaja só no `ToolContext`. **Não vetar.**
- **D7 — Formato `tq_mcp_live_/test_`** (env-tagged). Alternativa: sem env tag. **Veto:** baixo custo dropar a tag.
- **D8 — Rate limit em Postgres (counter + RPC atômica, revogada de anon/authenticated), não Redis.** Alternativa: edge-KV/Redis. **Veto:** se volume crescer, reavaliar.
- **D9 — `serverInfo` sem `project`.** Cliente não deve fazer reconnaissance de ambiente. **Não recomendo vetar.**
- **D10 — Expiry máx 366d, sem "nunca"; auto-revoke 1 ano sem uso; revoga em offboarding.** Alternativa: permitir "nunca" (pedido headless). A resposta certa p/ headless é o org-owned service token (C6). **Veto:** antecipar C6 se um cliente grande precisar headless já.
- **D11 — v1 read-only duro (NG2).** Mutating cliente amplifica o risco que a ADR-0011 mandou adiar. **Não recomendo vetar no v1.**
- **D12 — `crm_mcp_resolve_token` como RPC `SECURITY DEFINER` mínima, revogada de anon/authenticated, num handle separado de `ctx.db`.** Alternativa: `service_role` client só p/ o SELECT do token. Escolhi a RPC mínima: mantém `service_role` fora do namespace inteiro (D3 consistente). **Não recomendo vetar.**

---

## 11. Alternativas rejeitadas

- **`auth.admin.generateLink('magiclink')` + `verifyOtp()` para obter sessão real.** Funciona mas é a ferramenta errada para scoping por-request: cria sessão GoTrue real (efeitos colaterais, eventos de auth, exige email), pesado para alta-QPS. É o fluxo de "admin loga como user" numa UI. (Reservado como fallback se D1 for vetada — é a única opção que elimina estruturalmente a forja-de-usuário, R1.)
- **`SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '...'` via conexão Postgres direta.** É o que o PostgREST faz internamente, mas **inalcançável pelo supabase-js** (que fala HTTP). Exigiria conexão direta pelo pooler, abandonando o PostgREST que o MCP usa, com risco de vazar `SET LOCAL` entre conexões pooled. Rejeitado.
- **Assinar o JWT com o legacy JWT secret do projeto (HS256).** Era o draft original. Rejeitado (H2): esse secret também assina `service_role`; pô-lo numa fn customer-facing equivale a dar `service_role` à fn. Trocado por chave ES256 dedicada (§4.4, D1).
- **Mintar `app_metadata.organization_id` na claim ("advisory").** Rejeitado (H3b): attractive nuisance — vira cross-tenant trivial no dia em que uma policy confiar na claim, e há precedente vivo de policies lendo `auth.jwt()->>'organization_id'`. Org viaja só no `ToolContext` TS.
- **`service_role` no client de dados.** Rejeitado pela ADR-0011 (decisão 2) e amplificado no cenário B (caller é tenant). No crm-mcp é não-acessível por construção (§4.7).
- **Permitir PAT para usuário master.** Rejeitado (H1, D5): transforma o endpoint de cliente em master-ghost reader cross-org. Master fica no torque-mcp.
- **Reusar o ops-master sign-in (`signInAsMaster`).** Daria visão cross-org a um caller de cliente — o oposto do cenário B.
- **Reusar `createCachedMasterClientProvider` para cachear a sessão do usuário.** O cache assume **um** principal fixo; cachear/reusar entre PATs vazaria escopo entre usuários. Mint per-request em vez disso.
- **Diferir o gate de allowlist runtime (`customerExposed`) p/ C3, confiando só em imports ausentes na C2.** Rejeitado (H4): denylist-por-omissão falha aberta no 1º import errado. Gate runtime ship na C2.
- **`db.rpc("normalize_brazilian_phone")` no user client como "exceção pura".** Rejeitado (HOLE 1): é a forma mecânica exata que o CI guard anti-bypass tem que banir e a pureza/volatilidade da função não foi confirmada nas migrations. Normalize em TS; lista de exceções definer no `ctx.db` fica vazia.
- **Canary de boot decode-only.** Rejeitado (HOLE 3): passaria com token que o gateway rejeita (silent-anon-fallback). Canary é round-trip contra tabela RLS real.
- **OAuth 2.1 completo no v1.** Máquina de AS/DCR/PKCE que não temos. PAT estático é spec-compatível e forward-compatible. Roadmap C6.
- **Argon2/bcrypt para o hash do PAT.** Lentidão de senha-humana não compra nada contra token CSPRNG de 178 bits e adicionaria latência a toda request. SHA-256 é o padrão correto p/ credencial de alta entropia (brief B; OWASP Secrets Management).

---

## 12. Referências

### Internas (codebase — fonte de verdade)
- ADR: `docs/adr/0011-torque-mcp-internal-ops-server.md` (cenário B adiado; banimento de service_role; anti-bypass definer; RLS-herdado).
- Espinha C1: `supabase/functions/_shared/mcp/{types,dispatch,http,auth,guardrails,crypto,redact,registry}.ts` — `registry.ts:6-11` (`visibleTools` filtra só `readonly`), `dispatch.ts:53,64` (sem `customerExposed`), `http.ts:8-15` (`secretMatches` fora do hot-path do PAT).
- Anti-pattern a divergir: `supabase/functions/torque-mcp/index.ts:51-62` (gateway secret + master sign-in + lazy service client quando `allowMutations`).
- Mint master a substituir: `supabase/functions/torque-mcp/lib/clients.ts` (`signInAsMaster`).
- Config a forkar (sem master/service-role; loader hoje requer `MCP_MASTER_*` e só opcionalmente lê service_role — **não** assere ausência): `supabase/functions/torque-mcp/lib/config.ts:36-67`.
- Handler com `org_id` a endurecer + **`db.rpc("normalize_brazilian_phone")` a portar p/ TS (HOLE 1)**: `supabase/functions/torque-mcp/tools/lead.ts:56`.
- Helpers RLS: `supabase/migrations/20260131200000_create_master_admin_tables.sql:199-208` (`is_master_user` por `auth.uid()`, **não pinado** — H2), `20260520000000_permission_tab_schema.sql` (`get_my_organization_ids`, filtro `is_active`), `20261020000000_fix_realtime_rls_recursion.sql:14-25`.
- Policy `leads` responsibility-scoped (HOLE 2): `supabase/migrations/20260818100000_fix_leads_rls_use_feature_permissions.sql:36`.
- Landmine `auth.jwt()->>'organization_id'` / `auth.org_id()` (H3b): `20260504000001_create_meetings.sql:74-172`, depois `20260985000000_fix_meetings_rls.sql`.
- Classe `is_team_member` (leak cross-org, varredura ativa): `20261119000018_rls_wrap_and_fix_is_team_member_leak.sql`, `20261218000002_security_fix_remaining_is_team_member_policies.sql`. Helper singular multi-org (R5): `20260917000100_fix_permissions_multi_org_deterministic.sql:39`.
- Master-ghost migration (precedente da classe): `supabase/migrations/20261222000000_torque_mcp_master_ghost_policies.sql`.
- Hardening search_path (lição de pin): `20261227000000` (58 definers) / `20261224000000` (leads_uf 42883).
- CLAUDE.md raiz (gotchas RLS+Realtime, `verify_jwt=false`, multi-tenancy).

### Externas (research)
- [MCP Authorization spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — bearer, 401/403, audience binding.
- [MCP Security Best Practices (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices) — minimização de escopo.
- [Auth0 — MCP Streamable HTTP security](https://auth0.com/blog/mcp-streamable-http/).
- [Can we mint our own JWT and use it with RLS? — Supabase Discussion #37716](https://github.com/orgs/supabase/discussions/37716).
- [JWT Claims Reference — Supabase](https://supabase.com/docs/guides/auth/jwt-fields) | [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) | [Introducing JWT Signing Keys (blog)](https://supabase.com/blog/jwt-signing-keys) (shift assimétrico GA out/2025 — base do ES256 dedicado).
- [Securing Edge Functions — Supabase](https://supabase.com/docs/guides/functions/auth).
- [Behind GitHub's new authentication token formats — GitHub Blog](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/) (prefixo + CRC32 + entropia).
- [Introducing fine-grained PATs — GitHub Blog](https://github.blog/security/application-security/introducing-fine-grained-personal-access-tokens-for-github/) | [Token expiration & revocation — GitHub Docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation).
- [Best practices for secret API keys — Stripe](https://docs.stripe.com/keys-best-practices) | [Restricted API keys — Stripe](https://docs.stripe.com/keys/restricted-api-keys) (display-once, restricted keys, monitorar request logs).
- [Tokens — Slack](https://docs.slack.dev/authentication/tokens/) (escopos granulares).
- [SHA-256 vs Argon2 — MojoAuth](https://mojoauth.com/compare-hashing-algorithms/sha-256-vs-argon2/) | [Secrets Management Cheat Sheet — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) | [Authentication Cheat Sheet — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707) (audience binding, análogo estático).
- [Redis — rate limiting algorithms](https://redis.io/tutorials/howtos/ratelimiting/) | [API rate limiting best practices](https://www.getknit.dev/blog/10-best-practices-for-api-rate-limiting-and-throttling).
