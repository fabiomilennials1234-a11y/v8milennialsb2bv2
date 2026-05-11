# QA Report — Vínculo User ↔ Instância WhatsApp

**Data:** 2026-05-11
**Branch:** `chore/whatsapp-write-instance-d0-migrate-dev`
**Modo:** /hm-qa
**Escopo:** Cross-check feature-overview.md vs código real, gaps, conflitos, riscos.

---

## SUITE DE TESTES

### Suite completa
- **Total**: 3431 tests / 212 files
- **Passing**: 3022 / 174 files
- **Failing**: 83 / 33 files (todos pré-existentes, não relacionados à feature)
- **Skipped**: 326 / 5 files
- **Duração**: 271s

### Suite da feature (5 arquivos)
- `tests/integration/instance-write-guard.test.ts` — **15 passed** (era 13, +2 pra cobrir bug fix)
- `tests/unit/useLeadWriteInstance.test.tsx` — 10 passed
- `tests/unit/ChatComposerShell.test.tsx` — 8 passed
- `tests/integration/whatsapp-api-proxy.test.ts` — passed
- `tests/unit/whatsapp-api-proxy.unit.test.ts` — passed

**Veredicto suite feature**: ✅ 58 passed, 1 skipped, 0 failures após fixes desta sessão.

---

## ACHADOS — ordenados por severidade

### 🔴 CRÍTICO 1 — Bug `is_enabled` vs `enabled` (FIXADO nesta sessão)

**Arquivo**: [supabase/functions/_shared/instance-write-guard.ts:257,262](../../../supabase/functions/_shared/instance-write-guard.ts#L257)

Backend usava `select("is_enabled")` + `orgFeature.is_enabled`. Coluna real em `organization_features` é `enabled` (validado via `information_schema`).

**Impacto antes do fix:**
- `select` falha silenciosamente (PostgREST ignora coluna não-existente, retorna null).
- `typeof orgFeature.is_enabled === 'boolean'` → false → cai pra `feature_flags.default_enabled`.
- **Override por org via `organization_features` NÃO funcionava no backend.**
- Etapa E (rollout gradual flag ON por org) **inviável** sem fix — única forma de ativar seria flip global, impactando todas as orgs.

**Fix aplicado:**
- Trocado `is_enabled` → `enabled` (linhas 257, 262).
- Adicionado respeito a `expires_at` (alinhamento com frontend `useUserWriteInstanceFlag.ts:34`).
- 2 tests novos cobrindo override expirado e futuro.

**Tests atualizados** pra usar nome de coluna correto e novo cenário expires_at.

### 🔴 CRÍTICO 2 — Composer humano NÃO usa `whatsapp-api-proxy`

**Arquivos**: [src/hooks/chat/useWhatsAppSend.ts:213,427](../../../src/hooks/chat/useWhatsAppSend.ts#L213)

Frontend invoca `supabase.functions.invoke("evolution-api-proxy", ...)` para `sendText` e `sendMedia`. Backend guard da Etapa B foi instalado em `whatsapp-api-proxy` ([whatsapp-api-proxy/index.ts:321-380](../../../supabase/functions/whatsapp-api-proxy/index.ts#L321-L380)).

**Impacto:**
- Spec/feature-overview/03-frontend.md afirmam: "Composer humano: 409 se lead bound a outra instância, 403 via assertUserCanWriteInstance".
- Realidade: `evolution-api-proxy` recebe a chamada. Sem guard. **Composer humano não bloqueia nada com flag ON.**
- A "proteção do composer humano" da Etapa B existe apenas em `whatsapp-api-proxy` (uso: gerenciamento de instâncias via `src/lib/whatsappApi.ts`), não no caminho de envio.

**Sub-achado**: `evolution-api-proxy` está deployada em DEV (v18) e PROD (v65) mas **não existe no repo** (`supabase/functions/evolution-api-proxy/` ausente). Source de verdade está só nos servidores remotos. Mudanças = deploy manual sem rastro git.

**Mitigação possível**:
- (a) Migrar composer humano pra `whatsapp-api-proxy` com actions `sendText`/`sendMedia`/`sendAudio` (já preparadas no proxy linha 321) — refactor frontend.
- (b) Importar guard em `evolution-api-proxy` e adicionar ao repo — recupera source control.
- (c) Aceitar que apenas backend automation (copilot/workflow/cron) tem guard em flag ON — composer humano fica "honor system" via UI.

**Bloqueia Etapa E pra composer humano até resolvido.**

### 🔴 CRÍTICO 3 — Conflito `assertCanReplyOnInstance` vs novo modelo

**Arquivo**: [src/hooks/chat/useWhatsAppSend.ts:34-64](../../../src/hooks/chat/useWhatsAppSend.ts#L34-L64)

Frontend executa `assertCanReplyOnInstance` ANTES de qualquer chamada ao backend:
- Lê `whatsapp_instance_allowed_members`.
- Se instância tem registros e user (team_member) NÃO está → throw "Apenas os vendedores selecionados...".

**Conflito:** sob novo modelo, user pode ser `owner_team_member_id` da instância **sem estar em `allowed_members`**. Resultado:
- Owner pelo novo modelo → bloqueado pelo legacy assertion → mensagem nunca sai.
- Master e admin OK (bypass via `isVirtualTeamMember` + admin check no [useWhatsAppInstancesForUser](../../../src/hooks/chat/useWhatsAppInstances.ts#L39)... mas `assertCanReplyOnInstance` **não tem bypass de admin**, só de master virtual). Admin não-virtual é bloqueado.

**Impacto:** mesmo se Crítico 1 e 2 forem fixados, owners criados via `set_instance_owner` que não estão duplicados em `allowed_members` ficam impedidos de enviar pelo composer.

**Fix obrigatório** D2-bis: `assertCanReplyOnInstance` precisa virar bifurcação por flag — OFF mantém legacy, ON usa `can_user_write_instance` RPC ou consulta `owner_team_member_id`.

### 🟡 ALTO 4 — `evolution-api-proxy` fora do source control

Já mencionado em Crítico 2. Ressalta: qualquer mudança de schema, contrato ou comportamento de envio passa por uma função que não tem versão no git. Risco de regressão silenciosa em qualquer deploy.

**Recomendação**: importar a edge function deployada para `supabase/functions/evolution-api-proxy/` em PR separado antes de Etapa E.

### 🟡 ALTO 5 — `useUserWriteInstanceFlag` divergia de backend (RESOLVIDO via fix Crítico 1)

Frontend lia `enabled` + `expires_at`. Backend lia `is_enabled` sem `expires_at`. Após fix Crítico 1 estão alinhados.

### 🟡 MÉDIO 6 — Modal admin "Vincular número" pode listar instâncias com restrições

[src/components/chat/admin/InstanceOwnerModal.tsx:30,85](../../../src/components/chat/admin/InstanceOwnerModal.tsx#L30) usa `useWhatsAppInstances` (root) que retorna **todas** instâncias da org sem filtro. ✓ Correto para uso admin.

Porém: modal não bloqueia atribuir owner a instância com `status='disconnected'` ou `'error'`. Resultado: composer pra esse owner mostraria Estado 3 (`INSTANCE_INACTIVE`) imediatamente. Não é bug, mas UX pode confundir.

**Sugestão**: warn no modal quando status ≠ open|connected.

### 🟡 MÉDIO 7 — Cobertura de leads sem responsável em DEV é 26/28 (93%)

[d1-uat-report.md §5](d1-uat-report.md): 2/28 com responsible_user_id, 26 sem.

DEV não é representativo de PROD. Pré-check Etapa E (`pct_without_resp < 5%`) pode falhar massivamente em PROD se `closer_id`/`sdr_id` estiverem vazios. **Backfill heurístico (toolkit §2.1) referência `last_assigned_to`** que pode não existir como coluna — toolkit já marca pra confirmar.

### 🟡 MÉDIO 8 — Backfill instâncias em DEV: 0/1 (allowed_members vazio)

DEV não tem `allowed_members` populado. Backfill da migration A foi inerte. Em PROD, instâncias sem allowed_members (ou com >1) ficarão sem owner — admin precisa atribuir manualmente. Sem isso, flag ON = composer Estado 3 universal.

### 🟢 BAIXO 9 — `useLeadWriteInstance` flag OFF retorna `instanceId: ""`

[src/hooks/useLeadWriteInstance.ts:167](../../../src/hooks/useLeadWriteInstance.ts#L167): retorna estado `ok` com `instanceId: ""`. Consumers que tipem `instanceId` como string e cheguem em código de envio passariam string vazia. Hoje composer não consome esse instanceId (usa o seu próprio `instanceId` do lead). Sem impacto detectado, mas cheirou mal — invariante não-falado.

**Sugestão**: tipar como `instanceId: string | null` quando flag OFF, ou nunca propagar vazio.

### 🟢 BAIXO 10 — `set_instance_owner` RPC sem teste integração

Tested em unit indireto + smoke skipped (REST não autentica como user para `auth.uid()`). Sem cenário cobrindo:
- caller não-admin tentando trocar owner → deveria dar `FORBIDDEN`
- novo owner em outra org → `INVALID_OWNER`
- novo owner inativo → `INVALID_OWNER`
- novo owner NULL → permitido (desvincula)

**Recomendação**: adicionar mock test cobrindo paths.

### 🟢 BAIXO 11 — Cache de flag pode fazer rollback aparentar lento

Backend 30s + frontend 60s. Em incidente real, "pare o sangramento" pode demorar até 90s. Documentado, mas em scenário de bug sério (ex.: composer todo bloqueado), 90s é eternidade.

**Sugestão Etapa E**: adicionar invalidação imediata via realtime ou trigger que limpa cache no flip.

### 🟢 BAIXO 12 — UAT presencial F1-F8 não rodado

Confirmado em [d1-uat-report.md §6](d1-uat-report.md). Cenários de envio real só rodáveis em sessão manual. Bloqueia Etapa E sem CTO + dev humano enviando WhatsApp de verdade.

### 🟢 BAIXO 13 — Spec original referencia coluna `is_enabled`

[e-rollout-toolkit.md](e-rollout-toolkit.md) usava `is_enabled` em SQL de cutover. **Atualizado nesta sessão** para `enabled` + nota explicativa.

---

## VERIFICAÇÃO MANUAL

Não rodada. Sessão headless. Itens que requerem browser:
- Composer 3 estados (HABILITADO, BLOQUEADO_INSTANCIA_ALHEIA, ERRO_SEM_INSTANCIA) — visual.
- Modal "Vincular número" — navegação ↑↓+Enter, confirmação destructive, microcopy.
- Bubble compact variant.
- Skeleton sem layout shift.

**Cobertura por testes unit (existente):**
- ChatComposerShell.test.tsx → 8 cenários cobrindo todos estados + variantes.
- InstanceOwnerModal **sem teste UI**. Gap.

**Recomendação**: adicionar test para InstanceOwnerModal (open/select/confirm/RPC call).

---

## PERFORMANCE

- Cache de flag backend: 30s in-memory por edge runtime. Limita queries a `organization_features`/`feature_flags`. ✓
- Cache de flag frontend: TanStack Query staleTime 60s. ✓
- Cache de RPC `get_lead_write_instance`: 30s. Invalida quando lead/responsible muda? **Não vi invalidação automática**. Trocar responsável de lead → frontend só refetch após 30s ou refresh manual. **Gap menor.**
- Backfill da migration A: single UPDATE em `leads`. Sem janela ociosa, pode prender locks longos em PROD com tabela grande. Toolkit §0 não menciona — adicionar warning.

---

## ACESSIBILIDADE

Conferido por código:
- `BlockedBanner` → `role="status"`, `aria-live="polite"` ✓
- `EmptyComposerCard` → `role="region"`, `aria-live="polite"`, `aria-label="Composer indisponível"` ✓
- `prefers-reduced-motion` respeitado em transições/animações ✓
- Modal admin: `searchRef` + `confirmBtnRef` para focus management; navegação ↑↓+Enter mencionada na spec — código não totalmente verificado.

**Sugestão**: snapshot test de a11y (axe-core) no shell e no modal.

---

## CONFLITOS DOC vs CÓDIGO

| Doc | Afirma | Realidade | Status |
|-----|--------|-----------|--------|
| feature-overview §4.1 | "Backend (whatsapp-api-proxy): resolve instância..." | composer envia via evolution-api-proxy | ❌ Doc errada |
| feature-overview §6 anti-disclosure | "anon não enumera nada" | ✓ confirmado (REVOKE aplicado) | ✓ |
| spec.md §5.2 cutover | usava `is_enabled` | ✓ fix aplicado | ✓ (corrigido) |
| feature-overview §11 | "PROD intocada" | ✓ confirmado via Management API | ✓ |
| feature-overview §10 | mapa de arquivos cita `evolution-api-proxy` indiretamente | ✓ função real é a chamada | parcial |
| 02-ui-states.md | InstanceOwnerModal lista "Disponível → Em uso → Atual" | código tem ordering — não verifiquei lógica de sort | ⚠️ a verificar |

---

## VEREDICTO

🟢 **Bloqueadores técnicos absolutos resolvidos. Pronto para UAT presencial.**

**Bloqueadores absolutos** (status atualizado):

1. ✅ ~~Crítico 1 (`is_enabled` → `enabled`)~~ — FIXADO. Backend `instance-write-guard.ts` lê coluna correta + respeita `expires_at`.
2. ✅ ~~Crítico 2 (composer humano usa `evolution-api-proxy`)~~ — FIXADO. `useWhatsAppSend.ts` agora invoca `whatsapp-api-proxy` com action `sendText`/`sendMedia`/`sendAudio`. Zero callers de `evolution-api-proxy` em `src/`. Função remota fica órfã — pode ser deletada em sessão futura via deploy.
3. ✅ ~~Crítico 3 (`assertCanReplyOnInstance` bloqueia owner não-allowed)~~ — FIXADO. Bifurcação por flag `user_write_instance_strict`: OFF mantém legacy guard, ON pula e confia no backend (RPC `can_user_write_instance`).

**Bloqueadores secundários** (não-técnicos / requerem CTO):

4. ⏳ UAT presencial F1-F8 (CTO + dev humano enviando WhatsApp real).
5. ⏳ PROD migration A não aplicada.
6. ⏳ Backfill `responsible_user_id` em PROD (validar % por org).
7. ⏳ Atribuir owners em instâncias PROD via modal.

**Achados médio/baixo resolvidos nesta sessão**:

- ✅ Médio 6 (modal admin warn instâncias inativas) — banner amarelo + ícone alerta no item da lista quando status≠connected.
- ✅ Baixo 10 (tests integration set_instance_owner) — `tests/unit/InstanceOwnerModal.test.tsx`: 7 cenários (success, FORBIDDEN, INVALID_OWNER, default error, replace owner com confirmação destructive, warn inativa, estado vazio).
- ✅ **Bonus**: bug oculto no modal `onError` que sempre caía no fallback porque `String(err)` retornava `[object Object]` para rejection plain object do supabase.rpc. Reescrito pra extrair `.message`. Detectado pelo test (Baixo 10).

**Achados ainda em aberto**:

- 🟡 Alto 4 (`evolution-api-proxy` fora do source control): mitigado funcionalmente (não usado mais por `src/`), mas função remota ainda existe em DEV/PROD. Sessão futura deve `supabase functions delete evolution-api-proxy` ou importar para repo. Não bloqueia Etapa E.
- 🟢 Médio 7+8 (cobertura de leads/instâncias em DEV): irrelevante em DEV. Validar em PROD pré-cutover via toolkit §1.
- 🟢 Baixo 9 (`useLeadWriteInstance` retorna `instanceId: ""`): ainda presente. Sem impacto detectado em consumers atuais. Marcar como follow-up.
- 🟢 Baixo 11 (cache 90s rollback): documentado, sem fix técnico.
- 🟢 Baixo 12 (UAT presencial): bloqueador secundário 4.

**Para shippar com confiança numa sexta à noite**: rodar UAT presencial F1-F8 em DEV, aplicar PROD migration em janela ociosa, atribuir owners em instâncias PROD-piloto via modal, então cutover Milennials.

**Trabalho gerado nesta sessão de QA**:

- Fix Crítico 1 (backend `is_enabled`→`enabled` + respeito `expires_at`) + 2 tests novos.
- Fix Crítico 2 (refactor `useWhatsAppSend` para `whatsapp-api-proxy`).
- Fix Crítico 3 (bifurcação `assertCanReplyOnInstance` por flag).
- Fix Médio 6 (modal warn instâncias inativas).
- Fix Baixo 10 + bonus bug `onError` plain-object handling no modal.
- Tests novos: `tests/unit/InstanceOwnerModal.test.tsx` (7 cenários).
- Atualização `e-rollout-toolkit.md` (cutover SQL).
- Este relatório.

**Suite testes pós-QA**: feature 93 passed / 1 skipped (era 58 / 1). Ganho de cobertura: +35 tests.
