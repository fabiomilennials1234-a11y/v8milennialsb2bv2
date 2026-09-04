# PLANO — #1724 · Ciclo de entrega: o callback fecha a linha e o custo vira realizado

Branch `feat/1724-ciclo-de-entrega`, cortada de `origin/main` @ `90d12050`.
Pai: [#1719]. Antecessores aplicados em produção em 27/08: #1721 (forma da linha) e
#1722 (fila, worker, progresso).
Leituras: [`PLANO-1722.md`](./PLANO-1722.md) · [`HANDOFF-1722.md`](./HANDOFF-1722.md) ·
[`HANDOFF-1721.md`](./HANDOFF-1721.md) · ADR-0016, ADR-0028, ADR-0029.

---

## 1. O que este ticket é

Hoje o Disparo pelo Canal Oficial para em `sent`, que quer dizer **aceito pela fila**. A
Meta cobra **na entrega**. Enquanto o ciclo não fecha, o produto não sabe quem recebeu, o
custo realizado não existe, e a linha de quem nunca recebeu fica parada em "enviado" para
sempre — porque o TTL da Meta vai a 30 dias e a mensagem descartada **não gera callback**.

Três outros tickets penduram daqui: #1726 (erros viram decisões), #1727 (supressão) e
#1731 (verdade por destinatário no Chip).

---

## 2. Estado medido (fonte de cada fato)

### 2.1 A premissa central do brief — CONFERIDA, e ela se sustenta

O brief mandou reler antes de construir. Reli.

`notificame-webhook/index.ts:1113-1174` resolve o callback de status por **duas chaves**,
nesta ordem, e **antes** da resolução de canal:

```ts
const colunas = "id, status, raw_payload, provider_message_id";
const porExternalId = await admin.from("channel_messages").select(colunas)
  .eq("organization_id", organizationId).eq("external_id", st.messageId).limit(1);
let linha = ...;
if (!linha && st.providerMessageId) {
  const porProvider = await admin.from("channel_messages").select(colunas)
    .eq("organization_id", organizationId)
    .eq("provider_message_id", st.providerMessageId).limit(1);
  ...
}
if (!linha) { ...park("status_no_match"); return parkResponse(...); }
```

O comentário no próprio arquivo (`:1131-1138`) explica por quê: o `messageId` do evento
**não é estável por mensagem** — medido em 19/08, o `SENT` veio com o id que está em
`external_id` e o `ERROR` da MESMA mensagem, 0,4 s depois, veio com outro. O que os liga é o
`providerMessageId`, e **o primeiro callback que casar grava esse id na linha**
(`:1208`), para que os seguintes o usem como chave.

Do outro lado, o worker (`_shared/blast-official-runner.ts:288`) grava
`provider_message_id: envio.messageId`, que é o id da **resposta do envio** — o mesmo valor
que o provider põe em `channel_messages.external_id`
(`notificame-provider.ts:979-1003`, `:1297-1316`). O arquivo carrega 30 linhas de aviso
(`:267-287`) com a medição dos 747.

**Conclusão: a leitura bate.** O caminho é

```
callback --(duas chaves, por org)--> channel_messages --(external_id)--> blast_plan_recipients.provider_message_id
```

e não `callback --(id estável)--> blast_plan_recipients`, que não acharia nada, nunca.

### 2.2 O vocabulário do callback é de quatro palavras, não duas

`_shared/notificame-inbound.ts:400-418` — `classifyStatusWord`:

| palavra do fornecedor | vira |
|---|---|
| `SENT` / `ACCEPTED` / `QUEUED` | `sent` |
| `DELIVERED` | `delivered` |
| `READ` | `read` |
| `ERROR` / `FAILED` / `REJECTED` / `UNDELIVERED` | `failed` |
| qualquer outra | `null` → parka, não inventa |

**`read` é entrega.** Um `READ` que chegue sem o `DELIVERED` anterior (callback perdido ou
fora de ordem) fecha a linha como entregue — ignorá-lo deixaria uma mensagem lida marcada
como não confirmada 30 dias depois. `OUTBOUND_STATUS_RANK` (`:369-374`) já ordena
`pending < sent < delivered < read`, e `failed` fica **fora da escala de propósito**: recusa
vale sempre, inclusive depois de "entregue" — foi a sequência real que a Meta produziu.

### 2.3 Custo: **não existe escritor**, e o dono do preço é outro ticket

`estimated_cost` e `actual_cost` existem desde o #1721
(`20270823000000_blast_recipient_delivery_state.sql:57-59`, `numeric(12,4)`), e a varredura
em `src/`, `supabase/`, `tests/` e `scripts/` acha **só as duas migrations e os dois
ensaios**. Nenhum código lê ou escreve.

A tabela de preços versionada é critério de aceite do **#1725** ("A tabela de preços é
versionada, com vigência e origem, e não uma consulta em tempo real"), e o #1725 é bloqueado
por **#1722**, não por mim: somos irmãos, não fila. Ver §10 — é a única pergunta aberta.

### 2.4 `blast_plans` não tem coluna de custo

`20260101000000_baseline_prod_schema.sql:21899-21925`: `status`, `source`, `message`,
`refinements`, `total_recipients`, `lots_*`, `release_*`, `window_*`, `post_send_target`.
Nenhuma coluna de dinheiro, e o #1722 só acrescentou `template`.

Logo previsto e realizado são **derivados por soma**, não denormalizados. Isso é uma
vantagem, não uma falta: sem coluna de rollup não há corrida entre o callback que fecha a
linha e a agregação que o Disparo mostra, e um callback que chega depois do plano
`completed` continua mudando o número **sem ninguém precisar reagendar nada** (critério 4
sai de graça do desenho).

### 2.5 O estopim do #1721 vai ficar vermelho, e é o objetivo dele

`tests/unit/blast-recipient-status-vocabulary.test.ts`, teste 3, reprova no dia em que
alguém escrever `delivered` ou `unconfirmed`, com a mensagem apontando o que tratar antes:

> trate o balde de status desconhecido em `useBlastPlans.ts` (o `else p.pending += 1`), a
> union `BlastRecipientStatus` e as abas do `BlastPlanRecipientsSheet`.

Os três alvos, medidos:

- `useBlastPlans.ts:150-165` — `else p.pending += 1`. O primeiro `delivered` de produção
  apareceria como "Aguardando".
- `useBlastPlanRecipients.ts:35` — `export type BlastRecipientStatus = "pending" | "sent" | "skipped" | "failed"`.
- `BlastPlanRecipientsSheet.tsx:45` (`TABS`), `:91`, `:105` (`Record<BlastRecipientStatus, number>`
  com literal exaustivo), `:115` (filtro de aba vazia), `:120`, `:233-235`.
- `StepMonitor.tsx:218` e `:301-311` — o resumo e o rótulo por pessoa.

O teste 4 do mesmo arquivo fixa a union em quatro valores e diz, literalmente, que ampliar
"é trabalho da fatia que for tratar os estados na tela, não desta". **Esta é aquela fatia.**

### 2.6 O cron vivo, e por que o meu não precisa de edge function

Padrão mais recente e correto (`20270824000000_blast_official_worker.sql:150-220`): função
`SECURITY DEFINER` com `SET search_path = public`, URL derivada de `public.cron_config`
(nunca o ref chumbado), `EXCEPTION WHEN invalid_schema_name` (sem `pg_net` o Postgres falha
no schema **antes** da função, e `undefined_function` não pega isso), `cron.unschedule`
condicional antes do `cron.schedule`, EXECUTE revogado de `PUBLIC`/`anon`/`authenticated` e
concedido só a `service_role`.

**Mas a varredura do critério 5 não precisa de HTTP.** Ela é um `UPDATE` de uma linha:
`status = 'unconfirmed'` onde `status = 'sent'` e `sent_at` venceu o TTL. Uma edge function
aqui seria `net.http_post` → boundary → CORS → deploy → segredo, tudo para rodar um comando
que o Postgres já sabe rodar. Fica **SQL puro** numa função `SECURITY DEFINER` chamada pelo
`pg_cron`, diária. Menos peças, menos deploy do humano, e o job vai **versionado na
migration** — o brief avisa que prod tem 53 jobs e o repo 11, e é assim que esse buraco se
abre.

### 2.7 Herdado no meu raio — a contagem trunca em 1000

`useBlastPlans.ts:158` faz `.select("status").eq("plan_id", planId)` **sem paginar**, contra
o teto de 1000 linhas do PostgREST. `useBlastPlanRecipients` pagina (`FETCH_PAGE = 1000`,
`FETCH_PAGE_CAP = 20`); o de progresso não. Hoje é inerte — o maior Disparo da história do
produto tem 235 destinatários (ADR-0028). Deixa de ser inerte quando a mesma consulta passar
a somar **dinheiro**: um total truncado não parece truncado, parece um valor.

### 2.8 Herdado no meu raio — o `23505` que vira mensagem paga duas vezes

`blast-official-runner.ts:393-410` (`marcar`): erro de banco vira `console.error` e a linha
fica `pending` com `claimed_at`. Depois do stale de 10 minutos ela volta para a fila e é
**reenviada**. Se o índice único global de `provider_message_id` (#1721, sem
`organization_id` — `HANDOFF-1721.md` item B) recusar o carimbo com `23505`, o resultado é
uma duplicata cobrada.

Isso já existia. Minha fatia é a que torna `provider_message_id` **carregável de peso** — é
a chave de casamento do callback —, então o conserto entra aqui: ver §4.5.

### 2.9 Quatro achados dos sweeps que mudam o plano

**a) O ADR-0028 descreve a ordem das chaves ao contrário.**
`docs/adr/0028-disparo-canal-oficial-motor-proprio.md:23` diz que o webhook "casa pelo
`provider_message_id`, o id estável, com fallback por `external_id`". O código faz o
**inverso**: `external_id` primeiro (`:1140`), `provider_message_id` como fallback (`:1155`).
E tem de ser assim — `channel_messages.provider_message_id` nasce **NULL**, então o PRIMEIRO
callback de uma mensagem de Disparo **só pode** casar por `external_id`. Um implementador que
confiasse no ADR escreveria o casamento invertido e ele falharia exatamente no primeiro
callback, que é o único que importa para fechar a entrega. ADR é imutável — vira issue de
errata, não edição minha.

**b) `src/integrations/supabase/types.ts:1742-1778` está stale.** Nenhuma das seis colunas do
#1721 está nos tipos gerados. O frontend já contorna com `.from("blast_plan_recipients" as any)`
(`useBlastPlanRecipients.ts:68`, `useBlastPlans.ts:160`). Sigo o mesmo house pattern; regenerar
tipos é do humano, **depois** do apply em prod, nunca a partir de branch.

**c) O rollback do #1721 deixa de ser seguro por causa desta fatia.**
`rollback/20270823000000_blast_recipient_delivery_state.sql:8-11` avisa que ele para de valer no
momento em que alguma fatia escrever entrega ou custo — porque o CHECK volta a quatro valores e
qualquer linha `delivered`/`unconfirmed` passa a violar `23514`. Esta é a fatia. O rollback do
#1724 tem de dizer isso com todas as letras e trazer o `UPDATE` de reversão de estado
(`delivered`/`unconfirmed` → `sent`) **antes** de qualquer tentativa de reverter o #1721 — e
isso é DML de reversão, que mora no arquivo de rollback, não no de apply.

**d) `trackId` é um canal de correlação que existe e ninguém lê.**
`blast-official-runner.ts:259` passa `trackId: linha.id` para `sendTemplateViaInstance`, e
`whatsapp-dispatch.ts:406-458` **nunca lê `opts.trackId`** — só `trackSource`, `content` e
`idempotencyKey` chegam ao `governSend`. Se ele descesse até
`channel_messages.metadata`, o casamento seria direto, sem passar por `external_id`. **Fora de
escopo, deliberado**: não ajudaria nenhuma linha já enviada, mexeria no caminho de envio de
produção, e o casamento por `external_id` funciona. Fica registrado — é a forma certa no dia em
que alguém reescrever o transporte.

---

## 3. Premissas do brief conferidas

| Premissa do brief | Veredito |
|---|---|
| "casar direto pelo id estável não acha nada" | **Sustenta.** §2.1 |
| "o webhook resolve por duas chaves em `notificame-webhook/index.ts:1139-1174`" | **Sustenta**, com as linhas reais em `1113-1174`; o bloco inteiro (leitura + duas chaves + park + update) vai de `1113` a `1239` |
| "`external_id` casa com o que o worker grava" | **Sustenta.** `runner:288` grava `envio.messageId`; o provider põe o mesmo valor em `external_id` |
| "10 callbacks órfãos, o mais recente 2026-08-20" | Não reconferido contra prod (leitura de banco não autorizada nesta sessão sem branch); o mecanismo que os produz está lido e é o `park("status_no_match")` de `:1169` |
| "o índice único é global e a tabela não tem `organization_id`" | **Sustenta.** `20270823000000:62-66`; `TABLES_WITHOUT_ORG_ID` |
| "esta fatia é a primeira que escreve nessa coluna de verdade" | **NÃO sustenta.** Quem escreve é o worker do #1722 (`runner:288`), já em produção. Esta fatia é a primeira que **lê** a coluna para casar — e é por isso que a §2.8 vira escopo |
| "o webhook já faz a dança de duas chaves" — mas o ADR-0028 a descreve invertida | **Doc errado**, código certo. §2.9(a) |
| "prod tem 53 jobs e o repo 11 agendados" | Não reconferido; o repo tem 15 `cron.schedule` em migrations vivas. A regra que importa — job novo vai versionado — está seguida |

---

## 4. O que vai ser construído

### 4.1 Fatia 1 — o módulo que fecha a linha (`_shared/quick-blast/fechar-entrega.ts`)

Puro na decisão, com I/O isolado. Recebe o que o webhook já tem na mão e devolve um
veredito nomeado.

**A decisão, pura e testável sem banco** (`decidirFechamento`):

| callback | linha está | vira | grava |
|---|---|---|---|
| `delivered` \| `read` | `sent` | `delivered` | `delivered_at`, `actual_cost := estimated_cost`, `reason := null` |
| `delivered` \| `read` | `delivered` | — | nada (idempotente; reentrega não recobra) |
| `delivered` \| `read` | `failed` | — | nada (recusa vale sempre, §2.2) |
| `failed` | `sent` \| `delivered` | `failed` | `reason := 'provider_rejected'`, `actual_cost := null` |
| `sent` | qualquer | — | nada (o worker já marcou) |
| qualquer | `pending`/`skipped`/`unconfirmed` | — | nada |

`actual_cost := estimated_cost` é cópia, não cálculo: a Meta cobra na entrega **o preço da
categoria vigente no envio**, e é esse o valor carimbado na linha. Enquanto o #1725 não
carimba preço nenhum, a cópia é `NULL` → `NULL`, e o realizado é **desconhecido**, não zero
(§10).

`reason` sai do vocabulário canônico que a UI já sabe traduzir —
`invalid_number | instance_disconnected | provider_rejected | provider_error`
(`blast-recipient-view.ts:74-86`). Um callback de recusa é `provider_rejected`. Traduzir
`131050`, `131049`, `132015`, `132016`, `131042` em **decisões** é #1726, e o código cru da
Meta já fica persistido pelo próprio webhook em `channel_messages.raw_payload.status_event`
(`:1209-1220`) — não precisa de coluna nova para não se perder.

**O I/O, e o guarda de tenant.** `blast_plan_recipients` não tem `organization_id`, e o
índice único de `provider_message_id` é **global**. Casar só pela coluna deixaria um callback
da org A fechar a linha da org B se o fornecedor repetir id. Então são dois passos:

```ts
// 1. achar, com o tenant no JOIN — não na fé
.from("blast_plan_recipients")
.select("id, status, estimated_cost, blast_plans!inner(organization_id)")
.eq("provider_message_id", externalId)
.eq("blast_plans.organization_id", organizationId)
.limit(1)
// 2. escrever por id
```

Sem linha → devolve `"sem_linha"` e pronto. **É o caso comum**: quase todo callback de status
do produto é de conversa normal, não de Disparo. Nada de erro, nada de log por evento, nada
de insert (critério 6).

Nunca lança. Erro de banco vira `console.error` com o `externalId` e segue — o webhook tem de
responder 200 ao fornecedor de qualquer jeito.

### 4.2 Fatia 2 — o webhook chama, e só isso

`notificame-webhook/index.ts`:

- acrescentar `external_id` a `colunas` (`:1139`) — hoje o `select` não o traz, e é ele a
  chave do casamento;
- depois do `upd` bem-sucedido (`:1224`) e **antes** do `return json(200, …)` (`:1235`),
  chamar `fecharLinhaDoDisparo`;
- o retorno do 200 ganha o veredito (`blast: "fechada" | "sem_linha" | "ignorado"`), que é o
  que torna o critério 6 observável de fora sem ler banco.

O que **não** muda: a ordem das duas chaves, o `progride`, o merge de `raw_payload`, a guarda
de eco, o park. O bloco já está certo; eu penduro nele.

### 4.3 Fatia 3 — o custo aparece, separado

> ⚠️ **REVISTO DURANTE A CONSTRUÇÃO, e o motivo importa.** Este parágrafo dizia
> "um RPC, não uma soma no cliente", com três razões. A terceira era boa (tenant
> explícito) e a primeira também (o teto de 1000). A que faltava derrubou as três:
> **o frontend deste repo deploya sozinho no merge para a main, e a migration é
> botão do humano** (`CLAUDE.md`, § Comandos). Entre um e outro a RPC não
> existiria, e o painel passaria horas dizendo "0 enviados" — exatamente a mentira
> que este ticket recusa para o custo. Um *fallback* consertaria e poria a regra
> de dinheiro em dois caminhos, que é o que o próprio CTO acabou de recusar para
> o preço. A RPC saiu da migration: função que ninguém chama é andaime.

`src/modules/campaigns/lib/blast-delivery-summary.ts`, puro, e
`useBlastPlanProgress` passa a paginar.

- `resumirDestinatarios` conta os SEIS estados **por nome**, mais um contador
  `desconhecidos`. O `else p.pending += 1` morre: um estado que o código não
  conhece tem de ser contável, não escondido.
- `custoPrevisto` = soma de `estimated_cost` das linhas que SAÍRAM
  (`sent`/`delivered`/`failed`/`unconfirmed`); `custoRealizado` = soma de
  `actual_cost` das `delivered`. A diferença entre os dois é o que não chegou, e é
  o ponto de mostrá-los separados.
- **A soma é INTEIRA, em décimos de milésimo.** As colunas são `numeric(12,4)` —
  quatro casas porque o utility custa R$ 0,0350 e duas dariam 14% de erro por
  mensagem (#1721). O PostgREST devolve numeric como string justamente para não
  perder precisão, e `Number` a jogaria fora no primeiro passo (`0.035 * 10` é
  `0.34999999999999997`).
- **`null` é resposta.** Soma de nada é `null`, e `formatarCusto(null)` é `"—"`.
  Nunca `R$ 0,00`: zero afirma "custou nada"; o travessão diz "não sei", que é a
  verdade enquanto a tabela de preços (#1725) não existir. Decisão do CTO.
- A paginação conserta o herdado da §2.7 no caminho: o irmão
  `useBlastPlanRecipients` já paginava, este não.

### 4.4 Fatia 4 — a tela para de mentir (o estopim do #1721)

- `BlastRecipientStatus` ganha `delivered` e `unconfirmed`.
- `useBlastPlanProgress`: o `else p.pending += 1` morre — o RPC conta por status nomeado no
  SQL, e status desconhecido deixa de ter balde onde se esconder.
- `BlastPlanRecipientsSheet`: duas abas novas, `Record<BlastRecipientStatus, number>` volta a
  ser exaustivo, e a regra de esconder aba vazia (`:115`) passa a valer para as três abas que
  podem legitimamente ficar em zero (`failed`, `delivered`, `unconfirmed`).
- `blast-recipient-view.ts`: rótulo de `unconfirmed` — "Entrega não confirmada", e o texto
  auxiliar diz o que isso é (o prazo venceu sem o canal confirmar), porque "não confirmada"
  sozinha manda o operador adivinhar.
- `StepMonitor`: "Entregues" ao lado de "Enviados", e os dois custos.
- O teste 3 e o teste 4 da guarda de vocabulário são **reescritos**, não apagados: passam a
  afirmar que quem escreve os estados novos são exatamente os dois escritores previstos (o
  módulo de fechamento e a varredura), e que a union do frontend cobre os **seis**. Guarda que
  se apaga quando incomoda não é guarda.

### 4.5 Fatia 5 — a migration (uma só)

`supabase/migrations/20270903000030_blast_ciclo_de_entrega.sql` + rollback.
Timestamp acima do topo vivo (`20270902000010`) e sem colisão — há uma colisão viva na main
em `20270901000010` (dois arquivos), sendo consertada pelo #1854 em paralelo; a minha não
encosta nela.

Conteúdo, só schema (guarda F4). **`blast_plan_delivery_summary` NÃO entrou** —
ver a ressalva da §4.3:

1. `encerrar_entregas_vencidas()` — a varredura do critério 5. `UPDATE` para `unconfirmed`
   onde `status = 'sent'` e `sent_at < now() - <TTL>`, **só** para planos do regime oficial
   (o Chip não tem callback de entrega e a linha dele significa outra coisa — #1731). O
   `UPDATE` vive **dentro do corpo da função**, não no apply: é o falso positivo que o
   runbook prevê para varredura por linha, e o mesmo precedente de
   `claim_blast_recipients`.
2. Índice parcial que serve a varredura: `(sent_at) WHERE status = 'sent'`.
3. O `cron.schedule` diário, no molde vivo (§2.6).
4. Grants: EXECUTE revogado dos **três** (`PUBLIC`, `anon`, `authenticated`) e
   concedido só a `service_role`. A conferência vai em
   `scripts/verificar-grants-1724.sql` e fecha no apply — o grant é do banco no
   momento do `CREATE`, não do SQL da migration.

O discriminador de regime da varredura é **duplo**: `sent_at IS NOT NULL` (hoje
só o worker oficial escreve essa coluna) **e** `p.template IS NOT NULL` (o
discriminador do #1722). A primeira sozinha bastaria hoje; a segunda é o que
impede a #1731 de transformar a varredura num encerrador de linhas do Chip no dia
em que der marca de tempo ao Chip.

**O TTL.** ADR-0029: o TTL da Meta vai a 30 dias. O valor entra como constante nomeada na
função, com o ADR citado, e **não** como coluna de configuração — não há ainda quem a
preencha, e coluna de config sem tela é gate sem produtor, que é exatamente o defeito que o
ADR-0029 registra sobre `consent_records`.

### 4.6 Fatia 6 — o `23505` deixa de virar duplicata paga (§2.8)

Em `marcar`, no caminho do `sent`: se o `UPDATE` falhar com `23505` no carimbo do
`provider_message_id`, tentar de novo **sem** a coluna, mantendo `status: "sent"` e
`sent_at`. A linha fecha como enviada — não volta para a fila, ninguém paga duas vezes —, e o
que se perde é a correlação do callback, que a varredura do critério 5 encerra depois como
`unconfirmed`. É a troca certa: "uma linha sem confirmação de entrega" custa zero;
"uma mensagem paga duas vezes" custa dinheiro e incomoda o cliente.

Escopo justificado, não creep: minha fatia é a que faz essa coluna carregar peso.

---

## 5. Seams — onde a prova encosta

`/tdd`. Toda guarda nova é **vista vermelha uma vez** antes de ficar verde.

### 5.1 `tests/unit/blast-fechar-entrega.test.ts` — a decisão, pura

A tabela inteira da §4.1 por comportamento de borda. Os casos que já custaram defeito ou são
a origem do risco:

- `READ` sem `DELIVERED` anterior fecha como entregue (§2.2);
- `DELIVERED` atrasado **não** apaga um `failed` (a sequência real da Meta: `SENT` e, 2 s
  depois, `ERROR`);
- segundo `DELIVERED` do mesmo envio não recobra (idempotência);
- `actual_cost` é cópia de `estimated_cost`, e `NULL` continua `NULL` — não vira `0`;
- callback de org A **não** fecha linha de org B com o mesmo `provider_message_id`
  (o guarda da §4.1 — mutar o `.eq("blast_plans.organization_id", …)` para fora tem de
  reprovar);
- callback sem linha nenhuma devolve `"sem_linha"`, sem lançar e sem inserir (critério 6);
- erro de banco não lança.

### 5.2 `tests/unit/notificame-webhook-status-blast.test.ts` — o pendurado

No molde de `notificame-webhook-handler.test.ts` (499 linhas, dublês de PostgREST).
Prova o que só existe na junção:

- o `select` do webhook traz `external_id` — **mutação**: tirar a coluna do `colunas` tem de
  reprovar, senão o casamento cai em silêncio;
- callback que não é de Disparo passa pelo webhook sem tocar `blast_plan_recipients`;
- **critério 4**: callback com o plano já `completed` fecha a linha do mesmo jeito — nada no
  caminho olha o status do plano;
- falha do fechamento não muda o 200 nem o update de `channel_messages`.

### 5.3 `tests/unit/blast-delivery-summary.test.ts` — o custo separado

Puro sobre a forma que o RPC devolve (o SQL em si é §6): previsto conta o que saiu,
realizado conta só `delivered`, e um plano sem preço carimbado devolve **desconhecido**, não
zero. Mutação: fazer o realizado somar `sent` também tem de reprovar.

### 5.4 `tests/unit/blast-recipient-status-vocabulary.test.ts` — reescrito, não apagado

§4.4. Mais: a union do frontend cobre os seis, o `Record` exaustivo compila, e nenhum status
desconhecido tem balde.

### 5.5 O que só o banco prova, e onde

`FOR UPDATE SKIP LOCKED` do #1722 seguiu sem prova de concorrência real (`HANDOFF-1722.md`
§5). O meu débito de banco é menor e específico:

- `encerrar_entregas_vencidas()` fecha o que venceu e **não encosta** no que não venceu, nem
  em plano de Chip;
- `blast_plan_delivery_summary` recusa plano de outra org (`get_my_organization_ids()`), e
  `anon`/`authenticated` não executam `encerrar_entregas_vencidas`;
- a soma não trunca em 1000 (o ponto inteiro da §2.7): plano com 1.500 linhas.

Branch efêmera de prod, **pré-autorizada neste ticket**. Aviso ao subir, **derrubo ao
fechar** (`delete_branch`), e apago o `.env.development.local` se criar um.

---

## 6. Fora de escopo, deliberado

- **A tabela de preços versionada** — critério de aceite do #1725, que não depende de mim.
  Eu entrego o encanamento (§10).
- **Códigos da Meta como decisões** (`131050`, `131049`, `132015`, `132016`, `131042`) —
  #1726, que é bloqueado por mim. Eu gravo `provider_rejected` e deixo o código cru
  persistido onde o webhook já o põe.
- **Supressão** — #1727.
- **O Chip** — #1731. A varredura filtra por regime oficial justamente para não encostar nele.
- **Ritmo adaptativo** — #1728.
- **Reconciliação retroativa dos 10 órfãos** de `status_no_match` que já estão parkados.
  Fechar linha a partir da fila de eventos parkados é reprocessamento, não ciclo de entrega,
  e nenhum critério pede. Fica registrado como issue se o CTO quiser.

---

## 7. Riscos, com o custo de cada um

| Risco | Custo se acontecer | O que faço |
|---|---|---|
| O `external_id` de um Disparo colide com o de outra org e o índice global recusa o carimbo | mensagem paga duas vezes | §4.6 — o `23505` fecha a linha como `sent` em vez de devolvê-la à fila |
| Callback de entrega chega **antes** de o worker terminar de gravar a linha | a entrega se perde: `sem_linha`, e a linha fica `sent` até a varredura | Aceito e registrado. A janela é de milissegundos (o `marcar` roda imediatamente após o envio) e o desfecho é `unconfirmed`, não erro. Fechar isso exigiria fila de retentativa — desproporcional |
| TTL de 30 dias parece longo demais e alguém o encurta sem medir | linha viva vira `unconfirmed` cedo demais, e o custo realizado some | Constante nomeada, com o ADR citado na linha de cima |
| O RPC novo nasce com EXECUTE aberto | leitura cross-tenant de custo | Revogo dos três e confiro por `has_function_privilege` **e** pela borda do PostgREST, como o #1722 teve de fazer |
| A varredura roda antes de a coluna `sent_at` existir em algum ambiente | erro no cron | `to_regclass`/`IF NOT EXISTS` no molde vivo, e o job só é agendado se `pg_cron` existir |

---

## 8. Ordem de execução

1. Este plano. **A pergunta da §10 antes de encostar em custo.**
2. §4.1 + §5.1 — o módulo puro, vermelho primeiro.
3. §4.2 + §5.2 — o webhook pendura.
4. §4.5 — a migration (summary + varredura + índice + cron + grants) e o rollback, que precisa
   reverter estado antes de qualquer reversão do #1721 (§2.9c).
5. §4.3 + §5.3 — o RPC no hook.
6. §4.4 + §5.4 — a tela e a guarda reescrita.
7. §4.6 — o `23505`.
8. Branch efêmera: §5.5. Derrubar.
9. `cd supabase/functions && deno check _shared/` — **o gate de edge function é este**, não o
   `typecheck:ratchet`. Depois `lint:ratchet`, `test:ratchet`, `build`.
10. `/security-rubric` — obrigatório: o diff toca multi-tenant (RPC `SECURITY DEFINER` e
    casamento cross-org), secrets (cron), webhook e PII (motivo de falha na linha).
11. `/code-review`. 12. push. 13. `HANDOFF-1724.md`. 14. fechar a #1724.

---

## 9. O que o humano faz no fim

Nada de código. Aplicar a migration, deployar o webhook (`notificame-webhook`), regenerar os
types **a partir de prod**, e conferir o ledger. Prod é botão do humano.

---

## 10. A pergunta aberta — custo, e de quem é o preço

Está em §2.3. Registrada aqui para não se perder; vai ao CTO em texto, uma por mensagem.
