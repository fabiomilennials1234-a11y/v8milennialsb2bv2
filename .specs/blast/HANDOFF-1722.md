# HANDOFF — #1722 · Disparo pelo Canal Oficial: fila, worker e progresso

Branch `feat/1722-disparo-canal-oficial`, empilhada em `feat/1721-blast-recipient-state`
(PR #1777, **aberto**, não mergeado — conferido em 2026-08-23).
Plano e medições: [`PLANO-1722.md`](./PLANO-1722.md) · Antecessor: [`HANDOFF-1721.md`](./HANDOFF-1721.md)
Decisões do CTO: `~/Dev/.maestri/briefs/1722-decisoes.md`

> **Estado: INCOMPLETO, e de propósito.** Cinco das seis fatias estão prontas e verdes —
> incluindo a bifurcação do criador, que era o item crítico. Falta **a tela**: a seleção de
> Template (critérios 3 e 4) e o progresso por pessoa (critério 7). O desenho está em §4;
> não é "descobrir de novo", é executar. Ver §7 para o re-corte.

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
| 1 | Número oficial aparece na tela, com regime visível | ✅ módulo + seletor do Disparo Rápido; o rótulo no wizard depende da fatia 5 (§4) |
| 2 | Wizard e Disparo Rápido, mesmo conjunto, mesmo módulo | ✅ com **guarda mecânica** que reprova quem voltar a filtrar sozinho |
| 3 | Número oficial troca o passo de conteúdo | 🟡 máquina de estados pronta e testada, ordem já revista; **falta a UI** (§4.1) |
| 4 | Só Templates aprovados, sem catálogo local | 🟡 idem — o hook existe; falta o painel compartilhado |
| 5 | Uma linha por destinatário, worker consome uma a uma | ✅ worker, claim, cron **e** a bifurcação do criador nos 4 sítios de despacho |
| 6 | Mensagem aparece na conversa e **não** é gravada duas vezes | ✅ **provado por mutação**, não por leitura |
| 7 | Progresso por pessoa, não contador | ❌ não construído (§4.3) |
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

### 4.1 O passo de conteúdo troca de cara (critérios 3 e 4)

A **máquina de estados já está pronta e testada**: a ordem mudou (`speed` antes de
`message`), `regimeDoConteudo(draft)` responde o regime, e `validateStep("message")` já
exige `draft.template` quando o regime é oficial. Falta a UI:

- `StepMessage.tsx` ramifica: regime `chip` → o textarea de hoje, intocado; regime
  `oficial` → seleção de Template aprovado.
- O painel a reusar é `workflows/components/action-configs/TemplateNodeConfig.tsx`, e ele
  **não** é reusável como está: amarrado a `ActionNodeData`, lê a instância de
  `data.whatsappInstanceId` (linha 109, **fora** do mapa `campos` que já parametriza os
  outros cinco campos), e importa `VariableInserter` de `@/modules/workflows`.
- Caminho recomendado: extrair um `TemplateAprovadoPicker` **apresentacional** para
  `@/modules/communication` (onde já vive `useNotificameTemplates`), props
  `{instanceId, escolhido, onEscolher}`; `TemplateNodeConfig` passa a consumi-lo e o wizard
  também. Uma listagem, dois consumidores.
- ⚠️ **`listTemplates` NÃO filtra por status** (`_shared/notificame-templates.ts`): devolve
  PENDING/REJECTED/PAUSED também. O filtro `APPROVED` é de quem chama — hoje o front faz
  (`TemplateNodeConfig.tsx:130-133`). O picker novo tem de manter isso, ou o critério 4 cai.

### 4.2 O criador bifurca — **FEITO**

`createBlastPlan` despachava o lote 0 e **em seguida marcava os destinatários como `sent`**
na mesma passada. No regime oficial isso seria desastroso: as linhas nasceriam enviadas sem
ninguém ter enviado, o worker nunca as reivindicaria (ele só olha `pending`), e o Disparo
apareceria concluído com zero mensagens entregues.

Os **quatro** sítios de despacho foram bifurcados por `ehCanalOficial(instance)`:
criação single-número, criação multi-número, release multi-número e release single-número.
No regime oficial nenhum deles despacha nem marca `sent`; o lote continua sendo **liberado**
(`lots_released` avança — é o que `claim_blast_recipients` enxerga) e os ledgers de
orçamento continuam sendo incrementados, porque o Orçamento Diário conta **pessoas
planejadas para hoje** e isso não depende de quem carrega a mensagem.

`blast-plan-create` recusa **regime misto** e número não-disparável, e exige o Template no
oficial — via `regimeDoConjunto`, que é puro e tem teste próprio (a decisão do CTO era
"barrado na tela **e** no servidor"). O front já manda o `template` no payload.

Provas: `tests/unit/blast-plan-canal-oficial.test.ts` (5 casos, incluindo o **controle do
Chip**, que continua despachando e marcando `sent` na criação) e os 6 casos de
`regimeDoConjunto`.

⚠️ **Lacuna registrada, não construída**: o `post_send_target` (o "Destino" do wizard, que
move o lead quando a mensagem DELE sai) não dispara no regime oficial. `notifyRecipientsSent`
está dentro do ramo do Chip, e é o lugar certo — chamá-lo na criação afirmaria um envio que
não aconteceu. Quem passa a mover o lead é o worker, quando o envio de fato sai. É trabalho
de uma fatia própria; hoje um Disparo oficial com Destino escolhido simplesmente não move.

### 4.3 Progresso por pessoa (critério 7)

`StepMonitor.tsx:54,201-211` e `BlastPlanCard.tsx:101,300-321` mostram
`useBlastPlanProgress` — quatro contadores (`useBlastPlans.ts:145-168`). A lista por pessoa
já existe, mas só no drill-down `BlastPlanRecipientsSheet.tsx`. `StepMonitor` passa a
mostrar as pessoas, com `useBlastPlanRecipients` (que já pagina e já tem realtime
declarado em `StepMonitor.tsx:49-50`); o contador fica como resumo.

⚠️ **Dívida datada, herdada do #1721 e ainda não vencida**: `useBlastPlans.ts:162` tem
`else p.pending += 1` — um catch-all. No dia em que `delivered` for gravado (#1724), ele
aparece na tela como "Aguardando". O teste 3 da guarda de vocabulário é o estopim.

### 4.4 O resto do ciclo

`/code-review`, e o `/security-rubric` é **obrigatório** aqui: o diff toca multi-tenant
(RPC `SECURITY DEFINER` que varre todos os tenants por desenho), secrets (`x-cron-secret`),
CORS e WhatsApp/Uazapi.

---

## 5. O que sobrou para o humano

1. **Rodar a medição da decisão C** — está pronta em
   `scripts/medicao-1722-provider-message-id.sql`, cinco SELECTs, zero escrita:
   ```bash
   node scripts/prod-sql.mjs --file scripts/medicao-1722-provider-message-id.sql
   ```
   Tentei rodar e o sandbox recusou a chamada a produção — é permissão sua, não minha.
   **Por que importa**: descobri que a linha gravada no envio nasce com
   `provider_message_id` **NULL** (`buildOutboundChannelMessageRow`,
   `notificame-provider.ts:979-1003`); quem preenche essa coluna é o **primeiro callback que
   casar** (`notificame-webhook/index.ts:1131-1174`). O worker grava na linha do
   destinatário o id da **resposta do envio** — que é o que vira `external_id`. Se o
   `providerMessageId` estável não for esse id, a #1724 casa o callback errado e a entrega
   nunca fecha. `pmid_diferente = 0` responde a pergunta.
2. **Aplicar a migration `20270824000000`** — depois da `20270823000000` do #1721, que
   **também ainda não foi aplicada**. A ordem importa: a de agora depende das colunas da
   anterior (`claimed_at`).
3. **Regenerar os types** depois do apply em prod, nunca a partir de branch.
4. **Conferir o ledger** e o drift, como o runbook manda.
5. **Issue para o terceiro seletor de instância** — o CTO já disse que abre (§6).

**Nada foi aplicado em produção. Nenhuma branch do Supabase foi criada** — a medição que eu
precisava é read-only e não exige branch, e o que exigiria (o claim concorrente rodando de
verdade) ficou para a fatia que não coube.

---

## 6. O que me surpreendeu

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

## 7. Recomendação

O ticket é maior que uma janela. Não por surpresa de escopo — os nove critérios estão todos
mapeados —, mas porque a fatia 4.2 é uma bifurcação dentro de `createBlastPlan`, que é o
caminho do Chip em produção, e ela pede teste próprio antes de qualquer linha.

Sugiro **re-cortar o que falta em duas**, na ordem:

1. **O criador bifurca** (§4.2) — critério 5 fechado. É o que faz a fila existir de
   verdade; sem ela o worker é um laço sobre tabela vazia. Inclui o servidor recusando
   regime misto.
2. **A tela** (§4.1 + §4.3) — critérios 3, 4 e 7. Depende da 1 para ter o que mostrar.

As duas herdam um plano escrito, seams provados e o motor pronto.
