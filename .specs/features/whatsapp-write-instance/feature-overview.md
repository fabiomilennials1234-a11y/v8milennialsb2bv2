# Feature Overview — Vínculo User ↔ Instância WhatsApp ↔ Lead Responsável

**Versão:** 1.0 (D0 aplicada DEV apenas)
**Data:** 2026-05-11
**Branch:** `chore/whatsapp-write-instance-d0-migrate-dev`
**Estado:** Migration A em DEV (`bcfadphgsibjzivtbjvc`). PROD (`jsjsmuncfkbsbzqzqhfq`) intocada.
**Flag:** `user_write_instance_strict` default **OFF** — comportamento legacy preservado byte-a-byte até cutover por org.

---

## 1. Por que existe a feature

### Problema antes

Múltiplos vendedores em uma org compartilhavam mesma instância WhatsApp. Falta de regra clara levou a:

- Vendedor A respondia lead de vendedor B sem rastreabilidade.
- Cliente recebia mensagem de "número desconhecido" (instância de outro vendedor).
- Disputa interna sobre comissão (quem fechou de fato).
- Perda de contexto quando lead trocava de SDR para Closer.
- Auditoria: impossível reconstruir "quem mandou o quê de qual número".

### Solução

**1 vendedor = 1 instância de escrita por org.** Lead tem responsável definitivo. Mensagem sai pela instância vinculada ao responsável. Admin reatribui owner quando vendedor sai/troca.

---

## 2. Modelo de dados novo

### Coluna nova — `whatsapp_instances.owner_team_member_id`

| Atributo | Valor |
|----------|-------|
| Tipo | `uuid` (FK `team_members.id`) |
| Constraint | índice único parcial `(organization_id, owner_team_member_id)` `WHERE owner_team_member_id IS NOT NULL` |
| Significado | "Quem é o vendedor desta instância?" — 1 instância de escrita ativa por user por org |
| `NULL` permitido? | Sim. NULL = "sem owner" (admin/master ainda escrevem). |
| ON DELETE | `SET NULL` (apaga vendedor → instância fica sem owner, não é deletada) |

### Coluna nova — `leads.responsible_user_id`

| Atributo | Valor |
|----------|-------|
| Tipo | `uuid` (FK `team_members.id`) |
| Significado | "Quem é o vendedor responsável definitivo deste lead?" — fonte de verdade pra resolver instância |
| Backfill na migration A | `COALESCE(closer_id, sdr_id)` |
| Diferença vs `closer_id`/`sdr_id` | esses são papéis ao longo do funil; `responsible_user_id` é o ponto único atual |

### Tabela nova — `whatsapp_instance_owner_history`

Auditoria append-only de toda troca de owner.

| Campo | Tipo | Origem |
|-------|------|--------|
| `instance_id` | uuid | FK `whatsapp_instances` |
| `organization_id` | uuid | FK `organizations` |
| `previous_owner_id` | uuid | FK `team_members` |
| `new_owner_id` | uuid | FK `team_members` |
| `changed_by` | uuid | `auth.uid()` no momento da troca |
| `changed_at` | timestamptz | `now()` |
| `reason` | text | razão livre fornecida pelo admin |

**RLS:**
- `SELECT`: membros ativos da org, ou master plataforma.
- `INSERT/UPDATE/DELETE`: apenas `service_role` via RPC `set_instance_owner`.

### Feature flag — `feature_flags.user_write_instance_strict`

- `default_enabled = false` (default global).
- Override por org via `organization_features` (mais granular vence).
- Cache backend: 30s. Cache frontend: 60s. Total ~90s para propagar mudança.

---

## 3. Quatro RPCs SECURITY DEFINER

Todas com `search_path = public` lockado, grants: `authenticated + service_role` apenas (anon revogado em migration `20260930000001`).

| RPC | Função | Quem chama |
|-----|--------|-----------|
| `get_user_write_instance(user_id, org_id)` | Retorna instância vinculada ao user na org. Vazio se sem vínculo. | Dashboards/diagnóstico |
| `get_lead_write_instance(lead_id)` | Resolve instância via `responsible_user_id`. Retorna `error_code` estruturado: `LEAD_NOT_FOUND`, `NO_RESPONSIBLE`, `NO_INSTANCE`, `INSTANCE_INACTIVE`, ou `NULL` (sucesso). | Backend guard ([instance-write-guard.ts](../../../supabase/functions/_shared/instance-write-guard.ts)), frontend hook ([useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts)) |
| `can_user_write_instance(user_id, instance_id)` | `boolean`. True para owner exato, admin da org, ou master. | Composer humano (`whatsapp-api-proxy`) |
| `set_instance_owner(instance_id, new_owner_team_member_id, reason)` | Troca owner + grava auditoria. Apenas admin da org ou master. Valida novo owner pertence à org + ativo. | Modal admin "Vincular Número" |

---

## 4. Fluxo de envio — quatro caminhos

Todos gated por flag `user_write_instance_strict`. Flag OFF = comportamento legacy intocado.

### 4.1 Composer humano (UI `/chat`)

**Arquivos:** [whatsapp-api-proxy/index.ts](../../../supabase/functions/whatsapp-api-proxy/index.ts), [useWhatsAppSend.ts](../../../src/hooks/chat/useWhatsAppSend.ts), [ChatComposerShell.tsx](../../../src/components/chat/composer/ChatComposerShell.tsx)

**Frontend invoke**: `supabase.functions.invoke("whatsapp-api-proxy", { body: { action: "sendText" | "sendMedia" | "sendAudio", instance_id, organization_id, payload: { number, text|file|..., lead_id } } })`. Refactor de QA-2026-05-11: substituiu o caminho legacy `evolution-api-proxy` (que ficava fora do source control e bypassava o guard).

**Flag OFF:** Frontend pula `assertCanReplyOnInstance` legacy quando flag ON, mantém quando OFF (proteção rápida sem roundtrip ao backend pra rejeições óbvias). Backend (`whatsapp-api-proxy`) ignora `lead_id` no payload.

**Flag ON:**
1. Frontend hook `useLeadWriteInstance(leadId)` chama RPC `get_lead_write_instance`.
2. Resposta determina estado do composer (ver §5).
3. User envia → frontend POST com `lead_id` no payload (frontend SKIPA `assertCanReplyOnInstance` legacy — backend é fonte de verdade).
4. Backend (`whatsapp-api-proxy`):
   - Resolve instância do lead via `resolveLeadWriteInstance`.
   - Compara com instância que o frontend escolheu. Diferente? → **HTTP 409**.
   - `assertUserCanWriteInstance(user_id, instance_id)` → owner/admin/master? OK. Senão → **HTTP 403**.
5. Erro propaga → toast no frontend.

### 4.2 Copilot / outbound automático

**Arquivos:** [outbound-sender.ts](../../../supabase/functions/_shared/outbound-sender.ts), [followup-sender.ts](../../../supabase/functions/_shared/followup-sender.ts), [actions/send-document.ts](../../../supabase/functions/_shared/actions/send-document.ts)

**Flag OFF:** usa `preferred_instance_id` legado → primeira instância `open|connected` da org.

**Flag ON:**
- `resolveDispatchContext({ leadId })` chama `resolveStrictInstanceForCaller`.
- Se resolve → envia por essa instância.
- Se falha → lança `StrictWriteResolutionError` com error_code → registra em log e aborta. **Sem fallback.**

### 4.3 Workflow nodes

**Arquivos:** [workflow-action-handler.ts](../../../supabase/functions/_shared/workflow-action-handler.ts), [pipe-rule-dispatch/index.ts](../../../supabase/functions/pipe-rule-dispatch/index.ts), [campaign-rule-dispatch/index.ts](../../../supabase/functions/campaign-rule-dispatch/index.ts), [process-scheduled-user-messages/index.ts](../../../supabase/functions/process-scheduled-user-messages/index.ts)

7 nodes de workflow + dispatch de regras de pipe + dispatch de campanha + scheduled batch — todos passam `leadId` para o resolver. Flag ON → strict. Flag OFF → legacy.

### 4.4 Broadcast (exceção arquitetural)

**Arquivos:** [mass-send-create/index.ts](../../../supabase/functions/mass-send-create/index.ts), [semi-automatic-dispatch/index.ts](../../../supabase/functions/semi-automatic-dispatch/index.ts)

**Sempre legacy.** Broadcast 1→N não tem responsável único — instância é escolhida pelo admin no momento da campanha. Documentado como exceção em [02-ui-states.md](Obsidian-vault) e em comentário inline.

---

## 5. UI — três estados do composer

Implementado em [ChatComposerShell.tsx](../../../src/components/chat/composer/ChatComposerShell.tsx). Estados resolvidos por [useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts).

### Estado 1 — `HABILITADO`

User pode escrever. Composer ativo padrão. Rótulo discreto: "Você está atendendo este lead com a linha de WhatsApp [nome]".

**Quando:** flag OFF (default), ou flag ON + user é owner/admin/master da instância vinculada.

### Estado 2 — `BLOQUEADO_INSTANCIA_ALHEIA`

User comum tentando escrever em lead cujo responsável é outro vendedor. Composer desabilitado. Banner role=status aria-live=polite:

> "Este lead pertence a [nome do responsável]. Para responder, use sua linha ou peça um admin para reatribuir."

**Quando:** flag ON + user não-admin + lead tem responsável diferente.

### Estado 3 — `ERRO_SEM_INSTANCIA`

Lead com responsável mas o responsável não tem instância vinculada (`NO_INSTANCE`); ou lead sem responsável (`NO_RESPONSIBLE`); ou instância caiu (`INSTANCE_INACTIVE`). Composer desabilitado. Card role=region:

> "Não há linha de WhatsApp configurada para este lead. Peça um admin para vincular um número."

**Quando:** flag ON + falha de resolução.

### Modal admin — Vincular Número

[InstanceOwnerModal.tsx](../../../src/components/chat/admin/InstanceOwnerModal.tsx). Apenas admin da org ou master.

- Lista vendedores ordenada: **Disponível → Em uso → Atual**.
- Navegação ↑↓+Enter (a11y).
- Confirmação inline destructive ao substituir owner existente.
- Submete via RPC `set_instance_owner` → grava auditoria.
- Vocabulário user-facing: "número" ou "linha de WhatsApp" (nunca "instância").

---

## 6. Permissões e segurança

### Bypass admin/master

Sempre permitido independente de owner:
- `master` (plataforma) — `is_master_user(user_id)` retorna true.
- `admin` da org — `team_members.role = 'admin'` E `is_active = true`.

Razão: admins precisam responder em emergências (vendedor sumiu, cliente reclamou direto pro admin, etc).

### Anti-disclosure

RPCs revogadas de `anon` em migration `20260930000001`:
- `get_user_write_instance` — vazaria vínculos user→instância.
- `get_lead_write_instance` — vazaria existência/responsável de leads.
- `can_user_write_instance` — vazaria probe de permissão por user_id arbitrário.
- `set_instance_owner` — escrita sensível.

Anon não enumera nada. Apenas `authenticated` (com JWT válido) e `service_role` (edge functions).

### Auditoria

Toda troca de owner grava em `whatsapp_instance_owner_history` com `changed_by = auth.uid()`. Append-only. Membros da org leem; só `service_role` escreve via RPC.

### Logs sem PII

[instance-write-guard.ts](../../../supabase/functions/_shared/instance-write-guard.ts) loga apenas IDs e códigos. Nunca telefone, mensagem, nome.

---

## 7. Compatibilidade

### Flag OFF (estado atual em todas as orgs)

- Frontend: composer sempre Estado 1 HABILITADO. Hooks degradam safe (RPC error/loading → `canWrite=true`).
- Backend: `resolveStrictInstanceForCaller` retorna null → callers usam path legacy idêntico.
- Validação: cenário "flag OFF + leadId presente NÃO chama get_lead_write_instance" coberto em [tests/integration/instance-write-guard.test.ts](../../../tests/integration/instance-write-guard.test.ts).

### Flag ON (após cutover por org)

- Composer reflete vínculo real.
- Backend força instância do responsável.
- Erros 409/403 surgem → frontend mostra toast.

### Rollback

`UPDATE organization_features SET is_enabled = false ...` — efeito em ~90s (cache).

---

## 8. Exceções arquiteturais

| Caso | Comportamento | Razão |
|------|---------------|-------|
| Broadcast (`mass-send-create`, `semi-automatic-dispatch`) | Sempre legacy, ignora vínculo | 1→N sem responsável único |
| Admin/master | Sempre permitido escrever | Resposta de emergência |
| `responsible_user_id IS NULL` em flag ON | Composer Estado 3, dispatch falha `NO_RESPONSIBLE` | Backfill obrigatório pré-cutover |
| Vendedor com >1 instância na org | Bloqueado por unique index | Modelo é estritamente 1:1 |
| Vendedor sem instância em flag ON | Composer Estado 3, dispatch falha `NO_INSTANCE` | Admin precisa atribuir owner |

---

## 9. O que NÃO mudou

- Recebimento (webhook → `conversations`/`channel_messages`): inalterado.
- Schema `conversations`, `conversation_messages`, `channel_messages`: inalterado.
- Tabela `whatsapp_instance_allowed_members`: ainda existe, ainda em uso pelo frontend hoje (refactor é tarefa **D2-bis**).
- Hooks `useWhatsAppInstances`, `useWhatsAppInstanceAllowedMembers`: inalterados — continuam consultando allowed_members.
- Provider Uazapi/Evolution: inalterado.
- Cron jobs e edge function deploy: inalterado.

---

## 10. Mapa de arquivos

### Schema
- [supabase/migrations/20260930000000_user_write_instance.sql](../../../supabase/migrations/20260930000000_user_write_instance.sql) — schema + RPCs + flag + backfill
- [supabase/migrations/20260930000001_revoke_anon_write_instance_rpcs.sql](../../../supabase/migrations/20260930000001_revoke_anon_write_instance_rpcs.sql) — security follow-up

### Backend (`_shared`)
- [instance-write-guard.ts](../../../supabase/functions/_shared/instance-write-guard.ts) — núcleo: resolve, asserta, lê flag, cache 30s
- [whatsapp-dispatch.ts](../../../supabase/functions/_shared/whatsapp-dispatch.ts) — `resolveDispatchContext` com bifurcação flag
- [outbound-sender.ts](../../../supabase/functions/_shared/outbound-sender.ts), [followup-sender.ts](../../../supabase/functions/_shared/followup-sender.ts), [workflow-action-handler.ts](../../../supabase/functions/_shared/workflow-action-handler.ts), [actions/send-document.ts](../../../supabase/functions/_shared/actions/send-document.ts) — callers atualizados

### Backend (edge functions)
- [whatsapp-api-proxy](../../../supabase/functions/whatsapp-api-proxy/index.ts) — composer humano: 409/403
- [pipe-rule-dispatch](../../../supabase/functions/pipe-rule-dispatch/index.ts), [campaign-rule-dispatch](../../../supabase/functions/campaign-rule-dispatch/index.ts), [process-scheduled-user-messages](../../../supabase/functions/process-scheduled-user-messages/index.ts) — schedulers atualizados
- [mass-send-create](../../../supabase/functions/mass-send-create/index.ts), [semi-automatic-dispatch](../../../supabase/functions/semi-automatic-dispatch/index.ts) — exceções broadcast

### Frontend
- [src/hooks/useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts) — resolve estado composer, degrade safe
- [src/hooks/useUserWriteInstanceFlag.ts](../../../src/hooks/useUserWriteInstanceFlag.ts) — leitura conservadora flag, cache 60s
- [src/hooks/chat/useWhatsAppSend.ts](../../../src/hooks/chat/useWhatsAppSend.ts) — send hooks aceitam `leadId` e propagam
- [src/components/chat/composer/ChatComposerShell.tsx](../../../src/components/chat/composer/ChatComposerShell.tsx) — invólucro 3 estados
- [src/components/chat/admin/InstanceOwnerModal.tsx](../../../src/components/chat/admin/InstanceOwnerModal.tsx) — UI admin "Vincular Número"
- [src/components/chat/WhatsAppChat.tsx](../../../src/components/chat/WhatsAppChat.tsx), [src/components/chat/bubble/ChatBubbleThread.tsx](../../../src/components/chat/bubble/ChatBubbleThread.tsx), [src/components/chat/bubble/ChatBubbleComposer.tsx](../../../src/components/chat/bubble/ChatBubbleComposer.tsx) — envelopam composer no shell

### Tipos
- [src/types/user-write-instance.ts](../../../src/types/user-write-instance.ts) — tipos das RPCs
- [src/integrations/supabase/types.ts](../../../src/integrations/supabase/types.ts) — regenerado

### Testes
- [tests/integration/instance-write-guard.test.ts](../../../tests/integration/instance-write-guard.test.ts) — 13 cenários, mock Supabase
- [tests/unit/useLeadWriteInstance.test.tsx](../../../tests/unit/useLeadWriteInstance.test.tsx) — 10 cenários frontend hook
- [tests/unit/ChatComposerShell.test.tsx](../../../tests/unit/ChatComposerShell.test.tsx) — 8 cenários UI

### Docs
- [.specs/features/whatsapp-write-instance/spec.md](spec.md) — spec multi-etapa
- [.specs/features/whatsapp-write-instance/d1-uat-report.md](d1-uat-report.md) — relatório UAT
- [.specs/features/whatsapp-write-instance/d2-cleanup-decision.md](d2-cleanup-decision.md) — decisão de bloqueio
- [.specs/features/whatsapp-write-instance/e-rollout-toolkit.md](e-rollout-toolkit.md) — toolkit de cutover

---

## 11. Estado de aplicação

| Ambiente | Migration A | Flag default | Override por org |
|----------|-------------|---------------|-------------------|
| **DEV** (`bcfadphgsibjzivtbjvc`) | ✅ Aplicada (D0) | OFF | Nenhum |
| **PROD** (`jsjsmuncfkbsbzqzqhfq`) | ❌ Não aplicada | n/a | n/a |

PROD intocada por design. Aplicação em PROD requer autorização explícita do CTO em sessão futura, conforme [e-rollout-toolkit.md §0](e-rollout-toolkit.md).

---

## 12. Pendências conhecidas

1. **D2-bis (frontend refactor)**: `useWhatsAppInstances`, `useWhatsAppSend`, `useWhatsAppInstanceAllowedMembers` ainda consultam tabela legacy `allowed_members`. Refactor pra owner-only quando flag ON. Drop tabela só após.
2. **UAT presencial F1-F8**: cenários de envio real WhatsApp não automatizáveis. Necessário antes do primeiro cutover real.
3. **PROD migration A + revoke**: aplicar em janela ociosa antes do piloto Milennials.
4. **Backfill `responsible_user_id` em PROD**: validar `pct_without_resp < 5%` por org-piloto.
5. **Atribuição de owners em instâncias PROD**: usar [InstanceOwnerModal](../../../src/components/chat/admin/InstanceOwnerModal.tsx) ou backfill SQL §2 do toolkit.
6. **UI viewer para `whatsapp_instance_owner_history`**: tabela existe, viewer não. Útil para auditoria visual.
7. **Bypass "assumir conversa"** para outro user: fluxo separado, futuro.

---

## 13. Hotfix 2026-06-08 — vínculo vira PREFERÊNCIA (fallback connected)

**Branch:** `hotfix/dispatch-fallback-connected-instance` (de `main`).

### Correção de fato (doc §11 estava desatualizado)

Apesar do §11 afirmar "PROD intocada", a flag `user_write_instance_strict` estava **ON em PROD para a org Milennials** (`6030520a-2ca7-477d-be89-55758e2cd808`, override em `organization_features.enabled = true`, confirmado por leitura read-only da Management API em 2026-06-08). A Migration A foi aplicada em PROD em algum momento após este doc. **Esta seção é a fonte de verdade; §11 ficou histórico.**

### Sintoma

Com a flag ON, **todo disparo de lead sem responsável era bloqueado**: o resolver estrito lançava sem fallback (`NO_RESPONSIBLE`/`NO_INSTANCE`/`INSTANCE_INACTIVE`). Afetava copilot outbound, followups, send-document, message-gateway e as regras de disparo. Percepção do CTO: "o botão de disparo só funciona se o lead tiver responsável".

### Decisão (CTO)

O vínculo responsável→instância passa a ser **preferência, não gate**. Quando o vínculo não resolve uma instância usável, o disparo **cai para a primeira instância CONECTADA da org** em vez de falhar. Só `LEAD_NOT_FOUND` (lead inexistente) permanece erro.

### Implementação (camada TS, sem migration)

- `supabase/functions/_shared/whatsapp-dispatch.ts` — `resolveDispatchContext`: soft codes → fallback `resolveInstance(org, { requireConnected: true })`. Quando há instância do responsável conectada, ela é mantida (preferência).
- `supabase/functions/_shared/instance-write-guard.ts` — `resolveStrictInstanceForCaller`: soft codes → devolve `null` (caller usa precedência legada); só `LEAD_NOT_FOUND` lança. Os 4 callers (whatsapp-helpers, process-scheduled-user-messages, pipe-rule-dispatch, campaign-rule-dispatch) já tratavam o erro com fallback — comportamento preservado.
- RPC `get_lead_write_instance` e a flag **inalterados** — o vínculo per-user continua válido como preferência.

### Trade-off

Relaxa o isolamento per-user (LGPD) que a feature impunha: leads sem responsável passam a sair por instância compartilhada. Decisão explícita do CTO — ver `04 — Decisões/ADR-2026-06-08-disparo-fallback-instancia-conectada.md`.

### Cobertura

`tests/integration/instance-write-guard.test.ts` estendido (27 testes, 11 novos): fallback por soft code, preferência mantida no sucesso, `LEAD_NOT_FOUND` propaga, org sem instância conectada → `no_instance`.
