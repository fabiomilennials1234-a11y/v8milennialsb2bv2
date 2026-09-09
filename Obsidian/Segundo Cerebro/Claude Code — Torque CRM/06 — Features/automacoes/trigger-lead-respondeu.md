---
type: feature
title: Automações — Trigger "Lead Respondeu" (funil, etapa e número)
status: active
created: 2026-08-11
updated: 2026-09-03
tags: [workflows, triggers, pipelines, copilot]
related: []
owner: gabriel
---

# Automações — Trigger "Lead Respondeu" (funil, etapa e número)

## TL;DR

O trigger `lead_replied` ganhou um filtro **por funil**: marque um ou mais funis e a automação só dispara se o lead que respondeu estiver em algum deles. Junto veio o conserto do que impedia o trigger de existir na prática — ele disparava depois do gate de Copilot, então era inalcançável para 82 das 99 orgs. O alcance foi de **17 para 60** orgs (não 99 — ver as limitações).

## Por que existia um problema

Medido em PROD em 2026-08-11, antes da mudança:

- `lead_replied`: **0 workflows** e **0 execuções** em toda a história de `workflow_executions` (contra 177 de `stage_changed` e 79 de `lead_created`).
- Só **17 de 99 orgs** têm `copilot_agents.is_active = true`.

A causa não era desinteresse: o disparo morava no passo 1.7 de `agent-message`, **depois** do AGENT ACTIVE GATE. Org sem Copilot ativo saía no early-return e nunca chegava lá. O trigger era inalcançável, não impopular.

> [!note] Revisão de 2026-08-12
> A primeira versão desta fatia passou os portões (85 testes verdes) com o filtro por funil **morto**: o executor revalida o matcher contra o context persistido, e o desenho tinha esvaziado justamente o campo que ele precisa. O bug até tinha um teste — que o travava como se fosse invariante de desenho. Corrigido no commit `1fe8a6fc`; quatro testes novos cobrem as duas pontas, e os de revalidação **reprovam se a linha for revertida** (verificado).
>
> A revisão foi adversarial (6 lentes independentes, 2 céticos por achado) e derrubou **20 de 21** achados como dívida idêntica à `main` — vale não reabrir: o `[]` do export/import, a pílula de IA que não silencia automação, e o "funil deletado" que na verdade é soft delete. O registro completo está na memória `trigger-lead-respondeu-filtro-funil`.

## Como funciona agora

### Filtro por funil

`trigger_config.pipeline_ids`: lista de `pipelines.id`. Semântica **OR** — basta o lead ter entrada em **um** dos funis marcados. Lista vazia/ausente = qualquer funil (mesma convenção de `channel`).

Um campo só cobre funil padrão **e** custom, porque `pipelines` é a união dos dois: cada linha de `custom_pipelines` é espelhada ali com o **mesmo uuid**, pelo trigger `trg_sync_custom_pipeline`. Medido: 379 pipelines = 294 system + 85 custom, com 0 custom sem espelho.

> [!warning] Não copie a forma do `lead_created`
> Aquele trigger usa o par `filter_pipe` (slug `pipe_whatsapp`) + `filter_pipeline_id` (uuid), que duplica o mesmo conceito. Pior: o `pipe_type` com que o slug é comparado vem **hardcoded** do trigger PG `trigger_workflow_lead_created()`, então o filtro é praticamente decorativo. Aqui usamos só uuid.

"Estar no funil" = **existir linha em `pipeline_entries`**. Não há coluna de saída — o lead sai do funil por DELETE. Consequência: um lead parado em `vendido`/`perdido` **continua contando** como no funil (a entry só ganha `closed_at`).

### Onde a lista de funis do lead entra

`matchesTriggerConfig` é pura e síncrona, e não tem como consultar o banco. Então `fireTrigger` faz o lookup **sob demanda** — só quando algum workflow candidato realmente configurou `pipeline_ids` — e injeta o resultado no contexto.

> [!important] O matching acontece DUAS vezes, e a lista tem que sobreviver às duas
> `fireTrigger` casa o filtro e cria a execução; depois `process-workflow-executions` (`index.ts:247`) roda `matchesTriggerConfig` **de novo**, contra `workflow_executions.context`, antes de executar o primeiro nó. Esse segundo portão existe porque o trigger PG cria execuções às cegas.
>
> Por isso o insert grava `context: { trigger_type, ...matchContext }` — com os funis. A primeira versão desta feature os mantinha fora de propósito, e o resultado era que o fail-closed reprovava **100%** das execuções com filtro: a automação nascia e morria marcada `completed` / `Skipped: trigger conditions not met`. O sintoma para o cliente era *"funciona até eu marcar um funil"*. Quando o trigger não usa filtro de funil, `matchContext` **é** `context` e nada muda.
>
> O que **não** pode mudar é a chave de dedup: `computeTriggerDedupKey` faz hash do payload inteiro, e os funis de um lead mudam com o tempo. A chave continua computada sobre o `context` **original** — persistir e deduplicar são duas expressões separadas no insert, de propósito.
>
> Quatro testes travam as duas pontas: `grava lead_pipeline_ids no context da execução`, `o context gravado passa na revalidação do executor`, `a chave de dedup ignora os funis do lead` e `leitura dos funis falha → não dispara (fail-closed)`.

O lookup lê só `pipeline_entries` (canônica): 0 entries órfãs e 0 `custom_pipe_entries` sem par em 16.233 medidos. O `.eq('organization_id', ...)` é obrigatório e explícito — quem chama é service_role, que **bypassa a RLS**.

**Fail-closed**: se a leitura falhar, o filtro não é avaliável e o trigger **não** dispara. Disparar levaria a automação para leads fora do funil, o que é pior que não disparar.

### Os três filtros se somam (E, não OU)

O painel tem `channel`, `pipeline_ids` e `contains_text`, e o matcher os avalia em **AND**, nessa ordem. **Manter o "Contém texto" ao lado do funil foi decisão explícita** — o funil diz *quem* pode disparar, o texto diz *o que* a resposta precisa dizer; um não substitui o outro.

| `pipeline_ids` | `contains_text` | Dispara quando |
|---|---|---|
| vazio | vazio | qualquer resposta |
| `[Vendas]` | vazio | lead está em Vendas |
| vazio | `orçamento` | resposta contém "orçamento" |
| `[Vendas]` | `orçamento` | lead está em Vendas **e** a resposta contém "orçamento" |

`contains_text` é case-insensitive e faz `includes` (substring), não palavra inteira. Coberto por `funil e contains_text se somam (E, não OU)` e `funil e canal se somam`.

### Filtro por etapa (2026-09-03)

`trigger_config.stage_ids`: lista de `pipeline_stages.id`. Semântica **OR**, vazio = qualquer etapa. Some junto com os outros filtros (E).

Chave é o **uuid**, não o `stage_key`: o apelido de etapa se repete entre funis, o uuid não.

> [!important] Etapa é do Negócio, e o filtro é PURO
> Sob o [[ADR-0023]] quem ocupa etapa é o **Negócio**, não o Lead — e um Lead pode ter vários. Medido em PROD: 36.899 leads têm 1 card, mas **5.187 (12%) têm 2 ou mais**, e 5.165 destes em mais de um funil.
>
> A decisão foi filtro **puro**: basta o lead ter **algum** card numa das etapas marcadas, e o resultado é **uma** execução por resposta, não uma por card. A execução **não** carrega o `deal_id` que casou, e os nós que movem card seguem resolvendo o card como sempre resolveram.
>
> O custo assumido: se a automação move etapa, ela não sabe qual card mover quando há dois elegíveis. Alternativa rejeitada — amarrar a execução ao Negócio — dobraria o custo de dedup, e na variante que dispara por Negócio faria o lead receber duas automações por uma resposta.

`stage_id` nulo chega ao matcher **como nulo**, em vez de ser filtrado da lista: é o que distingue "card sem etapa" (não casa nada) de "leitura falhou" (fail-closed).

### Filtro por número de origem (2026-09-03)

`trigger_config.source_type` + `source_ids`: de qual das **nossas** caixas a resposta precisa ter chegado. Existe para a org com dois números falando com o mesmo lead — só o número escolhido conta.

Não é o mesmo que `channel`: aquele distingue WhatsApp de Meta, este distingue **um número nosso do outro**. Medido: 152 Instances em 62 orgs, e **19 orgs têm 2+ números** (7 com 2, 8 com 3, 2 com 4, 1 com 6, 1 com 57).

`source_type` já nasce como discriminador para o dia em que Instagram e WhatsApp oficial entrarem; hoje só o ramo `whatsapp_instance` é avaliado.

> [!warning] A Instance viaja por DUAS portas, e cobrir uma só falha em silêncio
> Quem conhece a Instance é o `whatsapp-webhook`; quem dispara o gatilho é o `agent-message`. O payload entre os dois não carregava o campo — a identidade do número se perdia uma camada antes de onde o filtro precisa dela.
>
> E são **duas** portas de entrada do `agent-message`: o `fetch` direto e a **fila do Copilot** (`copilot_message_queue`, ligada por org via `COPILOT_QUEUE_ENABLED_ORGS`). Cobrir só a primeira faria o filtro funcionar para umas orgs e falhar em silêncio para as outras.
>
> A fila não tinha seam testável para o payload, então a montagem virou módulo próprio: `_shared/copilot-batch-payload.ts`. Ela usa a Instance da mensagem **mais recente** do batch — o batch é agrupado por telefone+org e pode misturar Instances; a última é a que o lead acabou de usar.

**Fail-closed** quando o evento não diz de onde veio. Sem isso, "só o número do Closer" viraria "qualquer número" em silêncio — que é o que acontecia no caminho do `notificame-webhook`, corrigido junto (ver abaixo).

### Modos de resposta e freio (2026-09-03)

`reply_mode` responde à pergunta que o gatilho nunca tinha respondido: **o que conta como "responder"**.

| Modo | Dispara quando | Campo extra |
|---|---|---|
| `any` (padrão) | qualquer mensagem do lead | — |
| `after_outbound` | só se enviamos algo antes, dentro da janela | `reply_window_hours` |
| `first_of_thread` | só na primeira mensagem depois do silêncio | `new_thread_after_hours` |

> [!important] A evidência viaja congelada, e isso não é detalhe
> `hours_since_outbound` e `hours_since_previous_inbound` vão para o context como **horas decorridas**, nunca como timestamp. O matcher roda de novo no executor, minutos depois — comparar contra "agora" faria a revalidação reprovar exatamente o que o disparo aprovou, e a automação nasceria e morreria sozinha. É a mesma armadilha que quase matou o filtro de funil, por outro caminho.
>
> A leitura do inbound pega **duas** linhas e usa a segunda: a mensagem que acabou de chegar já está persistida quando o gatilho roda, então a primeira é ela mesma. Sem isso, `first_of_thread` compararia a mensagem com ela própria e nunca disparava.
>
> Leitura que falha grava os campos **ausentes**, não `null`: ausência reprova por fail-closed, enquanto `null` afirma "não houve mensagem anterior" e destravaria `first_of_thread` por engano.

`cooldown_minutes` (padrão **60**) é o freio, e **não trouxe mecanismo novo**: a chave de dedup já é `${trigger}:${hash}:${balde}` e o índice único parcial `(workflow_id, lead_id, trigger_dedup_key)` já garante que só o primeiro insert do balde vence. Cooldown é esse balde com outro tamanho, agora por workflow.

> [!note] Efeito de borda, assumido
> Balde é fatia de tempo, não janela deslizante: 10h59 e 11h01 caem em baldes diferentes e as duas passam. Teto de uma execução extra, só na virada. Cooldown exato exigiria consultar a última execução a cada mensagem recebida — recusado.

Um teste trava que os **outros** gatilhos não mudaram de janela: `stage_changed` segue com 300s por causa do incidente de re-disparo de 2026-07-03 (Motor 100).

### Canal oficial disparava sem contexto

O `notificame-webhook` chamava `fireTrigger` **sem `context`**. Como o matcher só compara quando o contexto traz o campo, um workflow restrito a "canal WhatsApp" disparava também com resposta de Instagram — filtro que passa sempre é filtro que não existe, e o filtro por número cairia no mesmo buraco.

A regra mora em `_shared/notificame-reacoes.ts` (`contextoDoGatilho`), junto das outras decisões perigosas do evento, e não no handler: ali ela é exercitada sem banco nem rede. Instagram e Facebook viram `channel: "meta"`, que é como o seletor da tela os chama.

Sem `instance_id` ali, de propósito: o canal oficial não tem Instance de WhatsApp, e fingir que tem seria mentir para o filtro. A ausência reprova por fail-closed quem filtra por número — resposta certa, não lacuna.

### Ponto de disparo (mudou)

O `fireTrigger` saiu do passo 1.7 e virou o passo **0.97** de `agent-message` — antes dos dois gates de Copilot (0.95 early e 1.6), do gate de audiência (1.0) e do de IA-desligada (1.5).

Racional: aqueles gates governam se **a IA responde**, não se **o lead respondeu**. Desligar a chavinha de IA de um contato não deve calar uma automação que não usa IA.

Duas proteções seguram o custo e o laço:
- `hasActiveWorkflowsForTrigger` roda primeiro: sem workflow do tipo na org, sai numa query indexada, sem pagar lookup de lead por mensagem em toda a frota.
- `source: "copilot"` foi mantido, então o origin guard continua descartando workflows que contenham nó de Copilot.

## Mudanças de comportamento

| Antes | Agora |
|---|---|
| Só disparava em org com Copilot ativo (17/99) | Alcança **60/99** — as que têm `copilot` no plano (medido 2026-08-12) |
| Lead com IA desligada não disparava | Dispara (é automação, não IA) |
| Primeiro inbound de número novo disparava (o `identifyTenant` criava o lead antes) | **Não** dispara — número desconhecido é primeiro contato, caso do `lead_created` |

O lookup agora é `findLeadByPhoneOrEmail` (sem criação), não `getOrCreateLead`.

Como a base instalada era zero, nenhuma dessas mudanças regride cliente algum.

> [!warning] "Número desconhecido não dispara" é mais largo do que parece
> Quem cria o lead é o `identifyTenant`, na **linha 374** — depois do gate 0.95. Numa org **sem agente ativo** o fluxo faz early-return no 0.95 e nunca chega lá, e `auto_create_lead_on_inbound` está ON em só **4 das 99** orgs. Ou seja: nessas orgs o lead não passa a existir por este caminho em mensagem nenhuma, não só na primeira — `findLeadByPhoneOrEmail` devolve `null` indefinidamente.
>
> Medido em 2026-08-12, nas orgs-alvo (passam o plan gate, sem agente ativo): de 1.384 números distintos que escreveram em 7 dias, **só 293 tinham lead** — 79% não dispararia. O trigger serve leads que já existem (import, `lead-webhook`, cadastro manual, outro funil), não descoberta de contato novo.

## Limitações conhecidas

- **39 das 99 orgs seguem inalcançáveis** — o PLAN GATE do passo 0.85 (`assertPlanFeature(…, "copilot")`) faz early-return antes do 0.97, então org cujo plano não inclui `copilot` nunca chega ao trigger, mesmo tendo `automations`. Não é regressão (o bloco é byte-idêntico à `main`), mas limita o alcance a 60. Conserto de fundo: gatear o 0.97 por `automations`. Subir o disparo acima do 0.85 **não** é opção — passaria na frente do lock de dedup (0.9).
- **Workflow com nó de Copilot nunca dispara por `lead_replied`** — herdado do origin guard, não introduzido aqui. Armadilha silenciosa: só um `console.log`.
- **Inbound sem texto/mídia não chega** — `computeShouldTriggerCopilot` no `whatsapp-webhook` barra reaction/sticker/enquete sem texto antes de chamar `agent-message`. Mensagem de grupo idem.
- **Respostas em sequência colapsam — mas o mecanismo não é o que parece.** São três guardas distintas, e a de 60s é a menos relevante:
  - **`acquire_copilot_lock` (passo 0.9)** — TTL 60s por `phone`+`org`, e **não é liberado nos early-returns**. É ele que barra o 2º inbound. Em PROD há 513 locks vivos, o mais velho com 1d10h.
  - **Chave de dedup** — hash de `{trigger, channel, message}` num balde de 60s, então só colapsa mensagens de texto **idêntico**. Duas respostas diferentes no mesmo minuto **não** colapsam por aqui.
  - **Skip de execução in-flight** — sem prazo nenhum: enquanto houver execução `running`/`processing`/`waiting_response`/`paused` daquele workflow para aquele lead, não há re-disparo. Hoje são 711 execuções in-flight, mediana de 20h a 2 dias.

  Ao testar na mão, "esperar 60s" resolve só o primeiro caso. Se não disparar, olhe a execução in-flight antes de suspeitar do filtro.
- ~~**Granularidade é o funil, não a etapa.**~~ **Fechado em 2026-09-03.** A divergência que travava isso deixou de existir: `pipeline_entries` ganhou `stage_id` uuid, preenchido em **48.130 das 48.171** entradas. As 41 restantes não casam filtro nenhum, por fail-closed.
- **Funil desativado** continua com entries, então um filtro salvo segue valendo. A UI mostra o funil marcado com `(desativado)` em vez de escondê-lo.

## Onde está

- Matcher + lookups: `supabase/functions/_shared/workflow-trigger.ts` (`matchesTriggerConfig` case `lead_replied`, `loadLeadPosition`, `loadReplyEvidence`, `hasActiveWorkflowsForTrigger`)
- Payload da fila do Copilot: `supabase/functions/_shared/copilot-batch-payload.ts`
- Contexto do canal oficial: `supabase/functions/_shared/notificame-reacoes.ts` (`contextoDoGatilho`)
- Disparo: `supabase/functions/agent-message/index.ts` passo 0.97
- UI: `src/modules/workflows/components/sidebar-panels/TriggerPanel.tsx` (`LeadRepliedConfig`)
- Tipo: `src/types/workflow.ts` (`TriggerConfigLeadReplied`)
- Export/import: `src/lib/workflowPortability.ts` (`pipeline_ids` neutralizado entre orgs)
- Testes: `tests/unit/workflow-trigger-shared.test.ts`, `tests/unit/lead-replied-config.test.tsx`, `tests/unit/notificame-reacoes.test.ts`, `tests/unit/copilot-batch-processor.test.ts`, `tests/unit/webhook-trigger-reactions.test.ts`

Sem migration: `workflows.trigger_config` é jsonb sem CHECK, e o campo é aditivo.

> [!caution] Deploy — edge function PRIMEIRO, front depois
> `agent-message` e o `_shared/` são **edge function = deploy manual**; merge em `main` sobe **só o front**, sozinho.
>
> A ordem não é detalhe: se o front subir primeiro, a UI passa a oferecer o filtro enquanto o backend antigo **não conhece `pipeline_ids`** — e o matcher antigo simplesmente ignora o campo, então o workflow que o cliente criou "restrito a um funil" dispara para **TODOS**. Fail-open, pior que não deployar.
>
> Na ordem certa (edge primeiro) o intervalo é inofensivo: o backend entende o campo, mas ninguém tem UI para preenchê-lo.
>
> ```
> supabase functions deploy agent-message --project-ref jsjsmuncfkbsbzqzqhfq
> supabase functions deploy whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
> supabase functions deploy copilot-batch-processor --project-ref jsjsmuncfkbsbzqzqhfq
> supabase functions deploy notificame-webhook --project-ref jsjsmuncfkbsbzqzqhfq
> ```
>
> São quatro agora, não uma. O `whatsapp-webhook` e o `copilot-batch-processor` carregam a Instance; sem eles o filtro por número reprova tudo (fail-closed) em vez de disparar para todos — degrada fechado, mas degrada.
>
> De worktree **limpa** — o deploy empacota o working tree.
