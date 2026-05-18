---
type: feature
title: Pipe Confirmacao
status: active
created: 2026-04-12
updated: 2026-05-18
tags: [uncategorized]
related: []
owner: gabriel
related_files: []
---

# Pipe Confirmacao

## O que é

Kanban de confirmação de reunião. Lead que saiu do `pipe_whatsapp` com `agendado` entra aqui pra ser confirmado em D-5 → D-3 → D-1 → `compareceu` (ou `nao_compareceu`/`reagendado`). Cada card tem `meeting_date` (data/hora da reunião), responsáveis (SDR/Closer/Responsible) e status de etapa.

## Como funciona

```
agendado (do pipe_whatsapp) → confirmar_d5 → confirmar_d3 → confirmar_d1
   → compareceu  (entra em pipe_propostas)
   → nao_compareceu
   → reagendado
```

A página `PipeConfirmacao.tsx` renderiza Kanban (drag entre stages) ou MeetingTimeline (linha do tempo 7×24). Edição de data/hora via `ConfirmacaoContext` no drawer; reagendamento full-form via `RescheduleModal`.

## Contrato de fonte da verdade — `meeting_date` ⇄ `compromisso_date`

> Fonte operacional: **`pipe_confirmacao.meeting_date`**.
> Espelho legacy: **`leads.compromisso_date`** (mantido pra retrocompatibilidade de telas/relatórios que ainda leem do lead).

Sync é **client-side** em hooks centrais. Sem trigger DB, sem RPC. Direção bidirecional, mas com regras assimétricas:

| Origem | Hook | Alvo | Operação |
|--------|------|------|----------|
| Pipe → Lead | `useUpdatePipeConfirmacao` | `leads.compromisso_date` | UPDATE (entrada existe sempre) |
| Lead → Pipe | `useUpdateLead` | `pipe_confirmacao.meeting_date` | UPDATE puro best-effort (afeta 0 linhas se não existir entrada — **nunca insert/upsert**) |

Ambos os syncs filtram por `.eq("organization_id", organizationId)` defensivamente. Idempotência via UPDATE no-op + last-write-wins. Aceita pequena race window (sub-segundo) entre as duas escritas — não há transação cross-tabela.

## Permissão `move_pipe_record` — SELECT-then-compare em fail-closed

`useUpdatePipeConfirmacao` antes bloqueava qualquer payload com `updates.status` setado, mesmo quando o status efetivo não mudava (ex: usuário só mexia `meeting_date` mas o form mandava o objeto inteiro). Membros sem `move_pipe_record` viam falsos "sem permissão".

Lógica atual:

1. Se `updates.status !== undefined` → SELECT `current.status` da row pelo `id`.
2. Se `current.status === payload.status` → remove `status` do payload (não conta como movimento).
3. Se `current.status !== payload.status` → consulta `move_pipe_record`. **Fail-closed**: bloqueia também enquanto a permissão ainda está em loading (`movePermission === undefined`).
4. SELECT falha ou row não encontrada → erro genérico "Registro não encontrado" (não vaza diferença "não existe" vs "sem permissão").

> Decisão de design: opção (b) — hook detecta mudança real fazendo SELECT do estado atual. Architect propôs (c) "caller omite", Security vetou por bypass trivial. Detalhes em [[ADR-2026-04-30-meeting-date-sync]].

> Atenção: a barreira final continua **client-side**. Caller que pule o hook pode mudar `status` direto. Issue HIGH em [[move-pipe-record-server-side]] pra fechar gap server-side (trigger DB ou RPC SECURITY DEFINER).

## Regras de negócio

- `meeting_date` aceita `null` (deleta a reunião — sync apaga `compromisso_date` também).
- `status` só transita com `move_pipe_record`. Edição-só-de-data é livre pra qualquer membro com acesso ao card.
- `compromisso_date` no form de Leads (Edit Lead) propaga pro pipe **apenas se** existir entrada em `pipe_confirmacao` para esse lead.
- Trigger automation (`triggerFollowUpAutomation`) dispara apenas em **mudança real** de status, não em UPDATE no-op.
- Workflow trigger `stage_changed` dispara client-side em `triggerStageChangedWorkflows` + server-side em `trg_workflow_stage_changed_confirmacao`. Risco de duplicidade tracked em [[triggerStageChangedWorkflows-duplicate]].

## Microcopy de erro

- `ConfirmacaoContext`: erro com `Sem permissão` é convertido em mensagem amigável: _"Você pode editar a data sem mudar a etapa do funil. Para mover entre etapas, peça permissão a um admin."_
- `RescheduleModal` ainda usa toast genérico — refinar em [[microcopy-reschedule-modal]].

## Arquivos chave

- `src/pages/PipeConfirmacao.tsx` — Página Kanban + MeetingTimeline. State usa `selectedItemId` (não `selectedItem` — evita stale após refetch).
- `src/hooks/usePipeConfirmacao.ts` — `useUpdatePipeConfirmacao` é o hook crítico (sync + permission gate).
- `src/hooks/useLeads.ts` — `useUpdateLead` propaga `compromisso_date → meeting_date`.
- `src/components/leads/funnel-contexts/ConfirmacaoContext.tsx` — Form inline no drawer com microcopy custom.
- `src/components/leads/RescheduleModal.tsx` — Modal full-form de reagendamento.

## Edge cases conhecidos

- Membro sem `move_pipe_record` editando só data/hora → permitido (CR-1 fixado em 2026-04-30).
- `compromisso_date` mudada via Edit Lead sem entrada em `pipe_confirmacao` → UPDATE 0 linhas, sem erro, sem insert (Security D5).
- `meeting_date = null` em `useUpdatePipeConfirmacao` → sync escreve `compromisso_date = null` em `leads`.
- Sync inverso (`useUpdateLead`) falha silenciosa — apenas `console.warn`. Tracked em [[toast-sync-inverso-falha]].
- Permission ainda em loading quando user clica → bloqueia (fail-closed). UX: spinner ou desabilitar até carregar.
- Race window sub-segundo entre UPDATE no pipe e UPDATE no lead — last-write-wins.

## Crédito de comparecimento e snapshot (DB trigger)

> A partir de 2026-05-18 (PRD #211 / #212), o crédito de reunião é
> **congelado no banco por um trigger**, capturado em dois eventos:
> criação do entry e transição final para `compareceu`. Lead = fonte da
> verdade; metadata = snapshot histórico.

### Regra do trigger `snapshot_responsible_from_lead`

| Evento | Ação |
|--------|------|
| `INSERT pipeline_entries` (slug=`confirmacao`) | Copia `leads.pre_sale_responsible_id` → `metadata.pre_sale_responsible_id` |
| `UPDATE OF stage_key` → `compareceu` (slug=`confirmacao`) | Re-lê o lead e sobrescreve `metadata.pre_sale_responsible_id` |
| `INSERT pipeline_entries` (slug=`propostas`) | Copia `leads.sale_responsible_id` → `metadata.sale_responsible_id` |
| `UPDATE OF stage_key` → `vendido` (slug=`propostas`) | Re-lê o lead e sobrescreve `metadata.sale_responsible_id` |

O trigger **nunca** lê nem escreve `sdr_id` / `closer_id` / `responsible_id`
legacy. Detalhes da decisão em [[ADR-2026-05-18-snapshot-responsible]].

### Popup "Nova Reunião" (AddMeetingModal)

O campo era "Responsável" (semântica ambígua). Agora é **"SDR (pré-venda)"**.
Comportamento:

- Quando o lead é selecionado, o campo é pré-preenchido com
  `leads.pre_sale_responsible_id` do lead.
- No submit, se o valor selecionado difere do lead atual, o lead é
  atualizado **primeiro** (via `useUpdateLead`) e só depois a entry é
  criada. O trigger captura o valor já atualizado.
- Caller pode passar `prefilledResponsibleId` para forçar uma escolha
  inicial (não consultando o lead). O lead é atualizado no submit se o
  valor escolhido diverge.
- Não há campo Closer no popup — closer é definido por outros caminhos.

## Atribuição de mérito de comparecimento

> Regra de negócio: **o mérito da reunião comparecida é do SDR (quem agendou)**.
> O closer continua com mérito de proposta/venda (revenue). Reuniões e vendas têm donos diferentes.

### Campos canônicos

| Atribuição | Campo canônico | Fallback legacy | Use |
|------------|----------------|-----------------|-----|
| Comparecimento (SDR) | `pre_sale_responsible_id` | `sdr_id` | Métricas de meetings, ranking SDR, metas reuniões |
| Venda (Closer) | `sale_responsible_id`  | `closer_id`, `responsible_id` | Métricas de revenue, ranking Closer, metas vendas |

`responsible_id` **NÃO** é fallback válido para crédito de comparecimento. Em várias orgs ele guarda o closer e creditaria o time errado.

Pipe `confirmacao` vive em `pipeline_entries` (slug=`confirmacao`, type=`system`). Frontend lê via view compat `pipe_confirmacao`. Ambos dual e legacy ids ficam em `pipeline_entries.metadata`.

### Bug histórico (corrigido em 2026-05-18)

A migration `20260982000000_drop_legacy_pipe_tables.sql` (Phase 4 da unificação de pipelines) recriou `get_ranking_data` sobre `pipeline_entries` mas **regrediu** o fix de SDR-only que a `20260930000000_dual_responsible_fields.sql` havia aplicado. A versão pós-20260982 expandia cada reunião em 3 rows (`responsible_id`, `sdr_id`, `closer_id`) e contava DISTINCT — creditando o closer.

Fix: `20261024000000_fix_meetings_ranking_sdr_only.sql` recria `get_ranking_data` e `get_dashboard_metrics`:

- Meetings ranking: `COALESCE(pre_sale_responsible_id, sdr_id)` **exclusivamente**.
- Dashboard meetings filter (`p_filter_member_id`): mesma regra.
- Reuniões sem `pre_sale_responsible_id` nem `sdr_id` caem no bucket "sem SDR" (não creditadas a ninguém — explicitamente intencional).
- Backfill: `pipeline_entries.metadata.pre_sale_responsible_id` ← COALESCE com `sdr_id`/`responsible_id` quando faltando; idem `sale_responsible_id` com `closer_id`/`responsible_id`. Idempotente.

### Frontend — hooks que filtram por SDR

| Arquivo | Filtro correto |
|---------|----------------|
| `src/hooks/useGoals.ts` (meetingsGoals.currentValue) | `pre_sale_responsible_id \|\| sdr_id` |
| `src/hooks/useDashboardMetrics.ts` (useConversionRates meetings) | `pre_sale_responsible_id \|\| sdr_id` |
| `src/hooks/useCommissions.ts` (metric_type=meetings) | `pre_sale_responsible_id \|\| sdr_id` |
| `src/hooks/useTVDashboardData.ts` (meetingsGoalsCalc) | `pre_sale_responsible_id \|\| sdr_id` |
| `src/hooks/useRecentActivity.ts` ("Reunião realizada") | `pre_sale_responsible \|\| sdr` |

> Nota: comissões não foram alteradas no aspecto de % por venda. Membros `metric_type='meetings'` (SDR) continuam contando reuniões comparecidas pela mesma regra acima — sem mudança de payout.

## Histórico de mudanças

- 2026-05-18 (lote 3 — PRD #211 / #212) — Trigger `snapshot_responsible_from_lead` instaurado em `pipeline_entries` (BEFORE INSERT OR UPDATE OF stage_key). Captura `leads.pre_sale_responsible_id` na criação do entry e na transição final para `compareceu`. Análogo para `propostas`/`vendido` com `sale_responsible_id`. `get_ranking_data` e `get_dashboard_metrics` reescritas sem nenhum fallback legacy (sdr_id/closer_id/responsible_id removidos). Backfill idempotente remove keys legacy de metadatas que já têm dual populado. `AddMeetingModal` rotulado "SDR (pré-venda)", pré-preenche a partir do lead e atualiza o lead antes do insert. Ver [[ADR-2026-05-18-snapshot-responsible]] + `supabase/migrations/20261025000000_snapshot_responsible_from_lead.sql`.
- 2026-05-18 — Fix mérito SDR-only para comparecimento. RPC `get_ranking_data` + `get_dashboard_metrics` recriadas (`20261024000000_fix_meetings_ranking_sdr_only.sql` — timestamp pós-`20261023000000` pra sobreviver a replay/reset, já que `20260982` recriava com bug). Backfill de `pre_sale_responsible_id` / `sale_responsible_id` em `pipeline_entries.metadata` e `leads`. Hooks `useGoals`, `useDashboardMetrics` (`useConversionRates`), `useRecentActivity` ajustados pra não usar `responsible_id` como fallback de crédito de reunião. Ver `07 — Changelog/2026-05-18.md`.
- 2026-04-30 — Fix sync `meeting_date` ⇄ `compromisso_date` + `move_pipe_record` SELECT-then-compare fail-closed. 4 arquivos. 4 causa-raízes identificadas (CR-1 falso bloqueio em edit-só-de-data, CR-2 sem sync cross-tabela, CR-3 selectedItem stale, CR-4 form de Leads não propagava). Ver [[2026-04-30-meeting-date-sync]] e [[ADR-2026-04-30-meeting-date-sync]].
