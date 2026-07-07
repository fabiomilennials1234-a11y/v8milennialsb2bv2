---
tipo: changelog
data: 2026-07-07
área: pipelines / identity (master)
tags: [changelog, metrics, stage-role, classifier, master, adr-0017, adr-0006]
---

# #991 — Stage Role Classifier + revisão master won/lost (PRD #986)

Fatia da refundação de métricas (ADR-0017 §1): etapas **custom** ganham
`stage_role` sugerido pelo AI Stage Classifier (padrão ADR-0006), com a regra
de ouro **won/lost = dinheiro = confirmação humana obrigatória**.

## Pendências de ativação (operador)

1. **Migration** — aplicar `20270302000020_pipeline_stages_stage_role_suggestions.sql`
   (depende do #990 `20270301000020`). Rollback em `migrations/rollback/`.
2. **Deploy edge** — `supabase functions deploy classify-stage-roles --project-ref <ref>`
   (verify_jwt=false no config.toml; auth `x-cron-secret`). Requer `OPENROUTER_API_KEY`
   para a passada IA (sem a key, roda só o determinístico).
3. **Backfill (~30 orgs, uma passada)** —
   `curl -X POST "$SUPABASE_URL/functions/v1/classify-stage-roles" -H "x-cron-secret: $CRON_SECRET" -d '{"all_orgs":true}'`
   (usar `{"all_orgs":true,"dry_run":true}` antes pra inspecionar o plano).
4. **Revisar a fila** — `/master/stage-roles` (sidebar master → "Etapas Won/Lost").

## O que mudou

- **Classifier determinístico** (fonte única Deno
  `_shared/metrics/stage-role-classifier.ts` + twin frontend em
  `pipelines/lib/stage-role-classifier.ts`, paridade pinada por teste):
  sinônimos pt-BR → fechado/ganhou/vendido/comprou/recomprou→won;
  perdido/desistiu/sem interesse→lost; reunião marcada/agendada→meeting_booked;
  compareceu/realizada→meeting_held; "não compareceu"/no-show→lost (negação
  vence). Flags `is_final_*` = sinal fraco de fallback (nome sempre vence);
  role nunca é derivado automaticamente delas.
- **Edge function `classify-stage-roles`** — 2 passadas (determinística → LLM
  via OpenRouter pro resíduo, temperature 0). Etapa de sistema NUNCA é tocada
  (role dela vem do mapa SQL do #990). meeting_* **auto-aplicam**; won/lost
  viram `suggested_stage_role` pendente. Guarda `.eq("stage_role","open")` no
  update evita sobrescrever role definido no meio-tempo.
- **Persistência** — 5 colunas em `pipeline_stages` (não tabela própria — estado
  1:1 efêmero; RLS existente já cobre): `suggested_stage_role`,
  `stage_role_suggested_at`, `stage_role_suggestion_source`
  (deterministic|ai|flag), `stage_role_reviewed_at/by` (trilha de auditoria +
  marcador anti-re-sugestão de etapa dispensada). Índice parcial pra fila.
- **Tela master `/master/stage-roles`** — fila won/lost agrupada por org,
  aprovar / corrigir (qualquer dos 5 roles) / dispensar. Payload de update sai
  de `buildReviewUpdate` (puro, testado): dismiss jamais carrega `stage_role`.
- **Modal de etapa** (`ManagePipelineStagesContent`, criar + editar) — dropdown
  "Papel nas métricas" (5 roles, labels pt-BR + descrição); etapa nova vem
  pré-preenchida pela sugestão do classifier ("Sugerido pelo nome") até o
  humano tocar no select; won/lost selecionável manualmente pelo admin
  (escolha explícita = confirmação permitida).

## Testes

- `tests/unit/stage-role-classifier.test.ts` — sinônimos (incl. aceite da
  issue), negações, flags, plano puro (won/lost nunca auto_apply, nem via IA).
- `tests/unit/stage-role-classifier-twin.test.ts` — paridade twin ⇄ canônico.
- `tests/unit/stage-role-review.test.ts` — agrupamento + invariante de
  confirmação humana.

Refs: `docs/adr/0017-event-sourced-sales-and-stage-metrics.md` §1,
`docs/adr/0006-copilot-followup-restructure.md` (amendment), migration #990.
