# Security Review — Chat Onda 2a

- **Revisor**: agent-security
- **Data**: 2026-04-22
- **Branch**: `feat/chat-ux-ui-redesign`
- **Frameworks**: OWASP ASVS 5.0, OWASP Top 10 2025, LGPD, STRIDE
- **Artefatos revisados**:
  - `.specs/features/chat-onda-2a/architect-refactor-plan.md`
  - `.specs/features/chat-onda-2a/ui-spec-bubble-density.md`
  - `supabase/migrations/20260422120000_conversation_read_state.sql`
  - Onda 1 merged: `src/hooks/useConversationDraft.ts`, `src/components/chat/UnreadDivider.tsx`, `ScrollToBottomFab.tsx`, `ChatEmptyState.tsx`, alterações em `src/hooks/useWhatsAppChat.ts`

---

## Veredicto

**APPROVED_WITH_CONDITIONS**

A Onda 2a é majoritariamente estrutural (refactor) + uma migration (`conversation_read_state`) que segue os padrões RLS canônicos do projeto. A migration está sólida. Porém, **a Onda 1 já mergeada introduziu uma vulnerabilidade de vazamento PII cross-user no `useConversationDraft`** — mesma estrutura planejada para `useChatDensity` (C11) e `chat-layout-sizes-${userId}` (C10), onde a remediação correta é fácil de aplicar antes do novo dano se propagar.

**Resumo**:
- Migration `conversation_read_state` — aprovada. RLS coerente, master bypass consistente, trigger `updated_at` seguro.
- Refactor estrutural (C1–C13, C15–C17) — aprovado. Risco baixo. Zero novas queries, zero mudança de autorização.
- Density tokens + CSS vars — aprovado. Zero vetor de segurança.
- Cache paralelo `useFailedMessages` (Onda 1) — aprovado. `queryKey` inclui `organizationId` + `phoneNumber` e RLS protege origem.
- **Bloqueantes**: 2 itens (ver seção "Bloqueantes"). O principal é o `useConversationDraft` sem user-scoping — **vazamento cross-user em dispositivos compartilhados**. PII de lead em localStorage, acessível por qualquer user que logue em seguida no mesmo browser.

Nenhum item impede a Onda 2a estrutural de avançar em paralelo, mas o bloqueante 1 **deve** ser corrigido na mesma onda (2a.1), antes do commit 13 (ChatComposer), porque ChatComposer passa a consumir `useConversationDraft` no componente novo — e se propagarmos o bug pra forma final, fica mais caro corrigir depois.

---

## STRIDE por componente

### 1. Migration `conversation_read_state`

| Categoria | Vetor | Defesa | Veredicto |
|-----------|-------|--------|-----------|
| **S**poofing | User forja `user_id` de outro user no INSERT | `WITH CHECK user_id = auth.uid()` rejeita | OK |
| **S**poofing | User forja `organization_id` de outra org no INSERT | `WITH CHECK organization_id = public.get_user_organization_id()` rejeita (SECURITY DEFINER resolve a org real do `auth.uid()`) | OK |
| **T**ampering | User altera row de outro user via UPDATE | `USING user_id = auth.uid()` filtra visibilidade para UPDATE | OK |
| **T**ampering | User altera própria row setando `organization_id` para outra org | `WITH CHECK` valida NEW values — spoof bloqueado | OK |
| **T**ampering | User altera `conversation_key` para ler unread de outra conversa | Conversation_key é payload opaco; não há autorização por conversa aqui (autorização por conversa é no `whatsapp_messages` e `conversations` — isolado) | OK |
| **R**epudiation | Sem audit log de UPSERT de read state | Intencional. Read state é metadata pessoal não-crítica. Aceitável. | OK |
| **I**nformation disclosure | User A lê rows de user B na mesma org via SELECT | `USING user_id = auth.uid()` bloqueia | OK |
| **I**nformation disclosure | User lê rows cross-org | `organization_id = public.get_user_organization_id()` bloqueia | OK |
| **I**nformation disclosure | `get_user_organization_id()` performance degrade → timing sidechannel | Função é `STABLE SECURITY DEFINER SET search_path = public`, query `SELECT ... FROM team_members WHERE user_id = auth.uid() AND is_active = true LIMIT 1`. Existe índice em `team_members.user_id`. **Verificado em `20260320000000_fix_followups_rls_and_time_based_automations.sql:14-26`**. OK. | OK |
| **D**enial of service | User spam UPSERT em loop | Update O(1), índice UNIQUE. Tabela cresce linear com (user × conversa). Não bloqueante, mas recomendar observabilidade. | CONDICIONAL |
| **E**levation of privilege | Master bypass concede INSERT/UPDATE com qualquer `user_id` | Master pode setar `user_id = X` no INSERT via `is_master_user() OR (...)`. Impacto: master pode escrever read state em nome de outro user. Uso legítimo (suporte/debug). Aceitável dado que master já é omnipotente por design. Recomendação de log opcional. | OK |
| **E**levation of privilege | Trigger `update_updated_at` executa como SECURITY DEFINER | Função existente no projeto (ref `20260106163946`), `SET search_path = public`. Não aceita input user-controlado além de `NEW`. OK. | OK |

**Veredicto migration**: **APROVADA**. RLS segue o padrão dual (USING + WITH CHECK) correto para multi-tenant. Funções auxiliares (`get_user_organization_id`, `is_master_user`) são STABLE SECURITY DEFINER e já validadas em outras migrations.

---

### 2. `useConversationDraft.ts` (Onda 1 — já em produção)

**Código atual** (`src/hooks/useConversationDraft.ts:1-38`):
```ts
const KEY_PREFIX = "chat-draft-";
// key: `chat-draft-${instanceId}:${phoneNumber}`
// consumido em WhatsAppChat.tsx:1431: const conversationKey = `${instanceId}:${phoneNumber}`;
```

| Categoria | Vetor | Defesa atual | Veredicto |
|-----------|-------|--------------|-----------|
| **S**poofing | — | — | N/A |
| **T**ampering | User edita sua própria chave localStorage | Só afeta si mesmo | OK |
| **R**epudiation | — | — | N/A |
| **I**nformation disclosure | **User A loga, digita draft sensível (PII do lead, valor de proposta, dados financeiros). Logout. User B loga no mesmo browser, abre mesma conversa (`${instanceId}:${phoneNumber}` idêntico por ser same org/instance). `useConversationDraft` lê `localStorage` no mount e popula input com draft do User A.** | **NENHUMA.** Key não é user-scoped. `signOut` em `AuthContext.tsx:100-103` só faz `supabase.auth.signOut()` — não limpa localStorage. | **BLOQUEANTE** |
| **I**nformation disclosure | Browser compartilhado entre operadores (kiosk, PC do escritório) — cenário real em Torque (ICP B2B, fábrica/distribuidora, operadores alternam no mesmo PC) | Nenhuma | BLOQUEANTE |
| **D**enial of service | Quota localStorage cheia | try/catch silencioso em `setDraft` (linha 27–34). User perde persistência mas app não quebra. OK. | OK |
| **E**levation of privilege | — | — | N/A |

**Severidade**: **MEDIUM–HIGH**. Não é RCE, não é cross-org (drafts dependem de `instanceId`, que varia por org). Mas É cross-user dentro da mesma org no mesmo device — e PII é real. Drafts podem conter nome, telefone, valor de negociação, confidencial. **LGPD aplicável** — Torque é controller; expõe dado pessoal de lead sem base legal.

**Mitigação obrigatória** (commit novo na Onda 2a.1, pré-C13):
1. Key: `chat-draft-${userId}-${instanceId}:${phoneNumber}` — prefixar com `userId` do auth context.
2. Fallback graceful se `userId` indisponível (ex: durante rehidratação): não persistir, manter só em memória.
3. Cleanup no logout: em `AuthContext.signOut()`, iterar `localStorage` e remover chaves que começam com `chat-draft-${oldUserId}-`. Também remover `chat-density-${oldUserId}`, `chat-panels-${oldUserId}`, `chat-layout-sizes-${oldUserId}` pela mesma disciplina.
4. Migration path: drafts antigos (`chat-draft-${instanceId}:${phone}` sem prefixo user) ficam órfãos — não serão lidos pela nova key. Opcional: varrer e deletar no primeiro boot pós-deploy (one-shot migration em `useAuth` effect).

---

### 3. Outras chaves localStorage planejadas

| Key | Comando | User-scoped? | Severidade se vazar |
|-----|---------|:-:|---------------------|
| `chat-density-${userId}` | C11 | **Sim** (já planejado) | N/A — valor é `"compact"`/`"comfortable"`/`"spacious"`, zero PII |
| `chat-panels-${userId}` / `chat-layout-sizes-${userId}` | C10 | **Sim** (já planejado) | N/A — apenas larguras de painel |
| `chat-last-read:${userId}:${orgId}:${phone}` | C14 fallback | **Sim** (já planejado) | N/A — timestamp, não-PII |
| `chat-last-read:${phone}` legado | já existente | **Não** | Timestamp. Não-PII. Não é bloqueante, mas a migração do C14 deve priorizar chave user-scoped. |

**Todas as chaves novas estão user-scoped**. Só o `useConversationDraft` (Onda 1 já merged) escapou. Atenção especial para não repetir o pattern em qualquer novo hook.

---

### 4. Realtime (planejado em `usePatchedRealtime` — Onda 2a não muda)

- **Vetor**: Supabase realtime `postgres_changes` envia payload do row com RLS aplicada via JWT do client. Se RLS estiver correta nas tabelas consumidas (`conversation_messages`, `channel_messages`, `whatsapp_messages`), client só recebe o que deveria ver.
- **Onda 2a**: sem mudança estrutural no realtime. Hooks permanecem; apenas migram de arquivo (C12).
- **Onda 2b**: auditoria das RLS policies das tabelas acima é mandatória quando houver redesenho do painel de contexto. **Flag para revisão futura** — fora do escopo desta review.

---

### 5. Layout 3-col + persistência

- `localStorage.chat-layout-sizes-${userId}` — user-scoped, valor é array de percentuais. Zero vetor. Se user forjar a chave, afeta apenas si próprio.
- Zod validation na leitura (planejado em C10) é boa prática — previne crash se localStorage corrompido.

---

### 6. ChatComposer com shortcuts (C13)

- **Slash `/` popover** — executa template. Templates já existem (`SlashCommandPopover`), apenas migra. **Verificação obrigatória em C13**: templates são renderizados como **texto puro** (não HTML). Se algum componente usa `dangerouslySetInnerHTML` com conteúdo de template — XSS. Investigar no commit.
- **Shortcuts Ctrl/Cmd+K, Ctrl/Cmd+U, Esc** — escopo do listener no composer (não `window`). Sem impacto em segurança.
- **@ menções / # tags** — **NÃO ENTRAM na Onda 2a** (são stubs pra Onda 2b). Quando forem implementadas, Security revisa XSS (renderização de mention como HTML) e autorização (menção de user fora da org).
- **Drop zone de imagem** — mesmo handler de file picker. Já validado (tipagem `image/*`, size check no backend). Sem novo vetor.

---

### 7. Tokens bubble + CSS vars

- **Zero vetor** de segurança. HSL tokens são estáticos, CSS vars não entram em template literal SQL.
- UI spec nota (seção 1) sobre AI border gold 1.30:1 em light é **acessibilidade**, não segurança. Cues redundantes (label "Copilot" + ícone) cobrem WCAG 1.4.1. OK.

---

### 8. God-component split (refactor C1–C8, C10, C12, C13)

- **Vetor teórico**: refactor introduz bug de autorização? Cada componente novo consome os mesmos hooks com as mesmas queries RLS-protected. Frontend não reescreve queries — só move código.
- **Risco baixo**. QA **deve** executar smoke cross-org (ver pattern na seção "Pattern de testes RLS").
- Barrel `index.ts` não expõe nenhuma função que bypasse RLS.

---

### 9. Cache paralelo `useFailedMessages` (Onda 1 merged)

- `queryKey` já inclui `organizationId` + `phoneNumber`.
- RLS em `whatsapp_messages_failed` (ou equivalente) protege origem — client só lê rows da sua org.
- **OK**. Zero mudança de superfície.

---

## Bloqueantes (MUST fix before merge/deploy)

### B1 — `useConversationDraft` sem user-scoping (HIGH)

- **Arquivo**: `src/hooks/useConversationDraft.ts:3-34`
- **Consumo**: `src/components/chat/WhatsAppChat.tsx:1431-1432`
- **Ação**:
  1. Novo commit **Onda 2a.0** (antes de qualquer commit do plan atual, ou em paralelo antes do C13):
     - Injetar `userId` do `useAuth()` no hook ou receber como parâmetro.
     - Key nova: `chat-draft-${userId}-${instanceId}:${phoneNumber}`.
     - Se `userId` ausente → não persistir, só in-memory state.
  2. No `src/contexts/AuthContext.tsx` método `signOut`, antes de `supabase.auth.signOut()`, varrer e remover:
     - `chat-draft-${user.id}-*`
     - `chat-density-${user.id}`
     - `chat-panels-${user.id}`, `chat-layout-sizes-${user.id}`
     - `chat-last-read:${user.id}:*`
  3. One-shot migration: no `AuthContext` mount, se encontrar chave `chat-draft-${anything sem user prefix}` (regex: `/^chat-draft-[^:-]+:[^:]+$/`), remover — drafts órfãos do período Onda 1.
- **Owner**: agent-frontend
- **Deadline**: antes do merge da Onda 2a.1 em main. Idealmente em branch separada `fix/chat-draft-user-scope` mergeada primeiro em `main`, depois rebase da branch da Onda 2a.
- **Evidência de aceite**: teste de integração Playwright — 2 users logam sequencialmente no mesmo browser context, User A digita draft na conversa X, logout, User B login, abre conversa X → assert `input.value === ""`.

### B2 — Migration aplicada primeiro em dev (PROC)

- Migration `20260422120000_conversation_read_state.sql` **deve** rodar primeiro em `bcfadphgsibjzivtbjvc` (dev) com os 7 testes pgTAP do checklist do DBA passando, **antes** de ir para `jsjsmuncfkbsbzqzqhfq` (prod).
- **Owner**: agent-dba + agent-infra
- **Deadline**: antes de qualquer frontend consumir a tabela (C14 do plan).
- **Evidência de aceite**: output dos testes pgTAP em dev + SQL rodando o checklist manual (pattern de teste RLS na seção abaixo).

---

## Condicionais (APPROVED_WITH_CONDITIONS)

### C1 — QA cross-user + cross-org obrigatório (MUST pass in Fase 3)

QA executa a seguinte matriz em dev (`bcfadphgsibjzivtbjvc`) com **contas reais, não mock**:

| Cenário | Users | Expectativa |
|---------|-------|-------------|
| 1 | User A e User B, **mesma org** | B não vê read state de A; B não vê drafts de A; troca de user no browser não vaza draft (após B1 aplicado) |
| 2 | User A (Org X) e User C (Org Y) | C não vê read state de A; C não vê conversas de A; login de C no browser de A não mostra nada de A |
| 3 | Master user em qualquer org | Vê read states de todos; vê conversas de todos; log de ação (opcional, recomendado) |
| 4 | User A deslogado → User B loga | Draft de A apagado do localStorage (após B1 aplicado) |
| 5 | User A fecha aba sem logout → User A reabre | Draft preservado (A é o mesmo user) |
| 6 | User A em 2 devices simultaneamente | Read state sync entre devices (via tabela); drafts NÃO sync (localStorage é local — aceito) |

### C2 — Onda 2b: revisar realtime + @ menções + rate limit (MUST escalate)

- Revisar RLS policies de `conversation_messages`, `channel_messages`, `whatsapp_messages` quando contexto panel ligar em produção.
- @ menções + # tags: threat model separado (XSS, autorização de menção cross-org).
- Full-text search (se for implementado no painel): rate limit persistente (Postgres-based).

### C3 — Observabilidade `conversation_read_state_upsert_rate` (SHOULD have)

- Log métrica no `runtime_logs` ou via Sentry transaction: contagem de UPSERTs por user por hora.
- Threshold alerta: >1000 UPSERTs/user/hora = possível abuse/bug no client.
- Não bloqueante. Recomendado para shippar com pelo menos um dashboard básico.

### C4 — AuthContext signOut — cleanup de localStorage (depende de B1)

- Implementação junto com B1.
- Verificar que keys de outros domínios (`kanban-*`, `notifications-*`, etc.) também seguem o mesmo pattern user-scoped. Auditoria separada recomendada para Onda 3.

---

## Aprovações sem ação (APPROVED)

- Schema `conversation_read_state` + todas as RLS policies (SELECT/INSERT/UPDATE/DELETE) conforme patterns canônicos.
- `get_user_organization_id()` STABLE SECURITY DEFINER com `SET search_path = public` — seguro.
- `is_master_user()` STABLE SECURITY DEFINER — consistente com projeto.
- Trigger `update_updated_at` — função existente, SECURITY DEFINER search_path seguro.
- Master bypass — padrão do projeto, aceitável.
- Tokens bubble, density modes, layout vars — zero vetor.
- Cache paralelo `useFailedMessages` (Onda 1) — `queryKey` inclui org + phone, RLS protege origem.
- Structural refactor (C1–C13, C15–C17) — sem superfície de autorização nova.

---

## Pattern de testes RLS para QA

Executar no SQL editor do Supabase em **dev** (`bcfadphgsibjzivtbjvc`). Substituir UUIDs pelos reais dos users de teste.

### Setup

```sql
-- IDs de teste (substituir)
-- user_a: membro da org_x
-- user_b: membro da org_x (mesma org)
-- user_c: membro da org_y (outra org)
-- user_master: master admin

-- Validar que get_user_organization_id retorna correto
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
SELECT public.get_user_organization_id(); -- deve retornar org_x
```

### Teste 1 — INSERT próprio (deve passar)

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
INSERT INTO public.conversation_read_state (organization_id, user_id, conversation_key)
VALUES (public.get_user_organization_id(), auth.uid(), 'whatsapp:inst_test:+5511999990000');
-- Expectativa: OK
```

### Teste 2 — INSERT com user_id forjado (deve falhar)

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
INSERT INTO public.conversation_read_state (organization_id, user_id, conversation_key)
VALUES (public.get_user_organization_id(), '<user_b_uuid>', 'whatsapp:inst_test:+5511999990000');
-- Expectativa: ERROR: new row violates row-level security policy
```

### Teste 3 — INSERT com organization_id forjado (deve falhar)

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
INSERT INTO public.conversation_read_state (organization_id, user_id, conversation_key)
VALUES ('<org_y_uuid>', auth.uid(), 'whatsapp:inst_test:+5511999990000');
-- Expectativa: ERROR: new row violates row-level security policy
```

### Teste 4 — SELECT cross-user (mesma org) deve retornar 0 rows

```sql
-- User A insere
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
INSERT INTO public.conversation_read_state (organization_id, user_id, conversation_key)
VALUES (public.get_user_organization_id(), auth.uid(), 'whatsapp:inst_shared:+5511999990001')
ON CONFLICT DO NOTHING;

-- User B na mesma org consulta
SELECT set_config('request.jwt.claim.sub', '<user_b_uuid>', false);
SELECT COUNT(*) FROM public.conversation_read_state
 WHERE conversation_key = 'whatsapp:inst_shared:+5511999990001';
-- Expectativa: 0
```

### Teste 5 — SELECT cross-org deve retornar 0 rows

```sql
SELECT set_config('request.jwt.claim.sub', '<user_c_uuid>', false); -- Org Y
SELECT COUNT(*) FROM public.conversation_read_state;
-- Expectativa: apenas rows de User C (se tiver); zero rows de org X
```

### Teste 6 — UPDATE rewrite organization_id (deve falhar)

```sql
-- User A com row própria
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
UPDATE public.conversation_read_state
   SET organization_id = '<org_y_uuid>'
 WHERE user_id = auth.uid();
-- Expectativa: ERROR: new row violates row-level security policy (WITH CHECK falha)
```

### Teste 7 — Master bypass (deve passar para todas as rows)

```sql
SELECT set_config('request.jwt.claim.sub', '<user_master_uuid>', false);
SELECT COUNT(*) FROM public.conversation_read_state;
-- Expectativa: contagem global (todos os rows de todas as orgs)
```

### Teste 8 — DELETE cross-user (deve falhar)

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user_a_uuid>', false);
DELETE FROM public.conversation_read_state
 WHERE user_id = '<user_b_uuid>';
-- Expectativa: 0 rows afetadas (RLS filtra antes)
```

**Critério de aceite**: todos os 8 testes passam. Evidência: screenshot ou log do SQL editor.

---

## Risk Matrix

| # | Item | Severidade | Probabilidade | Impacto | Score | Status |
|---|------|:-:|:-:|:-:|:-:|:-:|
| B1 | `useConversationDraft` vaza draft cross-user no mesmo browser | HIGH | MEDIUM (ICP tem PCs compartilhados) | HIGH (PII de lead + LGPD) | 7/9 | BLOQUEANTE |
| B2 | Migration direto em prod sem validação dev | MEDIUM | LOW | HIGH (RLS quebrada em prod = vazamento cross-org) | 5/9 | BLOQUEANTE (procedural) |
| C1 | QA não testar cross-org antes do deploy | MEDIUM | MEDIUM | HIGH (vazamento cross-org não detectado) | 6/9 | CONDICIONAL |
| C2 | Realtime + @ menções sem revisão em Onda 2b | MEDIUM | MEDIUM (se escopo crescer) | HIGH | 6/9 | CONDICIONAL (fora da 2a) |
| C3 | Ausência de métrica de upsert rate | LOW | LOW | LOW | 2/9 | CONDICIONAL (recomendação) |
| RISCO-A | Refactor C1–C13 introduz bug de autorização | LOW | LOW | HIGH | 4/9 | mitigado por QA cross-org |
| RISCO-B | Master bypass abuso interno | LOW | LOW | MEDIUM | 3/9 | aceito (log recomendado) |
| RISCO-C | DoS via spam de UPSERT | LOW | LOW | LOW | 2/9 | aceito + observabilidade |

**Legenda**: Score = Severidade × Probabilidade × Impacto, normalizado 1–9.

---

## LGPD — drafts como dado pessoal

Drafts de chat contêm PII por natureza:
- Nome do lead (mencionado no rascunho)
- Dados de contato (telefone, email mencionado)
- Dados financeiros (valor de proposta, desconto, condições de pagamento)
- Conteúdo sensível ocasional (queixa do lead, dado confidencial compartilhado na negociação)

**Base legal** (Art. 7º LGPD): legítimo interesse do controller (Torque) para prestação do serviço de CRM. Aceita.

**Obrigação de segurança** (Art. 46): "medidas de segurança, técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados e de situações acidentais ou ilícitas".

**Violação**: o bug B1 viola Art. 46 — acesso não autorizado por outro user no mesmo device. Mesmo que o dano imediato seja contido (outro funcionário da mesma org, portanto controller), **é exposição não autorizada entre sujeitos distintos** (user A ≠ user B são sujeitos distintos mesmo trabalhando para o mesmo controller).

**Mitigação LGPD** = implementação de B1:
1. Key user-scoped (prevenção de acesso não autorizado)
2. Cleanup no logout (eliminação ao término da sessão legítima)
3. Migração one-shot (eliminação retroativa de drafts órfãos)

**Documentar** em `Obsidian/.../06 — Features/Seguranca/` como fix de conformidade LGPD pós-merge. Adicionar em `03 — Operacional/` o playbook "limpeza de localStorage pós-logout".

**Nota**: density preference e layout sizes não são PII — zero obrigação LGPD adicional para eles. Só drafts.

---

## Notas operacionais

1. **Prompt injection** — não aplicável nesta onda. Chat é human-to-human (WhatsApp operador↔lead). Copilot AI bubbles são renderizadas mas não processadas como input pra LLM no escopo Onda 2a.
2. **Webhook signature** — não tocado na Onda 2a.
3. **Rate limit** — leads podem enviar mensagens em massa via WhatsApp. Já tratado upstream (Evolution API + webhook). Onda 2a não muda superfície.
4. **CSP** — tokens HSL são estáticos, não geram inline style dinâmico perigoso. Density injection via `style={{ "--var": value }}` é seguro (apenas strings de CSS vars).

---

## Poder de veto

Security **não veta** a Onda 2a. Aprova com condições explícitas:
- **B1 e B2** são bloqueantes. Sem eles, o merge desta branch para main fica BLOCKED.
- **C1–C4** são condicionais. B1+B2 + C1 cumpridos = green light.

---

**Assinatura**: agent-security
**Data**: 2026-04-22
**Próxima revisão obrigatória**: Onda 2b, quando `ContextPanel` + `@` menções + full-text search forem ligados em produção.
