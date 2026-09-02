# Agenda como fonte única de reunião

Decisão do CTO (2026-09-01): **A1 + B3 + C1**.

- **A1** — toda reunião nasce como linha em `meetings`. Agenda deixa de juntar 5 fontes.
- **B3** — etapas de funil viram ESPELHO da agenda agora; corte das etapas fica pra depois,
  com dado na mão. Não é migração destrutiva nas 106 orgs neste momento.
- **C1** — migrar o histórico inteiro (o que tem data) para `meetings`.

## Estado medido em PROD (2026-09-01)

| | |
|---|---|
| `meetings` | 49 linhas, 36 orgs com `meeting_events` |
| `meeting_events` | 1582 (1162 booked / 420 held) |
| `pipe_confirmacao` | 507 (466 com data) — 98% coberto por `meeting_events` |
| Alvo da migração | **884** pares distintos (lead_id, meeting_date) |
| → completed | 359 (tem `meeting_held` vinculado) |
| → no_show | 498 (data passada, sem held) |
| → scheduled | 27 (futura) |
| FORA de alcance | 284 booked sem `meeting_date` — ficam só em `meeting_events` |

Sobreposição do alvo com `meetings` atual: **2 linhas**. Sem risco de colisão em massa.

## Causa-raiz que o plano ataca

Três verdades desconectadas:
1. `meetings` — agenda. Botão Compareceu/Não compareceu grava aqui. Ninguém lê.
2. `pipe_confirmacao` / etapa de funil — reunião "existe" por estar numa coluna.
3. `meeting_events` — livro de métricas. Escritor ÚNICO: `fn_capture_meeting_event`
   no trigger de `pipeline_entries`, com `stage_key` literal (`'agendado'`, `'compareceu'`).
   A coluna `stage_role` existe e é ignorada.

`get_dashboard_metrics` e `useSDRPerformance` leem SÓ `meeting_events`.
Logo: botão da agenda é decorativo para todo número do produto.

## Invariante de reconciliação (guarda de todas as fatias)

Para cada org e cada mês fechado, ANTES e DEPOIS de cada fatia:
- `reunioesMarcadas`, `reunioesComparecidas`, `noShow` de `get_dashboard_metrics`
  devem bater exatamente.
Qualquer divergência = rollback da fatia.

Por isso o backfill grava `no_show` nas 498 passadas-sem-held: hoje o no-show é
INFERIDO por essa mesma regra. Gravar `scheduled` zeraria o histórico de no-show.

## Fatias

### S1 — deep-link do lead (independente, zero risco)
`?id=` → `?lead=` em 4 call sites. `Leads.tsx:247` lê `lead`.
- `EventDetailPopover.tsx:372`, `LeadTabInfo.tsx:137`, `LeadTabTags.tsx:56`, `LeadTabHistory.tsx:38`

### S2 — marcar reunião direto do card (independente, zero risco)
`CreateMeetingDialog` ganha `leadId`/`leadName`. Item "Reunião" do `LeadCard.tsx:484`
abre o dialog em vez de `abrirFicha`.

### S3 — `meetings` ganha ponteiro de negócio + no-show de primeira classe
- `meetings.deal_id` (hoje só existe `lead_id` e `pipeline_id`)
- `meeting_events` CHECK passa a aceitar `meeting_no_show`
- PRECISA de branch do Supabase (Docker/local banidos)

### S4 — backfill C1 (884 linhas)
`meeting_events` + `pipe_confirmacao` → `meetings`, com `external_ref` apontando
a origem para reconciliação e rollback. Ensaio transacional contra prod primeiro
(BEGIN / migration / asserções / ROLLBACK).

### S5 — agenda vira escritora (A1)
Botão da agenda passa a emitir `meeting_events` (`meeting_held` / `meeting_no_show`)
além de `meetings.status`. Botão passa a aparecer em 100% dos eventos.
`get_agenda_events` volta a ter 1 fonte + overlay Google.

### S6 — espelho do funil (B3)
Movimento agenda → card. `fn_capture_meeting_event` passa a ler `stage_role`
em vez de `stage_key` literal, e deixa de ser o escritor canônico.

### S7 — gatilhos de workflow
`meeting_held` / `meeting_no_show` como `WorkflowTriggerType`, com trigger de banco
em `meeting_events`.
NOTA: `meeting_confirmed`/`meeting_not_confirmed` que já existem na UI são NÓS MORTOS —
nenhum `trg_workflow_meeting_*` está anexado em PROD. Decidir se conserta ou remove.

## Achado lateral a levar ao CTO

`whatsapp >> nao_compareceu` na Milennials tem nome "↩️ Remarcar" e `stage_role = lost`.
Quem não compareceu está sendo contado como PERDIDO.
