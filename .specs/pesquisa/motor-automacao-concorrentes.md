# Motor de automação/workflow — pesquisa de concorrentes

**Data da pesquisa**: 2026-08-20
**Contexto**: redesenho do motor de automações do Torque CRM. Comparação de produto contra concorrentes e contra a categoria de motores duráveis.
**Regra de honestidade**: toda afirmação é marcada `[FATO]` (fonte primária citada), `[INFERÊNCIA]` (dedução, com a evidência declarada) ou `[DESCONHECIDO]` (não achei). Lacuna não foi preenchida com plausibilidade.

---

## 1. Resumo executivo

1. **Nenhum dos quatro CRMs publica SLA de latência gatilho→execução.** Nem Kommo, nem Salesforce, nem HubSpot, nem DataCrazy. Isso não é um buraco da pesquisa — é a norma do setor.
2. **O número mais útil da pesquisa é do Salesforce**: interviews pausadas "começam a retomar **dentro de uma hora**"; ações atrasadas rodam "**within one hour**". Nosso p90 de 35–53 min está **dentro** da faixa que o líder de mercado documenta como comportamento normal.
3. **HubSpot é o mais transparente**: é o único que **admite fila por escrito** — "the workflow may be throttled… actions will not execute immediately, but **in a queue**" — e o único que publica uma banda numérica (**janela de 15 minutos** para ações reagendadas). Ainda assim, **não publica SLA nem p95**.
4. **Kommo não publica latência**; o modo de falha documentado dela é outro: estourar 25.000 ações de tag/hora **para os gatilhos por ~1 hora**. Cliff de vazão, não fila lenta.
5. **Nosso teto de 5 execuções/org/min (=300/h) é o mais apertado da amostra**: Salesforce permite 1.000 resume events/h/org, Kommo 25.000 ações/h. Estamos 3,3× abaixo do Salesforce e ~83× abaixo da Kommo.
6. **Premissa refutada, e forte**: DataCrazy publica OpenAPI (38 paths/63 ops), rate limits, status page, 78 artigos de ajuda — **e conta automações por plano (8/20/80/ilimitadas)**. A expectativa de "quase nada público" estava errada. A fraqueza deles é comercial (27% das reclamações = propaganda enganosa), não técnica.
7. **Salesforce**: os 4 números que já usávamos internamente foram **confirmados**, com uma correção — SOQL assíncrono é **200**, não 100.
8. **Reclamação pública de "automação atrasa" na Kommo é fraca** (1 review verificado). O sinal de mercado real é outro: automação **trava** em envio não-entregue, sem branch de erro.
9. **Comprar em vez de construir**: Temporal/Inngest/Trigger.dev resolvem espera longa suspendendo execução (sleep de meses a 100 anos) — nenhum deles cobra por "esperar" exceto o Temporal, que fatura Timer como Action.
10. **Nenhum dos três motores duráveis promete precisão de timer.** O Temporal explicitamente desaconselha depender de sub-segundo.

---

## 2. Tabela comparativa

| Produto | Limites publicados | Atraso declarado | Modelo de execução | Qualidade da fonte |
|---|---|---|---|---|
| **Kommo** | 7 req/s por IP; 50 pipelines/conta; 100 stages/pipeline; 100 webhooks/conta; Salesbot: passos ilimitados, JSON 64KB, pausa máx 8760h | **Sem SLA.** Mas: >25.000 ações de tag/h **param os gatilhos**, que voltam "after about an hour, though it might take a little longer" | `[DESCONHECIDO]` — não publicado | **Boa** — docs oficiais datadas (developers/support.kommo.com) |
| **Salesforce** | Batch 200/chunk; 5 jobs concorrentes; flex queue 100; 100/200 SOQL; 150 DML; 50k linhas; 10s/60s CPU; 6/12MB heap; 1.000 resume events/h/org; 20.000 automações time-based pendentes/org; 250.000 scheduled-path interviews/24h | **Sim, explícito.** Interviews pausadas: batch que "starts resuming **within one hour**". Excedente "**deferred to be processed in the next hour**". Batch Apex: "**There's no guarantee** on how long it takes to start, execute, and finish" | Fila + batch por minuto; retry 15/30/60/120/240 min (máx 5) | **Excelente** — docs versionadas (Summer '26, API 67.0) |
| **HubSpot** | Workflows: 300 (Pro) / 1.000 (Ent) / 400 (Data Hub Pro) / 1.100 (Data Hub Ent), **não somam entre hubs**, teto comprável até 10.000 a $200/mês por 100; 250 gatilhos de enrollment/workflow; API 190 req/10s + 625k–1M/dia; 100.000 logs/dia | **Sim, e admite fila por escrito.** "the workflow **may be throttled**… actions will not execute immediately, but **in a queue** as records are processed". Reagendamento: "**within a 15-minute window**" | Fila com throttling sob carga; janela de jitter de 15 min para ações reagendadas; delays e branches não são reagendados, a ação seguinte é | **Excelente** — KB oficial datado (ago/2026) + catálogo legal |
| **DataCrazy** | **Automações contadas por plano: 8 / 20 / 80 / ilimitadas**; webhooks 3 / 15 / 80; API 60–120 req/min por rota; 429 + `Retry-After` + `X-RateLimit-*`; OpenAPI público (38 paths / 63 ops) | `[DESCONHECIDO]` — nada publicado sobre execução de automação | `[DESCONHECIDO]` | **Boa para API** (OpenAPI + docs + status page); **nula para o motor de automação** |
| **Temporal** | Timer máx **100 anos**; 500 actions/s por namespace; histórico 51.200 eventos / 50MB | "não confie em precisão sub-segundo; trate a duração como **mínimo**" | Event sourcing + replay do histórico | **Excelente** |
| **Inngest** | Sleep até **1 ano** (7 dias no free); 1.000 steps/função; run até 30–366 dias | `[DESCONHECIDO]` — sem declaração de precisão | Memoização de steps sobre invocações HTTP repetidas | **Excelente** |
| **Trigger.dev** | **TTL máximo de run: 14 dias**; 1.500 req/min | `[DESCONHECIDO]` — sem declaração de precisão | Checkpoint/restore de processo (CRIU) | **Excelente** |
| **Torque CRM (nós)** | 5 execuções/org/min (=300/h) | p90 35–53 min; pior caso 250 min | (interno) | Medido em produção |

---

## 3. Kommo (ex-amoCRM) — prioridade máxima

### 3.1 Limites de API

`[FATO]` **7 requisições por segundo, por IP** — não por conta.
> "not more than 7 requests per second"
> "restrictions are repeatedly violated, the IP address is blocked" → 403
— https://developers.kommo.com/docs/limitations (data na página: 2026-03-25)

`[FATO]` Comportamento de 429:
> "If you got the 429 too many times, your account may be blocked, and you'll get 403 response on any API request."
> Corpo da resposta traz `"retry_after": 300`
— https://developers.kommo.com/docs/http-codes

`[FATO]` Limites estruturais da conta (mesma página de limitations):
- Máx **250 entidades** retornadas por request; máx 250 adicionadas/atualizadas (recomendado 50)
- **50 pipelines por conta**
- **100 stages por pipeline**
- **100 webhooks por conta**
- 40 valores de campo customizado por entidade adicionada; 10 listas por conta; 100 sources por integração

`[DESCONHECIDO]` **Limite por conta (vs por IP)**. Circula o número "50 req/s por conta", mas a única fonte alcançável é um **usuário** (não mantenedor da amoCRM) no GitHub issue `amocrm/amocrm-api-php#318`, 22/05/2021. Sem confirmação oficial. **Não usar.**

### 3.2 Salesbot

`[FATO]` **Passos: explicitamente ilimitados.**
> "Currently, you can have any number of steps in a Salesbot, as there are no limitations on the step limit."
— https://support.kommo.com/docs/create-a-salesbot-in-kommo

`[FATO]` Outros limites:
- **100 bots por chamada de launch** ("No more than 100 bots at a time") — https://developers.kommo.com/reference/launch-salesbot (atualizado 2026-02-20). É **batch size do endpoint**, não teto de bots configurados.
- **JSON 64KB**: "there is a limitation on the size of the JSON, which cannot exceed 64KB" — https://developers.kommo.com/docs/salesbot-dp (2026-05-04)
- **Pausa máxima: 8760 horas** (1 ano); quick-reply 13 botões (3 recomendado); list message 10 opções; **Round Robin até 100 ações** — https://support.kommo.com/docs/salesbot-overview (2026-07-13)
- **500 ações por sessão do editor**: "A maximum of 500 actions (adding, editing, deleting triggers) can be performed in a single session"; excedente é descartado — https://support.kommo.com/docs/configure-your-salesbot-triggers (2025-12-05)

`[FATO]` **Concorrência: um bot por entidade.**
> "You cannot continue bot execution if another bot for the same entity is already running."
> "Bot1 will stop working as soon as Bot2 sends a pause step to the client"
— salesbot-dp + https://support.kommo.com/docs/manage-salesbot-interruptions

⚠️ **Correção de um número que circula**: "bot limitado a 100 ações" está **errado** — o 100 é escopo de **Round Robin** apenas.

`[DESCONHECIDO]` Máximo de bots por conta; timeout de execução de bot; total de mensagens por execução.

### 3.3 Digital Pipeline

`[DESCONHECIDO]` **Máximo de automações por stage, gatilhos por stage, condições por gatilho.** Buscado e fetchado: `support.kommo.com/docs/set-up-digital-pipeline-triggers` (2026-03-16), `developers.kommo.com/docs/salesbot-dp`, `developers.kommo.com/docs/webhooks-dp`, página de plan-limits. **Nenhum desses limites é declarado.** O único número adjacente é o botão "+n" da UI depois de 20 gatilhos — isso é display, não teto.

`[FATO]` Os únicos limites de container aplicáveis são os da seção 3.1 (50 pipelines, 100 stages, 100 webhooks).

### 3.4 SLA e latência — **o achado mais importante da Kommo**

`[FATO]` **Não existe SLA.** Termos de uso (última revisão 2026-06-26):
> "The Site, the Services, and all content and documents made available through them are provided on an 'as is' and 'as available' basis"
> "We do not warrant that the Site or the Services will be uninterrupted, error-free…"
> "Response times for technical support are targets only and are not guaranteed."
— https://www.kommo.com/terms/

`[FATO]` https://status.kommo.com/ não publica percentual de uptime nem SLA. Digital Pipeline aparece como componente monitorado; histórico de incidentes vazio no momento do fetch.

`[FATO]` **Parada de hora inteira por vazão** — a Kommo documenta isso nas próprias docs:
> "You can only perform up to 25,000 tag actions per hour. If you exceed this limit, all tag triggers will temporarily stop and you will receive a warning."
> **"Triggers will start working again after about an hour, though it might take a little longer depending on the system."**
> "You can only make up to 25,000 changes per hour. If you try to make more than that, your access to field triggers will be restricted for the next hour."
— https://support.kommo.com/docs/salesbot-triggers-overview

`[FATO]` Tolerância de janela de gatilho:
> "If the trigger time has passed, the task is still executed if it's within half of the specified trigger time window."

`[FATO]` **Webhooks** — https://developers.kommo.com/docs/webhooks-general (atualizado 2026-07-02):
- "Our service expects a response from the webhook within 2 seconds."
- Retries: tentativa 2 em 5 min, 3 em 15 min (códigos 0–99 e 300+); tentativas 4 em 15 min e 5 em 1 hora (códigos 499 e 500–599)
- Desabilitado "If more than 100 invalid responses were received in the last 2 hours"
- Webhooks de DP diferem (2026-04-02): "up to 4 delivery retry attempts within a one-hour period"

`[DESCONHECIDO]` **Qualquer frase do tipo "pode levar até X minutos" sobre despacho normal de gatilho.** As docs da Kommo descrevem apenas atrasos **configurados pelo usuário** (5 min / 10 min / 1 dia / custom) — nunca latência de fila do sistema.

### 3.5 Limites por plano

`[FATO]` Quatro tiers — **Base $15 / Advanced $25 / Pro $45 por usuário/mês / Enterprise custom**. De https://www.kommo.com/buy/tariff/ e https://support.kommo.com/docs/plans-limits (vigente 01/06/2026):

| | Base | Advanced | Pro | Enterprise |
|---|---|---|---|---|
| Leads/assento | 2.500 | 5.000 | 10.000 | Custom |
| Contatos+empresas/assento | 12.500 | 25.000 | 50.000 | Custom |
| Créditos de IA/assento | 750 | 1.250 | 2.250 | Custom |
| Agentes IA/workspace | Nenhum* | 3 | 50 | Custom |
| Campos custom/conta | 100 | 200 | 400 | Custom |
| Pipelines | 50 | 50 | 50 | **100** |
| Números WhatsApp/contas IG | 1/assento | 3/assento | Ilimitado | Ilimitado |

\* `[FATO]` **As duas páginas oficiais se contradizem**: plan-limits diz "None" para agentes IA no Base; a página de preços mostra 3.

`[FATO]` **Base constrói bot mas não roda bot** — e isso contradiz o checkmark da tabela de preços:
> "However, the Base plan has a certain limitation:" — "While you can set triggers and configure a Salesbot within the Salesbot Constructor, **you cannot launch the bot**."
— https://support.kommo.com/docs/configure-your-salesbot-triggers

`[FATO]` Assinatura mínima de **6 meses**; não há opção mensal.

`[DESCONHECIDO]` **Contagem por plano de automações ativas, bots ou disparos/mês.** Não aparece na página de preços nem na de plan-limits.

### 3.6 Reclamações públicas

`[FATO]` **Venues bloqueados**: G2 (403), Trustpilot (403), Reddit (bloqueio de domínio), GetApp (403). Nenhum fórum público de usuários da Kommo foi localizado em URL fetchável. **Isso importa**: os três lugares com maior probabilidade de conter reclamação de confiabilidade são exatamente os inalcançáveis — ausência de evidência aqui é evidência fraca.

`[FATO]` **Acessíveis**: Capterra (páginas 1–8), crmindex.ru.

`[FATO]` **Uma única reclamação verificada especificamente sobre latência** — Fernanda M., Head de SAC, Investment Banking, 5.0 estrelas, **27/04/2026**, Capterra p.2:
> "Em alguns casos, os bots não são ativados rapidamente ou não funcionam corretamente."

`[FATO]` **Evidência mais forte é de automação que TRAVA, não que atrasa** — José A., Gerente General, 2.0 estrelas, **10/01/2025**, Capterra p.5:
> "si envías un mensaje de whatsapp y este no llega a destinatario por que, por ejemplo, el cliente ingresó mal su número en el formulario, **la automatización se bloquea**. Y no hay como configurar ninguna clase de lógica que permita evaluarlo, lo que obliga a revisar de forma manual cada uno de los leads"

`[FATO]` Outros: Leonardo R. (1.0, 19/11/2021) sobre mecânica de ativação de bot; Bethzabel M. (09/02/2023) "A veces el boy [bot] manda un mismo mensaje muchas veces" (envio duplicado); Diego D. (Accounting, mar/2024, **softwareadvice.com**) "the bot never works for me, which is the feature I needed the most" / "I spent three hours trying to solve a bot problem, only to end up without a solution".

`[FATO]` Adjacente — entrega de mensagem/notificação, não o motor: Rafaella R. (17/06/2026) "as vezes com atraso no envio das mensagens"; Igor V. (30/04/2019) "Notifications and messages are sometimes delivered with some delay"; Anton D. (22/11/2018) "failures and delays in the delivery of notifications and messages".

`[FATO]` Instabilidade geral, não específica de automação (~12 reviews): Astrid N. (2.0, 12/04/2023) "cada pocos días la plataforma se daña"; Maria D. (11/10/2019) "at any moment the system may freeze"; crmindex.ru Егор Акимов (30/06/2026) "система иногда подтормаживает в часы пиковой нагрузки" (trava em horário de pico).

`[INFERÊNCIA]` **A tese "automação da Kommo atrasa" NÃO se sustenta no material público.** Evidência: 1 review verificado em 8 páginas de Capterra. O que a Kommo documenta é outra coisa — um **cliff de vazão de escala horária** (seção 3.4). Para um tenant B2B fazendo operação de tag/campo em massa, esse é o modo de falha realista, e é auto-infligido por volume, não fila lenta.

`[INFERÊNCIA]` **A fraqueza melhor evidenciada é ausência de tratamento de erro em envio falho.** Base: o relato do José A. — automação bloqueia permanentemente em mensagem não-entregue, sem branch condicional para detectar. É gap de design, não de latência.

> ⚠️ **Ressalva de método**: o agente de pesquisa se auto-corrigiu e retratou várias citações mal-atribuídas na re-verificação. Tudo acima sobreviveu a um segundo fetch verbatim direcionado. Ainda assim, o corpus recente da Capterra está saturado de reviews 5 estrelas brasileiros cuja única crítica é complexidade de setup — amostra enviesada.
>
> **Retratado explicitamente — NÃO usar**: citações atribuídas a John T. e Nikolay R. sobre atraso de notificação/e-mail; uma review de Florencia P. sobre indisponibilidade de 4 dias; e a alegação de que "mensagens de VKontakte e Avito podem levar até 40 minutos para chegar". Nenhuma dessas foi confirmada em página fetchada — apareceram só em resumo de busca ou em extração de primeira passada.

---

## 4. Salesforce — verificação dos números que já usávamos

Método: `developer.salesforce.com` e `help.salesforce.com` servem SPA vazia para fetch simples. As páginas foram renderizadas em browser real e o texto extraído do DOM. Todas as citações são literais. Páginas de developer trazem seletor de versão visível: **Summer '26 (API version 67.0) — Latest**. Páginas de help **não trazem versão nem data**.

### CLAIM A — Batch Apex 200/chunk, transação separada com limites renovados → **CONFIRMADO**

`[FATO]`
> "Each execution of a batch Apex job is considered a discrete transaction. For example, a batch Apex job that contains 1,000 records and is executed without the optional scope parameter from Database.executeBatch is considered five transactions of 200 records each. **The Apex governor limits are reset for each transaction.** If the first transaction succeeds but the second fails, the database updates made in the first transaction aren't rolled back."

> "If no size is specified with the optional scope parameter of Database.executeBatch, Salesforce chunks the records returned by the start method into **batches of 200 records**."
— https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_interface.htm

`[FATO]` Nuance adicional não presente no claim original: o parâmetro `scope` tem teto de **2.000** quando `start()` retorna QueryLocator; sem teto quando retorna Iterable.

### CLAIM B — 5 batch jobs concorrentes, flex queue 100 → **CONFIRMADO**, com 2 ressalvas

`[FATO]`
> "Up to 5 batch jobs can be queued or active concurrently."
> "Up to 100 Holding batch jobs can be held in the Apex flex queue."
> "If the Apex flex queue has the maximum number of 100 jobs, Database.executeBatch throws a LimitException and doesn't add the job to the queue."
> "The system can process up to five queued or active jobs simultaneously for each organization."
— mesma URL

`[FATO]` **Ressalva 1 — flex queue é condicional**: "If your org doesn't have Apex flex queue enabled, Database.executeBatch adds the batch job to the batch job queue with the Queued status. If the concurrent limit … has been reached, a LimitException is thrown."

`[FATO]` **Ressalva 2 — o 100 não é duro**: "It is possible that the number of jobs in the Apex flex queue sometimes exceeds the maximum limit, resulting from parallel requests to enqueue batch Apex jobs."

### CLAIM C — Governor limits por transação → **CONFIRMADO, com 1 correção**

`[FATO]` Tabela "Per-Transaction Apex Limits", verificada linha a linha em https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm (Summer '26 / API 67.0):

| Descrição | Sync | Async |
|---|---|---|
| Total de queries SOQL | 100 | **200** |
| Registros retornados por SOQL | 50.000 | 50.000 |
| Total de statements DML | 150 | 150 |
| Total heap size | 6 MB | 12 MB |
| CPU máximo nos servidores Salesforce | 10.000 ms | 60.000 ms |
| Tempo máximo de execução por transação Apex | 10 min | 10 min |

**Veredito item a item:**
- 100 SOQL síncrono — **CONFIRMADO**
- ⚠️ **SOQL assíncrono é 200, não 100** — o claim original omitia a distinção. **Corrigir internamente.**
- 150 DML — **CONFIRMADO** (150 para sync **e** async; DML não dobra)
- 50.000 linhas — **CONFIRMADO** (50.000 para ambos; **também não dobra**)
- CPU 10s/60s — **CONFIRMADO** (declarado como 10.000 ms / 60.000 ms)
- Heap 6MB/12MB — **CONFIRMADO**

`[FATO]` Linhas vizinhas relevantes: `Database.getQueryLocator` 10.000 em ambos; callouts 100 em ambos; timeout cumulativo de callout 120s; `System.enqueueJob` 50 sync / **1** async; limite cumulativo cross-namespace de SOQL 1.100.

### CLAIM D — Flow diz que retomada pode atrasar? → **CONFIRMADO no conteúdo, REFUTADO na redação**

`[FATO]` **As docs de Flow nunca usam "no guarantee", "might be delayed" ou "may not run at the exact time".** O que dizem — explicitamente e em vários lugares — é que a retomada é **batched, deferred e rescheduled**, ou seja, mais tarde que o horário agendado. Frases exatas:

**Elemento Wait / interviews pausadas** — https://help.salesforce.com/s/articleView?id=platform.flow_considerations_design_pause.htm&type=5
> "Interviews aren't resumed independently. They're grouped into a single batch that **starts resuming within one hour after the first interview enters the batch**. Actions that run as a result of the grouped interviews are also run in that transaction."

> "If an interview is waiting for a time in the past, Salesforce resumes the interview as soon as possible. **Depending on how many actions Salesforce is processing at the time, actions are run within one hour.**"

> "An org can process up to **1,000 time-based resume events per hour**. … **If an org exceeds this limit, Salesforce defers the remaining resume events to be processed in the next hour.**"

> Exemplo dado pela própria doc: "an org has 1,200 resume events scheduled to be processed between 4:00 PM and 5:00 PM. Salesforce processes 1,000 resume events between 4:00 PM and 5:00 PM and the additional 200 resume events between 5:00 PM and 6:00 PM."

> "Time-based resume events don't support minutes or seconds."

**Scheduled paths** — https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_scheduled_path.htm&type=5 — esta é a frase mais próxima do que se procurava:
> "**If a path is scheduled but doesn't run at the specified time**, it can be because the run of the path failed, potentially due to a problem in the flow itself. You receive an email informing you of the error. **Or it can be because your org exceeded the rolling 24-hour limit. The flow is rescheduled and tried again.**"

> "If a scheduled path interview fails one time, the error email is sent and retried 15 minutes later. The path is retried a maximum of 5 times. So, the scheduled path is retried after **15 minutes, after 30 minutes, and then again in 60, 120, and 240 minutes**."

> "All records that meet the conditions and are scheduled to be processed at the same time are grouped into batches, up to the batch size that you set. If your paths are set to run 10 minutes apart, they aren't batched." (batch size default e máximo 200, mínimo 1)

> "In a scheduled path, all the records that meet the conditions and are scheduled to be processed **in the same minute** are grouped up to the batch size into one batch."

`[FATO]` Evento de debug log: `FLOW_SCHEDULED_PATH_QUEUED` — "An event is logged when a scheduled path is added to **the queue** after a record is created or updated."

**Process Builder scheduled actions** (mesmo motor) — https://help.salesforce.com/s/articleView?id=platform.process_limits_scheduled_processing.htm&type=5
> "An org can process up to 1,000 groups of scheduled actions per hour. … If an org exceeds this limit, Salesforce processes the remaining schedules in the next hour."

`[FATO]` **Comparação útil — Apex TEM a frase que Flow não tem:**
> "Enqueued batch Apex jobs are processed when system resources become available. **There's no guarantee on how long it takes to start, execute, and finish the queued jobs.**"
> "When you call Database.executeBatch, Salesforce only places the job in the queue. **Actual execution can be delayed based on service availability and flex queue priority.**"

`[DESCONHECIDO]` **Schedule-triggered flows** (tipo Start agendado, ≠ scheduled paths): https://help.salesforce.com/s/articleView?id=platform.flow_considerations_trigger_schedule.htm&type=5 **NÃO** afirma que o flow pode começar depois do horário. As únicas frases de timing são "A schedule-triggered flow starts at the specified time and frequency" e "If a flow is scheduled to run one time with a date and time that has passed, the flow doesn't run." **Não confirmado para esse tipo de flow.**

### Limites por org — scheduled paths / paused interviews

`[FATO]` https://help.salesforce.com/s/articleView?id=platform.flow_considerations_limit.htm&type=5 ("General Flow Limits"):

| Limite por org | Todos os tiers |
|---|---|
| Grupos de scheduled actions de processes por hora, baseados em horário específico | 1.000 |
| Total combinado de automações que iniciam/retomam com base em valor de campo (resume events em flows ativos; grupos de scheduled actions em processes ativos; time triggers em workflow rules ativas; interviews inativas retomadas) | **20.000** |
| Schedule-triggered flow interviews por 24h | 250.000, ou nº de licenças × 200, o que for maior |
| Tamanho máximo de flow interview | 1.000.000 B (~1 MB) — "If the interview is too large, it can't be persisted or paused." |
| Heap total por flow interview | 215 MB (API 61.0+) |

`[FATO]` Scheduled-path interviews: **250.000 por 24h ou licenças × 200, o que for maior**. "Paths that run immediately don't count toward this limit. **If the limit is exceeded, the remaining interviews are processed when the limit is reset.**"

`[FATO]` Cap por flow único: "The maximum number of schedule-triggered flow interviews for a single flow is 250,000."

`[DESCONHECIDO]` **Cap por org no número de interviews pausadas/aguardando** não aparece na tabela General Flow Limits. Existem release notes intituladas "Have Unlimited Paused and Waiting Flows" que **não foram abertas** — portanto não afirmo nada sobre isso.

---

## 5. HubSpot

Fonte principal: **https://knowledge.hubspot.com/workflows/workflows-faq** — "Workflows | Frequently Asked Questions", **atualizada em 03/08/2026**. Mais precisa que o catálogo legal; tratada como autoritativa.

### 5.1 Workflows por conta e por plano

`[FATO]` Verbatim da FAQ:
> "If you have a Marketing, Sales, or Service Hub **Professional** subscription, you can create **up to 300 workflows**. If you have a Marketing, Sales, or Service Hub **Enterprise** subscription, you can create **up to 1000 workflows**. If you have an **Data Hub Professional** subscription, you can create **up to 400 workflows**. If you have an **Data Hub Enterprise** subscription, you can create **up to 1100 workflows**. If you have the **Brands add-on**, you can create an additional **100 workflows**. If you have multiple subscriptions, your limit will be determined by the subscription with the highest workflow limit."

`[FATO]` ⚠️ **"Operations Hub" não existe mais no catálogo** — virou **Data Hub**, e é o único hub com teto maior (400/1.100).

`[FATO]` ⚠️ **Os limites NÃO somam entre hubs.** Verbatim: "if your account has a Marketing Hub Professional and a Sales Hub Enterprise subscription, you'd be able to create up to 1000 workflows."

`[FATO]` O que conta contra o limite:
> "Only customized workflows created from the workflows tool will count toward your account limits. Embedded workflow tools with preset triggers do not count toward your workflow limits."

`[FATO]` **O teto é comprável** — https://legal.hubspot.com/hubspot-product-and-services-catalog:
> "**Workflows Limit Increase — $200 per month.** Increase your included workflows volume for your HubSpot automations by 100 workflows. Purchase multiple limit increase packs for more volume. **Maximum capacity of 10,000 workflows per account.**"

### 5.2 Enrollment

`[FATO]` **250 gatilhos de enrollment por workflow** — FAQ:
> "You can add **up to 250 enrollment triggers** to a workflow. If your workflow requires more enrollment triggers, create multiple workflows instead."
E em https://knowledge.hubspot.com/workflows/set-your-workflow-enrollment-triggers (03/08/2026): "You can add **up to 250 filters** to a workflow's enrollment triggers."

`[FATO]` Regras de re-enrollment:
> "By default, records are only enrolled in workflows the first time they meet the workflow enrollment triggers or are enrolled manually."
> "Records that are currently enrolled in a workflow cannot be re-enrolled into that same workflow until they complete the workflow."

`[FATO]` **Retenção**: "90 days: all workflow action log data will be stored." / "6 months: historical data of enrollments will be retained."

`[FATO]` **100.000 logs de execução bem-sucedida por dia** (limite de log, não de operação):
> "there is a **100,000 log limit for successful workflow executions per day**… Once the limit is exceeded, success and info logs will not be stored for the rest of the day, but error logs will continue to appear."

⚠️ `[FATO]` **Armadilha desarmada**: circula um limite de "100.000 registros por conta por dia" de enrollment. Ele existe, mas é **só para sandbox** — https://developers.hubspot.com/changelog/new-daily-limit-for-contact-enrollment-in-workflows-in-test-accounts (anunciado 06/10/2023): "We're implementing a daily record enrollment limit for workflows in **developer test accounts and sandboxes**." **Não citar como limite de produção.**

`[DESCONHECIDO]` **Cap de enrollment por dia/mês em contas de produção.**

### 5.3 Delays — tipos e comportamento

`[FATO]` **Seis tipos** — https://knowledge.hubspot.com/workflows/use-delays (**31/07/2026**):
1. **Calendar date** — "delays enrolled records until a specific date."
2. **Date or datetime property**
3. **Event occurrence** — "delays enrolled records until they complete an event, such as a form submission or website page visit."
4. **Set amount of time** — "delays enrolled records for a specific amount of days, hours, and minutes."
5. **Day of the week**
6. **Time of day**

`[DESCONHECIDO]` **Duração mínima e máxima de delay.** Buscados na página renderizada os termos `maximum`, `minimum`, `at most`, `no more than`, `up to` e numerais soltos — **a HubSpot não publica teto nem piso**.

`[FATO]` **Saída do delay é exata, não difusa**:
> "The enrolled record will exit the delay at the same time that it entered."
> "If you did not select the checkbox, enrolled records will **immediately** proceed to the next action after your configured delay."

`[FATO]` Dias úteis: "If your delay is set to 2 business days and a contact enters the delay on Friday at 3:00 PM, they will exit the delay on Tuesday at 3:00 PM."

`[FATO]` Pegadinha de event occurrence: "If an event has **already happened** when a record enters the delay, it will not immediately exit the delay. Records will only exit the delay if the event occurs while the record is in the delay."

### 5.4 Latência, fila e throttling — **o achado central**

`[FATO]` **A HubSpot admite enfileiramento por escrito.** FAQ, seção "Actions":
> "**Why are my workflow actions not executing at the expected time?** When a large number of records enroll in a workflow or execute an action at the same time, **the workflow may be throttled**. When a workflow is throttled, **actions will not execute immediately, but in a queue as records are processed**. Heavy simultaneous processing can cause actions or property changes to take time to process."

`[FATO]` **Janela de jitter de 15 minutos** — https://knowledge.hubspot.com/workflows/manage-your-workflow-settings (**03/08/2026**):
> "**To prevent workflow overload, actions are rescheduled to execute within a 15-minute window.** For example, if the next available time is 9:00 AM, actions will be rescheduled between 9:00 - 9:15 AM. Delays and if/then branches are not rescheduled, but the following action will be."
> "By default, workflow actions will run **as soon as** an enrolled record reaches the action."

`[FATO]` **Atraso fixo de 10 minutos** em caso específico (FAQ):
> "New contacts will take about 10 minutes to be processed because the contact and company owner sync is enabled… As a result, new contacts will be delayed for 10 minutes before executing the Rotate leads action."

`[DESCONHECIDO]` **SLA de latência, p95, ou "pode levar até N minutos" para o caso geral.** A janela de 15 min aplica-se **apenas a ações reagendadas** (fora do horário de execução ou em data de pausa). Para o regime comum, a única linguagem da HubSpot é qualitativa — "may be throttled… in a queue". **Esse número não existe e não deve ser inventado.**

### 5.5 Rate limits de API

`[FATO]` — https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines. Apps privados: burst por app, **diário compartilhado entre todos os apps da conta**.

| Tier | Por 10 segundos | Por dia |
|---|---|---|
| Free e Starter | 100 / app | 250.000 / conta |
| Professional | 190 / app | **625.000** / conta |
| Enterprise | 190 / app | 1.000.000 / conta |
| Com API Limit Increase | 250 / app | +1.000.000 / conta por incremento |

`[FATO]` "You can purchase a maximum of **two** API limit increases." Catálogo legal: "API Limit Increase **$500 per month**".
`[FATO]` Apps públicos de marketplace: "each HubSpot account that installs your app is limited to **110 requests every 10 seconds**".
`[FATO]` Restrição operacional: "Requests resulting in an error response shouldn't exceed **5%** of your total daily requests."
`[FATO]` Headers: `X-HubSpot-RateLimit-Daily`, `X-HubSpot-RateLimit-Daily-Remaining`; corpo de erro traz `"policyName": "DAILY"`.

> ⚠️ **Número refutado no fetch**: resumos de busca dizem 650.000/dia para Professional. A página oficial diz **625.000**.

## 6. DataCrazy — **premissa refutada**

A expectativa do brief ("quase nada público") está **errada**. Varredura de ~70 URLs.

### 6.1 Documentação técnica pública — **existe, e é extensa**

`[FATO]` **`https://docs.datacrazy.io` → 200.** Portal Mintlify completo, `<title>Introdução - Datacrazy</title>`. O `llms.txt` indexa **~75 páginas**: Leads, Negócios, Tags, Listas, Produtos, Conversas, Conexões, Atendentes, Pipelines, Atividades, Motivos de perda.

`[FATO]` **Spec OpenAPI legível por máquina → 200**: `https://api.datacrazy.io/v1/api/openapi/v1/json`, 103.525 bytes. `"openapi": "3.0.0"`, `"title": "API CRM Datacrazy"`, `"servers": [{"url": "https://api.g1.datacrazy.io"}]`, **38 paths / 63 operações**, auth bearer-JWT.

`[FATO]` **Status page → existe, mas não é linkada de lugar nenhum**: `https://datacrazy.instatus.com`, componentes "Global API", "API Accounts", "API Messaging", "API CRM", todos "100.0% uptime". Autenticidade confirmada por teste de controle (subdomínio Instatus inexistente também devolve 200, mas renderiza a landing do próprio Instatus).

`[FATO]` **Central de ajuda**: `https://help.datacrazy.io` — sitemap comprova **184 URLs / 78 artigos pt-BR / 14 coleções**, incluindo `automacoes`, `agente-de-ia`, `integracoes`, `conexoes`.

`[FATO]` **Blog de engenharia / changelog → NÃO EXISTE.** `blog.datacrazy.io` falha no DNS; `datacrazy.io/blog` faz 301 para a home; `docs.datacrazy.io/changelog` dá 404.

> ⚠️ **Armadilha de método a carregar adiante**: `datacrazy.io/changelog`, `/status`, `/api` e `/developers` devolvem **HTTP 200 mas são soft-404 da home** (conteúdo byte-idêntico). Varredura por status code teria reportado falsamente um changelog e um portal de devs. **Asserir sobre conteúdo, nunca sobre status code.**

### 6.2 Rate limit e webhooks — documentados

`[FATO]` — https://docs.datacrazy.io/essencials/rate-limit.md
> "O limite padrão é de: **60 requisições por minuto para a mesma rota**"
- **429 Too Many Requests**, corpo `{"message": "Too many requests"}`
- Header **`Retry-After`** em segundos (exemplo da doc: 30)
- Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

`[FATO]` Conexão Universal (`universal-connection/overview.md`):
> "A **Conexão Universal** permite que você conecte qualquer serviço externo que possua uma API HTTP/REST como um canal de mensagens dentro do Datacrazy."

`[FATO]` ⚠️ Escolha de design notável, verbatim:
> "⚠️ Importante: O endpoint sempre retorna `{ \"success\": true }` com HTTP 200, **independentemente do resultado do processamento interno**."

### 6.3 Limites por plano — **automação é metrificada**

`[FATO]` https://datacrazy.io/planos publica quotas duras. **Automações são contadas, não ilimitadas** — este é o dado mais acionável da seção:

| | Starter R$297/mês | Essential R$460/mês | Pro R$997/mês | Business R$2.997/mês |
|---|---|---|---|---|
| **Automações** | **8** | **20** | **80** | Ilimitadas |
| **Integrações via Webhook** | **3** | **15** | **80** | Ilimitadas |
| Leads | Até 5 mil | Até 100 mil | Até 500 mil | Ilimitados |
| Pipelines | Até 5 (8 etapas) | Até 20 (15 etapas) | Ilimitadas (25) | Ilimitadas (25) |
| Membros | Até 4 | Até 15 | Até 40 | Ilimitados |
| Rate limit | 60 req/min | 120 req/min | 120 req/min | 120 req/min |
| Acesso à API | — | ✓ | ✓ | ✓ |

`[FATO]` ⚠️ **"Acesso ao MCP" é vendido na página de preços e tem ZERO documentação** — 0 ocorrências no `llms-full.txt` e no sitemap da central de ajuda. O único artefato MCP é `docs.datacrazy.io/.well-known/mcp/server-card.json`, que é **o MCP padrão de busca-em-docs do Mintlify**, provisionado automaticamente em todo site Mintlify. **Não é MCP de produto da DataCrazy.** Confundir os dois seria erro material.

### 6.4 Automações — o que prometem e o que não documentam

`[FATO]` Copy literal de https://datacrazy.io/:
> "IA, automações com regras de negócio inteligentes, BI interno, mensageria conectada e decisões em tempo real, tudo fluindo em um sistema criado para escalar com você."
> "Fluxos de automação inteligentes — Organize leads e clientes em jornadas reais. Automatize mensagens, tarefas, condições e ações por etapa."
> "Crazy IA integrada aos fluxos — Detecte intenção de compra, sentimento e comportamento, e tome decisões automáticas com base em dados reais."
> "Integrações e API avançada — O limite é a sua criatividade. Conecte qualquer coisa, automatize tudo."

`[FATO]` De https://datacrazy.io/whatsapp-crazy-ia: "+2600 usuários ativos mensalmente" e "Disparo em massa com resposta inteligente — Mande campanhas promocionais pelo Whatsapp e deixe a IA continuar a conversa."

`[FATO]` ⚠️ **Na própria página de planos, "Crazy IA", "Whatsapp automatizado" e "Instagram automatizado" estão rotulados verbatim como "Em construção."**

⚠️ `[FATO]` A home anuncia **"Time de suporte com SLA de 5 minutos para primeira resposta"**. Isso é **SLA de suporte humano**, **não** de execução de automação. Não confundir.

`[DESCONHECIDO]` **Latência de execução de automação, teto de passos por fluxo, comportamento de retry/fila.** Existe página de rate limit de API, mas nada equivalente para o motor de automação.

`[DESCONHECIDO]` **Stack técnico.** Deliberadamente não deduzido de marketing.

### 6.5 Reviews e reclamações

`[FATO]` **Reclame Aqui** — https://www.reclameaqui.com.br/empresa/crm-datacrazy/, CNPJ 54.129.748/0001-18, período declarado verbatim "Dados de 01/02/2026 até 31/07/2026":
- Reputação: **"Sem reputação definida"** — "Essa empresa ainda não possui 10 reclamações avaliadas para calcularmos a reputação."
- **9 reclamações**, 100% respondidas, 100% resolvidas, 5 avaliadas. Tempo médio de resposta "1 dia e 5 horas". Nota média: "--".
- Principal problema: **"Propaganda enganosa" 27,27%**.
- Títulos são **integralmente de cobrança/contrato, zero defeito de produto**: "Dificuldade para cancelar assinatura e cobranças recorrentes indesejadas" (≈14/08/2026); "Desconhecimento de contrato e nota fiscal emitida para CNPJ sem contratação do serviço" (22/07/2026); "Débito no Cartão de Serviço não Contratado" (01/07/2026).

`[FATO]` **Ausência definitiva nas plataformas de review B2B**:
- **B2B Stack**: `b2bstack.com.br/busca?q=datacrazy` devolve verbatim **"Resultados para datacrazy (0 resultados)"**
- **Capterra BR**: busca renderizada devolve **"Produtos (0 resultados)"**
- **G2**: só falsos positivos (DataCraft Partners, Datacratic)
- **Reddit / Glassdoor / LinkedIn**: nada
- **Trustpilot**: **INCONCLUSIVO** — `br.trustpilot.com/review/datacrazy.io` devolve 403 tanto para curl quanto para browser headless

⚠️ `[FATO]` Uma nota "4,8/5, +2.600 empresas" que circula em resultados de busca vem de `descontodatacrazy.com.br`, **site afiliado/revendedor auto-declarado, não fonte independente**. **Não citar.**

`[INFERÊNCIA]` **A fraqueza da DataCrazy é comercial, não técnica.** Evidência: 100% das reclamações do Reclame Aqui são disputas de cobrança/cancelamento, com "propaganda enganosa" em 27%; e ausência total de B2B Stack, Capterra BR e G2 significa que **não existe sinal independente de qualidade de produto em nenhuma direção**. O modelo de domínio da API deles (leads, negócios, pipelines, conversas, tags, produtos, atividades) mapeia de perto no do Torque.

## 7. Padrão da indústria — motores de workflow duráveis

Categoria que estaríamos reimplementando. Todos os dados de docs/pricing oficiais, fetchados 2026-08-20.

### 7.1 Temporal

`[FATO]` **Modelo**: Event History + replay. "During a Replay the Commands that are generated are checked against an existing Event History." / "If a failure occurs, the Workflow Execution picks up where the last recorded event occurred in the Event History." — https://docs.temporal.io/workflow-execution

`[FATO]` **Esperas longas**: "A Workflow can sleep for months." "Timers are persisted, so even if your Worker or Temporal Service is down when the time period completes, as soon as your Worker and Temporal Service are back up, the `sleep()` call will resolve." — https://docs.temporal.io/develop/typescript/timers
Máximo: **"Timers have a maximum duration of 100 years in Temporal Cloud."** — https://docs.temporal.io/cloud/limits

`[FATO]` **Não segura recurso durante a espera**: "Workers consume no additional resources while waiting for a Timer to fire, so a single Worker can await millions of Timers concurrently." — https://docs.temporal.io/workflow-execution/timers-delays

`[FATO]` **Cobrança por Action, não por concorrência**. "Actions are the primary unit of consumption-based pricing." **Timer é Action faturável**: "Timer started. Includes implicit Timers that are started by a Temporal SDK when timeouts are set." Também faturam: cada Signal, cada Query, cada start **ou retry** de Activity, start de Workflow/Child Workflow, Continue-As-New. — https://docs.temporal.io/cloud/actions
Escada: $50/M nas primeiras 5M actions → $25/M acima de 200M. Mínimo: Essentials "$100 or 5% of usage". Vazão: **500 actions/s por namespace**. Histórico: 51.200 eventos / 50 MB. — https://docs.temporal.io/cloud/pricing e /cloud/limits

`[FATO]` **Precisão de timer — o único dos três que fala disso**: "your Workflows should not rely on sub-second accuracy for Timers. We recommend that you consider the duration as a **minimum** time, one which will be rounded up slightly due to the latency involved with scheduling and firing the Timer."

`[FATO]` Self-host: **sim**, licença MIT.

### 7.2 Inngest

`[FATO]` **Modelo**: memoização de steps sobre invocações HTTP repetidas. "Each step in your function is executed as a separate HTTP request" … "The steps that successfully executed are memoized." … "Function state is persisted outside of the function execution context." — https://www.inngest.com/docs/learn/how-functions-are-executed

`[FATO]` **Esperas longas**: `step.sleep` / `step.sleepUntil` até **1 ano** (free: 7 dias). Duração máxima de run: 30 dias (Free) / 90 (Basic) / 366 (Pro). — https://www.inngest.com/docs/usage-limits/inngest

`[FATO]` **Sleep não consome capacidade**: "A Function paused by a sleeping Step doesn't affect your account capacity; i.e. it does not count against your plan's concurrency limit."

`[FATO]` **Concorrência é por step, não por run**: "A function run that is sleeping, waiting for an event, or paused between steps does not count against your concurrency limit. Only steps that are actively executing code count toward the limit." — https://www.inngest.com/docs/guides/concurrency
`key` cria fila virtual por valor (ex.: `event.data.account_id` → isolamento por tenant). Escopos: `fn`, `env`, `account`.

⚠️ `[FATO]` **As duas páginas oficiais discordam**: docs dizem "Free 5, Basic 25, Pro 200+, Enterprise Custom"; pricing diz Hobby 5, **Pro 100+**, e não tem tier "Basic".

`[FATO]` Flow control publicado: Concurrency, Throttling, Rate Limiting, Debounce, Priority. Outros limites: 1.000 steps/função; payload de step 4 MiB; estado total 32 MiB; timeout de step 2h.

`[DESCONHECIDO]` Máximo de `step.waitForEvent`; precisão/latência de timer.

`[FATO]` Self-host: **sim** desde 1.0, mas "Inngest's support team does not guarantee direct support for self-hosted instances"; default SQLite não escala além de nó único.

### 7.3 Trigger.dev

`[FATO]` **Modelo — diferente dos outros dois**: checkpoint/restore de processo. "The system uses CRIU (Checkpoint/Restore In Userspace) to create a checkpoint of the task's entire state, including memory, CPU registers, and open file descriptors." Checkpoint ocorre em `triggerAndWait` ou quando `wait.for()`/`wait.until()` passa de 60 segundos. — https://trigger.dev/docs/how-it-works

`[FATO]` **Esperas**: espera <5s mantém o run `EXECUTING` e "holds its slot for the whole wait". Espera >5s: "A wait longer than 5 seconds does not count towards compute usage" — mas o slot só é liberado aos **60 segundos** de espera, quando a máquina é snapshotada e desligada. — https://trigger.dev/docs/wait

⚠️ `[FATO]` **TTL máximo de run: 14 dias.** "all runs have an enforced maximum TTL of 14 days." — https://trigger.dev/docs/limits. **É o teto mais duro dos três para espera de semanas.**

`[DESCONHECIDO]` Duração máxima de wait declarada explicitamente (a página de limites não a documenta; o TTL de 14 dias a limita na prática).

`[FATO]` **Concorrência**: fila por task; `concurrencyLimit` por fila; `concurrencyKey` cria instância de fila por valor único (isolamento por tenant). Ambiente tem limite base + "burstable limit (default 2.0x)".

⚠️ `[FATO]` **As duas páginas oficiais discordam**: pricing diz Free 20 / Hobby 50 / Pro 200+; docs/limits diz Free 10 / Hobby 25 / Pro 100+.
`[INFERÊNCIA]` A razão exata de 2× em todos os tiers bate com o multiplicador de burst 2.0x documentado (base vs. burst). **Nenhuma página afirma isso** — é dedução, não citação.

`[FATO]` Cobrança por compute-segundo ($0.0000169/s Micro → $0.00068/s Large 2x) + $0.25 por 10.000 runs. Outros: API 1.500 req/min; payload 3MB; output 10MB; batch 1.000 itens.

`[DESCONHECIDO]` Precisão/latência de timer.

`[FATO]` Self-host: **sim**, Apache 2.0.

### 7.4 Leitura cruzada

`[INFERÊNCIA]` **Os três cobram em unidades incompatíveis, e isso decide o build-vs-buy para carga "quase toda esperando".** Temporal fatura Timer como Action — workflow que dorme 12 vezes fatura 12 Actions só por esperar. Inngest e Trigger.dev tornam a espera gratuita (>5s no Trigger.dev; sleeps fora da conta de concorrência no Inngest). Evidência: as três páginas de pricing/actions citadas acima. Para o nosso perfil — automação de CRM é dominada por espera — **Temporal é o único onde esperar é linha de custo**.

`[FATO]` **Nenhum dos três publica SLA de latência ou precisão de timer.** Temporal é o único que toca no assunto, e o faz como ressalva ("não confie em sub-segundo"), não como garantia.

---

## 8. O que NÃO consegui descobrir

Seção obrigatória. Cada item foi buscado e **não** encontrado em fonte primária.

**Kommo**
1. Limite de rate por **conta** (só existe o de 7 req/s por **IP**). O "50 req/s por conta" tem como única fonte um usuário no GitHub em 2021 — não oficial.
2. Máximo de **bots por conta**.
3. **Timeout de execução** de Salesbot.
4. Total de **mensagens por execução** de bot.
5. Máximo de **automações por stage** do Digital Pipeline.
6. Máximo de **gatilhos por stage** e de **condições por gatilho**.
7. Contagem **por plano** de automações ativas, bots ou disparos/mês.
8. Qualquer declaração de **latência de despacho em regime normal** ("pode levar até X minutos"). As docs só descrevem atrasos configurados pelo usuário.
9. **Reclamações em G2, Trustpilot, Reddit e GetApp** — todos retornaram 403 ou bloqueio de domínio. Nenhum fórum oficial de usuários foi localizado em URL fetchável. *A ausência de reclamações de latência nesta pesquisa é, portanto, evidência fraca.*

**Salesforce**
10. Confirmação de que **schedule-triggered flows** (tipo Start agendado) podem começar depois do horário — a página de considerações **não** afirma isso. Confirmado apenas para *scheduled paths* e *paused interviews*.
11. **Cap por org de interviews pausadas/aguardando**. Não está na tabela General Flow Limits. Existem release notes "Have Unlimited Paused and Waiting Flows" que **não foram abertas** — nada afirmado.
12. Frase literal do tipo "no guarantee"/"may be delayed" **para Flow**. Ela existe para **Batch Apex**, não para Flow. O conteúdo equivalente em Flow é expresso como batching/deferral.

**HubSpot**
13. **Cap de enrollment por dia/mês em contas de produção.** O limite de 100.000 registros/dia que circula é **só de sandbox** (changelog de out/2023) — não usar como número de produção.
14. **Duração mínima e máxima de delay** em qualquer um dos 6 tipos. Buscados `maximum`, `minimum`, `at most`, `no more than`, `up to` e numerais na página renderizada: a HubSpot não publica teto nem piso.
15. **SLA, p95 ou "pode levar até N minutos" para o regime geral.** A HubSpot admite fila qualitativamente ("may be throttled… in a queue") mas nunca a quantifica. A janela de 15 min cobre só ações **reagendadas**, não latência geral. Esse número não existe — não inventar.

**DataCrazy**
16. **Latência de execução de automação, teto de passos por fluxo, comportamento de retry/fila.** Há página de rate limit de API, mas nada equivalente para o motor de automação. (A contagem de automações **por plano** foi encontrada — 8/20/80/ilimitadas.)
17. **Stack técnico** — deliberadamente não deduzido de marketing.
18. **Conteúdo dos 78 artigos da central de ajuda**, incluindo a coleção "Automações" — só o sitemap e a listagem de coleções foram varridos.
19. **Sinal independente de qualidade de produto.** Ausência confirmada em B2B Stack ("0 resultados"), Capterra BR ("0 resultados") e G2. Trustpilot **inconclusivo** (403 para curl e browser headless). Não há evidência em nenhuma direção.
20. **O que "Acesso ao MCP" da página de planos significa.** Vendido, com zero documentação; o único artefato MCP no domínio é o MCP padrão do Mintlify, não um produto DataCrazy.

**Motores duráveis**
21. **SLA ou precisão de timer** em Temporal, Inngest ou Trigger.dev. Nenhum dos três compromete-se com precisão de disparo.
22. Duração máxima de **`step.waitForEvent`** no Inngest.
23. Duração máxima de **wait** no Trigger.dev declarada explicitamente (só o TTL de 14 dias de run a limita).
24. Reconciliação oficial dos **números conflitantes de concorrência** — Inngest (Pro 100+ vs 200+) e Trigger.dev (docs 2× menor que pricing em todos os tiers). Nenhum fornecedor explica a diferença por escrito.

---

## 9. Implicação para nós

**Nossos números medidos em produção**: p90 de **35–53 min** entre gatilho e primeiro envio; pior caso **250 min**; teto de **5 execuções por org por minuto** (= 300/hora).

1. **O p90 não é o escândalo que parece.** O Salesforce documenta que ações de flow pausado rodam "**within one hour**" e que interviews retomam em batch "**within one hour** after the first interview enters the batch". Nosso p90 de 35–53 min cabe **dentro** da faixa que o líder do setor publica como normal. Contra o HubSpot, porém, ficamos 2–3,5× piores — a janela deles é **15 minutos**.
2. **O pior caso de 250 min é que está fora de curva.** Ele excede a banda de 1 hora do Salesforce em 4×. O único análogo de mercado é o retry ladder do Salesforce (15+30+60+120+240 = 465 min acumulados), mas aquilo é caminho de **falha com e-mail de erro**, não caminho feliz. Nosso 250 min não avisa ninguém. **É aqui que está o gap real, não no p90.**
3. **O teto de 5 exec/org/min é o mais apertado da amostra e é a causa mecânica provável da cauda.** 300/hora contra 1.000 resume events/h/org do Salesforce (3,3×) e 25.000 ações/h da Kommo (~83×). Antes de reescrever o motor, vale medir quanto da cauda de 250 min é fila atrás desse teto — pode ser um parâmetro, não uma arquitetura.
4. **Ninguém no setor promete latência — nem a HubSpot.** Os quatro CRMs não publicam SLA. O que a HubSpot faz e nós não fazemos é **admitir a fila por escrito** e dar uma banda para o caso reagendado (15 min). Declarar "sua automação dispara em até X" continua sendo posicionamento disponível e não ocupado por ninguém — e nos obrigaria a matar a cauda de 250 min primeiro.
5. **Automação é unidade de cobrança na DataCrazy — 8 no Starter, 20 no Essential, 80 no Pro.** Se o nosso motor não conta automações por plano, estamos deixando alavanca de pricing na mesa contra o concorrente brasileiro mais direto; se contamos, vale calibrar contra esses números. Vale também notar que "Whatsapp automatizado" e "Instagram automatizado" estão marcados **"Em construção"** na página de planos deles.
6. **O gap que a Kommo tem e que vale mais que latência**: automação que **trava** em envio não-entregue, sem branch de erro (reclamação verificada, jan/2025). Se o nosso redesenho tiver tratamento de falha de envio de primeira classe, isso é diferencial concreto contra o concorrente mais direto — e é mais barato que perseguir p90 de 15 minutos.

---

### Anexo — nota de método

- `help.salesforce.com` e `developer.salesforce.com` servem SPA vazia para fetch simples. As citações de Salesforce vieram de DOM renderizado em browser real.
- Páginas de `developer.salesforce.com` trazem versão visível (**Summer '26 / API 67.0**); `help.salesforce.com` **não** traz versão nem data.
- O agente de pesquisa da Kommo auto-retratou várias citações mal-atribuídas na re-verificação; tudo o que ficou sobreviveu a um segundo fetch verbatim.
- O agente de HubSpot/DataCrazy pareceu travado e a seção foi levantada em paralelo à mão; o agente depois concluiu com escopo maior (OpenAPI, planos, Reclame Aqui verificado, ausência confirmada em B2B Stack/Capterra/G2) e as seções 5 e 6 foram reescritas sobre o material dele. Onde os dois se sobrepõem, os números batem — inclusive os 625.000/dia.
- **Cinco números que circulam foram refutados no fetch** e não devem ser usados: (1) HubSpot Professional é **625.000**/dia, não 650.000; (2) o "cap de 100 ações" da Kommo é escopo de **Round Robin** apenas; (3) o limite HubSpot de 100.000 enrollments/dia é **só sandbox**; (4) a nota "4,8/5" da DataCrazy vem de site **afiliado**, não de fonte independente; (5) o "50 req/s por conta" da Kommo vem de um **usuário** no GitHub em 2021, não da fornecedora.
- **Armadilha de varredura**: `datacrazy.io/changelog`, `/status`, `/api` e `/developers` devolvem HTTP 200 mas são soft-404 da home. Asserir sobre conteúdo, nunca sobre status code.
