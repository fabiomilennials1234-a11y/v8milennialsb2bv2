---
type: feature
title: Pipe Confirmacao
status: active
created: 2026-04-12
updated: 2026-04-12
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

## Histórico de mudanças

- 2026-04-30 — Fix sync `meeting_date` ⇄ `compromisso_date` + `move_pipe_record` SELECT-then-compare fail-closed. 4 arquivos. 4 causa-raízes identificadas (CR-1 falso bloqueio em edit-só-de-data, CR-2 sem sync cross-tabela, CR-3 selectedItem stale, CR-4 form de Leads não propagava). Ver [[2026-04-30-meeting-date-sync]] e [[ADR-2026-04-30-meeting-date-sync]].
