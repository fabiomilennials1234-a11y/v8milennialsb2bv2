---
tags: [changelog, fix, pipe-confirmacao, permissoes, security]
created: 2026-04-30
status: active
related:
  - "[[Pipe Confirmacao]]"
  - "[[Permissoes Sistema]]"
  - "[[ADR-2026-04-30-meeting-date-sync]]"
---

# 2026-04-30 — Sync meeting_date ⇄ compromisso_date + move_pipe_record fail-closed

## Problema

Reagendar reunião não persistia consistentemente. Sintomas relatados pelo time:

1. Membro sem `move_pipe_record` recebia "Sem permissão" ao tentar editar **só a data/hora** de uma reunião — mesmo sem tentar mover a etapa.
2. Editar `compromisso_date` no form de Leads não atualizava o card no Kanban de Confirmação.
3. Editar `meeting_date` no Kanban deixava o lead com `compromisso_date` antigo (visível em outras telas que ainda leem do lead).
4. Após salvar, abrir o drawer de novo mostrava data antiga em alguns casos (state stale).

### Causa-raiz

| ID | Onde | Causa |
|----|------|-------|
| CR-1 | `useUpdatePipeConfirmacao` | Checava `move_pipe_record` sempre que `updates.status` no payload. Form mandava o status atual mesmo em edit-só-de-data → falso bloqueio. |
| CR-2 | Cross-tabela | Não havia sync algum entre `pipe_confirmacao.meeting_date` e `leads.compromisso_date`. |
| CR-3 | `PipeConfirmacao.tsx` | `selectedItem: any` era state stale após refetch — drawer mostrava snapshot do momento do click. |
| CR-4 | `useUpdateLead` | Form de Leads salvava `compromisso_date` direto na tabela `leads` sem propagar pro pipe. |

## Decisões consolidadas

### D1 — Fonte da verdade
`pipe_confirmacao.meeting_date` é a **fonte operacional**. `leads.compromisso_date` permanece como **espelho legacy** (telas/relatórios antigos ainda leem dele).

### D2 — Sync client-side em hooks centrais
Sem migration, sem RPC nova, sem trigger DB. Duas escritas sequenciais nos hooks que já são o ponto natural de mutação. Custo aceito: race window sub-segundo + last-write-wins.

### D3 — Permissão SELECT-then-compare (Security override)
Architect propôs **opção (c)** — caller omite `status` do payload em edit-só-de-data. Security vetou: bypass trivial e responsabilidade no caller errado. Decisão final: **opção (b)** — hook detecta mudança real fazendo SELECT do row atual.

```ts
if (updates.status !== undefined) {
  const { data: current, error: selErr } = await supabase
    .from("pipe_confirmacao")
    .select("status")
    .eq("id", id)
    .single();
  if (selErr || !current) throw new Error("Registro não encontrado");
  
  if (current.status !== updates.status) {
    // Fail-closed: bloqueia também enquanto permission carrega
    if (!movePermission || !movePermission.allowed) {
      throw new Error("Sem permissão para mover registros no pipe");
    }
  } else {
    // status no payload mas igual ao atual — remove
    delete updates.status;
  }
}
```

### D4 — `selectedItemId` em vez de `selectedItem`
Trocamos `useState<any>(null)` por `useState<string | null>(null)` e fazemos lookup derivado em todos os call sites: `pipeData?.find((p) => p.id === selectedItemId)`. Item sempre fresco do cache do React Query, nunca stale.

### D5 — `useUpdateLead` propaga `compromisso_date → meeting_date`
- Operação: **`update`** puro. Nunca `upsert`/`insert`.
- Filtros: `.eq("lead_id", id).eq("organization_id", organizationId)`.
- Payload **literal**: `{ meeting_date: safeUpdates.compromisso_date }`. Nunca spread.
- Nunca toca `status`.
- Best-effort: se não há entrada em `pipe_confirmacao`, UPDATE afeta 0 linhas sem erro.
- Falha → `console.warn` (toast/Sentry tracked em [[toast-sync-inverso-falha]]).

### D6 — Idempotência via UPDATE no-op + last-write-wins
Sem versionamento, sem ETag. UPDATE com mesmo valor é no-op no Postgres. Em corrida sub-segundo, última escrita vence. Aceito explicitamente.

## Implementação por arquivo

### `src/hooks/usePipeConfirmacao.ts`
- Adicionou `useOrganization()` (necessário para filtros `.eq("organization_id")` defensivos).
- SELECT-then-compare antes do check `move_pipe_record`.
- Bloco `delete updates.status` quando status efetivo não mudou.
- `if (isStatusChange)` substitui o antigo `if (updates.status)` no gate.
- Sync `leads.compromisso_date` quando `updates.meeting_date !== undefined` (inclusive `null`).
- Filtros `.eq("organization_id")` adicionados em todos os UPDATEs cross-tabela.
- `triggerFollowUpAutomation` agora dispara apenas em `isStatusChange === true`.
- `onSuccess` invalida `["leads"]` além de `["pipe_confirmacao"]`.

### `src/hooks/useLeads.ts`
- Após `safeUpdates`, novo bloco condicional: se `compromisso_date !== undefined`, executa UPDATE puro em `pipe_confirmacao` filtrado por `lead_id + organization_id`.
- Erro só logado em `console.warn` (não propaga — sync inverso é best-effort).

### `src/pages/PipeConfirmacao.tsx`
- `useState<any>(null)` → `useState<string | null>(null)` para `selectedItemId`.
- Em `handleCardClick`, `MeetingTimeline.onMeetingClick`, e props do `LeadDetailDrawer`: lookup derivado via `pipeData?.find((p) => p.id === selectedItemId)`.

### `src/components/leads/funnel-contexts/ConfirmacaoContext.tsx`
- Catch do erro de update detecta `msg.includes("Sem permissão")` e troca toast genérico por mensagem amigável: _"Você pode editar a data sem mudar a etapa do funil. Para mover entre etapas, peça permissão a um admin."_

## Verificação Security S6

Frontend grep nas migrations de `supabase/migrations/` confirmou:

> Nenhum trigger DB recalcula `pipe_confirmacao.status` a partir de `meeting_date`.

Triggers existentes em `pipe_confirmacao`:
- `update_updated_at` — touch de timestamp.
- `enqueue_webhooks` — fanout de eventos.
- `dispatch_rules` — pipe rules engine.
- `sync_from_lead` / `sync_owners_to_lead` — sync de responsáveis.
- `stage_change` — log de transição (apenas em mudança de `status`).
- `validate_status` — guarda contra valores inválidos.
- `workflow_meeting_confirmed` — fire em `is_confirmed`, **não** em `meeting_date`.

Conclusão: sync de `meeting_date` **não** causa escalada implícita de stage server-side.

## Validação QA

| Item | Resultado |
|------|-----------|
| Critérios CTO | 9/9 ✓ |
| Edge cases | 11/11 ✓ |
| Veto Security | 10/10 cobertos (item 7 = issue HIGH backlog, não bloqueante) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors |
| `npm run test:unit` | 19 failed / 2878 passed (baseline pré-patch: 21 failed / 2876 passed — sem regressão; falhas remanescentes em domínios não relacionados) |

## Riscos remanescentes

1. **`move_pipe_record` continua client-side** — issue HIGH [[move-pipe-record-server-side]]. Caller que pule o hook ainda pode mudar `status` direto.
2. **Race window sub-segundo** entre UPDATE no pipe e UPDATE no lead. Aceito explicitamente; last-write-wins.
3. **Sync inverso falha silencioso** (`console.warn` apenas). Tracked em [[toast-sync-inverso-falha]].
4. **`triggerStageChangedWorkflows` client-side + trigger server-side** podem disparar workflows duplicados. Tracked em [[triggerStageChangedWorkflows-duplicate]].
5. **Fallback `allowed: true` em `src/lib/permissions.ts`** (linhas ~140 e ~207) viola fail-closed-por-padrão. Tracked em [[permissions-fallback-fail-closed]].
6. **Tests unit ainda não cobrem** os paths de SELECT-then-compare e sync. Tracked em [[tests-unit-usePipeConfirmacao-useLeads-sync]].

## Links

- Decisão arquitetural: [[ADR-2026-04-30-meeting-date-sync]]
- Feature: [[Pipe Confirmacao]]
- RBAC: [[Permissoes Sistema]]
- Daily: [[2026-04-30]]
