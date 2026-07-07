# Spec — Refundação do Sistema de Métricas (Torque CRM)

**Data:** 2026-07-02
**Origem:** `RELATORIO-AUDITORIA-METRICAS-2026-07-02.md` (24 inconsistências confirmadas, 6 causas-raiz).
**Objetivo:** resolver todas as 6 causas-raiz sem exceção, de forma incremental, dev-first, com validação de reconciliação e rollback antes de qualquer prod.

---

## 1. Princípio único

Três **cadernos permanentes** (tabelas append-only, imutáveis) viram a fonte da verdade. Nenhuma tela recalcula — todas leem os cadernos via RPCs canônicas.

- `meeting_events` — já existe (ADR-0007). Reunião. Padrão a replicar.
- `pipeline_stage_events` — **novo.** Toda transição de etapa vira linha imutável.
- `sale_events` — **novo.** Toda venda (won/lost) vira linha imutável com atribuição snapshot.

Estado atual (`pipeline_entries.stage_key`) continua existindo para o kanban (é a projeção "agora"). Métrica deixa de ler estado e passa a ler eventos.

## 2. Causas-raiz → solução

| Raiz | Problema | Solução |
|---|---|---|
| R1 | Funil = estado mutável (retroage) | `pipeline_stage_events` imutável; funil lido por `occurred_at` |
| R2 | `stage_key` string editável, hardcoded, sem FK | Flags governadas em `pipeline_stages` + FK; métrica filtra por flag |
| R3 | Custom pipelines invisíveis (`type='system'`) | Remover o predicado das definições; parametrizar por `pipeline_id` |
| R4 | Zoo de âncoras + `updated_at` não-determinístico | 1 âncora canônica por métrica, gravada no evento; proibir `updated_at` |
| R5 | 5+ chaves de atribuição; soma ≠ total | Snapshot de atribuição no evento; 1 chave por papel; invariante testada |
| R6 | Dupla fonte da verdade (meeting/status; comissão) | Evento = SoT única; comissão vira projeção via trigger |

## 3. Arquitetura-alvo

### 3.1 Cadernos (write model)
- `pipeline_stage_events (id, org_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, actor_id, source)` — append-only, gravado por trigger `AFTER INSERT/UPDATE OF stage_key ON pipeline_entries`. Backfill inicial de `lead_history`.
- `sale_events (id, org_id, lead_id, pipeline_id, event_type[sale_won|sale_lost], sale_value, currency, closer_snapshot, sdr_snapshot, sold_at, occurred_at, loss_reason)` — append-only, gravado por trigger ao entrar em stage `is_won`/`is_lost`. `sold_at` fixado no momento (mata `updated_at`).

### 3.2 Etapa governada
- `pipeline_stages` ganha: `is_won`, `is_lost`, `is_meeting_booked`, `is_meeting_held` (bool), `stage_role` (enum), `win_probability` (numeric).
- FK composta `pipeline_entries(pipeline_id, stage_key) → pipeline_stages(pipeline_id, stage_key)`.
- Backfill mapeia as `stage_key` atuais para as flags.

### 3.3 Camada de leitura canônica (read model)
- Uma RPC por métrica lendo **só** dos cadernos + stages governados: `get_funnel_flow`, `get_sales_metrics`, `get_meeting_metrics`, `get_ranking`, `get_commission_ledger`.
- 1 âncora de data por métrica, declarada e fixa. Coorte real (mesma população fluindo).
- Frontend/TV consomem; **nunca recalculam** ticket/conversão client-side.

### 3.4 Comissão como projeção
- Trigger no `sale_event` grava linha em `commissions` com a atribuição canônica. Ledger == cálculo, por construção.

### 3.5 Governança
- Suite de invariantes no CI (`tests/integration` + `tests/sql` pgTAP): `soma(membro)+não-atribuído == total`; toda taxa ∈ [0,100]; funil monotônico; `Dashboard == Financeiro == Ranking` no mesmo período.
- Rollups incrementais (matview via pg_cron) — remove custo O(n)/request e teto de 500 da TV.
- Camada semântica (tooling a decidir na fase): tabela `metric_definitions` nativa vs dbt Core.

## 4. Protocolo de rollout (decisão do CTO)

**Big-bang por fase, mas com portão de validação rigoroso e rollback.** Toda fase:

1. **Migration reversível** — cada `CREATE OR REPLACE FUNCTION` acompanha script de restauração da versão anterior em `supabase/migrations/rollback/`. RPCs antigas permanecem vivas até o novo validar.
2. **Harness de reconciliação** — script que roda motor novo vs velho sobre snapshot de dados reais (leitura) e prova igualdade célula-a-célula, ou lista e justifica cada delta. Gate obrigatório.
3. **Testes exaustivos** — invariantes + reconciliação verdes no CI antes de prod.
4. **Deploy** — só com verde; dev (`bcfadphgsibjzivtbjvc`) primeiro, prod (`jsjsmuncfkbsbzqzqhfq`) só com pedido explícito após reconciliação.

## 5. Decomposição em sub-projetos (ordem de execução)

Cada sub-projeto: spec → plano → implementa → valida/reconcilia → sobe. Independentemente shippável.

- **SP-0 · Quick wins** (sem schema, baixo risco) — detalhado em §6.
- **SP-1 · Caderno de etapa + etapas governadas** — `pipeline_stage_events`, flags, FK, backfill, triggers. Mata R1, R2, R3.
- **SP-2 · Venda-evento + atribuição + comissão** — `sale_events`, atribuição canônica, comissão-projeção. Mata R4, R5, R6.
- **SP-3 · Leitura canônica** — `get_funnel_flow` + RPCs canônicas + fim do recompute client-side + custom pipeline.
- **SP-4 · Governança** — camada semântica + invariantes no CI + rollups.
- **SP-5 · 2ª auditoria** — 11 superfícies (multi-moeda, Financeiro, soft-delete geral, Carteira, timezone, Copilot metrics, campanhas, gamificação, coaching, MRR billing, webhook delivery).

## 6. SP-0 — Quick wins (escopo desta primeira entrega)

Fixes isolados, sem schema novo, cada um com teste. Ordem por confiança:

| # | Fix | Alvo (definição VIVA confirmada) | Ação |
|---|-----|----------------------------------|------|
| 6 | Transição "Reunião → Proposta" sempre 100% | `20261114000011:1814` (`get_analytics_pipeline_metrics`, 2 blocos: ~1798 e ~1850) | Adicionar CTE `proposta_count` (leads que alcançaram propostas); corrigir `Reunião→Proposta = proposta/attended` e `Proposta→Venda = won/proposta` |
| 22 | `get_segment_benchmark` sem `assert_org_access` | `20260327100004` + confirmar redefinição mais recente | Adicionar guard no topo, mantendo saída agregada |
| 7 | Automação usa stage morto `confirmada_no_dia` (typo) | `20260982000000:1106` (`get_leads_not_confirmed`) | Excluir por `metadata->>'is_confirmed' = 'true'`, não pela string morta |
| 12 | `get_pipeline_velocity` ignora `p_pipeline_type`; win_rate cruza janelas; ticket ÷100 | `analytics_reports.sql` (`get_pipeline_velocity`) | Fazer o param filtrar; win/den na mesma janela; revisar suposição de centavos |
| 23 | TV: `base_ativa` hardcoded 0; "Respostas" conta stage `abordado` | `useTVKPIs.ts` / `useTVDashboardData.ts` | Remover/ligar `base_ativa` a métrica real; "Respostas" → replies reais de `conversation_messages` |
| — | Soft-delete leak: RPCs antigas não filtram `deleted_at` | `get_dashboard_metrics`, `get_analytics_overview_metrics`, financial (defs vivas) | Adicionar filtro `deleted_at IS NULL` / `is_shadow` |

**Reversibilidade SP-0:** todos são `CREATE OR REPLACE FUNCTION` ou edição de hook — rollback = restaurar corpo anterior (guardado em `rollback/`). Nenhuma tabela alterada.

**Testes SP-0:** cada fix ganha teste em `tests/integration` (ou `tests/sql` pgTAP): p.ex. `Reunião→Proposta` nunca == 100% trivial; `get_leads_not_confirmed` exclui lead com `is_confirmed=true`; `get_segment_benchmark` rejeita org sem acesso.

## 7. Fora de escopo (agora)

- Migração de dados históricos além do backfill necessário por fase.
- Escolha final da ferramenta de camada semântica (decidida em SP-4).
- Redesign visual dos dashboards (só correção de números; UI só onde o número é lido).

## 8.5 Decisões do grill 2026-07-07 (CTO) — vinculantes

Registradas em **ADR-0017** (modelo de eventos) e **ADR-0018** (protocolo snapshot). Resumo:

1. **SP-0.5 (novo, antes de SP-1):** snapshot das RPCs de métrica VIVAS de prod (`pg_get_functiondef`) commitado como migrations `snapshot_*` datadas corretamente. Prod = source of truth de corpo de RPC até reconciliação geral. NÃO fazer db push dos arquivos SP-0 mis-datados (ADR-0018).
2. **SP-0.6 (novo, antes de SP-1):** guardrail CI — lint de migrations bloqueando `type='system'` em métrica, COALESCE de atribuição, `updated_at` como âncora, agregação de receita fora dos cadernos + regra documentada em `supabase/migrations/CLAUDE.md`.
3. **Etapa governada = enum único `stage_role`** (`open|meeting_booked|meeting_held|won|lost`), NÃO flags booleanas paralelas (§3.2 fica emendada). `is_final_positive/negative` viram UI-only, proibidas como input de métrica. Atribuição de role: mapa determinístico (chaves de sistema) + AI Stage Classifier sugere pra custom + confirmação humana obrigatória só em won/lost.
4. **Revenue Stream** obrigatório em todo `sale_event`: `novo_negocio` vs `carteira`, decidido **pelo cliente** (lead já tem Carteira Client no momento da venda → carteira), não pelo funil. Um caderno só; dashboards exibem os streams separados; total = soma. Mata a segunda superfície de receita da Carteira.
5. **Estorno por evento** (`sale_reversed` referenciando o original; par se anula na leitura; cascateia pra comissão projetada). Nunca editar/apagar evento.
6. **`sold_at` = momento do registro, sempre** (`now()` no write). Sem data retroativa informável, sem exceção.
7. **Timezone da org**: coluna `organizations.timezone` (default America/Sao_Paulo); corte de período é responsabilidade EXCLUSIVA do banco; frontend nomeia período, nunca converte data.
8. **Backfill best-effort com corte contratual 2026-12-01**; eventos reconstruídos com `source='backfill'`; antes do corte = melhor esforço declarado.
9. **Portão de reconciliação = delta-explicado + invariantes**: toda célula divergente do motor velho vinculada a finding numerado da auditoria ou decisão desta seção, senão reprova; + suite de invariantes no CI. Lista de deltas justificados commitada junto da migration.

Ordem final: **SP-0.5 → SP-0.6 → SP-1 → SP-2 → SP-3 → SP-4 → SP-5.**

## 8. Critério de sucesso do programa

`Dashboard == Financeiro == Ranking == Produtividade` para o mesmo período/org; `SUM(por membro) + não-atribuído == total`; toda taxa ∈ [0,100]; comissão paga == número na tela; org com pipeline custom vê métrica real; renomear etapa não zera métrica. Tudo coberto por invariantes no CI.
