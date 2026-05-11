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

🟥 **NÃO está pronto para Etapa E em PROD.**

**Bloqueadores absolutos** (ordem de fix):

1. ✅ ~~Crítico 1 (`is_enabled` → `enabled`)~~ — FIXADO nesta sessão.
2. ❌ **Crítico 2** (composer humano usa `evolution-api-proxy`, não `whatsapp-api-proxy`) — escolher entre (a)/(b)/(c) e implementar.
3. ❌ **Crítico 3** (`assertCanReplyOnInstance` bloqueia owner não-allowed) — D2-bis ou bifurcação por flag.

**Bloqueadores secundários**:

4. UAT presencial F1-F8 (CTO + dev).
5. PROD migration A não aplicada.
6. Backfill `responsible_user_id` em PROD (validar % por org).
7. Atribuir owners em instâncias PROD via modal.

**Para shippar com confiança numa sexta à noite**: corrigir Críticos 2 e 3, importar `evolution-api-proxy` para o repo, rodar UAT presencial, aplicar PROD migration em janela ociosa. Só então cutover Milennials.

**Trabalho gerado nesta sessão de QA**:
- Fix Crítico 1 (backend + 2 tests novos).
- Atualização e-rollout-toolkit.md.
- Este relatório.
