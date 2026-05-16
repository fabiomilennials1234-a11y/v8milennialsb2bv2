---
type: adr
title: ADR-2026-04-30 — Sync meeting_date ⇄ compromisso_date + permissão move_pipe_record fail-closed
status: accepted
created: 2026-04-30
updated: 2026-04-30
tags: [uncategorized]
related: []
owner: gabriel
---

# ADR-2026-04-30 — Sync meeting_date ⇄ compromisso_date + permissão move_pipe_record fail-closed

**Data:** 2026-04-30
**Status:** aceita

## Contexto

`pipe_confirmacao.meeting_date` (data/hora da reunião no Kanban) e `leads.compromisso_date` (mesmo dado replicado no lead, leitura legacy) divergiam silenciosamente. 4 causa-raízes em 4 arquivos diferentes. Sintoma reportado pelo time: reagendar reunião "às vezes funciona, às vezes não", e membros sem `move_pipe_record` recebiam falsos "sem permissão" ao tentar mexer só na data.

Ver detalhe técnico em [[2026-04-30-meeting-date-sync]].

## Forças em jogo

**Restrições do CTO:**
- Sem mudança de schema (sem migration nova).
- Sem RPC nova (sem deploy server-side).
- Sem refactor amplo — fix cirúrgico nos hooks que já são ponto natural de mutação.
- Sem reescrita do form de Leads ou do Kanban.

**Restrições do Security:**
- Defesa em camadas. Não confiar no caller pra omitir campos sensíveis.
- Fail-closed por padrão — em loading, em dúvida, em erro: bloqueia.
- Filtros `.eq("organization_id")` defensivos em qualquer UPDATE cross-tabela, mesmo quando RLS já cobre.
- Payload literal em sync inverso (sem spread). Operação `update` puro, nunca `upsert`/`insert`.

**Restrições técnicas:**
- React Query como cache; sem fonte única transacional cross-tabela.
- RLS de `pipe_confirmacao` valida tenant + visibilidade, **não** valida `move_pipe_record` em column-level.

## Opções consideradas

### Opção (a) — Trigger DB sincroniza `compromisso_date` ⇄ `meeting_date`
Vantagem: barreira server-side absoluta, transacional.
Desvantagem: nova migration em prod (~30 orgs ativas), risco de loop infinito entre dois triggers, escalada de complexidade no schema. CTO descartou.

### Opção (b) — SELECT-then-compare dentro do hook + sync client-side ⭐ ESCOLHIDA
Hook faz SELECT do row atual antes do UPDATE, compara `current.status` vs `payload.status`, decide se é movimento real. Sync nas duas direções via UPDATE puro best-effort.
Vantagem: zero migration, fix cirúrgico, fecha o falso positivo.
Desvantagem: barreira final continua client-side (gap conhecido); race window sub-segundo aceita.

### Opção (c) — Caller omite `status` do payload em edit-só-de-data
Form responsável por mandar apenas o que mudou. Hook fica mais simples.
Vantagem: hook trivial.
Desvantagem (vetada por Security): bypass trivial — qualquer caller (componente novo, agente IA, script) pode mandar `status` "sem querer" e disparar o gate em path errado. Responsabilidade no lugar errado.

### Opção (d) — RPC `SECURITY DEFINER` com check interno + revoke do UPDATE direto da coluna `status`
Vantagem: barreira server-side absoluta com pequena superfície (uma RPC).
Desvantagem: deploy server-side, refactor de todos os call sites de pipe (3 pipes padrão + N customizados). Registrado como **follow-up HIGH** em [[move-pipe-record-server-side]] — solução estrutural correta, mas fora do escopo deste fix.

## Decisão

**Adotada opção (b).** Detalhamento das sub-decisões:

### D1 — Fonte da verdade
`pipe_confirmacao.meeting_date` operacional; `leads.compromisso_date` espelho legacy.

### D2 — Sync client-side em hooks centrais
`useUpdatePipeConfirmacao` (pipe → lead) + `useUpdateLead` (lead → pipe). Sem migration, sem RPC.

### D3 — SELECT-then-compare em fail-closed (override Security sobre Architect)
Hook faz `select status` antes do `update`. Se igual, remove `status` do payload. Se diferente, checa `move_pipe_record` em fail-closed (bloqueia também em loading).

### D4 — `selectedItemId` substitui `selectedItem: any`
Lookup derivado do cache do React Query elimina state stale.

### D5 — Sync inverso é UPDATE puro best-effort
`useUpdateLead` propaga `compromisso_date → meeting_date` via UPDATE filtrado por `lead_id + organization_id`. Payload literal, sem spread, sem upsert/insert. Falha → `console.warn` apenas.

### D6 — Idempotência via UPDATE no-op + last-write-wins
Aceita race window sub-segundo entre as duas escritas.

## Consequências

### Positivas
- Falso positivo de permissão em edit-só-de-data eliminado.
- `meeting_date` e `compromisso_date` ficam alinhados em condições normais.
- Hook fica auditável — toda lógica em ponto único.
- Filtros defensivos de `organization_id` em todos os UPDATEs cross-tabela (defesa em profundidade).
- Microcopy de erro melhor no `ConfirmacaoContext`.

### Negativas
- Custo extra de 1 SELECT por UPDATE com `status` no payload (mitigado: SELECT em PK, índice clusterizado, < 1ms).
- Race window sub-segundo aceita.
- Barreira final continua client-side — gap server-side documentado em [[move-pipe-record-server-side]].
- Sync inverso falha silenciosa (apenas `console.warn`) — tracked em [[toast-sync-inverso-falha]].

### Pendências geradas
- HIGH: trigger DB ou RPC `SECURITY DEFINER` para fechar gap server-side ([[move-pipe-record-server-side]]).
- MEDIUM: testes unit dos paths SELECT-then-compare e sync ([[tests-unit-usePipeConfirmacao-useLeads-sync]]).
- MEDIUM: auditoria do fallback `allowed: true` em `src/lib/permissions.ts` ([[permissions-fallback-fail-closed]]).
- LOW: microcopy do `RescheduleModal` ([[microcopy-reschedule-modal]]).
- LOW: toast/Sentry no sync inverso ([[toast-sync-inverso-falha]]).
- LOW: dedupe `triggerStageChangedWorkflows` client-side vs server-side ([[triggerStageChangedWorkflows-duplicate]]).

## Alternativas rejeitadas

- **Trigger DB bidirecional** — descartada (CTO: sem migration neste fix).
- **Caller omite status** (opção c) — vetada por Security (bypass trivial).
- **RPC `SECURITY DEFINER`** — registrada como follow-up HIGH; solução estrutural correta para o gap, fora do escopo deste fix tático.
