# Auditoria competitiva — Frente 3: Automações, Campanhas e Cadência

**Papel:** Forja (engenheiro) · **Data:** 2026-07-27 · **Base:** `main @c934cc3c` + prod `jsjsmuncfkbsbzqzqhfq` (MCP read_only)
**Escopo:** workflows, campanhas, disparo em massa, templates, follow-ups/revisão, scoring.
**Nesta rodada não foi escrito código, migration, teste nem PR.** Só documento.

---

## 0. TL;DR — as 5 coisas que importam

1. **Três features de automação são fachada: existem na UI, o backend nunca as executa.**
   - Node **`copilot`** do workflow é **no-op comprovado no código** (`_shared/actions/index.ts:135-145`). **23 orgs desenharam** o node no fluxo; **8 orgs já dispararam** (488 `pending_ai_actions` de `generate_message`, 175 em 30d — medição do Crivo). O handoff pra IA não acontece. **Agravante (Crivo): o step é gravado como `success`** — a automação fica verde e ninguém abre chamado. Falha silenciosa com cara de sucesso.
   - **`enrollment_criteria`** (critério de entrada) — a UI grava, **zero leitura no backend**. 178/270 workflows têm o objeto gravado, **0 têm condição real**.
   - **`re_enrollment_*`** — idem, e só 1 workflow do banco inteiro ligou.
2. **Não existe critério de saída (goal).** Lead que fecha negócio no meio do fluxo **continua recebendo mensagem**. Isso é padrão em HubSpot há uma década e é o vetor #1 de cliente furioso e de reclamação de WhatsApp.
3. **Duas portas de disparo de trigger com garantias diferentes.** A porta TS (`workflow-trigger.ts:66-95`) tem a guarda anti-reentrada endurecida pelo incidente Motor 100. A porta PG (`fire_workflow_trigger`, baseline:4524) **não tem**. Medido: **2.604 pares (lead, workflow) com execução repetida, 2.045 leads afetados, pior caso 6×**.
4. **37% das execuções falham** (5.553 de 14.910). Causa #1 = `WhatsApp instance not available` (1.796, 20 orgs). Não é bug de motor — é instância desconectada. O produto não avisa ninguém.
5. **Temos 4 mecanismos de envio e só 1,5 estão vivos.** Campanha (12 registros, 0 criadas em 90d, 1 dispatch rule no banco inteiro) e disparo em massa (3 blast_plans, 3 sender jobs) estão clinicamente mortos. **Recomendação: absorver campanha em workflow+funil e manter /disparos só como one-shot.** Detalhe na §7.

---

## 1. Números de prod (evidência)

Adoção geral — **fonte: Lanterna**, medido 2026-07-27, denominador **93 orgs** (66 ativas em 30d, 87 em 90d; o "~30 orgs" do CLAUDE.md está stale):

| Métrica | Valor |
|---|---|
| Workflows totais / ativos | 270 / 115 |
| Orgs com ≥1 workflow / com workflow ativo | 72 (77%) / 41 (44%) |
| Workflows que **nunca executaram** | 162 (60%) — **33 deles ATIVOS** |
| Execuções 90d / 30d | 14.071 / 5.412 |
| Orgs que executaram workflow 30d | 35 |

Medições minhas (complementares, não duplicam a Lanterna):

| Métrica | Valor | Query |
|---|---|---|
| Execuções por status | completed 9.264 · **failed 5.553 (37%)** · cancelled 64 · waiting_response 25 · running 4 | `group by status` |
| Pares (lead, workflow) com >1 execução | **2.604** · 5.337 execuções · **2.045 leads** · pior caso **6×** | `having count(*)>1` |
| Uso por tipo de node | action 1.667 · wait_response 849 · trigger 270 · delay 188 · **condition 61 (só 9 orgs)** · wait_business_window 57 · end 40 · **copilot 29 (23 orgs)** · assign_responsible 27 · split_ab 17 · **webhook_call 0 · goto 0** | `jsonb_array_elements(definition->'nodes')` |
| Trigger types | stage_changed 164 (47 orgs) · lead_created 77 (45 orgs) · tag_added 12 (**1 org**) · lead_added_to_campaign 11 · scheduled_date 4 · lead_no_reply 1 · cron 1 | `group by trigger_type` |
| `enrollment_criteria` | objeto gravado em 178 · **enabled=true em 1** · **com condição real em 0** | `jsonb_array_length(...->'conditions')` |
| `re_enrollment_enabled` | **1** workflow no banco inteiro | — |
| Campanhas | 12 (9 orgs), **0 criadas em 90d**; `campanha_dispatch_rules` = **1** | — |
| Disparo massa | `blast_plans` = **3** (2 orgs, 54 destinatários) · `uazapi_sender_jobs` = **3** | fonte: Lanterna |
| `/disparos` visitado | **47 orgs** em 90d, 820 visitas → **2 orgs** geraram blast_plan | fonte: Lanterna |
| Follow-ups | 1.122 totais · **272 em 90d, 23 orgs** | — |
| `message_templates` (`/templates`) | **3 registros, 2 orgs** | — |
| `qualification_score > 0` | **117 de 32.683 leads (0,36%)** | — |
| `qualification_tier` preenchido | 2.009 de 32.683 (6%) — prata 787, bronze 522, desq. 461, ouro 149, diamante 90 | — |

Top causas de falha (`workflow_executions.error`, status=failed):

| Erro | n | orgs |
|---|---|---|
| `WhatsApp instance not available` | **1.796** | 20 |
| `Evolution POST /message/sendText/... HTTP 500` | 470 | 1 |
| `Uazapi server error 503 on POST /send/text` | 318 | 10 |
| `Empty message template` | 290 | 1 |
| `No team member configured` | 252 | 1 |
| `Lead has no phone` | 187 | 7 |
| `Etapa inválida para funil whatsapp...` | 308 (3 variantes) | 1–3 |

**Caveat de telemetria (Lanterna):** `usage_events.module_visited` só instrumenta 7 módulos — `pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`. **Não existe evento para `automacoes`.** Toda afirmação de uso de automação neste doc vem de dado de banco (workflows/execuções), nunca de "ninguém visitou".

---

## 2. Respostas às 8 perguntas do brief

### 2.1 Re-entrada, concorrência e saída (goal)

**Um lead pode entrar duas vezes no mesmo workflow? Sim — e entra.**

Existem **duas portas** que criam `workflow_executions`, com garantias assimétricas:

| Porta | Onde | Guarda de re-entrada |
|---|---|---|
| **TS** — `fireTrigger` | `supabase/functions/_shared/workflow-trigger.ts:66-95` | ① **skip se já existe execução in-flight** (`running/processing/waiting_response/paused`) para aquele lead+workflow ② + chave de dedup determinística por janela (300s stage_changed, 60s resto) com índice único parcial `ON CONFLICT DO NOTHING` (`:104-137`) |
| **PG** — `fire_workflow_trigger` | `supabase/migrations/20260101000000_baseline_prod_schema.sql:4524-4593` | **só ②** — a janela de dedup. **Não checa execução in-flight.** |

Quem usa qual:
- `stage_changed` de pipeline **vai pela porta TS** — o trigger PG faz `net.http_post` para `process-workflow-executions` mode `fire_trigger` (baseline:20692-20713), então cai no `fireTrigger` protegido. ✅
- `lead_created`, `tag_added`, `lead_assigned`, `score_reached`, `field_changed`, `meeting_confirmed`, `proposal_result`, `lead_added_to_campaign`, `campaign_*` — chamam `fire_workflow_trigger` **direto no Postgres** (ex.: `trigger_workflow_lead_created`, baseline:20xxx `PERFORM public.fire_workflow_trigger(...)`). ❌ sem guarda de in-flight.

Consequência prática: um lead recriado/reimportado, ou re-taggeado 2 minutos depois, abre **uma segunda execução paralela** do mesmo workflow — e as duas mandam mensagem. Medido: 2.045 leads com execução repetida, até 6 execuções do mesmo workflow para o mesmo lead.

> A guarda de in-flight foi introduzida exatamente por causa do incidente 2026-07-03 ("Motor 100", 7-12 disparos por lead) — o comentário em `workflow-trigger.ts:73-88` documenta isso. **A correção nasceu só de um lado da bifurcação.** É o achado mais acionável do doc.

**Critério de saída / goal: NÃO EXISTE.** Grep por `goal|exit_criteria|suppression` em `supabase/functions` + `src/modules/workflows` retorna **zero**. Não há:
- goal ("se o lead virou cliente, tira do fluxo"),
- suppression list ("nunca mandar pra estes"),
- cancelamento automático por conversão. Ninguém escreve `status='cancelled'` em `workflow_executions` no código de produto (só `pipe-rule-dispatch/index.ts:226` e `campaign-rule-dispatch/index.ts:208`, e por migração de regra, não por conversão).

**O que acontece se o lead converte no meio do fluxo:** o fluxo continua. Um `delay` de 1 dia seguido de `send_whatsapp` vai disparar mesmo que o lead já tenha comprado, respondido, pedido para parar ou sido marcado como perdido. A única saída é `wait_response` (`workflow-executor.ts:423-479`) — que só ramifica se o lead responder **naquele node específico**, e só naquela janela.

**Efeito sobre risco de ban (área frágil):** duplo. (a) mensagem para quem já converteu tem taxa de bloqueio/report alta — é exatamente o sinal que a Meta usa; (b) execuções paralelas do mesmo workflow multiplicam volume por lead. O Send Governor amortece o volume agregado (§2.4), mas não sabe que a mensagem é indesejada.

### 2.2 Observabilidade

**É a nossa parte mais forte — melhor que Pipedrive.**

`/automacoes/:id/execucoes` (`src/modules/workflows/pages/AutomacoesExecucoes.tsx`) mostra:
- 4 contadores: concluídas / falhas (inclui `loop_limit_reached`) / canceladas / em andamento (`:118-133`);
- lista de execuções com status, badge, e **badge "Retry" com linhagem** (`retry_of`, `:168,197-201`);
- drill-down por execução → **steps individuais** com `node_label`, `node_type`, status por step (success/failed/skipped) e `retry_attempt` (`:303-357`);
- **reprocessar execução falhada** com confirmação (`:63-67, 212-222, 245-260` → `useRetryWorkflowExecution`).

Além disso existe um dashboard master `/master/automation-health` com dead-letter, failed workflows, stuck actions, circuit-broken webhooks e alertas (`useAutomationHealth`).

**O que falta vs. mercado:** **histórico por contato**. HubSpot mostra, na ficha do contato, "este contato passou por estes fluxos, nesta data, saiu por este motivo". Nós não temos: grep por `workflow` na timeline de leads (`src/modules/leads/components/timeline/`, `src/modules/leads/hooks/`) retorna nada relevante. O vendedor abre o lead e **não sabe** que uma automação mandou 3 mensagens ontem — vai mandar a quarta na mão. Para um time de 3 vendedores no WhatsApp isso é caro.

Segundo gap: a lista de execuções é **por workflow**. Não há visão "todas as execuções falhando agora na minha org" para o admin (só master vê `automation-health`). Com 37% de falha e 20 orgs sofrendo de instância desconectada, o admin da org não tem como saber.

### 2.3 Branching real

**Só if/else binário, campo único, sem grupos.**

`workflow-executor.ts:253-356`, ramo `conditionMode === "field"`: lê **um** `node.data.field`, **um** `operator`, **um** `value`, chama `evaluateCondition` e escolhe entre a aresta `true` e a `false` (`:334-352`). Não há `AND`/`OR` entre condições, não há N ramos, não há switch.

O avaliador (`workflow-condition-evaluator.ts`) é razoavelmente rico no que **um** campo pode ser:
- **campo customizado**: sim — `field` com prefixo `custom.` (`:60-64`);
- **tag**: sim — `field === "tags"` resolve nomes de tag e compara com `contains` (`:65-67`);
- **valor numérico**: sim — `score` → `qualification_score`, `rating`, comparadores `greater_than/less_than` (`:68-70`, `compare` em `:108+`);
- pseudo-campo `any_responsible` que combina pré-venda + venda com booleano correto por operador (`:71-77, 87-106`) — **isso é bom e específico do nosso domínio**.

Há também `conditionMode === "time_window"` (`:256-318`) — condição de janela comercial que **pausa e reagenda** em vez de cair no ramo falso. Bom design, é diferenciação real.

**Veredito:** o motor de condição é decente; a **expressividade é o gargalo**: sem `E`/`OU` o cliente precisa encadear 3 nodes para "origem = meta_ads E score > 50", e cada node é mais um ponto de falha. Uso real confirma o atrito: **condition aparece em só 30 workflows de 9 orgs** — 61 usos contra 1.667 de `action`.

### 2.4 Segurança de envio — o choke cobre o workflow?

**Sim, o caminho de workflow está coberto.** Cadeia verificada:

```
workflow-executor "action"
  → _shared/workflow-action-handler.ts
  → _shared/action-handlers/send-whatsapp.ts:72  → sendTextViaInstance
  → _shared/whatsapp-dispatch.ts:299-343         → governSend  (linha 313)
```

Os **cinco** senders de `whatsapp-dispatch.ts` passam pelo governor: `sendTextViaInstance:313`, `sendAudioViaInstance:356`, `sendMenuViaInstance:411`, `sendPixButtonViaInstance:470`, `sendMediaViaInstance:521`. `send-whatsapp-rich.ts:70,152,256` e `send-to-number.ts:43` usam os mesmos helpers.

Por cima do governor há dedup de conteúdo: `send-whatsapp.ts:8` e `send-to-number.ts:45` chamam `reserveSendOrSkip` (`send_dedup_log`, PR #1252).

**Ressalva do Crivo (frente IA), que vale registrar aqui:** o caminho **conversacional** da IA — `outbound-sender.ts:182` (turno via `outbound-trigger`) e `copilot-v2-worker/index.ts:170` — chama `governSend` **direto, sem `reserveSendOrSkip` por cima**. Ou seja: **coberto pelo choke, não coberto pelo dedup de conteúdo**. Bate com a memória `send-dedup-cobre-so-workflow`. Não é caminho de workflow (por isso não entra na minha matriz), mas quem for mexer em envio precisa saber que a cobertura de dedup é desigual entre os dois caminhos.

**Onde ainda dá duplicado, em ordem de gravidade:**
1. **Duas execuções concorrentes do mesmo workflow** (§2.1). O `send_dedup_log` mata a *mesma mensagem* dentro da janela; **não** mata "duas execuções mandando a sequência inteira com 1h de diferença". O governor vê tráfego legítimo. **Este é o buraco real.**
2. **Sem goal** (§2.1): o lead que já respondeu no chat continua na fila do fluxo. Nenhum choke resolve — é semântica, não volume.
3. **`fire_workflow_trigger` é `SECURITY DEFINER`, recebe `p_organization_id` por parâmetro, tem `GRANT ... TO authenticated` (baseline:8970) e não faz nenhuma checagem de autorização no corpo.** Qualquer usuário autenticado pode disparar workflows de **qualquer** organização passando o UUID. É o padrão que a memória `definer-rpc-org-param-authenticated` já classificou como vetor cross-tenant de escrita/DoS. **Não é gap de produto, é achado de segurança** — reportar separado; não cabe nesta matriz.

### 2.5 Curva de criação — custo em cliques da automação mais comum

Cenário: *"lead entrou → manda mensagem em 5 min → se não responder em 1 dia, manda de novo."*

**Torque, do zero** (`/automacoes` → `/automacoes/novo`, editor DAG em `AutomacoesEditor.tsx`): o usuário monta o grafo nó a nó — trigger, delay, ação, wait_response, ação — arrastando da paleta, ligando arestas, e abrindo o painel lateral de cada node para configurar. Estimativa conservadora: **~30-40 interações** (navegação + 5 nodes + 4 arestas + configuração de cada painel + nome + salvar + ativar). Exige entender o conceito de DAG, de handle `replied` vs `timeout`, e de aresta direcionada.

**Torque, a partir de template**: `/automacoes` → botão de templates → escolher → clonar → ajustar texto → ativar. **~6-8 cliques.** Existem **7 templates de sistema** (`src/modules/workflows/lib/funnelTemplates.ts` — Disparo Automático, Disparo Qualificado, Disparo Pré-Qualificado, Nutrição Infinita ×3 variantes) visíveis a todas as orgs.

**Pipedrive**: automação é formulário linear "quando *gatilho* → então *ação*", com biblioteca de receitas prontas. O caso acima são ~2 automações encadeadas, ~10-12 cliques, sem canvas.
**HubSpot**: editor visual com if/then, mas o fluxo padrão parte de template e o delay + branch são 2 blocos. Comparável ao nosso caminho de template, superior ao nosso caminho do zero.

**Veredito honesto:** **do zero somos ~3× mais caros que o Pipedrive**; **via template somos competitivos**. O problema não é o preço do template — é que **o template não é a porta padrão**: `/automacoes/novo` (`Automacoes.tsx:210,237`) leva direto para a tela em branco, e o import/template está atrás de outro botão. **60% dos workflows nunca executaram** — canvas em branco é uma explicação forte, junto com os no-ops da §0.

### 2.6 Biblioteca de receitas prontas

**Temos, e ninguém tropeça nela.** 7 templates de sistema em `funnelTemplates.ts` (auto-gerados dos funis A/B da Milennials), mais `workflow_templates` no banco e `useCloneWorkflowTemplate`. É bom conteúdo — são fluxos reais que funcionaram.

Gaps vs. mercado: (a) template não é a porta padrão (§2.5); (b) todos os 7 são variação de "disparo + nutrição" — não cobrem "follow-up de proposta parada", "reativação de lead frio", "aviso de reunião amanhã", que são os pedidos recorrentes de uma distribuidora B2B; (c) nenhum template usa `condition`, `split_ab` ou `wait_business_window` — quem clona nunca descobre esses nodes.

### 2.7 Os 4 mecanismos de envio — posição explícita

Temos quatro caminhos que mandam mensagem para lead. **Não é sobreposição confusa em teoria — é sobreposição já resolvida pelo mercado interno: os clientes escolheram dois.**

| Mecanismo | Onde | Uso real (prod) | Posição |
|---|---|---|---|
| **Workflow** | `/automacoes` | 115 ativos, 41 orgs, 5.412 exec/30d | **É o motor.** Tudo converge aqui. |
| **Copilot** | `/copilot` | fora do meu escopo (Crivo) — mas o node `copilot` do workflow é no-op | Canal conversacional, complementar. Não compete. |
| **Campanha** | entidade `campanhas` | 12 registros, 9 orgs, **0 criadas em 90d**, 1 dispatch rule no banco | **MORTA.** UI Kanban já foi deletada (campaigns/CLAUDE.md); sobrou entidade + motor de sequência que ninguém usa. |
| **Disparo em massa** | `/disparos` | 3 blast_plans, 3 sender jobs, **mas 47 orgs visitam a tela** | **Vivo como intenção, morto como resultado.** |

**Recomendação (esta é a resposta que o brief pede):**

1. **Absorver Campanha em workflow + funil com prazo.** A UI já foi retirada; o que sobrou é `campanha_dispatch_rules` + `campanha_dispatch_rule_steps` — um **segundo motor de sequência** (trigger types próprios, step actions próprias, timeout actions próprias — ver `campaigns/CLAUDE.md` §Áreas frágeis) paralelo ao executor de workflow. **1 regra no banco inteiro.** Manter dois motores de sequência para uma regra é custo puro. Veredito: **REMOVER** o motor de dispatch rules; **MANTER** a entidade `campanhas` só como agrupador/atribuição (round-robin, metas) até o épico de métricas decidir o destino. Nada disso toca caminho de envio vivo → **risco de ban: nulo**, porque o motor removido não dispara hoje.
2. **Manter `/disparos` como o one-shot**, e investigar o funil 47→2 antes de mexer em qualquer outra coisa. 47 orgs entram na tela e 2 conseguem disparar: isso é um problema de conversão de UI, não de motor. **Caveat da Lanterna:** confirmar se existe caminho de disparo que não grava `blast_plans` (`mass-send-create` direto) antes de afirmar "ninguém dispara". Não afirmo.
3. **Consertar o node `copilot` ou removê-lo.** Hoje ele é uma terceira ponte fantasma entre workflow e IA (§0). Duas opções: implementar `generate_message` de verdade, ou tirar o node da paleta. **A pior opção é a atual** — 23 orgs acreditam ter um handoff que não existe. Se for implementado, o envio **tem** que sair por `whatsapp-dispatch.ts` (governor) e não por caminho novo — abrir um segundo caminho de envio de IA seria criar exatamente o vetor de ban que o choke único existe para fechar (ver memória `dedup-choke-placement`).

**Nota lateral (fora da matriz):** `outbound_dispatches` — documentada em `campaigns/CLAUDE.md:26,109` como "fila de itens disparados com retry" — **não existe em prod** (`relation "outbound_dispatches" does not exist`). Mais uma ref fantasma do padrão já catalogado em `refs-fantasma-objetos-ausentes`. A edge function `process-outbound-dispatches` e o cron seguem no repo.

### 2.8 Lead scoring / qualificação automática

Temos **dois** campos e **um** vivo:

- **`qualification_score` (0-100)**: **117 leads de 32.683 (0,36%)**. No backend só é **lido** (`workflow-condition-evaluator.ts:71`, `get-daily-priorities/index.ts:245-259`, `process-copilot-followups:330`); os únicos writes que achei são de teste (`test-workflow-system`). Existe um action handler `_shared/action-handlers/calculate-score.ts`, mas nenhum template o usa. **Na prática o campo é morto.**
- **`qualification_tier`** (diamante/ouro/prata/bronze/desqualificado): **2.009 leads (6%)**, alimentado pelo rubric-engine do Copilot v2 (`_shared/copilot-v2/rubric-engine.ts`) e pela API de escrita de leads. **Este é o que vive** — e é filtrável no board (memória `kanban-qualification-filter`).

**Mercado:** RD Station e HubSpot dão **scoring configurável pelo cliente** — o admin define "empresa com +50 funcionários = +20 pontos, abriu email = +5". Nós temos um rubric de IA que o cliente não edita e um score numérico que ninguém alimenta.

**Veredito:** não copiar o scoring de inbound americano (email opens, page views — não temos esses sinais e o ICP é WhatsApp outbound). **A jogada certa é matar `qualification_score` e apostar no `tier` da IA, tornando o rubric editável pelo admin.** É o mesmo benefício ("o sistema me diz em quem focar") pelo mecanismo que já funciona aqui.

---

## 3. Matriz de vereditos

| # | Feature | O que temos hoje (arquivo:linha) | Pipedrive / HubSpot / RD | Veredito | Por quê | Esforço |
|---|---|---|---|---|---|---|
| 1 | **Node `copilot` no workflow** | Insere `pending_ai_actions{action_type:'generate_message'}` (`workflow-executor.ts:406-421`); handler é **no-op declarado** (`_shared/actions/index.ts:135-145`). 29 usos, 27 workflows, **23 orgs desenharam**; **8 orgs já dispararam** (488 ações, 175 em 30d — Crivo). Step gravado como `success` | HubSpot tem ação "enviar via chatbot/sequence"; funciona | **MUDAR** (implementar ou tirar da paleta) | 23 orgs têm um handoff decorativo e 8 já o executaram achando que funcionou. Fica verde no painel → ninguém abre chamado. Feature que mente é pior que feature ausente. Se implementar: envio **obrigatoriamente** por `whatsapp-dispatch.ts` (governor), nunca caminho novo | **M** |
| 2 | **`enrollment_criteria`** (critério de entrada) | UI grava (`AutomacoesEditor.tsx:456`, `EnrollmentCriteria.tsx`); colunas no baseline:28320-28323; **zero leitura em `supabase/functions`**. 178 objetos gravados, **0 com condição, 1 enabled** | Enrollment criteria é o coração do HubSpot Workflows | **REMOVER/ESCONDER** agora, **ADICIONAR** de verdade depois | Ninguém preencheu (0 condições reais) → remover a aba não machuca ninguém e para de mentir. O valor real vem junto com goal (#4) | **P** (esconder) / **G** (implementar) |
| 3 | **`re_enrollment_*`** | Idem #2 (`ReenrollmentConfig.tsx`, colunas baseline:28321-28323). **1 workflow ligou no banco inteiro** | Re-enrollment é config padrão HubSpot | **REMOVER/ESCONDER** | Mesma razão. E hoje a re-entrada é decidida por outro mecanismo (dedup de trigger), o que torna a config ativamente enganosa | **P** |
| 4 | **Critério de saída / goal** | **Não existe.** Grep `goal\|exit_criteria\|suppression` = 0. `wait_response` (`workflow-executor.ts:423-479`) é o único desvio, e só no node dele | HubSpot: goal tira o contato do fluxo ao converter. Pipedrive: condição de parada. RD: idem | **ADICIONAR** — *maior item do doc* | Lead que comprou continua recebendo. É o vetor #1 de cliente furioso e de report de WhatsApp. Para ICP com WhatsApp como canal principal, isso é dano direto de reputação | **M** |
| 5 | **Guarda de re-entrada assimétrica** | TS tem skip de in-flight (`workflow-trigger.ts:66-95`); PG `fire_workflow_trigger` (baseline:4524-4593) **não tem**. `lead_created`/`tag_added`/etc entram pela porta PG. Medido: 2.604 pares repetidos, 2.045 leads, até 6× | Ambos: enrollment único é o default | **MUDAR** — *maior item de risco de ban* | A correção do incidente Motor 100 nasceu só de um lado da bifurcação. Duas execuções concorrentes mandam a sequência inteira duas vezes e o `send_dedup_log` não pega (mensagens em janelas diferentes) | **M** |
| 6 | **Observabilidade de execução** | Contadores + lista + steps por execução + linhagem de retry + reprocessar (`AutomacoesExecucoes.tsx:118-133,168,197-201,212-222,303-357`); `/master/automation-health` com dead-letter | Pipedrive é bem mais raso. HubSpot é comparável | **MANTER+VENDER** | É genuinamente melhor que Pipedrive. Deveria aparecer em demo e onboarding | — |
| 7 | **Histórico por contato** | **Não existe.** Nenhuma referência a workflow na timeline do lead | HubSpot mostra na ficha "passou por estes fluxos" | **ADICIONAR** | Vendedor abre o lead sem saber que a automação mandou 3 mensagens ontem → manda a quarta na mão. Dano direto ao cliente final, e é dado que já temos em `workflow_executions` | **P** |
| 8 | **Saúde da automação para o ADMIN da org** | Só master (`/master/automation-health`). Admin da org não vê nada | HubSpot expõe erro de fluxo ao dono | **ADICIONAR** | **1.796 falhas por `WhatsApp instance not available` em 20 orgs.** A automação está morta e ninguém na org sabe. Melhor ROI de suporte do doc | **P** |
| 9 | **Branching (`condition`)** | if/else binário, campo único (`workflow-executor.ts:334-352`); avaliador cobre custom field, tag, número, `any_responsible` (`workflow-condition-evaluator.ts:60-77`) | HubSpot: if/then multi-ramo com grupos AND/OR | **MUDAR** (adicionar AND/OR; multi-ramo é opcional) | Sem E/OU o cliente encadeia 3 nodes por regra. Uso real confirma o atrito: condition em só 9 orgs | **M** |
| 10 | **`condition` por janela de horário** | `conditionMode==='time_window'` **pausa e reagenda** em vez de cair no falso (`workflow-executor.ts:256-318`); + node `wait_business_window` (57 usos, 10 orgs) | Ninguém faz isso tão bem para WhatsApp | **MANTER+VENDER** | Mandar às 3h da manhã queima instância e reputação. Somos melhores aqui, e é argumento comercial concreto para o ICP | — |
| 11 | **`split_ab` com sticky + override por tag** | `workflow-executor.ts:482+`, `resolveOrCreateSplitAssignment`; `SplitAbAnalytics` | Pipedrive não tem. HubSpot tem em tier caro | **MANTER+VENDER** | Diferenciação real. Uso baixo (17, 9 orgs) porque nenhum template usa — resolver via #15 | — |
| 12 | **Send Governor cobre workflow** | `send-whatsapp.ts:72` → `sendTextViaInstance` → `governSend` (`whatsapp-dispatch.ts:313`); 5/5 senders governados (`:313,356,411,470,521`); `reserveSendOrSkip` por cima (`send-whatsapp.ts:8`, `send-to-number.ts:45`) | Não aplicável — nenhum concorrente tem o problema de instância WhatsApp | **MANTER** | Está correto. **Nenhuma proposta deste doc abre caminho de envio fora deste choke** | — |
| 13 | **Motor de sequência de campanha** | `campanha_dispatch_rules` + `_steps`; motor paralelo ao executor (`campaigns/CLAUDE.md` §Áreas frágeis). **1 regra no banco inteiro**, 0 campanhas criadas em 90d | Mercado tem **um** motor | **REMOVER** | Segundo motor de sequência com 1 usuário. Custo de manutenção e de confusão sem contrapartida. Não dispara hoje → **risco de ban da remoção: nulo** | **M** |
| 14 | **`/disparos` (blast)** | Wizard linear de 6 passos (`campaigns/components/disparo-wizard/`), plano auto-batched, janela segura (`blast-planning.ts`). **47 orgs visitam / 2 disparam** | Pipedrive/HubSpot não fazem blast de WhatsApp | **MANTER + MUDAR (conversão)** | O motor é bom e seguro. O funil 47→2 é problema de UI/pré-requisito. Investigar antes de tocar. **Caveat Lanterna:** confirmar se há caminho que não grava `blast_plans` | **P** (diagnóstico) |
| 15 | **Biblioteca de templates** | 7 templates de sistema (`lib/funnelTemplates.ts`), `workflow_templates`, `useCloneWorkflowTemplate` | Pipedrive: receitas prontas são **a porta padrão** | **MUDAR** — template vira a porta padrão de `/automacoes/novo` | Do zero somos ~3× o Pipedrive em cliques; via template somos competitivos. **60% dos workflows nunca executaram** — canvas em branco é explicação forte. Também cobre split_ab/condition/janela nunca descobertos | **P** |
| 16 | **Cobertura dos templates** | Os 7 são variações de "disparo + nutrição" | Pipedrive cobre o ciclo do negócio | **ADICIONAR** 4-6 receitas: proposta parada, reativação de frio, lembrete de reunião, pós-venda/upsell | Esforço baixo, impacto alto, zero código novo — é conteúdo | **P** |
| 17 | **`qualification_score`** | 0-100. **117 leads de 32.683 (0,36%)**. Só leitura no backend; writes só em teste. `action-handlers/calculate-score.ts` sem template que use | RD/HubSpot: scoring configurável pelo cliente | **REMOVER/ESCONDER** | Campo morto que ocupa espaço na UI e no `condition`. Aposentar em favor do tier | **P** |
| 18 | **`qualification_tier` (rubric IA)** | diamante→desqualificado, 2.009 leads (6%), alimentado por `copilot-v2/rubric-engine.ts`; filtrável no board | Mercado deixa o cliente editar as regras | **MANTER + ADICIONAR (rubric editável)** | Mesmo benefício do scoring de mercado, pelo mecanismo que já funciona aqui. Não copiar sinais de inbound (email open, page view) — não existem no nosso ICP | **M** |
| 19 | **Follow-ups / Revisão** | `/follow-ups` renderiza `engagement/pages/Revisao.tsx` (`App.tsx:411-416`, feature `review`); agrega follow-ups + mensagens agendadas + prioridades do dia + `AutomationSettings`. **1.122 registros, 272 em 90d, 23 orgs** | Mercado chama de "tarefas/atividades" e é o hábito diário | **MANTER** | É a segunda cadência mais usada depois de workflow, e é manual-assistida — casa com time pequeno que não confia em automação cega | — |
| 20 | **`/templates` (`message_templates`)** | **3 registros, 2 orgs** | Snippets/templates são commodity | **MUDAR** (fundir com templates de campanha) ou **ESCONDER** | Três registros em 93 orgs. Ou o valor está em outro lugar (templates do disparo/campanha), ou a porta está errada. Não vale rota própria no menu | **P** |
| 21 | **Node `webhook_call` / `goto`** | Implementados (`workflow-executor.ts:545,593`). **0 usos em prod** | Zapier/Make cobrem isso fora do CRM | **MANTER** (não remover) | Custo zero de manutenção, e webhook é item de checklist em venda técnica. Só não investir | — |
| 22 | **Guarda de loop** | `chain_depth` máx 5 (baseline:4536,4547) + `loop_counters` + status `loop_limit_reached` | Padrão de mercado | **MANTER** | Correto e testado | — |

---

## 4. Ordem sugerida (impacto no ICP × esforço)

1. **#8** — expor saúde de automação ao admin da org (**P**). 20 orgs com automação morta por instância desconectada e ninguém sabe. Maior ROI do doc.
2. **#5** — igualar a guarda de in-flight na porta PG (**M**). Risco de ban ativo, 2.045 leads já afetados.
3. **#4** — goal / critério de saída (**M**). Maior item de produto; para o `#2`/`#3` fazerem sentido.
4. **#15 + #16** — template como porta padrão + 4-6 receitas novas (**P**). Ataca os 60% de workflows natimortos.
5. **#1** — decidir o node copilot: implementar ou remover (**M**). 23 orgs com fachada.
6. **#7** — histórico de automação na ficha do lead (**P**).
7. **#2/#3/#17** — esconder as três configs mortas (**P**). Faxina de credibilidade.
8. **#13** — remover o motor de dispatch rules de campanha (**M**).

---

## 5. O que NÃO recomendo copiar do mercado

- **Scoring de inbound** (email open, page view, formulário). Não temos os sinais; o ICP é outbound por WhatsApp. Copiar seria construir um número que ninguém alimenta — já temos um (#17).
- **Suppression list global.** Boa prática de email marketing; no WhatsApp o sinal equivalente é "o lead pediu para parar", que é melhor resolvido por goal (#4) + opt-out no chat.
- **Multi-ramo (switch) no condition.** AND/OR resolve 90% dos casos com uma fração do custo de UI. Multi-ramo só se AND/OR não bastar.
- **Editor de fluxo mais rico.** Nosso canvas já é mais poderoso que o Pipedrive e **isso não é o gargalo** — o gargalo é a porta de entrada (#15) e as promessas falsas (#1/#2/#3).

---

## CONTEXT PACKET — CP-v2 (Forja, frente 3)

**Mapa verificado (confirmei lendo o código/banco):**
- Motor: `_shared/workflow-executor.ts` (1169 l, nodes em `:169-860`), `workflow-trigger.ts` (749 l), `workflow-condition-evaluator.ts` (235 l), `workflow-action-handler.ts` (704 l), `workflow-trigger-dedup.ts` (43 l).
- **Duas portas de trigger**: TS `fireTrigger` (`workflow-trigger.ts:66-137`, tem guarda in-flight) e PG `fire_workflow_trigger` (baseline:4524-4593, **não tem**). `stage_changed` de pipeline vai via `net.http_post` → porta TS (baseline:20692-20713). `lead_created`/`tag_added`/etc vão direto na porta PG.
- **Cobertura do governor no workflow**: `send-whatsapp.ts:72` → `whatsapp-dispatch.ts:299` → `governSend:313`. 5/5 senders governados (`:313,356,411,470,521`). `reserveSendOrSkip` extra em `send-whatsapp.ts:8` e `send-to-number.ts:45`.
- **Node copilot = no-op**: `workflow-executor.ts:406-421` enfileira `generate_message`; `_shared/actions/index.ts:135-145` retorna success sem fazer nada.
- **enrollment/re-enrollment = UI-only**: escrito em `AutomacoesEditor.tsx:454-459`, colunas baseline:28320-28323, zero leitura em `supabase/functions`.
- **Sem goal/exit/suppression**: grep = 0.
- `/follow-ups` renderiza `engagement/pages/Revisao.tsx` com feature `review` (`App.tsx:411-416`). **Corroborado independentemente pelo Pauta:** o item "Revisão" do menu aponta para `/follow-ups` (`TopNavigation.tsx:146`), e ele mediu 23 orgs com 415 tarefas vencidas nessa tela.
- 7 templates de sistema em `src/modules/workflows/lib/funnelTemplates.ts`.

**Achados (12):** os 5 do TL;DR + histórico por contato ausente · saúde de automação invisível ao admin da org · condition sem AND/OR (uso real: 9 orgs) · `qualification_score` morto (0,36%) vs `tier` vivo (6%) · template não é a porta padrão (60% dos workflows natimortos) · `/disparos` funil 47 orgs → 2 · `fire_workflow_trigger` é DEFINER + `GRANT authenticated` + org_id por parâmetro **sem gate** (baseline:8970) = vetor cross-tenant.

**Descartado:**
- "Workflow escapa do Send Governor" — **falso**, verificado sender a sender.
- "Dedup de trigger não existe" — **falso**, existe nas duas portas; o que falta na porta PG é a guarda de *in-flight*, que é outra coisa.
- "Não temos biblioteca de templates" — **falso**, temos 7; o problema é descoberta.
- "47 orgs visitam /disparos e ninguém dispara" — **não afirmado**: caveat da Lanterna sobre caminho que não grava `blast_plans` não foi fechado.
- `/master/stage-roles` como a "revisão" do CTO — **descartado**: a "revisão" da org é `/follow-ups` → `Revisao.tsx`.

**Aberto:**
- Existe caminho de disparo em massa que **não** grava `blast_plans` (`mass-send-create` direto)? Fecha ou derruba o funil 47→2. **Dono: Lanterna** (medição) **+ Bancada** (o Pauta roteou como E1 — dirigir o fluxo no Palco e achar onde trava). Enquanto não fechar, o item #14 da matriz fica em "diagnosticar", não em "mudar".
- Cruzamento oferecido pela Lanterna: dos 33 workflows ativos que nunca rodaram, quantos têm trigger `lead_created` vs `stage_changed`? **Minha hipótese mudou** — como `enrollment_criteria` tem 0 condições reais, ele **não** explica os natimortos. Suspeitos melhores: trigger nunca satisfeito, instância desconectada desde sempre, ou workflow clonado e esquecido.
- `outbound_dispatches` não existe em prod mas está documentada e tem edge function + cron. Ref fantasma — precisa de triagem própria.
- `fire_workflow_trigger` sem gate de org: **é achado de segurança, não de produto.** Precisa de dono (Crivo ou issue separada) — não tratei aqui.
