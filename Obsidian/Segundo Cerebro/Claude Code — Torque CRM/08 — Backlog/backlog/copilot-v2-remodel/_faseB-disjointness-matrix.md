---
title: "Fase B — Matriz de disjointness (paralelização das slices)"
feature: copilot-v2-remodel
phase: "B — Capabilities core"
status: ready
kind: orchestration
inputs: ["[[slice-03-tools-media]]", "[[slice-05-guardrails-handoff]]", "[[slice-06-asset-stores]]", "[[slice-07-ingestion-rag]]", "[[slice-11-proactivity]]"]
depends_on: ["[[slice-1H-harness-hardening]]"]
tags: [copilot-v2, fase-b, paralelizacao, disjointness, orchestration]
created: 2026-06-02
updated: 2026-06-02
---

# Fase B — Matriz de disjointness 🔀

> **Propósito**: cruzar os arquivos que cada plano da Fase B toca e dizer à fase de EXECUÇÃO quais slices rodam em **worktrees paralelas** (disjuntas) e quais **DEVEM serializar** (colisão de arquivo). Otimizado por throughput respeitando colisões. Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.
>
> **Insumo**: `filesTocados` REAIS dos 5 planners + leitura da seção `### Files` de cada plano. Os **5 planos estão `status: ready`** (execution-ready, TDD task-by-task) — [[slice-03-tools-media|3]], [[slice-05-guardrails-handoff|5]], [[slice-06-asset-stores|6]], [[slice-07-ingestion-rag|7]], [[slice-11-proactivity|11]].
>
> ⚠️ **Regeneração (2026-06-02)**: versão anterior estimava o footprint do [[slice-03-tools-media|Slice 3]] *antes* dele ser finalizado. **Slice 3 agora está finalizado e seu footprint é MENOR**: ele **não cria** `send-media-selector.ts`/`media-mime.ts` (dono = 6), **não cria** `handoff-routing.ts` (dono = 5), **não toca** `hybrid-search.ts`/`rag-threshold.ts`/RPC `match_*` (dono = 7). O foco próprio do Slice 3 é o par **`check_agenda_availability` + `schedule_meeting`** via Google Calendar + o módulo novo **`agenda.ts`** (exclusivo dele). Slice 3 é o **consumidor terminal** — apenas importa a infra de 5/6/7. Esta matriz reflete o footprint real reduzido.

---

## TL;DR — recomendação de execução

- **LEVA 1 (3 worktrees paralelas)** — [[slice-05-guardrails-handoff|5]] ║ [[slice-07-ingestion-rag|7]] ║ [[slice-11-proactivity|11]]. Disjuntas nos arquivos de escrita, exceto colisões **mecânicas append-only** (`copilot-v2-worker/index.ts` em regiões distintas entre 5×11; `config.toml` e `border-regression.test.ts` entre 7×11). Nenhuma sobreposição lógica → paralelizam com segurança.
- **LEVA 2 (serial, após 5/7/11)** — [[slice-06-asset-stores|6]]. Entra depois porque (a) toca `copilot-v2-worker/index.ts` (`makeExecutor` → `sendMediaViaProvider`) — o worker já tem as deps de 5/11 consolidadas; (b) toca `tool-executor.ts` HANDLERS (`send_media`) e 7 já entregou `search_knowledge` no mesmo objeto → ordem natural elimina a corrida de hunk.
- **LEVA 3 (serial, por último)** — [[slice-03-tools-media|3]], o **consumidor terminal**. Consome handoff-routing (5), send-media-selector/media-mime + schema/bucket `kind=audio` (6), RAG/`search_knowledge` (7). Footprint próprio pequeno e **sem migration**; toca `tool-executor.ts` (handlers `check_agenda_availability`/`schedule_meeting`/`handoff_to_vendedor`) e o worker (fiação de deps de I/O) — por isso vai por último, quando 6 já fechou o HANDLERS e o worker.

**Throughput ótimo**: 3 worktrees simultâneas (5, 7, 11) → merge sequencial (resolver hunks mecânicos) → worktree 6 → merge → worktree 3 → merge.

---

## Matriz de colisões (arquivo × slices)

Apenas arquivos tocados por **2+ slices**. `tool-executor.ts` e `copilot-v2-worker/index.ts` são os hotspots da fase.

| Arquivo | 3 | 5 | 6 | 7 | 11 | Natureza da colisão |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `_shared/copilot-v2/tool-executor.ts` | ✅ | — | ✅ | ✅ | — | **HOT — mapa `HANDLERS` + imports do topo**. 3 = `handoff_to_vendedor` + handlers de agenda (`check_agenda_availability`/`schedule_meeting`); 6 = handler real `send_media` (acervo-aware); 7 = handler real `search_knowledge` (RPC). Chaves diferentes no mesmo objeto → conflito textual mecânico. Ordem 7 → 6 → 3 elimina a corrida. |
| `copilot-v2-worker/index.ts` | ✅ | ✅ | ✅ | — | ✅ | **HOT — regiões diferentes do mesmo arquivo**. 5 = `processBatch` (deps judge/hitl/dispatchHandoff); 6 = `makeExecutor` (`sendMediaViaProvider` + `sendMediaReply`); 11 = `resolveContext`/produtor (edição localizada); 3 = `makeExecutor` (injeta deps de I/O: calendar, handoff dispatch, `now`; popula `introspection.slots`). 7 **NÃO** toca o worker. Merge sequencial resolve; lógica disjunta. |
| `copilot_v2_send_media` (schema/enum/bucket/cap) | (✅) | — | ✅ | — | — | **Ordering forte (CONSUMO, não co-escrita)**. 6 cria `kind=audio` no enum + bucket privado + cap (2 migrations). 3 **consome** (handler envia o item; o handler send_media canônico é do 6). Migration de 6 DEVE preceder qualquer envio de áudio do 3. |
| `supabase/config.toml` | — | — | — | ✅ | ✅ | Append de bloco `[functions.*]`. 7 = `copilot-v2-ingest-knowledge`; 11 = `copilot-v2-proactive`. Blocos distintos, append-only → conflito textual trivial no rebase. |
| `tests/integration/copilot-v2/border-regression.test.ts` | — | — | — | ✅ | ✅ | **NOVA colisão modelada**. Ambos APPENDam bloco `.skip` (7 = match RPC cross-org 0-row + reaper de ingestion travada; 11 = corrida do claim proativo + rate-limit). Arquivo-baseline do 1-H. Casos distintos, mantidos `.skip` → conflito append-only mecânico. |
| `_shared/copilot-v2/send-media-selector.ts` | (✅) | — | ✅ | — | — | 6 **cria** o módulo puro; 3 só **importa** no contrato do registry. Sem co-escrita se 6 mergear antes. |
| `_shared/copilot-v2/media-mime.ts` | (✅) | — | ✅ | — | — | Idem: 6 cria, 3 consome. Ordering, não co-escrita. |
| `_shared/copilot-v2/handoff-routing.ts` | (✅) | ✅ | — | — | — | 5 **cria** o módulo (resolve destino role-aware + RPC fan-out + realtime + WhatsApp). 3 só **chama** a dep `dispatchHandoffNotification` injetada pelo worker. Ordering 5 → 3 (soft). Até 5 mergear, dep `undefined` → caminho `notify_pending` explícito (não bloqueia 3). |
| `_shared/copilot-v2/hybrid-search.ts` + `rag-threshold.ts` + RPCs `match_*`/`copilot_v2_match_knowledge` | (✅) | — | — | ✅ | — | 7 **cria** a infra RAG + entrega o handler real `search_knowledge` em `tool-executor.ts`. 3 só **consome** (mantém `search_knowledge` honesto + teste de contrato). Ordering 7 → 3. |

Legenda: ✅ = toca/escreve · (✅) = **consome via import/dep** (sem co-escrita se a dona mergear antes) · — = não toca.

### Arquivos exclusivos (sem colisão — base segura pra paralelizar)

- **Slice 5 exclusivos**: `output-judge.ts`, `input-short-circuit.ts`, `hitl-gate.ts`, `handoff-routing.ts`, `queue-processor.ts`, `border.ts`, `AlertsDropdown.tsx`, 2 migrations (`*_copilot_v2_handoff_dispatch.sql`, `*_copilot_v2_hitl.sql`), 8 tests unit + 1 integration (`handoff-dispatch.test.ts`).
- **Slice 7 exclusivos**: `ingestion.ts`, `hybrid-search.ts`, `rag-threshold.ts`, `copilot-v2-ingest-knowledge/index.ts`, `_shared/copilot/rag.ts`, `_shared/copilot/search-knowledge.ts`, `_shared/copilot/knowledge-retriever.ts`, 4 migrations, 5 tests unit. (Compartilha `tool-executor.ts`, `config.toml`, `border-regression.test.ts`.)
- **Slice 11 exclusivos**: `proactive-scheduler.ts`, `copilot-v2-proactive/index.ts`, `lead-webhook/index.ts`, 2 migrations (`*_copilot_v2_proactive_log.sql`, `*_schedule_copilot_v2_proactive.sql`), 2 tests unit. (Compartilha `copilot-v2-worker/index.ts`, `config.toml`, `border-regression.test.ts`.)
- **Slice 6 exclusivos**: `media-mime.ts`, `send-media-selector.ts`, 2 migrations (`*_copilot_v2_send_media_audio_bucket.sql`, `*_copilot_v2_send_media_cap.sql`), 4 tests unit + 1 integration (`send-media-cap.test.ts`). (Compartilha `tool-executor.ts`, `copilot-v2-worker/index.ts`.)
- **Slice 3 exclusivos (footprint reduzido)**: **`agenda.ts`** (módulo puro novo, só dele), `introspect-guard.ts`, `tool-registry.ts`, `cognition-worker.ts`, 5 tests unit (`introspect-guard`, `tool-registry`, `agenda`, `cognition-worker`, `queue-processor*`). **Sem migration.** (Compartilha `tool-executor.ts` + `copilot-v2-worker/index.ts` — sempre por último.)

> **Migrations nunca colidem entre si**: cada slice gera timestamp real próprio (`date -u +%Y%m%d%H%M%S`) → arquivos distintos, ordenados por timestamp. A única dependência é a fundação (`20260531174908`/`20260531214954`), já MERGEADA via 1-H/0-C. Todas committed-not-applied; dev via MCP `apply_migration` após pre-check; **prod proibido em toda a Fase B** (CTO-gated). Slice 3 **não tem migration**.

---

## Lanes paralelas vs serializadas

### Lanes paralelas (worktrees isoladas, rodam juntas — LEVA 1)

```
worktree-1: feat/copilot-v2/slice-5-guardrails-handoff   ◄── Lane A
worktree-2: feat/copilot-v2/slice-7-ingestion-rag        ◄── Lane B
worktree-3: feat/copilot-v2/slice-11-proactivity         ◄── Lane C
```

**Por que [5, 7, 11] são disjuntas o suficiente:**
- **5 ∩ 7 = ∅** nos arquivos de escrita. (5 não toca `tool-executor.ts`; 7 não toca `queue-processor`/`border`/worker.)
- **5 ∩ 11 = `copilot-v2-worker/index.ts`** — regiões diferentes (5 no `processBatch`; 11 no `resolveContext`/produtor). Conflito textual mínimo, merge sequencial resolve sem retrabalho lógico.
- **7 ∩ 11 = `config.toml`** (blocos `[functions.*]` distintos, append-only) **e `border-regression.test.ts`** (blocos `.skip` distintos, append-only). Ambos mecânicos.
- **7 ∩ worker = ∅** (7 não toca o worker). **5 ∩ 7 ∩ config = ∅** (5 não toca config).

> Aceita-se os conflitos leves (`worker` 5×11, `config.toml` 7×11, `border-regression.test.ts` 7×11) como custo de merge na integração — **não** justificam serializar (regiões disjuntas, resolução mecânica). Quem mergear por último faz `git rebase develop` e resolve o hunk.

### Grupos que DEVEM serializar

1. **[[slice-06-asset-stores|6]] → [[slice-03-tools-media|3]]** — colisão dupla dura (CONSUMO):
   - `tool-executor.ts` (HANDLERS.`send_media`): Slice 6 é o **dono canônico** (handler acervo-aware + `send-media-selector`/`media-mime`); Slice 3 só consolida o contrato no registry e consome. 6 antes de 3.
   - `copilot_v2_send_media` (schema): migration de 6 (`kind=audio` + bucket + cap) DEVE preceder qualquer envio de áudio do 3.
   - **Veredito**: 6 antes de 3, sem exceção.

2. **[[slice-06-asset-stores|6]] vs LEVA 1 em `copilot-v2-worker/index.ts`** — 6 edita `makeExecutor` (`sendMediaViaProvider`); 5 edita `processBatch`; 11 edita `resolveContext`; 3 também edita `makeExecutor`. Para não serializar o merge do worker entre 4 slices ao mesmo tempo, 6 **não** entra na LEVA 1 → entra na **LEVA 2**, após 5/11 consolidarem o worker.

3. **[[slice-07-ingestion-rag|7]] → [[slice-06-asset-stores|6]] → [[slice-03-tools-media|3]]** em `tool-executor.ts` — três escritores do mapa `HANDLERS`, chaves diferentes (`search_knowledge` / `send_media` / agenda+handoff). Ordering (7 na LEVA 1, 6 na LEVA 2, 3 na LEVA 3) torna cada toque do `HANDLERS` um append sobre o estado já mergeado → conflito de hunk mecânico, nunca lógico.

### Ordem de execução recomendada (throughput ótimo)

```
LEVA 1 (paralela):   Slice 5  ║  Slice 7  ║  Slice 11      ← 3 worktrees simultâneas
                        │          │          │
                        ▼          ▼          ▼
                     merge 5 → merge 7 → merge 11  (rebase develop; resolver hunks de
                                                    worker[5×11] + config.toml[7×11] + border-regression[7×11])
                        │
LEVA 2 (serial):     Slice 6   (worker já tem deps de 5/11; HANDLERS já tem search_knowledge de 7)
                        │
                        ▼
                     merge 6
                        │
LEVA 3 (serial):     Slice 3   (consumidor terminal: handoff-routing de 5, send-media-selector/media-mime
                                +schema/bucket/cap de 6, RAG/search_knowledge de 7; footprint pequeno, sem migration)
```

> **Slice 3 é o consumidor terminal e tem footprint reduzido**: já está `status: ready` (TDD task-by-task), mas só executa depois de 5/6/7 mergeadas — ele importa a infra delas. Seu único módulo exclusivo novo é `agenda.ts` (puro, sem colisão); o resto é fiação de handlers no `tool-executor.ts`/worker que 6 já deixou prontos pra receber chaves novas.

---

## Decisões abertas consolidadas (união dos 5 planos)

Sinalizadas pro CTO — parâmetros, não premissas inventadas. Cada uma é um slot de config; fail-CLOSED cobre o pré-config.

1. **HITL — tools "críticas" + threshold "alto valor"** (Slice 5). Default ajustável: `CRITICAL_TOOLS={schedule_meeting, send_media, transfer_to_human, handoff_to_vendedor, move_lead_stage}` + `HIGH_VALUE_TIERS={diamante, ouro}`. Exportados como constantes; trocar a regra = mexer no conjunto, não na lógica do gate.
2. **Output-judge — categorias proibidas + política comercial por org** (Slice 5). Baseline segura agora (`forbidden_promise`/`unauthorized_price`/`leaked_credential`/`off_policy_tone`); política definitiva vem do config do **Slice 8** (lida via `commercialPolicy` quando existir).
3. **Output-judge — taxa de amostragem** (`judge_sample_rate`, Slice 5). Decisão técnica; default conservador `1.0` persistido em `copilot_v2_org_settings`, ajustável por org.
4. **Cap da send-media library com áudio** (Slice 6). `≤5 por tipo` vs `≤N total`. NÃO decidido. Construído como parâmetro (`copilot_v2_send_media_limits.mode/max_items` + `assertWithinCap` testado nas 2 leituras); seed default PROVISÓRIO (`per_kind=5`); migration committed-not-applied até o CTO decidir.
5. **Provider/custo de transcrição de vídeo** (Slice 7). Whisper/Gemini/ElevenLabs STT — tradeoff de custo/min + latência. `decideIngestionExtractor` roteia vídeo pra `transcript` mas fail-CLOSED (vídeo → `failed` com motivo) até o CTO escolher. Decisão de produto.
6. **Confirmação de schema `copilot_agent_faqs.organization_id`** (Slice 7 — NÃO é decisão de produto). Se a coluna não existir em dev, o predicate org troca pela subquery via `agent_id → copilot_agents.organization_id`. Sinalizado inline pro executor não inventar coluna.
7. **Janela de horário comercial** (Slice 11). Formato (string do prompt vs objeto estruturado pro gate) + default `{Seg-Sex 08:00-18:00 America/Sao_Paulo}`. Fail-CLOSED cobre o pré-config. UI = Slice 8.
8. **Cadência de followup** (Slice 11). Intervalos (d3/d7/d14?), nº máximo de tentativas, critério de parada. Default proposto: 1 followup `d3`. O `slot` da chave de idempotência já suporta múltiplas etapas sem mudar código.
9. **Threshold "dormindo" da Carteira** (Slice 11). Default 60 dias via `upsell_clients.updated_at` (proxy). Idealmente deriva da data do último pedido — pode exigir join com orders/`client_health_snapshots`/`portfolio_rpcs`. Confirmar fonte canônica + threshold.
10. **Teto de rate-limit proativo por org/dia** (Slice 11). Default 50 via `slots.proactiveDailyCeiling`. Confirmar número e se é uniforme ou por-arquétipo. Fail-CLOSED se ausente.
11. **Fronteira proativo 1:1 × campaigns (massa fria)** (Slice 11). Se um lead está em campanha ativa, suprimir o followup/resgate proativo? ADR #11 diz "não duplicar". Se "suprimir", os selectors ganham `NOT EXISTS (campanha_leads ativa)` — mudança localizada de query.
12. **Janela/timezone de `check_agenda_availability` + parsing de `datetime`** (Slice 3). Default da janela = próximas 48h; timezone canônico `America/Sao_Paulo`; `datetime` deve casar 1:1 com um slot de `introspection.slots` (write-after-introspect). Confirmar se a janela default e o slot de 60min são adequados ou se vêm do config do agente (Slice 8). Fail-CLOSED: `no_calendar`/`slot_in_past`/`slot_not_available`/`invalid_datetime`.

> **Nota de ADR transversal**: o threshold RAG consolidado (Slice 7, `doc=0.55/faq=0.5/memory=0.7`) é decisão **técnica resolvida com default justificado**, não bloqueante — listada só por transparência, não exige decisão de produto.

---

## Notas de coordenação pro executor

- **`copilot-v2-worker/index.ts` é o gargalo de merge** (4 slices o tocam: 5, 6, 11, 3 — regiões distintas). Tratar como recurso serializável. 5 e 11 paralelizam (regiões diferentes), mas o merge é sequencial; 6 entra na LEVA 2; 3 na LEVA 3.
- **`tool-executor.ts` HANDLERS** é tocado por 7 (LEVA 1), 6 (LEVA 2) e 3 (LEVA 3) — chaves diferentes (`search_knowledge` / `send_media` / agenda+handoff). A ordem das levas torna cada toque um append sobre o estado mergeado → conflito de hunk trivial.
- **`config.toml`** (7 × 11) e **`border-regression.test.ts`** (7 × 11): blocos/casos distintos, append-only — resolução mecânica no rebase.
- **Migrations**: zero colisão entre slices (timestamps distintos). Todas committed-not-applied; pre-check da fundação em dev antes de aplicar via MCP; **prod proibido em toda a Fase B** (CTO-gated). Slice 3 não cria migration.
- **Slice 3 = consumidor terminal de footprint reduzido**: depende (por consumo/import) de handoff-routing (5), send-media (6: handler+schema+bucket+cap), RAG/`search_knowledge` (7). Único módulo novo exclusivo: `agenda.ts`. Executa por último, na LEVA 3.
