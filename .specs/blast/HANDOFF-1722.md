# HANDOFF — #1722 · Disparo pelo Canal Oficial: fila, worker e progresso

Branch `feat/1722-disparo-canal-oficial`, empilhada em `feat/1721-blast-recipient-state`
(PR #1777, **aberto**, não mergeado — conferido em 2026-08-23).
Plano e medições: [`PLANO-1722.md`](./PLANO-1722.md) · Antecessor: [`HANDOFF-1721.md`](./HANDOFF-1721.md)
Decisões do CTO: `~/Dev/.maestri/briefs/1722-decisoes.md`

> **Estado: COMPLETO.** Os nove critérios estão fechados e verdes: 121 testes nos arquivos
> tocados, build de produção limpo, **zero** erros de tipo e **zero** problemas de lint
> introduzidos. Nada aplicado em produção — migration, types e deploy são botão do humano
> (§5).

---

## 1. Por que este trabalho existiu

O Disparo do Torque não funciona no canal oficial. Medido em produção (ADR-0028): a
história inteira do produto tem **três Disparos, e os três falharam**. No canal oficial nem
falha — não existe: o wizard **escondia** o número oficial e o Disparo Rápido o **oferecia
e quebrava**, devolvendo ao vendedor a string crua `notificame does not support
senderAdvanced`.

A causa não era um filtro errado. Era **cada tela decidindo por conta própria** quais
números existiam. E o motor não existia: o canal oficial não tem o `/sender/*` da Uazapi —
o provider define `senderAdvanced` só para lançar `NotSupportedError`. Não é allowlist a
alargar, é a ausência de um laço.

Esta fatia é o tracer bullet: corta fila, envio e tela de uma vez, e é de onde as seis
fatias seguintes penduram.

---

## 2. O que foi entregue, e está verde

**83 testes passando** nos arquivos tocados. **Zero** erros de tipo introduzidos.

| Arquivo | O quê |
|---|---|
| `src/modules/campaigns/lib/disparo-numbers.ts` | O módulo ÚNICO de números, com `regime: "chip" \| "oficial"`. Sucede `instances-to-numbers.ts`, que foi **apagado** |
| `src/modules/campaigns/index.ts` | Exporta o módulo — o Disparo Rápido vive em `leads` e precisa dele pelo barrel |
| `src/modules/leads/components/bulk-actions/QuickBlastDialog.tsx` | Passa a consumir o módulo; o regime aparece no seletor |
| `src/modules/campaigns/components/disparo-wizard/wizard-machine.ts` | Ordem revista (número antes do conteúdo), `regimesSelecionados`, `regimeDoConteudo`, `template` no draft, recusa de regime misto, conteúdo validado por regime |
| `supabase/functions/_shared/decisao-do-disparo.ts` | A regra composta: enviar / pular / recusar, pura. Mais `regimeDoProvedor` |
| `supabase/functions/_shared/blast-official-runner.ts` | O laço do worker, com transporte e relógio injetados |
| `supabase/functions/process-blast-recipients/index.ts` | A edge function cron-only que embrulha o laço |
| `supabase/migrations/20270824000000_blast_official_worker.sql` | `blast_plans.template`, índice do claim, RPC `claim_blast_recipients`, cron versionado |
| `supabase/migrations/rollback/20270824000000_...sql` | O reverso, na ordem certa (cron primeiro) |
| `supabase/functions/_shared/quick-blast/blast-plan.ts` | `template` em `PlanRow` e em `CreateBlastPlanInput`, gravado no plano |
| `supabase/config.toml` | Registro da função nova, `verify_jwt = false` com o gate explicado |
| `scripts/medicao-1722-provider-message-id.sql` | A medição que o CTO pediu (decisão C) — **ainda não rodada**, ver §5 |

Testes: `disparo-numbers`, `decisao-do-disparo`, `blast-official-runner`,
`regime-do-disparo-twin`, mais os casos novos em `disparo-wizard`.
`disparo-instances-to-numbers.test.ts` foi apagado — **nenhum caso se perdeu**, todos
foram portados, e o único veredito que mudou (`notificame`) tem caso próprio explicando
por quê.

### Critérios de aceite

| # | Critério | Estado |
|---|---|---|
| 1 | Número oficial aparece na tela, com regime visível | ✅ nas duas telas, com o selo "Canal Oficial · Template" no passo de números |
| 2 | Wizard e Disparo Rápido, mesmo conjunto, mesmo módulo | ✅ com **guarda mecânica** que reprova quem voltar a filtrar sozinho |
| 3 | Número oficial troca o passo de conteúdo | ✅ ordem revista (número antes do conteúdo) + `StepMessage` ramifica por regime |
| 4 | Só Templates aprovados, sem catálogo local | ✅ `apenasAprovados`, com guarda mecânica nos dois consumidores |
| 5 | Uma linha por destinatário, worker consome uma a uma | ✅ worker, claim, cron **e** a bifurcação do criador nos 4 sítios de despacho |
| 6 | Mensagem aparece na conversa e **não** é gravada duas vezes | ✅ **provado por mutação**, não por leitura |
| 7 | Progresso por pessoa, não contador | ✅ `StepMonitor` lista pessoa a pessoa, lido da FILA — guarda proíbe voltar ao job do fornecedor |
| 8 | Organization só com Chip: idêntico a hoje | ✅ provado — allowlist intocada, testes portados, controle explícito |
| 9 | Decisão de enviar/pular/recusar num lugar só | ✅ `decisao-do-disparo.ts`, 17 testes, 3 mutações capturadas |

---

## 3. Decisões, e por quê

**1. O regime NÃO é derivado de `capabilities.massSend`.** Era o caminho elegante — existe
um registro de perfis de provedor em `whatsapp-provider.ts` — e está **errado**:
`EVOLUTION.capabilities.massSend` é `false` lá (`whatsapp-provider.ts:81`) e o Evolution
**está** na allowlist de disparo. Derivar removeria o Evolution do wizard: mudança de
comportamento no Chip, que o critério 8 proíbe. As duas listas coexistem, e um **teste
gêmeo** acusa a divergência que importa (chip não pode ser `official`, oficial não pode
entrar como chip).

**2. O discriminador do Canal Oficial é `provider` E `channel_type`.** Um canal de
Instagram nasce com `provider: "notificame"` e `status: "connected"`
(`_shared/notificame.ts:1460-1475`) — **a mesma dupla** que qualifica o número oficial.
Sem o `channel_type`, um Direct de Instagram viraria número de Disparo e o produto
tentaria mandar Template de WhatsApp por ele. Achado ao ler
`tests/unit/notificame-instagram-isolation.test.ts`, que existe justamente para impedir
isso; o teste segue verde, e agora há um segundo no módulo novo.

**3. O worker NÃO grava a mensagem na conversa.** Quem grava é o provider, dentro do envio
(`notificame-provider.ts:1297-1316`). É a regra que `enviar-template.ts:103-105` já
carregava em comentário para o nó de Workflow. **Provado por mutação**: acrescentei a
gravação ao runner e o teste do critério 6 ficou vermelho.

**4. `trackSource: "mass_send"`, e travado por teste.** `deriveSendSource` reconhece um
vocabulário **fechado** (`send-dedup.ts:65-77`); valor fora do mapa faz o dedup ser pulado
**fail-open, com um único log**. Inventar um source novo tiraria o worker do choke em
silêncio. Mutei para `"blast_oficial"` e o teste reprovou.

**5. `recusar` ≠ `pular`, e a diferença é dinheiro.** `pular` grava `skipped` na linha e
ela **não volta nunca**; `recusar` não toca na linha e ela volta no próximo tique. Por isso
a precedência coloca as recusas de plano **antes** dos pulos de linha: marcar `skipped` por
um plano pausado queimaria um destinatário são. Mutei a ordem e um teste reprovou.

**6. `blast_plans.message` continua sendo escrito no regime oficial**, com o corpo
renderizado do Template. Não é duplicação: é o registro do que **foi** enviado, e ele tem de
sobreviver ao dia em que a Meta reclassificar ou pausar o Template do lado dela (ADR-0029).
Também mantém a Revisão e todo leitor antigo funcionando, e a coluna é `NOT NULL`.

**7. O claim é um RPC, não código do worker.** Dois tiques do cron são dois processos; a
garantia de envio único não pode morar em nenhum deles. Mora no `UPDATE ... RETURNING` sob
`FOR UPDATE SKIP LOCKED`, no molde de `claim_pending_ai_actions`. A linha reivindicada
continua `pending` — o que muda é `claimed_at`; e `claimed_at` velho de 10 minutos volta
para a fila, porque a alternativa é ficar presa para sempre.

**8. A união `BlastRecipientStatus` NÃO foi ampliada.** O worker escreve `sent`/`failed`;
`delivered` e `unconfirmed` são o ciclo de entrega (#1724). Consequência deliberada: as
quatro guardas de vocabulário do #1721 seguem verdes, **e o PR #1777 não foi tocado**.

**9. O cron segue o padrão vivo, não o template do `CLAUDE.md`.** O template de
`supabase/migrations/CLAUDE.md` chumba o ref do projeto e lê
`current_setting('app.cron_secret')`; as migrations recentes (`toth_cron_sync`,
`notificame_subscription_repair`) derivam a URL de `public.cron_config` e tratam
`invalid_schema_name`. Segui as vivas. **O template do doc está desatualizado** — vale uma
issue.

---

## 4. O que falta, com o desenho já feito

### 4.1 A tela — FEITO

- **A ordem dos passos mudou** (decisão (a) do CTO): `Pra quem → Velocidade → Mensagem →
  Destino → Revisão → Acompanhar`. Os mesmos seis passos, os mesmos seis rótulos; muda a
  posição de uma tela. É a única ordem em que a tela nunca pede uma decisão que o passo
  seguinte anula.

  ⚠️ **Isto é uma exceção AUTORIZADA à leitura literal do critério 8**, e vale dizer com
  todas as letras: a Organization só com Chip vê os passos em ordem diferente da de ontem.
  O comportamento de ENVIO dela é idêntico — mesmos campos, mesma linguagem, mesmo motor,
  mesmos ledgers —, mas a sequência visual mudou para todo mundo, não só para quem tem
  canal oficial. O CTO fechou isso explicitamente ("muda a posição de uma tela"). Chamar de
  "idêntico" sem a ressalva seria funcionalmente verdadeiro e visualmente falso.
- **O "Passo N de 6" virou derivado** (`kickerDoPasso`). Eram cinco literais espalhados, e
  a reordenação fez os cinco mentirem de uma vez — "Mensagem" seguia anunciando "Passo 2"
  depois de virar o terceiro. Uma tela com número errado não reclama: ela só mente. Guarda
  mecânica reprova quem chumbar de novo.
- **`StepMessage` ramifica por regime**: Chip mantém o editor de texto **intocado**; Canal
  Oficial lista os Templates **aprovados** da conta, direto do servidor, sem catálogo local.
- **A decisão "quais Templates são escolhíveis" virou módulo compartilhado**
  (`communication/lib/templates-aprovados.ts`), consumido pelo passo de conteúdo **e** pelo
  nó de Workflow. Era a mesma forma do defeito que este ticket conserta na camada dos
  números — três telas decidindo sozinhas —, e não valia a pena repeti-la com Templates.
  Guarda mecânica proíbe `status === "APPROVED"` solto nos dois arquivos.
- **`StepSpeed` mostra o regime** no próprio número.

### 4.3 Progresso por pessoa — FEITO

`StepMonitor` passa a listar **pessoa a pessoa**, lido da fila (`useBlastPlanRecipients`),
com o motivo em português quando existe. O contador continua como resumo — o critério pede
que a tela mostre pessoas, não que esconda o total. Guarda mecânica reprova se alguém
voltar a ler o job do fornecedor ali.

⚠️ **Dívida datada, herdada do #1721 e ainda não vencida**: `useBlastPlans.ts:162` tem
`else p.pending += 1` — um catch-all. No dia em que `delivered` for gravado (#1724), ele
aparece no CONTADOR como "Aguardando". A lista por pessoa não sofre disso (ela mostra o
status real), mas o resumo sim. O teste 3 da guarda de vocabulário é o estopim.

### 4.4 O resto do ciclo

`/code-review`, e o `/security-rubric` é **obrigatório** aqui: o diff toca multi-tenant
(RPC `SECURITY DEFINER` que varre todos os tenants por desenho), secrets (`x-cron-secret`),
CORS e WhatsApp/Uazapi.

---

## 5. O que sobrou para o humano

Nada de código. Quatro coisas, todas de produção.

1. **Rodar `scripts/verificar-grants-1722.sql` IMEDIATAMENTE depois do apply.**
   É o item da `/security-rubric` que **não pode ser fechado antes** — o grant é concedido
   pelo banco no momento do `CREATE`, não pelo SQL da migration, e neste projeto o EXECUTE
   chega por dois caminhos (PUBLIC implícito e `ALTER DEFAULT PRIVILEGES` nominal) que se
   escondem um atrás do outro. A migration revoga dos três e concede só a `service_role`; a
   consulta é o que prova. Esperado: `anon=false`, `authenticated=false`,
   `service_role=true`. **`claim_blast_recipients` é SECURITY DEFINER e devolve
   destinatários de TODAS as organizações por desenho** — grant aberto ali é vazamento
   cross-tenant, não inconveniência.
2. **Aplicar a migration `20270824000000`** — depois da `20270823000000` do #1721, que
   **também ainda não foi aplicada**. A ordem importa: a de agora depende das colunas da
   anterior (`claimed_at`).
3. **Deployar `process-blast-recipients`** (`supabase functions deploy`). Sem o deploy, o
   cron chama uma função que não existe e a fila não anda — e o sintoma é silêncio, não
   erro.
4. **Regenerar os types** depois do apply em prod, nunca a partir de branch. E conferir o
   ledger/drift como o runbook manda.

**Nada foi aplicado em produção. Nenhuma branch do Supabase foi criada** — a medição que eu
precisava (§6) é read-only e não exigiu uma; o que exigiria branch (o claim concorrente
rodando de verdade contra Postgres) está registrado como a prova que falta, abaixo.

⚠️ **O que NÃO está provado**: o `FOR UPDATE SKIP LOCKED` do `claim_blast_recipients` foi
provado como *desenho* (molde de `claim_pending_ai_actions`, que é o claim vivo do repo) e o
laço foi provado com dublês — mas **duas sessões concorrentes disputando a mesma linha nunca
rodaram**. Isso é SQL, e SQL não se prova com dublê. Pede branch efêmera, e a autorização
está de pé. É a primeira coisa a fazer se o worker duplicar envio em produção.

## 5-bis. `post_send_target` no regime oficial — quem move o lead

Registrado pelo Despachante, a partir da descrição do operário e de medição própria no
código entregue. Ficou de fora do handoff original e por pouco morreu com o terminal.

**O criador não move o lead no regime oficial, e isso é correto.**
`quick-blast/blast-plan.ts` chama `notifyRecipientsSent` em quatro pontos (`:408`, `:553`,
`:775`, `:817`) — **todos no ramo do Chip**. Chamá-lo na criação de um Disparo oficial
afirmaria um envio que ainda não aconteceu: no Canal Oficial a linha nasce `pending` e só
sai quando o worker a reivindica.

**Quem move é o worker, quando o envio sai — e ele já move.** Medido em
`_shared/blast-official-runner.ts`: o `postSendTarget` é lido do plano (`:247`, `:275`),
carregado no contexto do destinatário (`:89`, `:230-231`) e aplicado depois do envio
(`:284-297`), chamando `deps.aposEnviar` apenas quando há `leadId`. É best-effort e nunca
lança — a mesma assimetria de `notifyRecipientsSent`, deliberada: falha ao mover não
desfaz um envio que já saiu.

**Não há trabalho pendente aqui.** O que havia era uma decisão de desenho viva só na
conversa. Se um dia o comportamento parecer errado, o lugar de olhar é
`blast-official-runner.ts:284-297`, não o criador.

## 6. O que me surpreendeu

- **O id da resposta do envio NÃO é o `providerMessageId` estável — e nunca foi.** Medido
  contra produção em 2026-08-24, somente leitura:

  | | |
  |---|---|
  | linhas de saída com `provider_message_id` | **747** |
  | `provider_message_id = external_id` | **0** |
  | `external_id` no formato UUID | **747 / 747** |
  | `provider_message_id` em base64 longo | **747 / 747** |

  Não é "às vezes divergem": são **espaços de identificador diferentes**. O do envio é UUID
  (`610d05f8-2efd-…`), o estável é base64 (`dGg3ZzQwYnh3…`). E há **10 callbacks órfãos**
  (`status_no_match`, o mais recente 2026-08-20) — o sintoma já acontece hoje.

  **Consequência para a #1724, e é a mais cara do lote**: casar o callback direto contra
  `blast_plan_recipients.provider_message_id` pelo id estável **não acha nada, nunca**. O
  caminho que funciona é o que o webhook já faz certo — ele resolve o callback até a linha de
  `channel_messages` por duas chaves (`notificame-webhook/index.ts:1139-1174`), e de lá
  `external_id` casa com o que o worker grava. Reusar aquele casamento é melhor do que
  duplicar a dança de duas chaves numa segunda tabela. Está escrito no worker, no teste que
  fixa a semântica, e aqui.

  O que a coluna **é**, e continua sendo: a chave de idempotência do envio. Para isso o UUID
  serve tão bem quanto o base64, e a UNIQUE parcial do #1721 segue fazendo o trabalho dela.

- **Cinco telas anunciavam o próprio número de passo em literal.** A reordenação fez as cinco
  mentirem de uma vez, e nenhuma reclama — número de passo errado não quebra nada, só engana.
  Virou derivação com guarda.

- **Existem TRÊS seletores de instância, não dois.** O brief e o ADR-0028 citam o wizard e
  o `QuickBlastDialog`. O terceiro,
  `src/modules/pipelines/components/disparo/DisparoWizard.tsx:410-413`, tem o mesmo defeito
  e alimenta **seis** telas (`PipeConfirmacao`, `PipePropostas`, `PipeWhatsapp`,
  `CustomPipeline`, `CarteiraBulkBar`, `Upsell`). Fica **FORA** por decisão do CTO:
  apontá-lo para o módulo novo o faria oferecer o número oficial numa tela que não sabe
  enviar por ele — exposição nova, não conserto. **Issue própria, o CTO abre.**
- **O canal de Instagram e o número oficial são indistinguíveis por `provider` + `status`.**
  Só o `channel_type` os separa (decisão 3). Eu teria escrito a regra errada se não
  tivesse ido ler o teste de isolamento antes.
- **`createBlastPlan` marca `sent` logo após despachar.** Achei que a marcação viesse do
  retorno do fornecedor. Isso transforma o que parecia "injetar outro dispatch" numa
  bifurcação de verdade dentro da função mais sensível do Disparo — e é a razão principal de
  a fatia 5 não ter cabido nesta janela.
- **O ratchet de tipos acusa 76 erros "introduzidos" numa árvore limpa.** Confirmei com
  `git stash`: os 76 existem sem nenhuma alteração minha. Mesma classe do aviso do brief
  sobre o lint — o `node_modules` local não bate com o do CI. **Não regenerei nada.** Meu
  delta real é zero.
- **`psql` está no PATH** e **`scripts/db-push-branch.sh` existe** — o `CLAUDE.md` diz que
  não e o `HANDOFF-1721` também. Os dois a favor, mas é drift de doc a corrigir.
- **A premissa do brief sobre o dedup não sobreviveu**, e o CTO confirmou o achado: o bug
  "o copilot escapa" já foi corrigido dentro de `governSend`. O que sobra da advertência —
  vocabulário fechado, fail-open silencioso — é o que virou teste (decisão 4).

---

## 6-bis. `/security-rubric` — veredito

**Bloqueia agora: nada.** **Bloqueia no apply: um item**, e é mecânico (abaixo).

| Item | Veredito |
|---|---|
| RLS | Nenhuma policy nova. As duas de `blast_plan_recipients` (ambas SELECT) ficam como estavam; nenhum `SELECT ... FROM team_members` inline foi introduzido |
| Multi-tenant | `blast-plan-create` já resolvia a org do contexto de auth; as Instances novas que eu leio já vêm validadas contra ela. O worker é cron, sem entrada de usuário |
| EXECUTE grants | Revogados de `PUBLIC`, `anon` e `authenticated` nos **dois** — os três, porque nenhum sozinho basta. ⚠️ **A verificação não pôde ser rodada: nada foi aplicado em lugar nenhum.** `scripts/verificar-grants-1722.sql` está pronto; o item fecha no apply |
| `search_path` | Pinado (`SET search_path = public`) nas duas funções |
| service_role não é backstop | O worker roda como service_role e varre todos os tenants **por desenho**. Não há IDOR: não existe entrada de usuário no caminho — o único acionador é o pg_cron, autenticado por `x-cron-secret` com `timingSafeCompare`, e `CRON_SECRET` vazio devolve 401 (fail-closed) |
| Secrets | O segredo do cron sai de `public.cron_config` dentro da função SECURITY DEFINER e nunca é logado. O log do tique carrega **só contadores** |
| CORS / edge fn | `Deno.serve(withErrorBoundary(...))` + `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return. Nenhum header custom novo no caminho de navegador — `x-cron-secret` é servidor-para-servidor, não passa por preflight |
| PII | Nenhum telefone em log. O erro do fornecedor vai para `reason` na linha do destinatário, que é lida sob RLS por tenant — e é exatamente o que o critério "ver por que falhou" pede |
| Injection | Sem SQL dinâmico. Os parâmetros do RPC são `INT` |
| Migration | Só schema. O único `UPDATE` está **dentro do corpo** de `claim_blast_recipients`, não no apply — é o falso positivo que o runbook prevê para varredura por linha |

**Herdado (não bloqueia, vira issue):**

- `HERDADO — supabase/functions/blast-plan-create/index.ts:207 (hoje 250) — `deno check` falha
  com `Type 'string | undefined' is not assignable to type '"image" | "text"'` no fechamento do
  `runUazapiSenderJob`. Confirmado idêntico na árvore limpa via `git stash`. Edge functions não
  são type-checked no CI, então isso não é visto por ninguém hoje.
- `HERDADO — .agent/skills/skills/radix-ui-design-system/templates/component-template.tsx — erro
  fatal de parsing no ESLint. O diretório `.agent/` **não é rastreado pelo git** (`git ls-files`
  vazio) e zero arquivos dele estão no meu diff. É o único `error` que o `lint:ratchet` acusa, e
  o CI não o enxerga. **Não regenerei a baseline** — é exatamente a armadilha que o brief avisou.
- Meu delta real de lint: **2 warnings** `no-explicit-any`, em
  `_shared/blast-official-runner.ts` (o cliente Supabase, como no resto de `_shared`) e nas
  fixtures de `blast-plan-canal-oficial.test.ts`. Zero erros, zero tipos introduzidos.

---

## 6-ter. O que o `/code-review` mudou

Dois eixos em paralelo (Padrões, Spec). **Quatro achados viraram conserto, e um deles era
regressão de verdade.**

**Consertado — REGRESSÃO no critério 8: o case do provedor.** O módulo antigo normalizava
(`instances-to-numbers.ts:49`, `BLASTABLE_PROVIDERS.has((i.provider ?? "").toLowerCase())`)
e a minha reescrita não. Um `provider: "Uazapi"` passaria a cair no fail-closed e a
Organization ficaria **sem número nenhum, sem explicação**. Nenhum teste cobria — nem o
antigo nem o meu —, então não herdei vermelho que me avisasse. Agora normalizam os dois
lados, o teste gêmeo exercita o case, e há caso próprio dizendo de onde veio.

**Consertado — uma TERCEIRA cópia da regra de regime.** `blast-official-runner.ts` calculava
`provider === "notificame" ? "oficial" : "chip"` inline, enquanto `decisao-do-disparo.ts` se
declara "FONTE ÚNICA" duas linhas acima. E a terceira cópia ficava **fora do teste gêmeo**,
que é o único instrumento que impede front e servidor de divergirem. Duas cópias vigiadas é
decisão; três, com uma invisível, é o defeito que este ticket veio consertar na camada dos
números. Agora usa `regimeDoProvedor`, e uma guarda nova reprova `=== "notificame"` solto
nos três arquivos suspeitos.

**Consertado — `StepMessage` reimplementava o que já existia.** `rotulosDosBotoes` tinha o
**mesmo nome** de uma função exportada em `communication/lib/template-send.ts`, e o meu
`corpoDoTemplate` era um `previewDoTemplate` pela metade (só BODY, sem HEADER/FOOTER). Pior
que duplicação: o texto gravado na conversa sairia **diferente** do que o nó de Workflow
grava para o mesmo template. Agora os dois caminhos usam as mesmas funções.

**Consertado — o rótulo do número tinha uma terceira fórmula** no ramo de fallback do
Disparo Rápido. Virou `rotuloDaInstancia`, exportado do módulo único.

**Registrado como ressalva, não como conserto — a ordem dos passos.** A revisão de spec
observou, com razão, que a reordenação muda a UX de **todo** usuário, inclusive só-Chip, e
que chamar isso de "idêntico" é funcionalmente verdadeiro e visualmente falso. O CTO fechou
a exceção explicitamente; agora ela está escrita como exceção (§4.1), não escondida.

**Aceito de propósito, não consertado — o bloco repetido 4× em `blast-plan.ts`.** A revisão
tem razão que `if (!ehCanalOficial(x)) { dispatch + markRecipients + notify }` aparece nos
quatro sítios de despacho. Mas os quatro diferem nos argumentos (`params.message` vs
`plan.message`, opções inline vs `dispatchOpts`), e um helper com saco de parâmetros trocaria
repetição legível por indireção — dentro da função mais sensível do Disparo, que é o caminho
de produção do Chip. A parte que **precisava** ser única já é: a pergunta `ehCanalOficial`.
Fica como dívida explícita para quem migrar o Chip para o motor próprio, que é quando os
quatro sítios convergem de verdade.

---

## 7. Fechamento

Os nove critérios estão fechados. O que ficou **fora é escopo de outras fatias**, não dívida
desta: variáveis (#1723), ciclo de entrega (#1724), teto de gasto (#1725), erros da Meta como
decisões (#1726), supressão (#1727), ritmo adaptativo (#1728), pausar/parar pelo worker
(#1729), Disparo Rápido enviando pelo oficial (#1730) e a verdade por destinatário do Chip
(#1731).

O terceiro seletor de instância (`pipelines/components/disparo/DisparoWizard.tsx:410-413`)
seguiu **fora por decisão do CTO** e virou a issue **#1781**, bloqueada por esta. Não encostei
nele: apontá-lo para o módulo novo o faria oferecer o número oficial numa tela que não sabe
enviar por ele — exposição nova, não conserto.

A fatia seguinte mais urgente é a **#1724**, e ela começa com o achado de §6 na mão: sem
aquilo, a entrega nunca fecha e o custo realizado nunca sobe.
