# Spec — WhatsApp Write Instance (Etapas D + E)

**Autor:** CTO via Claude
**Data:** 2026-05-11
**Branch base:** `feat/chat-bubble-kanban` (tip `49524ae`)
**Baseline:** Etapas A+B+C merged. Migration A não aplicada em DEV. Flag `user_write_instance_strict` default OFF.
**Status:** Spec — **execução unificada em uma branch** (`chore/whatsapp-write-instance-d0-migrate-dev`), 1 PR ao final.

## Status atual (2026-05-11)

| Etapa | Status | Artefato |
|-------|--------|----------|
| **D0** — Migration A em DEV | ✅ Concluída | commit `5f91cf5` (migration A + revoke anon) |
| **D1** — UAT flag OFF | ✅ Automatizado | [d1-uat-report.md](d1-uat-report.md) |
| **D2** — Cleanup `allowed_members` | 🟥 Bloqueada/reescopada | [d2-cleanup-decision.md](d2-cleanup-decision.md) |
| **E** — Rollout flag ON por org | 🟡 Pronto p/ execução autorizada | [e-rollout-toolkit.md](e-rollout-toolkit.md) |

**D2** virou pendência futura (D2-bis: refactor frontend `allowed_members` → `owner_team_member_id` gated por flag) — uso ativo no frontend impede drop/rename hoje.

**E** prepared mas **não executado em PROD** (memory rule: PROD requer pedido explícito do CTO na sessão).

---

## 0. Veredicto

Feature funcionalmente inerte hoje. Migration A não rodou em DEV → colunas/RPCs ausentes → guards backend curto-circuitam → frontend degrada para Estado 1 (HABILITADO).

Próximo bloco fecha gap em 4 sub-etapas:

- **D0** — Aplicar migration A em DEV. Pré-requisito de tudo.
- **D1** — UAT funcional flag OFF (validar zero regressão byte-a-byte).
- **D2** — Limpeza schema legado (`whatsapp_instance_allowed_members`).
- **E** — Rollout flag ON por org (piloto Milennials → expansão).

Etapa D2 destrutiva → exige backup + autorização explícita.
Etapa E altera comportamento prod → exige rollback plan + observabilidade.

---

## 1. Estado atual (referência)

| Camada | Status | Ref |
|--------|--------|-----|
| Schema (migration A) | Commitado, **não aplicado em DEV** | [supabase/migrations/20260930000000_user_write_instance.sql](../../../supabase/migrations/20260930000000_user_write_instance.sql) |
| Backend guards (etapa B) | Merged, gated por flag | [supabase/functions/_shared/instance-write-guard.ts](../../../supabase/functions/_shared/instance-write-guard.ts) |
| Frontend (etapa C) | Merged, degrade safe | [src/hooks/useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts), [src/components/chat/composer/ChatComposerShell.tsx](../../../src/components/chat/composer/ChatComposerShell.tsx) |
| Modal admin | Merged | [src/components/chat/admin/InstanceOwnerModal.tsx](../../../src/components/chat/admin/InstanceOwnerModal.tsx) |
| Testes | 13 backend + 18 frontend, passing | `tests/integration/instance-write-guard.test.ts`, `tests/unit/{useLeadWriteInstance,ChatComposerShell}.test.tsx` |
| Flag `user_write_instance_strict` | default OFF | tabela `feature_flags` |
| Vault docs | 01-schema, 02-ui-states, 03-frontend | Obsidian `06 — Features/whatsapp-write-instance/` |

---

## 2. Etapa D0 — Aplicar migration A em DEV

**Objetivo:** ativar schema/RPCs em DEV sem ligar flag.

**Branch:** `chore/whatsapp-write-instance-d0-migrate-dev`

### Passos

1. Pull `feat/chat-bubble-kanban` em DEV worktree.
2. Backup snapshot DEV (Supabase backup ondemand).
3. Aplicar migration:
   ```bash
   supabase db push --project-ref bcfadphgsibjzivtbjvc
   ```
   Alternativa MCP: `apply_migration` (se permissão liberada).
4. Regenerar types:
   ```bash
   supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts
   ```
5. Verificar:
   - Colunas existem: `whatsapp_instances.owner_team_member_id`, `leads.responsible_user_id`.
   - Tabela `whatsapp_instance_owner_history` criada com RLS habilitado.
   - 4 RPCs visíveis em `pg_proc`.
   - Flag `user_write_instance_strict` em `feature_flags`, `default_enabled = false`.
   - Backfill leads: `SELECT count(*) FROM leads WHERE responsible_user_id IS NULL` antes/depois (esperado: drop quando closer/sdr existem).
   - Backfill instâncias: `SELECT count(*) FROM whatsapp_instances WHERE owner_team_member_id IS NOT NULL` (esperado: > 0 para orgs com allowed_members single).

### Critérios de aceite D0

- [ ] Migration aplicada sem erro.
- [ ] Types regenerados, build passa, lint 0.
- [ ] Backfill conferido com query de antes/depois.
- [ ] Smoke test envio WhatsApp em DEV (flag OFF) — comportamento idêntico ao baseline.
- [ ] Commit + push branch nova + PR.

### Risco

Backfill `responsible_user_id := COALESCE(closer_id, sdr_id)` corre em UPDATE single-pass. Se tabela `leads` enorme + DEV underprovisioned → lock prolongado. Mitigação: rodar em janela ociosa.

---

## 3. Etapa D1 — UAT flag OFF (validação zero regressão)

**Objetivo:** confirmar bifurcação `isStrictWriteEnabled = false` mantém comportamento legado byte-a-byte.

**Branch:** sem branch (validação manual + relatório).

### Cenários

| # | Caller | Setup | Esperado |
|---|--------|-------|----------|
| 1 | Composer humano (`whatsapp-api-proxy`) | user comum, lead com responsável diferente | envia OK (sem 409/403) |
| 2 | Outbound copilot imediato | agente ativo, lead novo | envia via `preferred_instance_id` legado |
| 3 | Followup cron | followup agendado | envia via instância default |
| 4 | Workflow node `send_message` | workflow ativo | envia conforme legado |
| 5 | `pipe-rule-dispatch` template | regra disparando | envia OK |
| 6 | `campaign-rule-dispatch` | campanha ativa | envia OK |
| 7 | `mass-send-create` | broadcast | envia OK (exceção arquitetural — nunca passa pelo guard) |
| 8 | Frontend `useLeadWriteInstance` flag OFF | abrir lead drawer | composer Estado 1 (HABILITADO), zero shell shift |

### Critérios de aceite D1

- [ ] 8/8 cenários green.
- [ ] Logs edge functions: nenhum log `instance-write-guard` ativo (caller deve curto-circuitar antes).
- [ ] Sentry sem novos erros vs. baseline 24h.
- [ ] Relatório UAT em `.specs/features/whatsapp-write-instance/d1-uat-report.md`.

---

## 4. Etapa D2 — Limpeza schema legado

**Objetivo:** decidir destino de `whatsapp_instance_allowed_members` (precursor multi-membro) agora que owner é 1:1.

**Branch:** `feat/whatsapp-write-instance-d2-cleanup`

### Decisão pendente

Tabela `whatsapp_instance_allowed_members` permite N membros por instância. Etapa A migrou para owner único (1:1). Possíveis caminhos:

| Opção | Prós | Contras |
|-------|------|---------|
| **A. Drop tabela** | Schema limpo, sem legado | Quebra qualquer caller residual; perda histórica |
| **B. Manter como ACL secundária** | Permite "usuários autorizados a ler" futuramente | Confunde modelo (owner ≠ members) |
| **C. Rename + freeze** (`_legacy_whatsapp_instance_allowed_members`) | Preserva histórico, sinaliza deprecação | Schema poluído |

**Recomendação:** **C** se houver dependência ativa, **A** se grep confirmar zero callers fora da migration A.

### Passos

1. Grep callers:
   ```bash
   grep -r "whatsapp_instance_allowed_members" src/ supabase/ tests/
   ```
2. Documentar findings em `.specs/features/whatsapp-write-instance/d2-cleanup-decision.md`.
3. CTO escolhe opção (decisão arquitetural).
4. Migration `20XXXXXXXXXXXX_whatsapp_allowed_members_cleanup.sql`:
   - Opção A: `DROP TABLE ... CASCADE` (revisar FKs).
   - Opção C: `ALTER TABLE ... RENAME TO _legacy_...` + comment.
5. Atualizar types regen.
6. Smoke test envios DEV.

### Critérios de aceite D2

- [ ] Decisão registrada com grep evidencial.
- [ ] Migration aplicada DEV sem quebrar.
- [ ] Smoke test envios passa.
- [ ] **Não aplicar em PROD nesta etapa** — agendar junto com Etapa E rollout.

---

## 5. Etapa E — Rollout flag ON por org

**Objetivo:** ativar `user_write_instance_strict` por org gradualmente, começando piloto Milennials.

**Branch:** `feat/whatsapp-write-instance-e-rollout`

### 5.1 Pré-rollout (por org)

Antes de ligar flag para uma org, garantir:

1. **Toda instância tem owner**:
   ```sql
   SELECT id, instance_name, owner_team_member_id
   FROM whatsapp_instances
   WHERE organization_id = '<org_id>'
     AND owner_team_member_id IS NULL
     AND status IN ('open', 'connected');
   ```
   Resultado deve ser 0 rows. Caso contrário: admin abre [InstanceOwnerModal](../../../src/components/chat/admin/InstanceOwnerModal.tsx) e atribui owner.

2. **Todo lead ativo tem responsável**:
   ```sql
   SELECT count(*) FROM leads
   WHERE organization_id = '<org_id>'
     AND responsible_user_id IS NULL
     AND status NOT IN ('lost', 'won_archived');
   ```
   Threshold: < 5% do total. Acima disso → backfill manual via UI ou script.

3. **Conferência cobertura**:
   - Quantos team_members ativos vs. quantas instâncias open|connected.
   - Se `team_members > instâncias` → users sem instância vão receber `NO_INSTANCE` → composer Estado 3 (ERRO_SEM_INSTANCIA). Aceitável? Documentar.

### 5.2 Cutover (por org)

```sql
INSERT INTO organization_features (organization_id, feature_key, enabled, updated_at)
VALUES ('<org_id>', 'user_write_instance_strict', true, now())
ON CONFLICT (organization_id, feature_key) DO UPDATE
SET enabled = true, updated_at = now();
```

Cache flag backend = ~30s, frontend = ~60s. Aguardar 90s para efeito propagar.

### 5.3 Observabilidade

Métricas a monitorar (primeiras 24h pós-cutover):

| Métrica | Fonte | Ação se anômalo |
|---------|-------|------------------|
| HTTP 409 em `whatsapp-api-proxy` | edge logs | esperado baixo; pico = leads com responsável trocado mid-conversa |
| HTTP 403 em `whatsapp-api-proxy` | edge logs | esperado quase zero; pico = bug de owner ou user removido da org |
| `StrictWriteResolutionError` em outbound/followup/workflow | edge logs (grep) | indica responsável faltando ou owner não vinculado |
| Sentry | dashboard | baseline 24h pré vs. pós |
| Volume de envios WhatsApp | `channel_messages` count by hour | drop > 20% = rollback |

### 5.4 Rollback

Reversível em 1 query:
```sql
UPDATE organization_features
SET enabled = false, updated_at = now()
WHERE organization_id = '<org_id>'
  AND feature_key = 'user_write_instance_strict';
```

Cache 90s. Comportamento volta ao legado byte-a-byte (etapa B preserva path OFF).

### 5.5 Sequência de rollout

1. **Milennials (org `6030520a-2ca7-477d-be89-55758e2cd808`)** — piloto, 7 dias observação.
2. Se green: 3 orgs médio porte (escolha CTO).
3. Se green: restante por lotes de 5, 48h entre lotes.
4. Após 100% orgs ON por 30 dias estáveis → considerar `default_enabled = true` em `feature_flags` (PR separado).

### Critérios de aceite E (por org)

- [ ] Pré-checks 1+2+3 passam.
- [ ] Cutover SQL aplicado.
- [ ] 0 erros 409/403 anormais nas primeiras 4h.
- [ ] Volume de envios estável (±10% baseline).
- [ ] Sentry sem novos erros relacionados.
- [ ] Sem ticket de suporte vinculado.

---

## 6. Riscos transversais

| Risco | Severidade | Mitigação |
|-------|------------|-----------|
| Migration A trava locks longos em PROD | Alta | Aplicar fora pico; testar timing em DEV |
| Backfill instâncias não cobre multi-membro | Média | Modal admin + UAT pré-cutover por org |
| Cache flag torna rollback lento (90s) | Baixa | Documentar; janela aceitável |
| Composer humano bloqueia user com responsabilidade legítima | Média | Bypass admin/master; modal admin reatribui |
| Broadcast (`mass-send-create`) ignora vínculo | Aceito (arquitetural) | Documentado em etapa B |
| Frontend mostra Estado 3 em massa | Média | Pré-check 1 (toda instância tem owner) |

---

## 7. Critérios de aceite globais (feature completa)

- [ ] D0: migration aplicada DEV + smoke test green.
- [ ] D1: UAT 8/8 flag OFF green.
- [ ] D2: schema cleanup decidido + aplicado DEV.
- [ ] E piloto: Milennials 7 dias estável flag ON.
- [ ] E expansão: 100% orgs flag ON, 30 dias estáveis.
- [ ] Vault changelog atualizado por etapa.
- [ ] PROD migration A aplicada (junto com E piloto ou antes, em janela ociosa).

---

## 8. Fora de escopo

- Mudança de modelo (1:N owners por instância).
- UI para ver histórico `whatsapp_instance_owner_history` (auditoria existe, viewer não).
- Bypass de bloqueio por outro user (ex.: "assumir conversa") — fluxo separado, futuro.
- Notificação push quando lead muda de responsável/instância.

---

## 9. Ordem de execução sugerida

```
D0 (migrate dev) → D1 (UAT OFF) → D2 (cleanup decision)
                                   ↓
                          PROD migration apply (janela ociosa, autorização CTO)
                                   ↓
                          E piloto Milennials (7d)
                                   ↓
                          E expansão lotes (5 orgs / 48h)
                                   ↓
                          default flag ON (PR separado)
```

Cada etapa = branch nova + PR. Nunca push direto em main/develop.
