# Security Review — Chat Onda 2b

**Autor:** Security (agent-security)
**Data:** 2026-04-22
**Branch:** `feat/chat-ux-ui-redesign`
**Artefatos revisados:**
- `.specs/features/chat-onda-2b/architect-plan.md`
- `.specs/features/chat-onda-2b/ui-spec.md`
- `supabase/migrations/20260422140000_conversations_ai_state.sql`
- `supabase/migrations/20260422140001_whatsapp_messages_fts.sql`

**Frameworks aplicados:** OWASP Top 10 2025, OWASP API Security Top 10, OWASP ASVS 5.0, STRIDE, LGPD.

---

## Veredicto

**APPROVED_WITH_CONDITIONS**

Aprovado sujeito a resolução dos bloqueantes **B3, B4 (já atendido na migration FTS — ver nota), B5, B6** antes do merge/deploy. Condições B3/B5/B6 são executáveis em paralelo à implementação Frontend. Migrations SQL passam na revisão sem alteração necessária — enum FSM, trigger com `SET search_path = public`, RPC com 4 guards defense-in-depth, `REVOKE public/anon → GRANT authenticated`.

Sem veto. Zero issues de severidade crítica. Superfície de ataque nova é bem delimitada e a defesa em camadas está presente nos três anéis (DB RLS, DB trigger, app guard).

---

## 1. STRIDE por componente

### 1.1 FSM `conversations.ai_state` (migration `20260422140000`)

| Vetor | Análise | Status |
|-------|---------|--------|
| **S — Spoofing** | User de Org A muda `ai_state` de conversa de Org B? RLS `conversations_update_by_responsibility` (migration `20260128050000`) filtra por `organization_id + responsibility`. Master bypass via `master_all_conversations` (migration `20260131200001`). `service_role` bypass — backend interno. | PASS |
| **T — Tampering** | User pula estado ilegal (ex: `AI_ACTIVE → HUMAN_ACTIVE` sem passar por `WAITING_HUMAN`/`AI_PAUSED_MANUAL`)? Trigger `enforce_ai_state_transition` valida 9 transições permitidas, rejeita o resto com `RAISE EXCEPTION` + `ERRCODE check_violation`. Trigger dispara `BEFORE UPDATE OF ai_state FOR EACH ROW WHEN (OLD.ai_state IS DISTINCT FROM NEW.ai_state)` — cobre 100% dos UPDATEs que tocam `ai_state`, incluindo `service_role` e master. **Importante:** trigger NÃO tem bypass para master/service_role — FSM é enforced uniformemente. Isso é intencional e correto: master não deve poder pular estados arbitrariamente (audit integrity). Se houver necessidade emergencial, `ALTER TABLE ... DISABLE TRIGGER` como superuser (antídoto documentado). | PASS |
| **R — Repudiation** | Sem audit trail de quem mudou quando? Colunas `ai_state_updated_at` (auto-populada pelo trigger via `NEW.ai_state_updated_at := now()`) + `ai_state_updated_by` (caller popula via `UPDATE ... SET ai_state_updated_by = auth.uid()`). **GAP:** `ai_state_updated_by` é caller-provided — depende do hook `useTakeover` incluí-lo no payload. Se esquecerem, fica NULL e perde a atribuição. Mitigação: QA testar que toda mutation de `ai_state` do `useTakeover.ts` inclui `updated_by: user.id`. Opção mais robusta (recomendada para Onda 2c): trigger popular `NEW.ai_state_updated_by := auth.uid()` também — garante no DB. Por ora, aceite com flag. | CONDICIONAL |
| **I — Info disclosure** | Realtime `postgres_changes` expõe `ai_state` cross-org? Supabase Realtime respeita RLS em SELECT para `UPDATE`/`INSERT` events. Policy `conversations_select_by_responsibility` filtra por org + responsibility. Payload só chega a usuários com acesso. | PASS |
| **D — DoS** | User spam UPDATE `ai_state` em loop? Cada UPDATE dispara trigger O(1) (tabela lookup de 9 tuplas em memória) + realtime broadcast. Custo baixo. Sem rate limit explícito. Em cenário adversarial, pode saturar realtime bandwidth para membros da mesma org. Aceitável — atacante precisaria de credencial válida de member + conversa atribuída. | ACEITE COM FLAG |
| **E — Elevation** | Trigger `SECURITY DEFINER` + `SET search_path = public`. Confirmado na migration linhas 166-167. Sem search_path injection possível. Função não acessa dados além de `OLD`/`NEW` — sem query lateral que pudesse ser explorada. | PASS |

### 1.2 RPC `search_messages` (migration `20260422140001`)

| Vetor | Análise | Status |
|-------|---------|--------|
| **S — Spoofing** | User de Org A chama `search_messages(p_org_id=<OrgB>, ...)` e vê mensagens de B? Guard 2 (linhas 177-186): `SELECT 1 FROM team_members WHERE user_id=auth.uid() AND organization_id=p_org_id AND is_active=true`. Negado → `RAISE EXCEPTION 'access_denied'` com `ERRCODE insufficient_privilege`. Bloqueio hard. | PASS |
| **T — Tampering / SQL Injection** | `p_query` concatenado em string? NÃO. Parseado via `websearch_to_tsquery('portuguese', p_query)` — parser oficial, não concatena SQL. Retorna `tsquery` typed ou NULL em input inválido. Sem injection possível. | PASS |
| **R — Repudiation** | RPC não loga chamadas. Auditoria de busca (padrão LGPD — quem buscou quê) ausente. Baixa prioridade — dados já acessíveis via RLS normal. Flag para Onda 2c se auditor externo exigir. | ACEITE COM FLAG |
| **I — Info disclosure** | `headline` vaza conteúdo cross-org? Query filtrada por `WHERE m.organization_id = p_org_id` (linha 236). Guard 2 já validou que caller é membro ativo da org. **Defense in depth:** RLS em `whatsapp_messages_select_org` filtra também — mas `SECURITY DEFINER` bypassa RLS, então o filtro manual na query é o controle real. Filtro está presente e correto. | PASS |
| **D — DoS** | User spam RPC em loop? Sem rate limit server-side. Cada call ~30-80ms com GIN index. Guard 3 rejeita queries `< 3 chars` — protege contra queries que gerariam posting lists enormes. Guard 4 rejeita `p_limit > 100`. Mesmo assim, atacante autenticado pode fazer ~100 req/s e saturar DB. Mitigação: Supabase platform rate limit (default 60 req/s por IP) + client-side debounce 300ms (documentado em `useMessageSearch`). Aceitar e flag para Onda 2c (rate limit persistente em `api_rate_limit` table). | ACEITE COM FLAG |
| **E — Elevation** | `SECURITY DEFINER` + `SET search_path = public` (linha 159). Protegido contra schema spoofing. `REVOKE EXECUTE FROM public, anon` + `GRANT EXECUTE TO authenticated` (linhas 249-251) — permissão mínima. **Nota:** aproveitar B4 — migration JÁ inclui `SET search_path = public`. Bloqueante B4 está PRÉ-ATENDIDO pela migration. Marcar como resolvido. | PASS |
| **XSS — via headline** | `ts_headline` retorna `<mark>...</mark>`. Frontend precisa sanitizar com DOMPurify antes de `dangerouslySetInnerHTML`. `ts_headline` escapa o conteúdo original (transforma `<script>` em `&lt;script&gt;` no output), MAS confiar 100% no servidor para sanitização client-side é anti-pattern. DOMPurify com whitelist `{ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: []}` é defense in depth. UI spec seções 4 linhas 757-773 documenta corretamente. **GAP:** `dompurify` NÃO está no `package.json` (verificado). Precisa `npm install dompurify @types/dompurify`. B5 bloqueante. | BLOCKED PENDING B5 |

### 1.3 CommandPalette

| Vetor | Análise | Status |
|-------|---------|--------|
| **Authorization leak** | Palette expõe ações sem checar permissão? Grupos `Navigation`, `Actions`, `Conversations`, `Messages` precisam consumir `useCanPerformAction(action)` antes de renderizar items sensíveis (ex: "Criar workflow", "Arquivar conversa"). Items de navegação pura (ir para `/dashboard`) não exigem check — rota tem seu próprio guard. Items que disparam ação (mutation) SIM. Arquitetura proposta (`commandRegistry`) permite registrar `permission?: string` por comando — deve ser USADO. Validar implementação. | CONDICIONAL — QA |
| **Cross-tenancy na search de lead** | `CommandGroupConversations` e futuras buscas de lead consomem hooks existentes (`useLeads`, `useWhatsAppContacts`) que já têm RLS. OK se reusar. Se criar query nova → precisa filtro explícito. Validar no code review. | CONDICIONAL — QA |
| **Recent commands localStorage** | UI spec recomenda key `cmd-palette-recent-${userId}`. CORRETO para isolamento entre users no mesmo browser (pattern B1 da Onda 2a). **PENDENTE:** cleanup no signOut. Se user A fizer logout e user B logar no mesmo device, o localStorage permanece. `userId` diferente = chave diferente = não vê os recentes de A, mas o registro fica acumulando (vazamento de metadados sobre comandos usados). Solução: no `AuthContext.signOut`, adicionar `localStorage.removeItem(` todas as keys `cmd-palette-recent-*`). B3 bloqueante. | BLOCKED PENDING B3 |
| **Spoofing via cmdk custom actions** | Cada action executa via `onSelect` — dispara mutation React Query ou navigate. Sem input cruzado. OK. | PASS |

### 1.4 Virtualização `@tanstack/react-virtual`

| Vetor | Análise | Status |
|-------|---------|--------|
| **Supply chain** | Lib NÃO está em `package.json`. Precisa `npm install @tanstack/react-virtual`. Autor: TanStack (Tanner Linsley). Amplamente adotada. Rodar `npm audit` pós-install para confirmar zero CVE. Flag condicional. | CONDICIONAL — CI |
| **Logic bugs** | Virtualização não introduz superfície de ataque por si. Renderiza items que o React Query já trouxe. | PASS |

### 1.5 Realtime cirúrgico `usePatchedRealtime`

| Vetor | Análise | Status |
|-------|---------|--------|
| **I — Info disclosure via payload** | `postgres_changes` envia row completo respeitando RLS em SELECT da tabela source. `conversations` e `whatsapp_messages` têm RLS cobrindo SELECT: `conversations_select_by_responsibility` (linha 500 migration `20260128050000`), `whatsapp_messages_select_by_responsibility` (linha 619 migration `20260128000001`). User só recebe eventos de rows que ele conseguiria ler por SELECT normal. Defense in depth confirmada. | PASS |
| **T — Filter bypass client-side** | `filter: "organization_id=eq.X"` pode ser modificado no client. Irrelevante — RLS no DB bloqueia eventos para rows inacessíveis. | PASS |
| **Cache poisoning** | `setQueryData` confia no payload. Se RLS está correta, confiança é justificada. Matcher id-based (`matcher: (row, cacheItem) => row.id === cacheItem.id`) previne duplicação e row injection cruzada entre caches. | PASS |

### 1.6 AITimeline (consome `lead_history`)

| Vetor | Análise | Status |
|-------|---------|--------|
| **S — Cross-org history** | `lead_history` tem RLS? **CONFIRMADO.** Policies ativas: `lead_history_select_by_lead` (migration `20260901000000`) filtra via JOIN com `leads` + permission engine (`is_user_admin`, `has_feature_permission('leads.view_all')`, `can_see_lead_by_permissions`, `can_see_lead_by_team_member_permissions`, `is_user_responsible_in_any_pipe`). Master bypass via `master_select_all_lead_history` / `master_all_lead_history` (migration `20260607000000`). RLS enabled via `ALTER TABLE lead_history ENABLE ROW LEVEL SECURITY` (múltiplas migrations). B6 PRÉ-ATENDIDO. | PASS |
| **Filter `action LIKE 'ai_%'`** | Aplicado no client. Como RLS cobre SELECT, client filter é só UX — mesmo que atacante mude o filter, só verá histórico de leads acessíveis. | PASS |

### 1.7 LeadDetailContent split

Refactor puro — sem nova superfície. Consumidores mantêm `leads`/`team_members` RLS existente. Sem issue.

---

## 2. Bloqueantes (PRÉ-MERGE)

### B3 — CommandPalette recent commands — user-scoped + cleanup no signOut

**Severidade:** Média
**Owner:** Frontend
**Deadline:** antes do merge da Fase 2b.1 (C26)
**Como verificar:**
1. `src/components/command/recentCommands.ts` usa `localStorage.setItem(\`cmd-palette-recent-${userId}\`, ...)` — key PREFIXADA com userId
2. `src/contexts/AuthContext.tsx` no `signOut()`:
   ```ts
   Object.keys(localStorage)
     .filter((k) => k.startsWith("cmd-palette-recent-"))
     .forEach((k) => localStorage.removeItem(k));
   ```
3. Teste manual: user A usa palette, logout, user B login no mesmo browser → seção "Recentes" vazia ou só com recentes de B
4. Teste unit: `recentCommands.getRecent(userIdA)` após `pushRecent(userIdB, cmd)` retorna `[]`

### B4 — RPC `search_messages` com `SET search_path = public`

**Severidade:** Alta (teoria) — **JÁ ATENDIDO na migration**
**Status:** PRÉ-RESOLVIDO
**Verificação:** `grep -n "SET search_path" supabase/migrations/20260422140001_whatsapp_messages_fts.sql` → linha 159 confirmado. Trigger FSM também (linha 167). Sem ação necessária.

### B5 — DOMPurify em search highlight, whitelist `<mark>` only

**Severidade:** Média (ts_headline JÁ escapa server-side, mas defense in depth é obrigatória)
**Owner:** Frontend (C37 — CommandGroupMessages)
**Deadline:** antes do merge de C37
**Como verificar:**
1. `package.json` contém `"dompurify": "^3.x"` e `"@types/dompurify": "^3.x"` → rodar `npm install dompurify @types/dompurify`
2. `src/components/command/groups/CommandGroupMessages.tsx` (ou helper `HighlightedText.tsx`):
   ```ts
   import DOMPurify from "dompurify";
   const clean = DOMPurify.sanitize(headline, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });
   <span dangerouslySetInnerHTML={{ __html: clean }} />
   ```
3. Grep negativo: nenhum `dangerouslySetInnerHTML` com valor bruto da RPC sem DOMPurify
4. Unit test: input `'<script>alert(1)</script><mark>ok</mark>'` → output `'<mark>ok</mark>'` (script removido)
5. Headline NUNCA aplicada a `content` raw — apenas ao campo `headline` retornado pela RPC

### B6 — `lead_history` tem RLS cobrindo AITimeline

**Severidade:** Alta (teoria) — **JÁ ATENDIDO**
**Status:** PRÉ-RESOLVIDO
**Verificação:** policies ativas confirmadas em `20260901000000_fix_lead_history_rls_align_permissions.sql` + `20260607000000_fix_master_missing_rls_and_add_second_master.sql`. RLS enabled. Sem ação necessária.

**Resumo de bloqueantes ativos:** apenas **B3** e **B5** exigem trabalho antes do merge. B4 e B6 já estão cobertos pela implementação/base atual.

---

## 3. Condicionais (aceitos com flag, backlog Onda 2c)

| # | Item | Owner | Backlog |
|---|------|-------|---------|
| C1 | Rate limit server-side em `search_messages` (persistent em `api_rate_limit` table ou Supabase platform config) — observabilidade primeiro, decidir threshold | Backend | Onda 2c |
| C2 | `ai_state_updated_by` populado via trigger (`NEW.ai_state_updated_by := auth.uid()`) em vez de caller-provided — robustez forense | DBA | Onda 2c |
| C3 | `npm audit` em `@tanstack/react-virtual` + `dompurify` antes do merge de C18/C37 | Infra (CI) | Automático via Dependabot/Snyk |
| C4 | Audit log de chamadas `search_messages` (quem buscou o quê — LGPD) | Backend | Onda 2c se auditor exigir |
| C5 | `permission` opcional em `commandRegistry` — validar QA que todas as ações de mutation consomem `useCanPerformAction` | Frontend + QA | Durante 2b |
| C6 | Focus ring gold em light mode (ratio 2.1:1 — FAIL WCAG, já documentado na Onda 2a) — `--ring-light: 221 83% 40%` | UI | Onda 2c |

---

## 4. Aprovados sem ressalva

- Migration FSM (`20260422140000`) — enum idempotente, trigger com `SECURITY DEFINER + SET search_path`, 9 transições explícitas, antídoto documentado, backfill idempotente, index parcial eficiente
- Migration FTS (`20260422140001`) — generated column STORED, GIN index, RPC com 4 guards (auth / org membership / min query / max limit), REVOKE public+anon → GRANT authenticated, parser `websearch_to_tsquery` (safe)
- CommandPalette arquitetura base (cmdk battle-tested, Linear/Vercel/GitHub usam em produção)
- Virtualização (`@tanstack/react-virtual` — autor mainstream, invisível à superfície de ataque)
- Realtime cirúrgico (RLS cobre payload, matcher id-based previne cache poisoning)
- AITimeline (consome `lead_history` com RLS confirmada + permission engine integrado)
- LeadDetailContent split (refactor puro, sem nova superfície)
- WCAG AA em dark mode (calculado na UI spec, todos os 5 pill states passam)

---

## 5. Risk Matrix

| Risco | Severidade | Probabilidade | Impacto | Risk Score | Mitigação |
|-------|-----------|---------------|---------|-----------|-----------|
| RPC `search_messages` chamada cross-tenancy | Alta | Muito baixa | Alto (exfiltração PII) | 3/9 | Guard 2 (team_members active check) + filtro explícito `WHERE organization_id` — 2 camadas |
| FSM transição ilegal persiste (race condition entre concurrent UPDATEs) | Média | Baixa | Médio (estado inconsistente) | 2/9 | BEFORE UPDATE trigger + `WHEN (OLD IS DISTINCT FROM NEW)` — Postgres MVCC garante atomicidade por row |
| XSS via search highlight | Alta | Baixa | Alto (session hijack) | 3/9 | ts_headline server-escape + DOMPurify whitelist `<mark>` only (B5) — 2 camadas |
| Recent commands vazam entre users no mesmo device | Baixa | Média | Baixo (metadados sobre uso) | 2/9 | userId prefix + signOut cleanup (B3) |
| Realtime payload cross-tenant | Alta | Muito baixa | Alto (exfiltração em massa) | 3/9 | RLS SELECT cobre realtime (Supabase-enforced) |
| DoS via spam `search_messages` | Baixa | Baixa | Baixo (degradação temporária) | 1/9 | Guard 3/4 + client debounce + Supabase platform rate limit |
| `ai_state_updated_by` NULL por caller não popular | Baixa | Média | Baixo (auditoria incompleta) | 2/9 | QA test + migração futura para trigger-populated (C2) |
| Supply chain (`dompurify`, `@tanstack/react-virtual`) | Média | Muito baixa | Alto (se comprometida) | 2/9 | `npm audit` + lockfile integrity + Dependabot |
| CommandPalette expõe ações sem permissão | Média | Média | Médio (privilege escalation UX) | 4/9 | `useCanPerformAction` por command + QA review |
| `lead_history` AITimeline cross-org | Alta | Muito baixa | Alto | 3/9 | RLS `lead_history_select_by_lead` + permission engine |

**Top risk ativo:** CommandPalette permissão (4/9) — C5 condicional. QA obrigatório.

---

## 6. SQL queries para QA testar

### Q1 — User de Org A tenta chamar `search_messages` com Org B's id → exception

```sql
-- Como user da Org A (JWT do supabase.auth.signInWithPassword)
-- Executar no SQL Editor logado como user de Org A (membro ativo):
SELECT * FROM public.search_messages(
  p_org_id := '<UUID_DA_ORG_B>'::uuid,
  p_query  := 'proposta',
  p_limit  := 10,
  p_offset := 0
);
-- Esperado: ERROR: access_denied: user is not an active member of organization <UUID_B>
-- ERRCODE: insufficient_privilege (42501)
```

### Q2 — User pula transição FSM ilegal → trigger bloqueia

```sql
-- Setup: conversa com ai_state = 'AI_ACTIVE'
-- Tentar pular para HUMAN_ACTIVE direto (precisa passar por WAITING_HUMAN ou AI_PAUSED_MANUAL):
UPDATE public.conversations
SET ai_state = 'HUMAN_ACTIVE'::public.ai_takeover_state_enum,
    ai_state_updated_by = auth.uid()
WHERE id = '<UUID_CONVERSA>';
-- Esperado: ERROR: ai_state transition not allowed: AI_ACTIVE -> HUMAN_ACTIVE.
-- ERRCODE: check_violation (23514)

-- Transição válida (AI_ACTIVE -> AI_PAUSED_MANUAL):
UPDATE public.conversations
SET ai_state = 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum,
    ai_state_updated_by = auth.uid()
WHERE id = '<UUID_CONVERSA>';
-- Esperado: OK. Verificar ai_state_updated_at atualizado automaticamente.
```

### Q3 — Master user também é sujeito ao trigger (sem bypass)

```sql
-- Logado como master user:
UPDATE public.conversations
SET ai_state = 'HANDOFF_BACK'::public.ai_takeover_state_enum
WHERE id = '<UUID_CONVERSA>' AND ai_state = 'AI_ACTIVE';
-- Esperado: ERROR: ai_state transition not allowed: AI_ACTIVE -> HANDOFF_BACK
-- Master vê tudo (RLS bypass), mas FSM é enforcement uniforme.
-- Para bypass emergencial: ALTER TABLE ... DISABLE TRIGGER (como superuser).
```

### Q4 — Master user bypass de RLS funciona (SELECT cross-org)

```sql
-- Logado como master_user (user cujo is_master_user() = true):
SELECT organization_id, ai_state, count(*)
FROM public.conversations
GROUP BY organization_id, ai_state;
-- Esperado: múltiplas orgs no resultado (RLS master_all_conversations libera).

-- Logado como member normal de Org X:
-- Esperado: apenas Org X (conversations_select_by_responsibility filtra).
```

### Q5 — Realtime payload só inclui rows da org do user

```sql
-- Setup:
--   User A é member ativo de Org A.
--   User A abre channel supabase.channel('test').on('postgres_changes', { table: 'conversations' }).subscribe()
-- Em outro session (psql como service_role):
UPDATE public.conversations SET ai_state = 'AI_PAUSED_MANUAL' WHERE organization_id = '<ORG_A>';
UPDATE public.conversations SET ai_state = 'AI_PAUSED_MANUAL' WHERE organization_id = '<ORG_B>';

-- Esperado no client de User A:
--   Recebe apenas eventos de organization_id = ORG_A.
--   Eventos de ORG_B não chegam (RLS SELECT enforced pelo Realtime).
```

### Q6 — `lead_history` isolamento cross-org (AITimeline)

```sql
-- Logado como user de Org A:
SELECT lh.id, lh.lead_id, lh.action, l.organization_id
FROM public.lead_history lh
JOIN public.leads l ON l.id = lh.lead_id
WHERE l.organization_id = '<ORG_B>';
-- Esperado: 0 rows (RLS lead_history_select_by_lead + leads RLS bloqueiam).
```

### Q7 — RPC rejeita query < 3 chars

```sql
SELECT * FROM public.search_messages('<MINHA_ORG>'::uuid, 'ab', 10, 0);
-- Esperado: ERROR: query_too_short: minimum 3 characters required
-- ERRCODE: invalid_parameter_value (22023)
```

### Q8 — RPC rejeita limit > 100

```sql
SELECT * FROM public.search_messages('<MINHA_ORG>'::uuid, 'proposta', 500, 0);
-- Esperado: ERROR: limit_too_large: maximum is 100
```

### Q9 — RPC rejeita chamada anônima (auth.uid() NULL)

```sql
-- Via supabase client com anon key, sem login:
const { data, error } = await supabase.rpc('search_messages', {
  p_org_id: '<QUALQUER_UUID>',
  p_query: 'proposta',
});
-- Esperado: error.code = '42501', error.message contém 'access_denied: authentication required'
```

### Q10 — RPC SQL injection no p_query é inerte

```sql
SELECT * FROM public.search_messages(
  '<MINHA_ORG>'::uuid,
  $$proposta'); DROP TABLE public.whatsapp_messages; --$$,
  10, 0
);
-- Esperado: query tratada como string literal pelo websearch_to_tsquery.
-- Retorna 0 rows ou algumas matches do termo "proposta".
-- NADA é droppado. Tabela intacta.
```

---

## 7. LGPD

### 7.1 Dados pessoais expostos pelas novas capacidades

| Capacidade | PII exposta | Base legal | Retenção |
|-----------|-------------|-----------|----------|
| `search_messages` | Conteúdo de mensagens WhatsApp (nome, telefone, CPF às vezes, endereço, dados comerciais do lead) | Legítimo interesse (Art. 7º IX LGPD) — user é membro ativo da organização titular, já tem acesso aos mesmos dados via chat normal | Mesma retenção de `whatsapp_messages` (sem delete automático — `leads.retain_policy` ainda não implementada) |
| FSM `ai_state` | Quem pausou IA, quando (metadata operacional, não-sensível por si) | Mesma base contratual do CRM | Sem retenção específica — metadata da conversa |
| AITimeline (`lead_history`) | Ações operacionais (nenhuma PII nova — apenas audit trail de IA) | Legítimo interesse (auditoria e transparência) | Mesma de `lead_history` |
| CommandPalette — search de conversas | Nome / telefone do lead no resultado | Mesma de `leads` (já acessível via lista de leads) | N/A — não persiste resultado |

**Análise:** nenhuma nova categoria de dado pessoal processada. A feature agrega acesso mais eficiente a dados JÁ acessíveis ao usuário por RLS. Consentimento implícito via contrato CRM com a organização titular (usuário é colaborador da org que opera o CRM).

### 7.2 Pontos de atenção LGPD

- **Art. 9º — Transparência:** user que busca `search_messages` deve saber que a busca cobre TODAS as mensagens da org. Ausência de auditoria da busca (C4 condicional) é lacuna — mas não é obrigatório por LGPD enquanto base legal for legítimo interesse + dados já compartilhados com o operador.
- **Art. 18 — Direito de eliminação:** se um lead solicitar exclusão de dados, `whatsapp_messages` (e derivado `search_tsv`) devem ser deletados junto. `search_tsv` é GENERATED STORED — morre com o row. OK.
- **Art. 46 — Segurança:** RPC com 4 guards + RLS + filtro explícito por org = medida técnica adequada. ASVS V4.2 (Authorization) nível 2 atingido.
- **Art. 37 — Registro de operações de tratamento:** DPO deve atualizar o RoPA (Record of Processing Activities) do produto Torque incluindo: "busca de mensagens por operador autenticado via RPC search_messages". Task de documentação — não bloqueante técnica.

---

## 8. Checklist de aceite do Security

- [x] FSM trigger tem `SET search_path = public` explícito
- [x] FSM trigger é `SECURITY DEFINER` e não acessa dados além de OLD/NEW
- [x] FSM trigger enforcement uniforme (sem bypass para master/service_role — intencional)
- [x] RPC `search_messages` tem `SET search_path = public`
- [x] RPC `search_messages` é `SECURITY DEFINER` com guard de org membership
- [x] RPC `search_messages` valida `auth.uid() IS NOT NULL`
- [x] RPC `search_messages` valida query length >= 3
- [x] RPC `search_messages` valida limit <= 100
- [x] RPC `search_messages` usa `websearch_to_tsquery` (não concat SQL)
- [x] RPC `search_messages` tem `REVOKE public, anon` + `GRANT authenticated`
- [x] RPC `search_messages` filtra `WHERE organization_id = p_org_id` na query (não confia só no RLS — é SECURITY DEFINER)
- [x] `conversations` tem RLS SELECT + UPDATE filtrando por org (pré-existente)
- [x] `whatsapp_messages` tem RLS SELECT filtrando por org (pré-existente)
- [x] `lead_history` tem RLS SELECT integrado com permission engine (pré-existente)
- [x] Realtime respeita RLS em SELECT (Supabase-enforced)
- [ ] **B3** — CommandPalette recent key `cmd-palette-recent-${userId}` + signOut cleanup
- [x] **B4** — RPC `search_messages` com `SET search_path = public` (PRÉ-ATENDIDO)
- [ ] **B5** — DOMPurify whitelist `<mark>` only em `HighlightedText`
- [x] **B6** — `lead_history` RLS confirmada (PRÉ-ATENDIDO)
- [ ] C3 — `npm audit` pós-install de dompurify + @tanstack/react-virtual
- [ ] C5 — QA validar que toda ação do CommandPalette que muta dado consome `useCanPerformAction`

---

## 9. Próximo passo

Frontend pode iniciar implementação da Fase 2b.1 (C18-C28). Security faz re-review pontual em dois pontos:

1. **Antes do merge de C26** (recent commands) — validar B3 implementado
2. **Antes do merge de C37** (CommandGroupMessages) — validar B5 implementado e dompurify no bundle

Migrations `20260422140000` e `20260422140001` **estão aprovadas para deploy** no ambiente de dev (`bcfadphgsibjzivtbjvc`) imediatamente. Deploy em produção (`jsjsmuncfkbsbzqzqhfq`) após QA executar queries Q1-Q10 em dev e confirmar comportamento esperado.

**Sem veto. Aprovação condicional ativa.**

---

*Security review assinado: agent-security, 2026-04-22.*
