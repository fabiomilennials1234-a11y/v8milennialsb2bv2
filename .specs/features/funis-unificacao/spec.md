# Unificação dos Funis — "funil é funil" (Wave 2)

**Status:** aprovado em grill com o CTO (2026-09-01) · pronto para execução
**Base:** worktree limpo de `origin/main` (`c2b942b9`, 2026-09-01 14:38) em `/Users/gabrielaureliogipp/Dev/v8-funis-wave2`
**Escopo:** projeto isolado — não absorve o redesign de funis (outro dev) nem a fatia Lead↔Negócio; as interfaces com eles estão declaradas em §7.
**Relatório de diagnóstico:** https://claude.ai/code/artifact/7a4e37ad-45d2-4a38-8365-dde79c89afe7

---

## 1. A tese

**Padrão de mercado: funil é funil.** Não existe funil "de sistema" vs funil "custom" — existe UM tipo de funil, todo funil é criado, renomeado, editado e deletado pelo usuário, e os funis que vêm de fábrica são apenas **conteúdo semeado** na org nova, não um tipo no código. O que ocupa etapa em qualquer funil é sempre um **Negócio**. Todo comportamento que hoje se pendura no slug (`whatsapp`, `propostas`…) passa a se pendurar em configuração explícita ou em `stage_role`.

Números que motivam (produção, 2026-09-01): 47,7 mil entradas de funil, **34,7% já em 79 funis custom de 45 orgs** — e esses funis são cidadãos de segunda classe: sem disparo por etapa, sem Copilot, sem analytics, sem filtros/bulk/paginação, invisíveis pra API de movimento.

## 2. Decisões travadas (grill 2026-09-01)

| # | Decisão | Detalhe |
|---|---|---|
| **D1** | **Unificação total (alvo A)** | Um tipo de funil. Funis de fábrica viram seed renomeável/deletável. Nenhum comportamento por slug. |
| **D2** | **Todo card é Negócio** | Valor opcional (negócio de R$ 0 é normal). Métrica/forecast por funil. **Entrar num funil É a decisão explícita que cria o Negócio** (emenda ao ADR-0030 — a porta registra a Procedência: `human`, `import`, `webhook`, `workflow`, `api`, `backfill_funil_custom` — mantém o valor `human` do CHECK existente (decisão CTO 2026-09-01)). Segue proibido o automático puro (lead entra no sistema → nada nasce). Backfill: **1 Negócio por card custom** (não por jornada — cada funil custom é uma iniciativa comercial distinta), procedência `backfill_funil_custom`, valor nulo, **título derivado por data** ("Negócio de set/2026"), nunca do nome do funil (decisão CTO 2026-09-01; evita reproduzir o que o ADR-0023 §9 rejeitou). |
| **D3** | **Etapa identificada por UUID** | `pipeline_stages` ganha `pipeline_id` FK real; `pipeline_entries` ganha `stage_id` NOT NULL; `stage_key` vira espelho transitório (trigger) até a última view de compat cair. Comportamento por `stage_role`, nunca por slug. Defaults viram **seed server-side na criação da org** (`ensureDefaultStagesInDb` do front morre). Deletar etapa com cards exige diálogo "mover os N cards para ___" — nunca deleta card junto. |
| **D4** | **Sem papéis de funil; destino por porta** | Cada porta de entrada declara o destino na própria configuração (webhook payload, import, Cal.com settings, config do agente Copilot, nó de workflow). **Um único fallback: "funil padrão" da org.** Receita = negócio ganho em **qualquer** funil (`stage_role = 'won'` via `metric_stage_role` — cadeia `sale_events`→comissões já é agnóstica). Transição entre funis por `target_pipeline_id`/`target_stage_id` (já existem em `pipeline_stages`). |
| **D5** | **Troca com espelho, espelho com data pra morrer** | `custom_pipe_entries`/`custom_pipelines`/`custom_pipeline_stages` viram views de compat com INSTEAD OF (playbook Wave 1). **O projeto só conta como entregue com todos os espelhos removidos (§6 F6)** — não vira estado permanente. |
| **D6** | **Webhook aceita qualquer funil e erra alto** | `place_in_pipe` aceita id ou slug de qualquer funil. Os 3 nomes antigos viram aliases dos funis semeados. Funil inexistente → **4xx** (fim do 200 + descarte). Antes da virada: levantamento dos robôs n8n que hoje mandam slug inválido. |
| **D7** | **Rollout** | Estrutura: global (todas as orgs), cada migration com ensaio BEGIN/ROLLBACK contra prod + reconciliação de contagens. Comportamento/UI: piloto **Milennials** → lotes. A trava "nada em produção" do redesign **não vale** para este projeto; **cada janela de produção é aprovada pelo CTO, uma a uma**. |
| **D8** | **Projeto isolado** | Worktree de `origin/main`, branch dedicada. Não mistura com Omie, redesign ou Lead↔Negócio. |
| **D9** | **Carteira fora** | Carteira já não é funil (sidebar sem entrada; etapas `upsell_*` aposentadas no banco). Este projeto só faz a **faxina do resíduo**: remove `upsell_base`/`upsell_gestao` do vocabulário de funil (CHECK, enum TS, 6 call sites de `usePipelineStages`), sem tocar em `/upsell`, `upsell_clients` (13,5 mil clientes / 25 orgs) nem no trilho da Carteira. |
| **D10** | **Contratos externos: aditivo, nada quebra** | API v1 (73 chaves / 49 orgs / Make): aceita qualquer funil por id ou slug; slugs antigos viram aliases; morrem `custom_pipeline_not_supported` e o prefixo `custom:` (aceito como legado); OpenAPI corrigido (3 mentiras hoje). Webhooks de saída: os 6 eventos `pipe_*.created/updated` (mortos em prod, gatilho caiu) saem do catálogo; nasce **um** evento `negocio.stage_changed` com `{pipeline_id, pipeline_slug, stage_id, stage_role, deal_id, lead_id}`. |
| **D11** | **Disparo por etapa em funil custom: freio triplo** | (1) Nasce **desligado por funil** — toggle na config do funil, nada muda sozinho na virada. (2) **Nunca retroativo** — só dispara movimento posterior à ativação. (3) Todo envio passa pelo **send-governor** (choke único já existente: dedup + sinal de ban + ledger). |

### Emendas de ADR a escrever na F1

- **ADR-0034 (novo): "Funil é funil"** — D1, D3, D4. Supersede a semântica de `pipelines.type` como comportamento (coluna permanece como marca de origem do seed, sem efeito).
- **ADR-0030 (emenda)** — D2: entrar num funil é a decisão explícita que abre o Negócio; a porta registra a Procedência.
- **CONTEXT.md** — atualizar **Pipeline** (remove "System pipes: …"; todo funil é criado e editável; os de fábrica são seed), **Stage** (identidade UUID; papel via stage_role; trilha padrão é seed, não lei), **Negócio** (ocupa etapa em qualquer funil; valor opcional; nasce ao entrar no funil por porta explícita).

## 3. Estado atual verificado (main `c2b942b9` + prod)

O que **já está pronto** e o plano aproveita:
- `pipelines` já é o registro único (custom espelhado com o mesmo uuid via `trg_sync_custom_pipeline`).
- `pipeline_entries` já espelha 100% do custom (16.565 entries; sync one-way).
- `pipeline_entries.deal_id` já populado em 72,9% (34.795/47.732) pelo trilho Lead↔Negócio.
- Comissões/gamificação/caderno de vendas já disparam por `stage_role` (`metric_stage_role` → `sale_events`) — funil custom **já** gera comissão hoje.
- `stage_role` populado nas 4,2 mil etapas + fila `classify-stage-roles` + revisão master.
- API v1 nova já fala Negócio/Procedência; rota lead/stage já depreciada.
- `send-governor` no ar (modo sombra) como choke único de envio automático.
- Lint `scripts/check-metric-antipatterns.sh` R3 já proíbe `type='system'` em métrica; os **6 `metric-lint-allow`** existentes são a checklist exata do que a unificação apaga.

O que trava (alvos do plano): CHECK `pipeline_stages_pipeline_type_check` (5 valores literais — **primeira migration da wave**); `stage_key` texto vs `stage_id` UUID; adapter `type='system'`; `abrir_negocio`/`mover_negocio`/`api_move_deal` recusando custom; dispatch/Copilot/analytics cegos a custom; ~20 RPCs com assinatura `p_pipeline_type text`; 3 editores de etapa; `saved_views.entity_type` com slug; ~125 arquivos de teste no vocabulário velho.

## 4. Bugs vivos que a varredura achou (entram na F0)

1. **Meta CAPI `sold` nunca disparou**: `get_pending_meta_conversion_signals` filtra `p.type='propostas'` — valor impossível (`type` só vale `system|custom`). Fix correto: `stage_role='won'`.
2. **Realtime em views**: `useCommandMetrics.ts:235-236` assina `pipe_propostas`/`pipe_confirmacao` (views não emitem `postgres_changes`) — no-op silencioso.
3. **Query morta**: `LeadDetailSheet.tsx:56` filtra `.eq("pipe_type", …)` numa coluna que se chama `pipeline_type` — a barra de etapas do sheet nunca renderiza.
4. **Etapa de sistema deletável sem guarda** com slugs referenciados a jusante — guarda interina até a D3 entregar o diálogo definitivo.
5. **Funil custom trunca em 1.000 registros em silêncio** (`useCustomPipeEntries` sem paginação) — resolvido de vez na F4 (kanban custom passa pro `get_pipeline_page`), com aviso interino se a F4 demorar.

## 5. Fases

> Toda migration de estrutura: ensaio transacional contra prod (BEGIN → migration → asserções → ROLLBACK via `scripts/prod-sql.mjs`) antes da janela real; asserção de contagem como predicado dentro do próprio UPDATE/INSERT quando houver reescrita de dados. Janelas de prod: aprovação do CTO uma a uma (D7).

### F0 — Estancar (curta, sai primeiro)
- Fix Meta CAPI `sold` (`stage_role='won'`), fix realtime-em-view, fix query morta do LeadDetailSheet, guarda interina de deleção de etapa.
- Levantamento dos robôs n8n: quais mandam `place_in_pipe` com slug que hoje cai no descarte silencioso (D6).
- **Janela de prod:** 1 (migration do fix CAPI).

### F1 — Fundações de schema + documentação de domínio
- Dropar o CHECK de 5 valores em `pipeline_stages.pipeline_type`.
- `pipeline_stages.pipeline_id` FK → `pipelines` + backfill (resolvendo por org + slug); UNIQUE `(pipeline_id, stage_key)` e `(pipeline_id, position)`.
- Migrar as 531 `custom_pipeline_stages` → `pipeline_stages` (preservando uuid onde possível); `custom_pipeline_stages` vira view de compat.
- `pipeline_entries.stage_id` (FK) + backfill de `(pipeline_id, stage_key)`; trigger-espelho mantém `stage_key` sincronizado (D3).
- Seed server-side: `create_default_pipelines`/`create_default_pipeline_stages` viram a única semeadura; front para de semear.
- Faxina do resíduo Carteira (D9): tipos `upsell_*` fora do vocabulário.
- Escrever ADR-0034, emenda ADR-0030, atualizar CONTEXT.md (§2).
- **Janelas de prod:** 2–3.

### F2 — Inversão do silo custom + backfill de Negócios
- `pipeline_entries` vira fonte única também para custom: inverter o sync; `custom_pipe_entries` e `custom_pipelines` viram views de compat com INSTEAD OF (mesmo playbook das `pipe_*`).
- Reescrever os 6 triggers hoje pendurados em `custom_pipe_entries` (checklist, workflow entry/stage-change, updated_at, tenancy, sync) para `pipeline_entries` — atenção: `apply_stage_checklist` roda `OF stage_id` num lado e `OF stage_key` no outro; unifica em `stage_id`.
- Preservar nomes de constraints/FKs que o front embeda via PostgREST (`acoes_do_dia_*_pipeline_entries_fkey`).
- **Backfill D2:** 1 Negócio por card custom sem `deal_id` (procedência `backfill_funil_custom`, valor nulo), org a org, Milennials primeiro; reconciliação: `COUNT(entries custom sem deal) = 0` e nenhum deal órfão.
- `tests/remote/setup-remote.ts` e fábricas: teardown passa a limpar `pipeline_entries` (view não aceita DELETE fora do INSTEAD OF).
- **Janelas de prod:** 2 (inversão + backfill por lotes).

### F3 — Motor agnóstico
- `_shared/pipeline-adapter.ts`: `PipeSlug` morre; resolve qualquer funil por id/slug (sem filtro `type='system'`); os 23 testes que o dublam migram junto.
- `lead-webhook` (D6): aceita qualquer funil, aliases legados, 4xx em inexistente; `partner-webhook`, `webhook-calcom/new-lead/orchestrator`, `meta-leadgen-poll`, `google-calendar-events` param de assumir slug fixo (destino por config da porta, fallback funil padrão — D4).
- "Funil padrão" da org: coluna/config + UI em Configurações; deleção de funil apontado exige substituto no diálogo (D3/D4).
- RPCs: `abrir_negocio` (mata o IF/ELSIF e o prefixo `custom:`), `mover_negocio` (aceita destino custom), `api_move_deal`/`api_create_deal` (D10), `get_pipeline_page` e contagens por `pipeline_id` (fundem os pares system/custom: `get_stage_lead_ids`+`get_custom_filtered_lead_ids`, `delete_system_pipeline`+`delete_custom_pipeline`, etc.); assinaturas antigas viram wrappers finos até a F6.
- Workflows: contexto de trigger unificado (`pipeline_id` sempre; `pipe_type` mantido como eco legado até F6); condição/variável `{{estagio}}` lê o Sujeito da Execução (ADR-0031), nunca `leads.pipe_whatsapp`.
- Copilot: kanban rules por funil escolhido (config do agente — D4); auto-avanço deixa de hardcodar a trilha whatsapp (progressão por posição + `stage_role`); v2 `move_lead_stage` implementado para qualquer funil.
- Dispatch por etapa em custom (D11): toggle por funil (default OFF), corte temporal de ativação, envio via send-governor.
- Webhooks de saída (D10): remove os 6 eventos mortos do catálogo; trigger + evento `negocio.stage_changed`.
- Métricas: apagar os 6 `metric-lint-allow`; analytics RPCs (`get_funnel_conversion`, `get_pipeline_velocity`, `get_sales_cycle_analysis`, `get_analytics_pipeline_metrics`) por `pipeline_id`.
- **Janelas de prod:** 2–3 (deploys de edge functions + RPCs; comportamento atrás do piloto D7).

### F4 — Uma UI, um funil
- Rota única `/funil/:slug` (redirects 301 de `/pipe-whatsapp|confirmacao|propostas` e `/pipe/custom/:slug`); as 3 páginas de sistema (~3,7 mil linhas) e a custom colapsam numa; navegação/sidebar viram lista de `pipelines` (morrem `PIPE_PATH_MAP`, `FUNIS_PATHS`, atalho "G W" reaponta pro funil padrão).
- Paridade total (a lista da varredura §14 do relatório): filtros, saved views (migração de dados `saved_views.entity_type: pipe_* → pipeline:{uuid}`), bulk, métricas de funil, paginação (`get_pipeline_page` para todos — mata o truncamento de 1.000), export dinâmico (cabeçalhos por funil), import unificado; cor/ícone/rename/delete para todos (incl. os semeados); **um** editor de etapas (morrem 2 dos 3) com o diálogo de mover cards.
- `CreateNewModal` "ativar funil de sistema" vira "criar funil (a partir de template opcional)"; onboarding/quiz e clone de org (master) semeiam `pipelines`+`pipeline_stages` por FK; templates master idem.
- Vocabulário TS: `PipelineType` union morre; `pipe-defaults`/`pipe-columns` viram seed/dado; `useLeadAllPipelines` perde os mapas de tradução; `PipeOpsPort` encolhe; contexts por pipe morrem.
- Testes: ~125 arquivos migram por lote junto com cada superfície (gate `test:unit` por conjunto de arquivos, ratchet).
- **Janela de prod:** deploy de front (piloto por flag → geral).

### F5 — Rollout e integrações externas
- Piloto Milennials: flip completo (UI + comportamento), 1 semana de observação com reconciliação diária.
- Lotes de orgs; patch dos robôs n8n (ids em vez de slugs) — os aliases seguram quem não migrou.
- OpenAPI/docs corrigidos e publicados; aviso às orgs com chave de API (changelog: nada quebra, funil custom passa a funcionar).

### F6 — Demolição (critério de "entregue")
- Caem: views `pipe_whatsapp/confirmacao/propostas` (+`*_compat`), views de compat `custom_*`, espelho `stage_key` (se nenhum leitor restar), espelho `leads.pipe_whatsapp` (coordenar — tem leitores vivos em RPCs de no-response), wrappers de RPC legados, eco `pipe_type` nos contextos de workflow.
- `supabase gen types` regenerado; `as never`/casts removidos; `git grep -c "pipe_whatsapp\|pipe_type\|PipelineType"` no src ≈ 0 (exceto migrations históricas e aliases documentados da API).
- **Exit criteria:** espelhos = 0 · 6 lint-allows apagados · funil custom com paridade total medida (disparo, Copilot, analytics, filtros, API) · zero leitura das views em 7 dias de `runtime_logs` antes de cada DROP.

## 6. Riscos e freios

| Risco | Freio |
|---|---|
| Disparo retroativo em massa na virada (3 bans históricos) | D11: default OFF por funil + corte temporal + send-governor. |
| Backfill cria Negócios errados (dado de dinheiro) | Big-bang por fase com ensaio/rollback; critério de aceite como predicado no próprio INSERT; reconciliação org a org; Milennials primeiro. |
| Robô n8n quebra com 4xx | Levantamento F0 + aliases D6; erro visível é o comportamento correto (hoje o lead se perde em silêncio). |
| View de compat sem INSTEAD OF quebra teardown de teste/escritas esquecidas | Inventário de escritores feito (varredura); INSTEAD OF cobre INSERT/UPDATE/DELETE; CI roda a suíte inteira por fase. |
| Etapas custom sem `stage_role` viram buraco de métrica quando `is_final_*` perder o posto | F1 força a fila `classify-stage-roles` a zerar o backlog custom antes da F3. |
| Invalidations por string (`["pipe_propostas","perf",…]`) quebram silenciosamente | F4 troca queryKeys por `["pipeline", pipelineId, …]` num lote único auditado. |
| Migration de checkout defasado / push em prod errado | Sempre deste worktree; `--dry-run` + ledger conferido; nunca `db push` cego (66 pendentes conhecidas tornam push cru inutilizável). |

## 7. Interfaces com os outros trilhos (não são escopo, são contrato)

- **Lead↔Negócio (T1–T7):** nosso backfill cobre **só cards custom**; os cards dos funis semeados continuam no trilho deles. Ordem: nossa F2 depois do M6/backfill deles OU com recorte `deal_id IS NULL` — decidir na abertura da F2 olhando o estado do trilho.
- **Redesign de funis (outro dev):** D8 do redesign (nivelar capacidades) fica **respondida** por este plano (D2); D1–D7 do redesign seguem com o CTO; a rota única da F4 é a base que o redesign passa a estilizar.
- **Carteira:** intocada (D9). O resíduo removido aqui não muda `/upsell` nem `upsell_clients`.
- **Governor:** se o modo enforce ligar antes da F3, melhor; não é pré-requisito.

## 8. Execução

- Branch: `feat/funis-unificacao` a partir de `origin/main`, neste worktree.
- Pipeline: arquiteto → engenheiro (Impl+DB+Tests+Segurança+Docs) → arquiteto (commit+push) → CTO. PRs pequenas por fase; cada janela de prod precedida do ensaio e aprovada pelo CTO no chat.
- Gates locais por PR: `npm run typecheck:ratchet` · `lint:ratchet` · `build` · `test:unit` por conjunto de arquivos · `scripts/check-metric-antipatterns.sh`.
- Validação com banco: branch efêmera do Supabase (nunca Docker/local), encerrada no mesmo dia.
