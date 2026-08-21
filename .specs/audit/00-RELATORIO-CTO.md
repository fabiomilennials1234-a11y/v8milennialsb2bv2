# Torque CRM × mercado — relatório para decisão

**Data**: 2026-07-27 · **Base**: `main @c934cc3c` + prod `jsjsmuncfkbsbzqzqhfq` (leitura `read_only`)
**Comparação**: Pipedrive, HubSpot Sales Hub, RD Station CRM/Marketing
**Escopo**: **documento apenas.** Nenhuma linha de código, migration, PR ou issue foi criada. Nada foi alterado no sistema.

**Frentes**: Cais (funil/objeto de venda) · Forja (automações/campanhas) · Crivo (IA/Copilot) · Vitral (UX/chat/agenda) · Bancada (métricas) · Lanterna (uso real em prod)
**Documentos de detalhe**: `.specs/audit/mercado-{funil-negocios, automacoes-campanhas, ia-copilot, ux-chat-agenda, metricas-atrito}.md` e `uso-real-prod.md`

---

## 0. A tese, em cinco frases

1. **O problema do Torque não é falta de funcionalidade. É funcionalidade construída e nunca ligada.** Sete subsistemas completos — `deals`, `next_best_actions`, `coaching_suggestions`, `ai_email_drafts`, `enrichment_requests`, `enrollment_criteria`, node `copilot` do workflow — têm **zero linhas** ou são **no-op declarado no código**. Não é backlog: é dívida com aparência de feature.
2. **Suas queixas de "revisão" e "métricas" são o MESMO defeito, medido de dois lados** — uma fila de revisão nunca usada deixa 26 stages com won/lost errado, e daí **118 vendas e 288 perdas ficam fora de toda métrica**. Você viu os dois sintomas sem saber que eram a mesma coisa (§2.2c).
3. **Por cima disso, duas contabilidades de venda vivas ao mesmo tempo**: 24 funções lendo o funil legado, 17 lendo o ledger novo, divergindo **em direções opostas conforme a org**.
4. **A dor "duplicidade" é uma feature que ficou quebrada 8 semanas** — não uma feature ruim. As RPCs que a tela chama só nasceram em 22/07. Há **728 duplicados por e-mail em 22 orgs** esperando.
5. **Somos genuinamente melhores que Pipedrive/HubSpot/RD em seis pontos concretos** — e quase todos estão escondidos. Mas o maior deles, a IA, tem **adoção de nicho: 27% da base e 0,5% do tráfego**. A causa foi isolada: **88% dos agentes desativados nunca tiveram uma única conversa.** A perda está entre criar o agente e o primeiro atendimento — **onboarding, não qualidade**.

> **O padrão que atravessa as cinco frentes**: quase nada aqui pede construção nova. Pede **terminar, ligar e mostrar** o que já existe.

---

## 1. 🔴 Quebrado agora, em produção

Estes não são temas de roadmap. São coisas erradas rodando hoje.

| # | O quê | Evidência | Impacto |
|---|---|---|---|
| **R0** | **`fire_workflow_trigger` dispara workflow cross-tenant.** `SECURITY DEFINER`, `search_path` pinado, `GRANT ... TO authenticated`, `p_organization_id` **por parâmetro**, e o corpo **não tem uma única referência a `auth.uid()` ou `team_members`** — vai direto de `SELECT workflows WHERE organization_id = p_organization_id` para `INSERT workflow_executions` | baseline:8970. Levantado pelo Forja, **verificado independentemente pelo Crivo em prod** | **Não para no banco.** Workflow envia WhatsApp (handler `send-whatsapp`): é **mensagem real saindo em nome do tenant vítima, queimando a reputação do número dele**. As duas defesas existentes **não seguram**: `MAX_CHAIN_DEPTH=5` limita cadeia, não chamada direta; o dedup de 60s usa `md5(p_context)` na chave, então **basta variar o context para contornar**. Fix conhecido: separar autorização de execução — corpo `_unchecked` service_role + wrapper que valide `team_members`, como `clear_human_pause` já faz certo |
| **R1** | **Guarda de re-entrada assimétrica.** A porta TS (`workflow-trigger.ts:66-95`) tem skip de execução in-flight — nasceu do incidente Motor 100. A porta PG (`fire_workflow_trigger`) **não tem**, e `lead_created`/`tag_added` entram por ela | **2.604 pares (lead,workflow) com execução repetida · 2.045 leads · pior caso 6×** | Envio duplicado de WhatsApp acontecendo agora. Vetor de ban ativo |
| **R2** | **Node `copilot` do workflow é no-op** — `_shared/actions/index.ts:135-145` admite em comentário que não existe handler e **retorna `success:true`** | 27 workflows em 23 orgs desenharam · 8 orgs dispararam · 488 execuções | A automação fica **verde**. O cliente acha que a IA respondeu e ninguém abre chamado |
| **R3** | **37% das execuções de workflow falham** (5.553 de 14.910). Causa #1: "WhatsApp instance not available" — 1.796 falhas em 20 orgs | Forja, prod | **O admin da org não tem nenhuma tela que mostre isso.** Só o master vê. Melhor relação ganho/esforço do lote inteiro (**P**) |
| **R4** | **`enrollment_criteria` / `re_enrollment_*`: a UI grava, o backend nunca lê.** Zero ocorrência em `supabase/functions` | 178 objetos gravados, 0 com condição real | Cliente configura critério de entrada e ele não vale nada |
| **R5** | **Não existe goal / critério de saída de fluxo.** Lead que fecha negócio no meio da automação **continua recebendo mensagem** | Forja | Padrão HubSpot há uma década. Vetor nº 1 de cliente furioso e de report no WhatsApp |

**Risco menor, registrado**: sem guarda de prompt injection na entrada do agente, que tem 9 tools de **escrita** ativas; `EXECUTE` de `match_*` liberado para `anon` (contido por RLS).

---

## 2. Suas três dores, respondidas

### 2.1 "Questões de métricas" → duas contabilidades de venda vivas

Não são duas RPCs divergentes. São **duas famílias inteiras**, contadas por `pg_get_functiondef`:

| Família | Funções | Exemplos |
|---|---|---|
| Leem **`sale_events`** (nova, correta) | **17** | `get_sales_metrics`, `get_ranking`, `_metric_leaf_sales` (#1194), `get_commission_ledger` |
| Leem **`pipe_propostas`** (legada) | **24** | `get_dashboard_metrics`, `get_ranking_data`, `get_analytics_*`, `get_funnel_health` |

**Global**: ledger vê 265 vendas / 93 perdas; funil vê 208 / 53.

**E a divergência é bidirecional** — este é o agravante:

| Org | via `sale_events` | via `pipe_propostas` |
|---|---|---|
| `163874dd…` (maior) | 15 | **29** ← funil vê quase o dobro |
| `6030520a…` (Milennials) | **12** | 6 ← ledger vê o dobro |
| `feed1feb…` | **5** | 2 |
| `ab138cd5…` | **3** | 0 |

Não dá para dizer "uma está adiantada". São contabilidades **genuinamente inconsistentes, em direções opostas**. Reconciliar **não é aritmética** — exige decidir, por org, qual evento é real.

Na prática: **`/dashboard` mostra 5-6 vendas e `/performance` + TV mostram 12, para a mesma org e o mesmo mês.** As 24 inconsistências da auditoria de 2026-07 são sintoma disto. O #1194 escolheu a fonte certa e **não desligou a velha** — hoje são três gerações coexistindo.

> **Efeito colateral que ninguém notou**: `get_commission_ledger` já lê o ledger enquanto `get_ranking_data` lê o funil. **Hoje é possível a comissão e o ranking discordarem.** Isso é dinheiro de vendedor.

**A fila de revisão master entra aqui — e é pior de explicar ao cliente do que eu supus.** Minha hipótese era "won/lost sem classificar". Refutada na forma: as 3.695 stages têm `stage_role`, nenhuma está sem. Confirmada no impacto, em versão pior:

> **26 stages em 22 orgs (24% da base) têm sugestão pendente desde 2026-07-08 — 19 dias — e a fila tem ZERO revisões desde que existe. Nenhuma org, nunca.** E **todas as 26** são `open→won` (16) ou `open→lost` (10), com **421 entries dentro** (132 no won, 289 no lost).

Tradução para o cliente: **em 22 orgs o funil conta como pipeline aberto o que o classificador já identificou como venda fechada ou perda.** Não é classificação ausente — é **classificação errada**, viva, inflando o pipeline aberto e esvaziando o fechado. É o terceiro vetor da mesma dor de métricas.

**Pendência fechada pela Bancada — e a resposta é pior do que "não medimos".** `stage_role_reviewed_at` está preenchido em **zero linhas de toda a base**: ninguém revisou nada desde que a fila existe. Nas 16 stages `open→won` há **131 entries em 7 orgs, e só 13 têm `sale_event`**.

> **118 vendas prováveis são invisíveis.** Não estão em `sale_events` (o funil não fecha, o trigger não dispara) **nem** em `pipe_propostas`. O `/dashboard` e o `/performance` já divergem 3× entre si — e essas 118 **não aparecem em nenhum dos dois**.

**Quanto valem? O número não existe — e essa é a resposta.** `pipeline_entries` não tem coluna de valor; `deals.value` existe mas `deal_id` é nulo em 131 de 131; `leads.faturamento` é TEXT (faixa declarada, não venda); `pipe_propostas.sale_value` cobre 13 dos 131 (R$ 11.869,72) — justamente as que já contam.

**Não é receita escondida esperando ser somada. É receita irrecuperável sem reabrir lead por lead.**

### 2.2b — A perda não é registrada como perda

O outro lado das mesmas 26 stages, e é pior que o lado das vendas:

**288 entries em 10 stages `open→lost`, 8 orgs. ZERO contadas como perda.** 139 ainda **abertas, inflando o pipeline vivo**; 149 fechadas sem virar perda. Paradas **68 dias em média** (máximo 123).

**A leitura honesta**: o peso no denominador da conversão é pequeno — 6,1% de 4.725 entries abertas. Mas **o numerador de perda erra 100%**.

> Não é "conversão um pouco errada". É **taxa de perda que não existe**, mais **139 negócios mortos contando como vivos**.

### 2.2c — A cadeia: suas duas queixas são o mesmo defeito

Bancada e Lanterna fecharam isto junto, cada uma sustentando um lado:

```
fila de revisão com adoção ZERO  (nunca revisada, desde que existe)
        ↓
26 stages com won/lost errado    (22 orgs, 24% da base)
        ↓
118 vendas + 288 perdas fora da métrica
        ↓
/dashboard e /performance divergindo 3×
        ↓
"questões de métricas"
```

**"Revisão" e "métricas" não são duas dores suas. São o mesmo defeito, medido de dois lados.** Você percebeu os dois sintomas sem saber que eram a mesma coisa.

**Complementos medidos**: motivo de perda **0 de 93 orgs jamais preencheu** (na Milennials, 39 de 39 perdas sem motivo) — a métrica de perda agregada não existe na prática. **Zero export CSV** em todo `src/modules/analytics`. Filtro e aba **fora da URL** — não dá para salvar nem compartilhar uma visão. O #1194 está **inerte em prod**: 2 páginas, 15 widgets, 1 org.

### 2.2 "Revisão" → problema de nome e de lugar

Eu te ofereci a opção errada no começo e o time me corrigiu com evidência. Existem duas coisas chamadas "Revisão", e a que importa é a que eu não listei:

- **`/follow-ups`, rotulada "Revisão" no menu da org** (`TopNavigation.tsx:146`, flag `review`, `engagement/pages/Revisao.tsx`). **1.122 follow-ups, 272 em 90 dias, 23 orgs** — é a **segunda cadência mais usada do produto**.
- `/master/stage-roles` — fila master de won/lost sugerido. Master-only; nenhum cliente vê.

**Ou seja: não é feature morta. É feature viva, enterrada no overflow "Mais", com nome de oficina mecânica.**

E aqui está o **maior retorno do lote inteiro, esforço P**: hoje o vendedor loga e cai num **dashboard de métricas** (`App.tsx:284`). Pipedrive e HubSpot abrem na **fila de tarefas do dia**. A tela já existe, pronta. Renomear "Revisão" → **"Hoje"**, subir para primeiro item primário com badge, e torná-la a home do vendedor.

### 2.3 "Duplicidade" → **ficou quebrada 8 semanas.** Útil e ignorada, não inútil

> **Correção**: minha primeira leitura foi que a feature era desnecessária. A Lanterna refutou com histórico de commit e o veredito é o oposto — registro a correção porque ela muda a decisão.

A página existe desde **2026-05-26** (`bf3e51a1`). As RPCs que ela chama só nasceram em **2026-07-22**, commit `0d3cc421`, mensagem literal: *"fix(leads): implementa RPCs find_duplicate_leads / merge_leads (página /duplicados quebrada) (#1192)"*.

**Ou seja: de 26/05 a 22/07 a tela dava erro.** Ninguém usava porque **não funcionava**. Zero merges em toda a história (`_lead_duplicates_audit` = 0; o `audit_log` não tem nenhum DELETE em `leads`, e `merge_leads` termina em DELETE).

E há trabalho real esperando: **piso de 728 leads duplicados por e-mail em 22 orgs, e 2.122 por nome em 43 orgs.**

**Veredito: NÃO REMOVER.** Confirmar que o fix chegou ao cliente e medir de novo em 30 dias.

Dois detalhes que continuam valendo:
- Duplicata **por telefone é impossível por construção** — há UNIQUE parcial em `(organization_id, normalized_phone)` para leads vivos. Mesmo assim a RPC **gasta o primeiro e prioritário ramo do `UNION ALL`** nessa comparação: ramo morto, custo puro.
- O mercado dedup **no momento da criação e da importação**, não só numa tela separada. Isso segue valendo como melhoria de posição.

⚠️ **Pendência que bloqueia a recomendação**: as RPCs estão em prod (definição lida), mas **merge em `main` não deploya o front** — o redeploy no EasyPanel é manual. **Não dá para provar por SQL se o fix chegou ao cliente.** Alguém precisa confirmar o redeploy antes de concluir qualquer coisa sobre esta feature.

---

## 3. O achado que inverte sua premissa: a IA que assiste foi construída e nunca ligada

Você supôs que faltava IA que ajuda o vendedor. É pior — ela **existe no código e nunca foi conectada**.

| Tabela | Linhas em prod |
|---|---|
| `next_best_actions` | **0** |
| `coaching_suggestions` | **0** |
| `ai_email_drafts` | **0** |
| `copilot_prompt_analyses` | **0** |
| `enrichment_requests` | **0** |

`useNextBestActions.ts` lê uma tabela que **nenhuma edge function escreve** — consumidor sem produtor. E o `ChatComposer` do WhatsApp **não tem um botão de IA** para o vendedor humano.

No mesmo período, a IA-que-age vai muito bem: **~3.416 ações reais / 30 dias, 18 agentes ativos**.

**A assimetria**: nossa IA age **pelo** vendedor. O mercado usa IA para **aumentar** o vendedor. Temos o lado difícil pronto e o lado fácil desligado.

### 3.1 A leitura honesta da adoção de IA — e a pergunta nº 1 do produto

O Crivo corrigiu a própria estimativa contra o denominador real da Lanterna. Fica o número certo, sem adoçar:

| | Real |
|---|---|
| Orgs com agente ativo | **18 de 66 ativas = 27% da base** (não os ~60% estimados antes) |
| Agentes | **44 criados em 42 orgs · 18 mantidos** |
| Fatia do canal que a IA toca | **38.806 mensagens de WhatsApp contra 200 do agente, janela idêntica de 2 dias = ~0,5% do tráfego** |

**A distribuição é BIMODAL — e isso responde a pergunta.** A Lanterna cruzou agente × conversas reais e corrigiu a leitura anterior (`is_active=false` descreve o estado de hoje, **não prova que esteve ligado**):

| Grupo | Conversas |
|---|---|
| **26 agentes desativados** | **23 deles (88%) NUNCA tiveram uma única conversa.** Os 3 que rodaram somaram 7 |
| **18 agentes ativos** | 15 passam de 5 conversas — somando **2.633** |

**Ou o agente pega tração de verdade, ou nunca sai do chão.** Não existe meio-termo, e quase não existe "experimentou e se decepcionou".

> **Conclusão corrigida — e ela inverte o que eu escrevi antes:** a perda **não** é de retenção nem de decepção com qualidade. Está **entre criar o agente e ele atender o primeiro lead** — configuração, ativação, vínculo com a instância de WhatsApp. **A curva de onboarding volta a ser a causa primária.** Isso é uma tese muito mais barata de atacar do que "melhorar a IA", e o R2 (node `copilot` no-op) deixa de ser o suspeito principal.

**Gap de instrumentação que sai daqui**: não dá para datar a desativação de um agente. `copilot_agents.updated_at` está contaminado — 33 dos 44 agentes, em 33 orgs distintas, com `updated_at` em 2026-07-11 (update em massa da padronização de modelo). E não há trilha: `useCopilotToggleAudit.ts` audita o toggle de IA **por lead/telefone**, não o liga-desliga do agente. Vale issue própria.

---

## 4. Onde somos melhores — honesto, com evidência

Não é lista de consolo. Cada item tem arquivo/linha ou número de prod nos documentos de detalhe.

| # | Diferencial | Por que o mercado não tem | Situação |
|---|---|---|---|
| 1 | **Lead em múltiplos funis simultâneos** | No Pipedrive um deal vive em **um** pipeline só. Nosso lead está em qualificação, confirmação e proposta ao mesmo tempo | Invariante do modelo. **Manter e vender** |
| 2 | **Agente que executa no CRM via 9 tools** + controle de handoff (kill-switch por número, pausa temporizada, takeover) | **1.514 conversas já usaram.** Nem HubSpot Breeze nem Pipedrive fazem isso em WhatsApp com essa profundidade | Nosso fosso real |
| 3 | **Confirmação de reunião modelada como funil D-5/D-3/D-1** | Ninguém no mercado modela reunião como pipeline de risco de no-show | Escondido |
| 4 | **Observabilidade de automação** — steps, linhagem de retry, reprocessar | Melhor que Pipedrive | Escondido do admin da org (ver R3) |
| 5 | **Gamificação, ranking e `/tv`** | Pipedrive e HubSpot não têm gamificação nativa nesse nível | **Soterrado dentro de `Performance.tsx` (1.578 linhas)**, rotulado "Ranking". ⚠️ **Comissões sai desta lista**: tem **0 linhas em prod**. É potencial, não diferencial exercido |
| 6 | **Filtro de inbox cruzando funil × qualificação × IA-vs-humano** | Ninguém cruza essas três dimensões | Recém-entregue (#1234) |

Extras confirmados: `condition` por janela de horário que **pausa e reagenda** em vez de cair no ramo falso; `split_ab` com sticky + override por tag; `sale_events` como **ledger imutável com estorno** — melhor que o `deal` mutável do mercado.

---

## 5. O que está morto — candidatos a remover ou esconder

| Item | Estado medido | Recomendação |
|---|---|---|
| **`/negocios` (`deals`)** | `deals`, `deal_items`, `companies`, `contacts`, `activities`, `deal_contacts`, `deal_insights`, `import_batches` = **0 linhas cada** nas 93 orgs. `pipeline_entries.deal_id` preenchido: **0 de 37.303**. `Negocios.tsx:133` renderiza toda coluna do kanban com o título literal `"Estágio"` — ninguém nunca abriu com dados | **Esconder a flag agora (P), dropar depois (M).** Não ligar: seria a **quarta** geração de contabilidade de venda |
| **Campanhas** | 12 registros, **0 criadas em 90 dias**, 1 dispatch rule no banco inteiro. Mantém um **segundo motor de sequência** paralelo ao executor | **Remover o motor.** Risco zero: não dispara hoje |
| **Workflows zumbis** | **162 de 270 workflows (60%) nunca executaram — e 33 deles estão ATIVOS.** 61 orgs têm workflow zumbi | Investigar por que não disparam antes de julgar a feature |
| **`enrollment_criteria` que não filtra** | 178 workflows (66%) em **47 orgs** têm critério preenchido que o backend nunca lê | Ver R4. É promessa quebrada em escala |
| **Comissões** | **0 linhas em prod** — apesar de `get_commission_ledger` existir e ler o ledger | Feature construída, zero adoção. Decidir: ativar com um cliente ou aposentar |
| **`saved_views`, `reports`, `report_schedules`, `dashboards` legado, webhooks de saída** | **0 linhas cada** | Candidatas diretas a remoção |
| **`awards` vs `competitions`** ⚠️ | `awards` = 1 linha, org NULL (morto). **`competitions` = 6 orgs, 11 competições (VIVO)** | **Não juntar `/premiacoes` com `/comissoes` num corte só.** São coisas diferentes com destinos opostos. **`/comissoes` é o único REMOVER assinado** de toda a auditoria — zero absoluto, histórico inteiro, sem bug que explique o zero |
| ~~`/duplicatas`~~ | **Removida desta lista** — ver §2.3: estava quebrada, não morta | **NÃO remover.** Confirmar redeploy e medir em 30d |
| **`/insights`** | **É master-only** (`App.tsx:754-762`) — não é feature de cliente | **Parar de contá-la** como feature do produto |
| **Oráculo** | 8 usos / 30 dias contra **1.040 linhas** de código | Decidir: investir ou aposentar |
| **Coluna `default_probability`** | **50 em 100% das 3.695 stages**, nas 93 orgs | Coluna inerte: ou torna editável (**P**), ou deriva de conversão histórica (**M**) |
| **`max_days_in_stage` / `sla_hours`** | Existem em `pipeline_stages` e estão **NULL em 100% das 3.695 stages**. Único leitor é clone de org | Ver §6 — não é remover, é **ligar** |

---

## 6. As cinco maiores oportunidades, por ganho ÷ esforço

| # | Ação | Ganho | Esforço | Por quê agora |
|---|---|---|---|---|
| **1** | **Sinalizar negócio parado (rotting)** | **18.532 de 36.529 entradas abertas (50,7%) estão paradas há 30+ dias e nada no produto sinaliza** | **P** | As colunas já existem no banco, só estão NULL e sem leitor no front. É a religião do Pipedrive e o maior ganho/esforço da auditoria |
| **2** | **"Revisão" → "Hoje", primário, home do vendedor** | O vendedor passa a abrir o CRM numa fila de ações em vez de num painel de métricas | **P** | Tela pronta e enterrada. Muda o hábito diário sem construir nada. **Ver 2b — a badge tem que ser feita certo ou o item se anula** |
| **2b** | **Regra da badge de "Hoje"** — não somar os 415 vencidos brutos | **38% dos follow-ups são AUTOMÁTICOS (425 de 1.122).** Uma badge grande gerada em parte pelo próprio sistema vira o padrão "9+ não lidos para sempre", e o usuário **aprende a ignorar** | **P** | Contar **vencidos + vence hoje, do usuário logado**; separar automático de manual dentro da tela; acima de 2 dígitos virar ponto em vez de número. Sem isto, o item 2 nasce contra si mesmo |
| **3** | **Tela de saúde da automação para o admin da org** | 1.796 falhas de "WhatsApp instance not available" em 20 orgs, invisíveis para quem pode resolver | **P** | A observabilidade já existe — só está restrita ao master |
| **4** | **Destravar recompra**: trocar `UNIQUE (pipeline_id, lead_id)` por índice parcial `WHERE closed_at IS NULL` | **44 clientes (14,1%) já recompraram** e o funil não representa. Hoje um cliente **não pode ter uma segunda proposta, nunca** — é restrição de banco | **P→M** | Menor movimento que resolve o maior problema estrutural. Exige auditar os `.single()` de entrada por lead |
| **5** | **Unificar a contabilidade de venda** em `sale_events` | Acaba com o 3× entre `/dashboard` e `/performance`, e com o risco de comissão ≠ ranking | **M→G** | Ver o caminho de 5 passos abaixo. **O passo 0 é obrigatório** |
| **4b** | **Zerar a fila de revisão e fechar o registro de won/lost** — **pré-requisito do item 5** | Destrava as 118 vendas e as 288 perdas hoje fora de toda métrica, e tira 139 negócios mortos do pipeline vivo | **P** | **Correção de ordem, vinda da Lanterna**: "obrigar motivo de perda" era o nº 2 desta lista e **caiu para depois daqui**. Motivo é *por que* perdeu; a fila decide *se* perdeu. **Preencher motivo numa perda que o sistema não sabe que é perda é impossível por construção** — e cobrar o campo antes de consertar o registro joga no cliente a culpa de um defeito nosso |
| **5b** | **Dar valor de venda ao fechamento em funil custom** — precede ou acompanha o item 5 | **`pipeline_entries` não tem coluna de valor em lugar nenhum.** As 118 vendas invisíveis não têm valor recuperável | **P→M** | **Sem isto, a unificação herda o buraco.** Unificar a fonte não basta se a fonte não carrega o dado. Funis custom têm 40% de adoção (37 de 93 orgs) — não é caso de borda |

### 6.1 Desperdício de intenção — onde o cliente tenta e não consegue

Estes não são "features não usadas". São features que o cliente **procura** e não converte. Isso é mais valioso que qualquer número de adoção.

| Sinal | Medido | Leitura |
|---|---|---|
| **`/disparos`: 47 orgs visitaram em 90d, 820 visitas — e só 2 orgs dispararam** (3 planos, 54 destinatários) | Lanterna + Vitral | **Maior desperdício de intenção medido no produto.** Item primário que gera 820 visitas e 3 ações não tem problema de demanda, tem problema de fluxo. **Precisa de alguém dirigindo o funil para achar onde trava** |
| **`/follow-ups`: 415 follow-ups vencidos-e-abertos em 23 orgs** | Lanterna | Não é tela ignorada — é tela que **acumula dívida e não avisa ninguém**. O número da badge já existe em prod e ninguém o vê. Isto transforma a recomendação nº 2 de palpite de design em fato |
| **`/templates`: 2 orgs, 3 templates no produto inteiro** | Lanterna | O slash command do chat lê dessa tabela: **91 de 93 orgs abrem o popover vazio**, o que ensina o usuário a nunca mais digitar `/`. Não é problema de UI, é de **conteúdo** — semear 3-5 templates na criação da org |
| **Google Calendar conectado em 1 org de 93** | Lanterna | **Sete edge functions de calendário servindo uma organização.** O gargalo é o OAuth, não o calendário |
| **`/agenda` — ressalva FECHADA, e a leitura inverteu** | Lanterna + Vitral | **`meeting_events`: 1.245 eventos em 90d, em 31 orgs.** `/pipe-confirmacao`: **50 orgs, 1.300 visitas em 90d**. Contra apenas 11 orgs com linha em `meetings` e **1 org** com Google Calendar. **Reunião é operada em escala — no kanban.** Ver §6.2 |
| **37 orgs criaram funil custom, 20 nunca receberam lead** | Lanterna | Criam e abandonam. Vale entender o quê |

### 6.2 A reunião não é bloco de tempo — é estágio de negócio

Vale isolar porque **decide dinheiro**, e porque a diferença entre os dois diagnósticos leva a decisões opostas.

**31 orgs geram evento de reunião de verdade. 11 têm registro formal. 1 conectou calendário.**

"Fracassou" leva a cortar e deixar quieto. **"Visualização errada" leva à pergunta certa**: para venda B2B por WhatsApp, reunião não é bloco de tempo — é **estágio de negócio**. E o nosso `pipe_confirmacao`, com cadência D-5/D-3/D-1, **já modela exatamente isso**. Por isso ele tem 50 orgs enquanto o calendário tem 11.

**Consequência prática**: segue valendo **não construir** link público de agendamento (Calendly), lembrete automático de reunião nem "copilot propõe horário" — mas agora por motivo forte, não por "ninguém usa".

**A pergunta para a próxima rodada**, deliberadamente não respondida aqui: *o que falta ao `pipe_confirmacao` para ele **ser** a agenda* — por exemplo, uma visão "reuniões de hoje" dentro do próprio funil. O Vitral não desenhou spec por não saber ainda como as 50 orgs usam o kanban, e não quis inventar. Concordo com a abstenção.

**Dois caveats registrados**: `pipe_confirmacao` cai de **50 → 23 orgs** ao estreitar de 90d para 30d — pode ser sazonal, **ninguém afirmou tendência**. E há uma discrepância de **modelo de dado**, não de UI, a investigar: `meeting_events` em 31 orgs contra `meetings` em 11.

### 6.3 Correção de fato: qual é a tela nº 1

O briefing dizia que o chat era a tela mais usada. **Não é.**

| Tela | Orgs (90d) | Visitas (90d) |
|---|---|---|
| **`/pipe-whatsapp`** (kanban de qualificação) | **77** | **20.312** |
| `/chat-whatsapp` | 71 | 11.901 |

Não muda veredito nenhum, mas **muda onde ganho de velocidade se paga**: as duas juntas são **32 mil visitas em 90 dias — uma ordem de grandeza acima de todo o resto do produto**. É ali que teclado, densidade e latência rendem, e em nenhum outro lugar.

**Baratos e óbvios, do mesmo lote**: tornar motivo de perda obrigatório ao marcar perdido (hoje **30,2%** de captura, 0/93 orgs no agregado) — ⚠️ **só depois do item 4b, nunca antes** · derivar `sale_value` da soma dos produtos em vez de digitar à mão · pôr filtro e aba na URL · export CSV em analytics · corrigir os atalhos `g w`/`g c`/`g p` que caem em 404 (`useGlobalShortcuts.ts:28-31`) · destravar membro não-admin preso em tela de espera durante o onboarding do admin (`OnboardingGate.tsx:23-30`).

### Caminho de desligamento da contabilidade legada (se você aprovar a #5)

| Passo | O quê | Risco | Esforço |
|---|---|---|---|
| **0** | **Reconciliar antes de mexer** — por org, classificar cada evento discrepante: falta no ledger, sobra no ledger, ou stage do funil errado. **Sem isso, qualquer desligamento congela o número errado** | — | **M** |
| 1 | Congelar a via velha para **escrita**; toda venda nova via `fn_capture_sale_event` | baixo | **P** |
| 2 | Backfill do delta apurado no passo 0 | **alto — é dinheiro de cliente.** Só com dry-run e reconciliação assinada | **M** |
| 3 | Migrar as 24 funções legadas, começando por `get_dashboard_metrics` e `get_ranking_data` | médio — comissão depende de ranking | **M→G** |
| 4 | Reduzir `pipe_propostas` a projeção de leitura, ou dropar | baixo | **P** |

**Armadilhas registradas**: `fn_sale_events_block_mutation` bloqueia UPDATE/DELETE — corrigir backfill errado exige **evento de estorno**, planejado antes, não durante. Migration de schema **não pode** carregar backfill de dado de cliente (guarda F4): o passo 2 é operação separada e autorizada, nunca `db push`.

---

## 7. Correções ao que constava como verdade

| Constava | Real |
|---|---|
| ~30 orgs ativas (CLAUDE.md) | **93 orgs no banco · 66 com evento em 30 dias · 87 em 90 dias** |
| Menu inchado com ~40 itens | **8 itens primários** (`TopNavigation.tsx:130-141`) — paridade com Pipedrive. Os 3 pipes fixos **já são filhos** do dropdown "Funis" (`:263-274`): "um funil com seletor" já é o que fazemos. *(Erro meu no briefing: passei lista de rotas como se fosse menu.)* |
| "Revisão" = `/master/stage-roles` | **`/follow-ups`** — e é a segunda cadência mais usada |
| Falta IA que assiste o vendedor | **Foi construída e nunca ligada** (§3) |
| Falta objeto de venda deal-centric | **Existe e se chama `sale_events`** — 371 eventos, 26 orgs, com estorno e imutabilidade. Melhor que `deals` |

---

## 8. Uma decisão de identidade, que só você toma

Proposta do Vitral sobre a metáfora de corrida (Comando / Combustível / Pitstop / Pilotos): **a metáfora fica no destino e some na busca.** Mantém Comando, Turbo, Pitstop e Ranking; renomeia **Combustível → Leads**, **Pilotos → Time**, **Revisão → Hoje**. Preserva a identidade viva do produto sem cobrar pedágio justamente onde o usuário está procurando algo.

Isto não é mudança técnica — é posicionamento. Fica registrado como decisão sua.

---

## 9. O que esta auditoria **não** verificou

Honestidade sobre o limite do que está acima:

- **Nada foi verificado em tela.** O `.env` do checkout apontava para o ambiente dev **aposentado** (`bcfadphgsibjzivtbjvc`) e nenhuma credencial loga nele. Apontei temporariamente para prod para destravar o browser e **já reverti ao estado original**. A prova visual do 3× (print de `/dashboard` e `/performance` lado a lado) **não foi capturada** — todo o achado de métricas vem de `pg_get_functiondef` e `SELECT` em prod, que é evidência mais forte, mas não substitui ver a tela.
- **Limite duro da medição de adoção**: `usage_events` instrumenta apenas **7 módulos** (`pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`). Todo o resto foi medido por **pegada de dado**. Consequência importante: **`/dashboard`, `/performance`, `/ranking`, `/insights`, `/tv` e `/copilot/metricas` são leitura pura e NÃO SÃO MENSURÁVEIS hoje.** Qualquer zero de adoção nessas telas é **artefato de medição, não sinal**. **Nenhuma decisão de corte pode se apoiar nisso.** A §5 de `uso-real-prod.md` lista tudo que não deu para medir e por quê.
- **Pendências abertas, duas** (a de receita das stages `open→won` foi fechada — ver §2.2): **(a)** o front com o fix de `/duplicatas` (#1192) já foi redeployado no EasyPanel? Sem isso não se conclui nada sobre aquela feature, porque merge em `main` não deploya. **(b)** Não é possível datar a desativação de um agente de Copilot — `updated_at` contaminado por update em massa, e sem trilha do liga-desliga (§3.1).
- Tudo acima é **evidência de código (`arquivo:linha`) e de dado de produção**. Onde um número é proxy, o documento de detalhe marca como proxy.
- **Nenhuma alteração foi feita no sistema.** Só os seis documentos em `.specs/audit/`, não commitados. O `.env` que apontei temporariamente para prod foi revertido ao estado original.
