# phone_ai_preferences — Tasks

Atomic, ordered, with gate checks. One task at a time.

---

### T1 — DB migration: `phone_ai_preferences` table, index, RLS

**What**: Create table + PK + index + RLS select policy + updated_at trigger.
**Where**: `supabase/migrations/20260422100000_phone_ai_preferences_table.sql`
**Depends on**: —
**Reuses**: `public.update_updated_at()` trigger function; `auth.uid()`; `team_members`.
**Done when**:
- Tabela criada; PK `(organization_id, normalized_phone)`; index em `normalized_phone`.
- RLS ativa; policy de SELECT por org ativa; INSERT/UPDATE/DELETE **sem policy** (acesso via RPC SECURITY DEFINER apenas).
- `COMMENT ON TABLE` explica propósito.
**Gate**: Migration aplica sem erro no dev Supabase (`bcfadphgsibjzivtbjvc`).

---

### T2 — DB migration: `toggle_phone_ai`, `get_phone_ai_status` RPCs + `toggle_lead_ai` sync + drop old `toggle_conversation_ai`

**What**:
- CREATE OR REPLACE `toggle_phone_ai(p_phone TEXT, p_disabled BOOLEAN) RETURNS JSONB`.
- CREATE OR REPLACE `get_phone_ai_status(p_phone TEXT) RETURNS JSONB`.
- CREATE OR REPLACE `toggle_lead_ai(...)` — versão que faz UPSERT em `phone_ai_preferences` (quando `normalized_phone IS NOT NULL`).
- DROP FUNCTION `toggle_conversation_ai(text, boolean) CASCADE`.
- GRANT EXECUTE para `authenticated` nas 3 RPCs.
**Where**: `supabase/migrations/20260422100001_phone_ai_preferences_rpcs.sql`
**Depends on**: T1.
**Reuses**: `normalize_brazilian_phone`, `auth.uid`, `team_members` lookup pattern.
**Done when**:
- `toggle_phone_ai` UPSERTs preferência, sincroniza todos leads com mesmo normalized_phone, loga em `lead_history` por lead afetado, **nunca** insere shadow lead.
- `toggle_lead_ai` escreve em preferences além dos leads.
- `get_phone_ai_status` retorna `{ai_disabled, source}` com fallback pra leads.
- `toggle_conversation_ai` removida.
**Gate**: Migration aplica sem erro; `SELECT proname FROM pg_proc WHERE proname='toggle_conversation_ai'` retorna vazio.

---

### T3 — Backend: `lead-service.getOrCreateLead` consulta preferência na criação

**What**: Antes do INSERT em `leads`, consultar `phone_ai_preferences` por `(org, normalized_phone)`. Se existir com `ai_disabled=true`, pré-setar no insertData.
**Where**: `supabase/functions/_shared/lead-service.ts`
**Depends on**: T1.
**Reuses**: `normalizePhoneForSearch` (já presente).
**Done when**:
- Branch de INSERT honra preferência prévia.
- Sem regressão no happy path (lead criado default ligado quando não há preferência).
- `console.log` claro quando herança ocorre.
**Gate**: `npm run test:unit -- lead-service` passa; nova tests/unit/lead-service-preference.test.ts cobre os 2 branches (herda / default).

---

### T4 — Frontend: `normalizePhone` + hooks

**What**:
- Em `src/hooks/useLeads.ts`:
  - `useLeadAiStatus` permanece; `onMutate` de `useToggleLeadAI` passa a atualizar optimisticamente `["lead_ai_status", leadId]` e `onError` faz rollback.
  - `useToggleConversationAI` renomeado internamente; chama `toggle_phone_ai`; adiciona `onMutate`/`onError` com optimistic update em `["phone_ai_status", orgId, normalizedPhone]`. Mantém export com nome antigo como alias.
  - Novo hook `usePhoneAiStatus(phone)` que chama `get_phone_ai_status`.
- Em `src/components/chat/WhatsAppChat.tsx`:
  - `currentAiDisabled` lê `leadAi` quando há leadId, senão `phoneAi`.
**Where**: `src/hooks/useLeads.ts`, `src/components/chat/WhatsAppChat.tsx`
**Depends on**: T2, types regenerated (T5).
**Done when**:
- Compila sem erro (`npx tsc --noEmit`).
- Switch reflete estado imediatamente em ambos os casos (com/sem lead).
- Rollback visual em erro de RPC.
**Gate**: `npm run test:unit` passa novos testes de hook (T7).

---

### T5 — Regenerate supabase types

**What**: Rodar `supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts` após T1+T2 aplicados em dev.
**Where**: `src/integrations/supabase/types.ts`
**Depends on**: T1, T2 aplicados no projeto dev.
**Reuses**: CLI padrão do projeto.
**Done when**: types atualizados; `toggle_phone_ai`, `get_phone_ai_status` visíveis em `Database['public']['Functions']`.
**Gate**: `npx tsc --noEmit` sem erros novos.

---

### T6 — Lead `ai_disabled` trigger audit (defensivo)

**What**: Adicionar migration com trigger `AFTER UPDATE OF ai_disabled ON leads` que sincroniza `phone_ai_preferences` quando um processo externo (ex: webhook antigo, script manual) atualiza `leads.ai_disabled` direto — garante fonte única mesmo se alguém contornar a RPC.
**Where**: `supabase/migrations/20260422100002_leads_ai_sync_back_to_preferences.sql`
**Depends on**: T1, T2.
**Reuses**: `normalize_brazilian_phone` (trigger já faz que `NEW.normalized_phone` esteja populado).
**Done when**:
- Trigger ativo em `leads`.
- UPDATE direto em `leads.ai_disabled` propaga para `phone_ai_preferences` (UPSERT).
- Se `normalized_phone IS NULL`, no-op.
**Gate**: Test de integração confirma sync bidirecional.

---

### T7 — Testes unit de hooks

**What**: `tests/unit/hooks-phone-ai-preferences.test.ts`:
- `usePhoneAiStatus` resolve phone normalization; chama RPC correto.
- `useTogglePhoneAI` (ex-useToggleConversationAI):
  - optimistic update escreve em cache certa;
  - rollback em erro;
  - chama `toggle_phone_ai` (não mais `toggle_conversation_ai`).
- `useToggleLeadAI`:
  - optimistic update em `["lead_ai_status", leadId]`.
  - rollback em erro.
**Where**: `tests/unit/hooks-phone-ai-preferences.test.ts`
**Depends on**: T4.
**Gate**: Todos novos testes passam; `test:unit` global sem regressão.

---

### T8 — Testes unit normalize-phone equivalência

**What**: `tests/unit/normalize-phone-equivalence.test.ts` com tabela de casos, rodando `normalizePhone` (frontend) e `normalizePhoneForSearch` (edge) para provar saída idêntica.
**Where**: `tests/unit/normalize-phone-equivalence.test.ts`
**Depends on**: —
**Gate**: `test:unit` passa.

---

### T9 — Teste unit regressão enum / lead-service

**What**: `tests/unit/lead-service-preference.test.ts`:
- Cenário A (preferência existe, ai_disabled=true) → lead criado com `ai_disabled=true`.
- Cenário B (preferência não existe) → lead criado com default.
- Cenário C (preferência existe, ai_disabled=false) → lead criado default.
**Where**: `tests/unit/lead-service-preference.test.ts`
**Depends on**: T3.
**Gate**: `test:unit` passa.

---

### T10 — Verificação build + test + lint

**What**: Rodar `npm run build`, `npm run test:unit`, `npm run lint`. Corrigir qualquer regressão. Sem `--no-verify` em commits.
**Depends on**: T4, T7, T8, T9.
**Gate**: Zero erros novos.

---

### T11 — Security review (final gate)

**What**: Revisão pelo agent-security. Checklist:
- RLS: org A não acessa preferência da org B. Prova: integration test.
- RPC: `SECURITY DEFINER` sem escape. `search_path = public`. Explicit `auth.uid() IS NULL` bloqueado. `organization_id` validado via `team_members.is_active=true`.
- Sem log de dados sensíveis (phone fica normalizado, ok pra log interno; não log em contexto cross-org).
- Sem drift com `toggle_lead_ai` (same-org check coerente).
**Depends on**: T1–T10.
**Gate**: Security sign-off registrado em STATE.md / decisão.

---

### T12 — Documentação: Obsidian + STATE.md + ADR + changelog

**What**:
- Atualizar `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Comunicacao/Chat WhatsApp.md` com seção nova sobre toggle de IA.
- Criar/atualizar `Obsidian/.../06 — Features/IA/Copilot.md` com nota sobre fonte de verdade.
- Criar ADR `Obsidian/.../04 — Decisões/ADR-2026-04-22-phone-ai-preferences.md`.
- Atualizar `.specs/project/STATE.md` com decisão Dxxx, lição, e todos residuais.
- Changelog: `Obsidian/.../07 — Changelog/2026-04-22.md`.
**Depends on**: T1–T11.
**Gate**: Documentos criados/atualizados; protocolo Obsidian cumprido.
