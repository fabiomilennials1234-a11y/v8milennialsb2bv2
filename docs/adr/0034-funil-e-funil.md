# 34. Funil é funil

Date: 2026-09-01

## Status

Accepted (grill com o CTO, 2026-09-01).

Supersede a **semântica de `pipelines.type` como comportamento** — a coluna sobrevive como marca de origem do seed, sem nenhum efeito em runtime. Completa **ADR-0023** (o Negócio é a unidade do funil) na dimensão que ele não tocou: a igualdade entre os funis. Apoia-se em **ADR-0030** (Procedência — emendado na mesma data, ver Amendment 1 lá) e **ADR-0031** (sujeito da execução). Plano de execução: `.specs/features/funis-unificacao/spec.md` (decisões D1–D11, fases F0–F6).

## Context

O produto tem dois cidadãos onde o mercado tem um. Números de produção, 2026-09-01:

- **47,7 mil entradas de funil, e 34,7% já vivem em 79 funis custom de 45 organizações.** Um terço da operação real acontece no cidadão de segunda classe.
- **A matriz de paridade do funil custom é quase toda vazia:** sem disparo por etapa, sem Copilot, sem analytics, sem filtros/saved views/bulk, sem paginação (trunca em 1.000 registros em silêncio), sem export dinâmico, e invisível para a API de movimento — `api_move_deal` recusa com `custom_pipeline_not_supported`.
- **O comportamento está pendurado no slug, não em configuração.** `_shared/pipeline-adapter.ts` fecha o union `PipeSlug` e filtra `type='system'`; ~20 RPCs carregam assinatura `p_pipeline_type text`; o CHECK `pipeline_stages_pipeline_type_check` congela 5 valores literais; `lead-webhook` responde **200 e descarta o lead** quando `place_in_pipe` traz um slug que não é dos 3 antigos.
- **A parte difícil já foi feita.** A Wave 1 converteu os pipes de sistema em views sobre `pipeline_entries`; `pipelines` já é o registro único (custom espelhado com o mesmo uuid); as 16.565 entries custom já estão 100% espelhadas; comissão/gamificação/caderno já disparam por `stage_role` via `metric_stage_role` → `sale_events` — **funil custom já gera comissão hoje**; `stage_role` está populado nas 4,2 mil etapas, com fila `classify-stage-roles` e revisão master.
- **O layout canônico já não descreve os funis reais.** Dos 396 funis ativos, **283 (71%) não têm etapa `won`** (medido na Emenda 1 do ADR-0023). Qualquer desenho que presuma "o funil de fechamento tem etapa de venda" está errado na maioria dos casos desde o primeiro dia.
- Os **6 `metric-lint-allow`** do `check-metric-antipatterns.sh` (R3 já proíbe `type='system'` em métrica nova) são a checklist exata do que resta apagar.

O custo não é estético. Cada feature nova nasce duas vezes ou nasce só para o lado "system" — o repositório tem um padrão catalogado de *feature construída e nunca ligada*, e o if/else system/custom é uma das fábricas dele.

## Decision

**1. Um tipo de funil (D1).** Não existe funil "de sistema" versus funil "custom". Todo funil é criado, renomeado, editado e deletado pelo usuário. Os funis que vêm de fábrica são **conteúdo semeado** na criação da org — seed server-side (`create_default_pipelines`/`create_default_pipeline_stages` como única semeadura; o `ensureDefaultStagesInDb` do front morre) — não um tipo no código. Os 3 slugs antigos (`whatsapp`, `confirmacao`, `propostas`) sobrevivem apenas como **aliases** dos funis semeados, para webhook e API. Nenhum comportamento se pendura em slug: comportamento vem de configuração explícita ou de `stage_role`.

**2. Etapa identificada por UUID; `stage_key` vira espelho transitório (D3).** `pipeline_stages` ganha `pipeline_id` FK real; `pipeline_entries` ganha `stage_id` NOT NULL; `stage_key` passa a ser espelho mantido por trigger, vivo apenas até a última view de compat cair (F6). O papel da etapa é `stage_role` (`won`, `lost`, …), nunca o nome nem o slug. A trilha default (`novo → abordado → …`) é **seed, não lei** — deixa de existir como constante no código. Deletar etapa com cards exige o diálogo "mover os N cards para ___"; deletar card junto é proibido.

**3. Destino por porta de entrada; um único fallback (D4).** Não existem papéis de funil. Cada porta de entrada declara o destino **na própria configuração**: payload do webhook, mapeamento do import, settings do Cal.com, config do agente Copilot, nó de workflow. O único fallback é o **funil padrão da org** (uma config, editável, exigida como substituto no diálogo de deleção do funil apontado). **Receita é negócio ganho em qualquer funil**: a chegada numa etapa `stage_role='won'` marca o desfecho pela cadeia `deals.outcome` → `sale_events` (Emenda 1 do ADR-0023), que já é agnóstica de funil — nada na contabilidade cita slug.

**4. Troca com espelho, espelho com data pra morrer (D5).** `custom_pipe_entries`, `custom_pipelines` e `custom_pipeline_stages` viram views de compat com INSTEAD OF (o mesmo playbook que a Wave 1 usou para as `pipe_*`). O projeto **só conta como entregue com todos os espelhos removidos** (F6): zero leitura em 7 dias de `runtime_logs` antes de cada DROP, wrappers de RPC legados derrubados, `git grep` de `pipe_whatsapp|pipe_type|PipelineType` ≈ 0 no src. Espelho não é estado permanente — é andaime com data.

### Alternativas rejeitadas (grill 2026-09-01)

- **(B) Manter os 2 funis semeados como "protegidos"** (não-deletáveis, com código próprio) e nivelar só o resto. Preserva exatamente o if/else que produz a matriz de paridade vazia: cada feature nova continuaria sendo escrita duas vezes ou uma só — e os 34,7% seguiriam de segunda classe. A proteção que importa (não perder cards ao deletar) a D3 entrega para **todos** os funis, sem tipo.
- **Papéis de funil como enum** (`qualificacao | agendamento | fechamento | …`). É o slug com outro nome: o comportamento voltaria a se pendurar num rótulo do funil. E o dado refuta o rótulo — 71% dos funis ativos não têm etapa `won`; o funil que o cliente desenha não cabe no papel que o enum previu. O papel que sobrevive ao contato com a realidade é o da **etapa** (`stage_role`), que já existe, já está populado e já move a contabilidade.
- **Funil tipado por sujeito** (funil "de pessoas" vs funil "de negócios"). Rejeitado porque o mercado inteiro — Pipedrive, HubSpot, Kommo — põe **Deal em todo pipeline, com valor opcional**. Dois sujeitos significam duas APIs, duas métricas, dois kanbans, e a pergunta "quanto vale este funil" sem resposta em metade do produto. Negócio de R$ 0 é normal (D2); um funil de qualificação é um funil de negócios que ainda não têm valor.

## Consequences

**O que isso força**

- **Comportamento novo pendurado em slug é regressão, não estilo.** Um `if (slug === 'propostas')` escrito depois deste ADR reintroduz o tipo que ele mata — a revisão barra, e o lint R3 do `check-metric-antipatterns.sh` já barra em métrica. Os 6 `metric-lint-allow` existentes são dívida com prazo (F3), não licença.
- `pipelines.type` fica **sem leitor**. Quem consultar a coluna para decidir comportamento está violando este ADR; ela responde apenas "este funil veio do seed?".
- O webhook **erra alto**: funil inexistente vira 4xx — fim do 200 + descarte silencioso. Antes da virada, levantamento dos robôs n8n que hoje mandam slug inválido (F0), e os aliases seguram quem não migrou.
- As ~20 assinaturas `p_pipeline_type` viram wrappers finos sobre as versões por `pipeline_id`, e os wrappers morrem na F6. Os pares de RPC system/custom (`get_stage_lead_ids`+`get_custom_filtered_lead_ids`, `delete_system_pipeline`+`delete_custom_pipeline`, …) fundem.
- Todo card é Negócio (D2 — Emenda 1 do ADR-0030): backfill de **1 Negócio por card custom** sem `deal_id`, procedência `backfill_funil_custom`, valor nulo.
- Etapas custom sem `stage_role` viram buraco de métrica quando `is_final_*` perder o posto — a fila `classify-stage-roles` zera o backlog custom antes da F3.

**O que quebra se violarem**

- Pendurar disparo/Copilot/métrica num slug de seed quebra na primeira org que **renomear ou deletar** o funil semeado — direito que a D1 acabou de dar a todas.
- Escrever `stage_key` sem passar pelo espelho quebra quando o espelho cair (F6). O caminho de escrita é `stage_id`; `stage_key` é leitura de compat.
- Deixar um espelho virar permanente reproduz o estado que este ADR existe para encerrar: duas verdades, uma delas mentindo baixinho.

**O que aceitamos**

- Os 3 aliases de slug ficam na API para sempre, documentados — contrato externo é aditivo (D10), 73 chaves em 49 orgs não quebram.
- Duas semânticas coexistem durante as fases: views de compat e colunas-espelho vivem até a F6, com o critério de saída medido, não prometido.
- Cada janela de produção é aprovada pelo CTO uma a uma (D7); o rollout de comportamento/UI é piloto Milennials → lotes. A trava "nada em produção" do redesign de funis não vale para este projeto.
