# 2026-10-09 — Motivo da perda: porta única em toda movimentação humana

## Mudanças
- **Funis / perda (SCRUM-369, ADR-0017)**: toda movimentação HUMANA para etapa de perda pede o motivo — não só o arrastar do `/funil`. Cancelar = nada escrito; falha ao gravar o motivo = não move + toast.
- **Predicado único** `isEtapaDePerda` (`stage_role = 'lost'` OU `is_final_negative = true`). Pega funis cuja etapa de perda só tem a flag (Riofix/Mustang `perdido_desqualificado`). Só decide QUANDO perguntar — não decide desfecho (decisão B2d intacta).
- **Porta única** `LossReasonGateProvider` + `useLossReasonGate()` em `leads` (montado em `src/App.tsx`): `requestLossReason()` → `Promise<PerdaResolvida | null>` e `capturarMotivoDaPerda({ entryIds })` (pede + grava `loss_reason_id` + `loss_reason` no metadata).
- Call sites cobertos: `/funil` (useFunilMoveFlow), chat "Funis do lead", trilho do modal do lead, `DealDetailDialog`, painel do Negócio (mover etapa e botão "Perdeu" → `p_loss_reason`), menu "Marcar como perdido" do card, "Perdido" do funil mergeado, `useLeadPipeHandlers`, ação em massa (modo mover).
- `LossReasonDialog` fraco (motivo opcional) apagado.

- **Volta 1 (revisor+qa)**:
  - Nascer perdido fechado: etapa de perda fica DESABILITADA (title `ETAPA_DE_PERDA_INDISPONIVEL`) e nunca é default em todo seletor que cria negócio — `AddToFunilDialog`, `LeadPipeActions` (adicionar), `AddLeadToPipeModal`, `LeadModal`, `Leads.tsx` (novo lead), `LeadCreateForm`, `NewDealDialog`/`useAbrirNegocio` (`etapaDeAbertura` recusa no caminho programático).
  - `isEtapaDePerda`: flag legada só vale se `stage_role <> 'won'` (won+neg = ganho).
  - Trocar responsável (painel do chat, `useUpdateLead`) e atribuição em massa (`useBulkAssign`) invalidam `["lead-responsible-map"]` — a linha do inbox atualiza na hora.
  - Linha do inbox em modo unificado sem dono a afirmar volta a mostrar bolinha + nome da caixa.
  - `LossReasonGate`: falha na consulta do catálogo mostra erro + "Tentar de novo" e trava Confirmar (fallback de slugs só com catálogo vazio de verdade).
  - `useFunilMoveFlow`: porta fechada emite um toast só (`portaAberta` no hook).
  - (Revertido na volta 2) guarda `IF NOT EXISTS` no trigger.
- **Volta 2**:
  - Trigger `trg_unarchive_on_inbound` volta à forma v1: TODO acesso a `whatsapp_conversations` dentro do BEGIN…EXCEPTION. A guarda fora do bloco abortava o INSERT da mensagem com 55P03 (lock_timeout 8 s + AccessExclusive pendente) ou 42703 (drift) — provado em PG 16 nativo; teste PGlite de drift de coluna com controle positivo.
  - `SocialCreateLeadDialog` (lead do Instagram): etapa de perda desabilitada + guarda no `canSubmit`.
  - `useLeadPipeHandlers.addToPipeline`: guarda própria recusa etapa de perda (toast), não só a UI.

## Arquivos tocados
- `src/contracts/pipe/perda.ts` — regra pura (antes `pipelines/lib/loss-reason.ts`, que virou re-export) + `isEtapaDePerda`, `patchDaPerda`, fallback.
- `src/integrations/supabase/entry-metadata.ts` — `patchEntryMetadata` (antes `pipelines/lib/entry-metadata.ts`, que virou re-export).
- `src/modules/leads/loss-reason-gate/*` — provider, hook, diálogo, persistência, helper de teste.
- `src/modules/leads/lib/etapa-de-perda.ts` — adaptador do shape de `useLeadAllPipelines`.

## Decisões
- A porta mora em `leads` (não em `pipelines`): `leads` não importa `pipelines` (PipeOpsPort). Catálogo vem por `usePipeOps().useLossReasons`.
- Massa no modo ADICIONAR (lista de leads, `bulk_add_to_pipeline`): etapa de perda fica indisponível — o RPC decide quais negócios move/cria e não há como gravar o motivo antes.

## Follow-ups
- Import CSV ainda aceita etapa de perda.
- `BulkAssignDialog` manda `sale_responsible_id` que `useBulkAssign` ignora (tipo pede `closer_id`) — herdado da main.
- Port para `classic/` (Clássica não recebe fix automaticamente).
- RPC de bulk aceitar `p_loss_reason` (hoje N×2 idas ao banco por lote, em grupos de 5).
- Automações/backend que movem para perda seguem sem motivo (fora do escopo).
