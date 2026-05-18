---
type: decision
title: Snapshot responsible via DB trigger
status: accepted
date: 2026-05-18
tags: [decision, db, trigger, snapshot, sdr, closer, attribution]
related:
  - "[[2026-05-18]]"
  - "[[Pipe Confirmacao]]"
  - "[[ADR-2026-04-30-meeting-date-sync]]"
owner: gabriel
---

# ADR — Snapshot responsible from lead via DB trigger

## Status

Accepted — 2026-05-18. Implements slice S1 of PRD #211 (issue #212). Slices
#213 (admin reassign RPCs) and #214 (legacy writers cleanup) build on top of
this contract.

## Contexto

### Causa-raiz

A migration `20260982000000_drop_legacy_pipe_tables.sql` (Phase 4 da
unificação de pipelines) removeu o trigger `sync_dual_responsible_to_lead_from_pipe`
junto com as tabelas `pipe_*` legacy. Esse trigger era a única peça que
mantinha `leads.pre_sale_responsible_id` / `leads.sale_responsible_id` em
sincronia com o que era escrito no pipe. Pós-remoção:

- O **lead** continuou sendo a fonte exibida nos avatares (Lead Card / Lead
  Detail Modal) — `pre_sale_responsible_id` / `sale_responsible_id`.
- As **métricas** (Dashboard, Ranking, TV) passaram a ler de
  `pipeline_entries.metadata.pre_sale_responsible_id` /
  `sale_responsible_id` — preenchido apenas pelos writers atuais (frontend
  hooks, webhooks, action handlers), sem garantia de paridade com o lead.
- O resultado em produção: org Milennials (e outras) viam o avatar trocar
  mas o ranking continuar premiando o antigo dono. Métrica deixou de
  refletir realidade.

Commit `e3ac4599` corrigiu o **leitor** (RPCs `get_ranking_data` /
`get_dashboard_metrics`, fix SDR-only) e fez **backfill retroativo** de
`metadata`. Não restituiu o **mecanismo prospectivo** de sincronização: novas
reuniões agendadas continuavam vulneráveis a divergir do lead.

Também, o `AddMeetingModal.tsx` no popup "Nova Reunião" pedia um
"Responsável" genérico — semanticamente ambíguo, sem amarração com
`leads.pre_sale_responsible_id`. SDR escolhido no modal não voltava pro lead.

### Restrições

- Multi-tenant: trigger não pode vazar entre orgs.
- Realtime: trigger não pode quebrar `pipeline_entries` em
  `postgres_changes` (subscribers do Kanban).
- Backwards compat: hooks legacy ainda escrevem `metadata.sdr_id` /
  `closer_id` / `responsible_id`. Cleanup amplo é S3/#214.
- Histórico imutável: reunião que aconteceu é mérito de quem agendou — não
  pode "trocar de dono retroativamente" só porque o lead foi reatribuído
  amanhã.

## Decisão

**Snapshot congelado por trigger DB, capturado em dois eventos: criação do
entry e transição final.**

### Regras invioláveis

| Evento | Ação |
|--------|------|
| `INSERT pipeline_entries` (slug=`confirmacao`) | Copia `leads.pre_sale_responsible_id` → `NEW.metadata.pre_sale_responsible_id` |
| `INSERT pipeline_entries` (slug=`propostas`) | Copia `leads.sale_responsible_id` → `NEW.metadata.sale_responsible_id` |
| `UPDATE OF stage_key` → `compareceu` (slug=`confirmacao`) | Re-lê `leads.pre_sale_responsible_id` e sobrescreve `NEW.metadata.pre_sale_responsible_id` |
| `UPDATE OF stage_key` → `vendido` (slug=`propostas`) | Re-lê `leads.sale_responsible_id` e sobrescreve `NEW.metadata.sale_responsible_id` |

### Não-regras (explícitas)

- Trigger **nunca** lê `sdr_id` / `closer_id` / `responsible_id` legacy do
  lead.
- Trigger **nunca** escreve campos legacy em `metadata`.
- Trigger **não** atua em outros stage transitions (intermediários,
  reversões, `perdido`, `remarcar`).
- Trigger **não** sincroniza lead ← entry. Direção é entry ← lead. Mudanças
  no lead são absorvidas apenas no próximo evento qualificado.

### Implementação

- Arquivo: `supabase/migrations/20261025000000_snapshot_responsible_from_lead.sql`.
- Função: `public.snapshot_responsible_from_lead()` —
  `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`.
- Trigger: `trg_snapshot_responsible_from_lead` —
  `BEFORE INSERT OR UPDATE OF stage_key ON public.pipeline_entries FOR EACH ROW`.
- Cross-tenant guard: a função compara `pipelines.organization_id` com
  `NEW.organization_id`; se divergir, retorna `NEW` sem escrever.

## Trade-offs descartados

### Alternativa A — Live JOIN nas RPCs (read-time)

`get_ranking_data` faria JOIN com `leads` e leria `pre_sale_responsible_id`
em runtime. **Descartado**:

- Quebra a propriedade de mérito histórico: reunião que aconteceu em janeiro
  com SDR A, atribuída em fevereiro para SDR B, perde o crédito de A
  retroativamente.
- Performance: mais um JOIN por linha em hot path.
- Não corrige métricas que dependem do `metadata` direto (Dashboard
  per-member filter, hooks `useCommissions`, etc.).

### Alternativa B — Cache sync via trigger lead → entry

Trigger em `leads` que propaga `pre_sale_responsible_id` para todas as
entries do lead. **Descartado**:

- Apaga histórico — mesma falha de A, agora em escrita.
- Cascata de updates em `pipeline_entries` cada vez que um lead muda de
  responsável. Subscribers de Realtime recebem flood.
- Conflito direto com a regra de negócio "mérito de comparecimento é de
  quem agendou".

### Alternativa C — Snapshot só em criação, sem refresh final

Mais simples, mas perde casos legítimos: lead criado sem SDR, atribuído
depois, então a reunião acontece. Refresh em transição final captura esse
fluxo comum.

### Alternativa D — Frontend fica responsável por preencher metadata

Status quo pré-fix. **Descartado**: já provou ser frágil — webhooks, action
handlers, modais e workflows escrevem em paths diferentes, sem garantia
homogênea.

## Consequências

### Positivas

- Métricas voltam a refletir realidade.
- Refresh em transição final captura "lead reatribuído entre marcação e
  acontecimento" — caso comum em vendas B2B.
- Lead = fonte da verdade single-writer. Frontend não precisa lembrar de
  duplicar a escrita no entry.
- Cleanup de legacy fica trivial (S3/#214 só precisa parar de escrever).

### Negativas

- Trigger `SECURITY DEFINER` precisa de auditoria extra em mudanças
  futuras. Documentado no comment da função.
- Entries criados antes do trigger continuam com snapshot histórico
  potencialmente errado. Mitigado pelo backfill em `e3ac4599`.
- Hooks ainda escrevem `metadata.pre_sale_responsible_id` / `sale_responsible_id`
  client-side, redundantemente. Trigger sobrescreve em INSERT (jsonb_set
  com `create_missing=true` força o key); coexistência é tolerada até S3.

### Riscos residuais

- Edge function bypassa o trigger? Não: trigger é DB-level, todo INSERT
  passa por ele. Mesmo `service_role` com RLS desligado dispara triggers.
- Trigger lê lead com RLS? Não — `SECURITY DEFINER` ignora RLS de leads,
  mas o filtro `organization_id = NEW.organization_id` mantém isolamento.
- Performance? Trigger faz 2 SELECTs (pipelines, leads) por INSERT em
  `pipeline_entries`. `pipelines` tem PK lookup (constante); `leads` tem PK
  lookup (constante). Custo desprezível.

## Plano de descomissionamento legacy

Fases ordenadas. Cada fase só inicia quando a anterior está em prod e
estável.

| Fase | Issue | Conteúdo |
|------|-------|----------|
| S1 (este slice) | #212 | Trigger + RPC cleanup + popup correção |
| S2 | #213 | RPCs admin: `admin_reassign_meeting_credit` / `admin_reassign_sale_credit` (reescreve snapshot manualmente em entries específicos) |
| S3 | #214 | Cleanup amplo de writes legacy nos hooks (`usePipeConfirmacao`, `usePipePropostas`, `usePipeWhatsapp`). `kanban-filters.ts` reduz 9→4 campos. |
| Fase B futura (PR separado) | TBD | Drop colunas legacy `leads.sdr_id`, `leads.closer_id`, `leads.responsible_id`. Backfill final, depois ALTER TABLE. |

## Invariantes pós-deploy

1. Para qualquer entry com `stage_key='compareceu'` (slug=`confirmacao`),
   `metadata->>'pre_sale_responsible_id'` reflete `leads.pre_sale_responsible_id`
   no momento da transição (ou da criação, se nunca transicionou).
2. Análogo para `vendido` (slug=`propostas`) com `sale_responsible_id`.
3. `get_ranking_data` lê apenas `pe.metadata->>'pre_sale_responsible_id'` /
   `sale_responsible_id`. Nenhum fallback legacy.
4. `get_dashboard_metrics` segue a mesma regra de leitura.
5. Hooks de cleanup futuro (S3) podem parar de escrever metadata sem
   prejudicar nenhuma métrica — o trigger garante o write authoritativo.

## Referências

- Issue PRD: #211.
- Slice deste ADR: #212.
- Follow-ups: #213, #214.
- Migration: `supabase/migrations/20261025000000_snapshot_responsible_from_lead.sql`.
- Test integration: `tests/integration/snapshot-responsible-lifecycle.test.ts`.
- Bug histórico antecessor: ver [[2026-05-18]] (commit `e3ac4599`).
- Feature note: [[Pipe Confirmacao]].
