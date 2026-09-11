# HANDOFF — #1724 · Ciclo de entrega: o callback fecha a linha e o custo vira realizado

Branch `feat/1724-ciclo-de-entrega`, cortada de `origin/main` @ `90d12050`, commit
`e7b4f247`. Plano e medições: [`PLANO-1724.md`](./PLANO-1724.md) ·
Antecessores: [`HANDOFF-1722.md`](./HANDOFF-1722.md) · [`HANDOFF-1721.md`](./HANDOFF-1721.md)
Decisão do CTO sobre custo: `~/Dev/.maestri/briefs/1724-decisao-custo.md`

> **Estado: COMPLETO com uma ressalva nomeada** (critério 2, §5). 104 testes verdes nos 8
> arquivos tocados, build de produção limpo, **zero** lint introduzido, **zero** tipos
> introduzidos (80 na minha árvore, 80 na árvore limpa — medido com `git stash`).
> Nada aplicado em produção; migration e deploy são botão do humano (§6).

---

## 1. Por que este trabalho existiu

O Disparo pelo Canal Oficial parava em `sent`, que quer dizer **aceito pela fila**. A Meta
cobra **na entrega** (ADR-0029). Enquanto o ciclo não fechava, o produto não sabia quem
recebeu, o custo realizado não existia, e a linha de quem nunca recebeu ficava parada em
"enviado" para sempre — porque o TTL do template vai a 30 dias e a mensagem descartada
**não gera callback**.

Três fatias penduram daqui: #1726, #1727 e #1731.

---

## 2. O achado que decide a fatia, e ele se confirmou

O brief mandou reler antes de construir, e a leitura bate.

```
callback --(duas chaves, por org)--> channel_messages --(external_id)--> blast_plan_recipients.provider_message_id
```

`notificame-webhook/index.ts:1140-1163` tenta `external_id` primeiro e
`provider_message_id` como fallback. O worker grava `envio.messageId`
(`blast-official-runner.ts:288`), que é o `external_id` que o provider escreve.

**Casar direto pelo id estável não acha nada, nunca** — 747 linhas de saída em produção,
`provider_message_id = external_id` em **zero** delas. Espaços de identificador diferentes.

### ⚠️ ERRATA DE ADR — e é o achado mais caro do lote, que não estava no ticket

| Onde | O que diz |
|---|---|
| `docs/adr/0028-disparo-canal-oficial-motor-proprio.md:23` | "casa pelo `provider_message_id`, o id estável, com **fallback por `external_id`**" |
| `supabase/functions/notificame-webhook/index.ts:1140` | `.eq("external_id", st.messageId)` — **primeiro** |
| `supabase/functions/notificame-webhook/index.ts:1155` | `.eq("provider_message_id", st.providerMessageId)` — **fallback** |

**O ADR descreve a ordem ao contrário, e o código está certo.** Tem de estar:
`channel_messages.provider_message_id` nasce **NULL** (`notificame-provider.ts:979-1003`
não escreve a coluna; quem a escreve é o primeiro callback que casar,
`index.ts:1208`). Logo o **primeiro** callback de uma mensagem só pode casar por
`external_id` — e é o primeiro que fecha a entrega.

Quem confiasse no ADR escreveria o casamento invertido e ele falharia **em silêncio**.
ADR é imutável: **o CTO abre a errata.**

---

## 3. O que foi entregue

| Arquivo | O quê |
|---|---|
| `supabase/functions/_shared/quick-blast/fechar-entrega.ts` | A decisão pura (`decidirFechamento`) + o I/O (`fecharLinhaDoDisparo`), com o tenant NO JOIN |
| `supabase/functions/notificame-webhook/index.ts` | `external_id` no select + a chamada depois do update. **3 hunks**, a resolução de duas chaves intocada |
| `src/modules/campaigns/lib/blast-delivery-summary.ts` | Os seis estados por nome, os dois custos em inteiros de 10⁻⁴, `truncado`, e as duas derivações que as telas compartilham |
| `src/modules/campaigns/hooks/useBlastPlans.ts` | `useBlastPlanProgress` paginado, ordenado e fail-closed por org |
| `src/modules/campaigns/hooks/useBlastPlanRecipients.ts` | A union com os seis |
| `BlastPlanRecipientsSheet` · `StepMonitor` · `BlastPlanCard` · `blast-recipient-view` | Abas Entregues / Não confirmadas, rótulos, os dois custos, `Record` exaustivo |
| `supabase/migrations/20270903000030_blast_ciclo_de_entrega.sql` + rollback | Índice parcial, `encerrar_entregas_vencidas()`, cron diário versionado, grants |
| `scripts/verificar-grants-1724.sql` | A prova de grant, que só fecha no apply |
| 5 arquivos de teste | 104 casos |

### Critérios de aceite

| # | Critério | Estado |
|---|---|---|
| 1 | Entrega marca a linha certa, pelo identificador estável | ✅ via a ponte do `external_id` (§2). `READ` sem `DELIVERED` anterior também fecha |
| 2 | Falha marca a linha com o motivo como o canal reportou | ⚠️ **PARCIAL, e nomeado** — ver §5 |
| 3 | Custo realizado = soma das entregues, separado do previsto | ✅ regra completa e provada. Os números aparecem como **desconhecidos** até a #1725 carimbar preço — decisão do CTO |
| 4 | Callback depois do fim do envio segue atualizando | ✅ **por desenho, não por remendo**: nada no caminho lê `blast_plans.status`, e o custo é derivado por soma, não denormalizado — não há rollup para reagendar |
| 5 | Prazo vencido sem confirmação encerra como não confirmada | ✅ `encerrar_entregas_vencidas()` + cron diário versionado |
| 6 | Callback que não casa não derruba nem inventa linha | ✅ `"sem_linha"` é o desfecho **comum** e é silencioso: sem log, sem insert, sem exceção |

---

## 4. Decisões, e por quê

**1. A varredura é SQL puro, não edge function.** É um `UPDATE`. Uma edge function
significaria `net.http_post` + boundary + CORS + segredo + deploy, tudo para rodar um
comando que o Postgres já sabe rodar — e mais um caminho para falhar em silêncio. Cron
diário chamando função `SECURITY DEFINER`. Uma superfície de segredo **a menos** que o
#1722.

**2. O discriminador de regime da varredura é DUPLO, e a segunda condição é para o
futuro.** `sent_at IS NOT NULL` bastaria hoje — só o worker oficial escreve essa coluna
(`blast-official-runner.ts:265`; o Chip grava apenas `{status, reason}` em
`blast-plan-store.ts:71` e `mass-send-status:89`). Mas a **#1731** dá verdade por
destinatário ao Chip, e se ela passar a carimbar `sent_at` esta varredura começaria a
encerrar linhas de Chip como `unconfirmed` — que ali significaria outra coisa, porque o
Chip não tem callback de entrega. Por isso também `p.template IS NOT NULL`.

**3. O custo é DERIVADO, nunca denormalizado.** `blast_plans` não tem coluna de dinheiro
(`baseline:21899-21925`) e eu não criei nenhuma. Sem coluna de rollup não há corrida entre
o callback que fecha a linha e a agregação que a tela mostra — **o critério 4 sai de graça
do desenho** em vez de precisar de um reagendamento.

**4. A soma é INTEIRA, em décimos de milésimo.** `numeric(12,4)` tem quatro casas porque o
utility custa R$ 0,0350 e duas dariam 14% de erro por mensagem (#1721). O PostgREST devolve
numeric como **string** para não perder precisão, e `Number` a jogaria fora no primeiro
passo (`0.035 * 10` é `0.34999999999999997`).

**5. `null` é resposta, e travessão não é enfeite.** Soma de nada é `null`, e
`formatarCusto(null)` é `"—"`. Zero **afirmaria** "custou nada"; o travessão diz "não sei",
que é a verdade enquanto a #1725 não existir. Decisão do CTO, com a instrução explícita de
manter mesmo que alguém ache feio.

**6. `read` é entrega.** Callbacks chegam fora de ordem e se perdem. Ignorar o `READ`
deixaria uma mensagem **lida** viva até a varredura a encerrar como "não confirmada" 30
dias depois.

**7. Recusa vale mesmo depois de entregue** — foi a sequência real da Meta (`SENT` e, 2 s
depois, `ERROR 131053`). Mesma assimetria que o webhook já aplica em `channel_messages`.

**8. O tenant vai no JOIN, não na fé.** `blast_plan_recipients` não tem
`organization_id` e a UNIQUE de `provider_message_id` é **global** (#1721, item B). Sem
`.eq("blast_plans.organization_id", …)`, um id repetido entre organizações fecharia a linha
errada. Mutei o filtro para fora e um teste reprovou.

**9. Curto-circuito antes da consulta para `sent`.** É o callback mais frequente do canal e
a tabela de decisão diz que ele nunca faz nada. Consultar o banco para descobrir isso seria
uma ida por evento em troca de nada. A regra segue num lugar só — `decidirFechamento`
também devolve `ignorar` para `sent`.

---

## 5. ⚠️ A ressalva: o critério 2 está PARCIAL, e é deliberado

O critério pede "o motivo **como o canal reportou**". A linha recebe
`reason = "provider_rejected"`, que é o vocabulário canônico que a tela já traduz
(`blast-recipient-view.ts:74-86`) e cujo default **nunca vaza código cru para a UI**.

O código da Meta (`131050`, `131049`, `132015`, `132016`, `131042`) **não é copiado para a
linha do destinatário**. Duas razões:

1. traduzir código em **decisão** é literalmente a #1726, que é bloqueada por esta;
2. não existe coluna para o código cru, e criar uma que só a #1726 vai usar seria andaime.

**O código não se perde**: o próprio webhook o persiste em
`channel_messages.raw_payload.status_event` (`index.ts:1209-1220`), na linha que a #1726
alcança pelo **mesmo `external_id`** que esta fatia já usa como ponte. O custo é um join a
mais na #1726 — e está escrito aqui para que ela não descubra sozinha.

**Se o CTO quiser o código na linha**, é uma coluna e meia hora. Não fiz porque invadiria o
critério de aceite de outra fatia.

---

## 6. O que sobrou para o humano

Nada de código. Cinco coisas, todas de produção.

1. **Rodar `scripts/verificar-grants-1724.sql` IMEDIATAMENTE depois do apply.** É o item da
   `/security-rubric` que **não pode fechar antes**: o grant é concedido pelo banco no
   momento do `CREATE`, não pelo SQL da migration, e neste projeto o EXECUTE chega por dois
   caminhos que se escondem um atrás do outro. Esperado: `anon=false`,
   `authenticated=false`, `service_role=true`.
2. **Aplicar `20270903000030_blast_ciclo_de_entrega.sql`.** ⚠️ **O número mudou, e a frase
   que estava aqui expirou.** Este item dizia `20270903000000` e *"sem colisão"* — era
   verdade quando foi escrito, e deixou de ser quando a main andou 14 commits e trouxe
   `20270903000000_metrica_por_etapa_para_de_degradar.sql`. Renumerado para `...000030` pela
   #1863 (§11). ⚠️ Há uma colisão em `20270901000010` (dois arquivos) **viva NESTA BRANCH,
   não na main** — a main já a resolveu no #1854, renumerando `produtos_do_negocio` para
   `20270901000011`, e esta branch está 14 commits atrás. A minha não encosta nela, ela some
   no merge, mas reprova dois testes de contrato no checkout local até a main entrar (§7,
   §11.1). *(Esta frase dizia "viva na main" até a #1863 medir: era falso — `git ls-tree
   origin/main` mostra `...000010_erp_pedidos_itens` e `...000011_produtos_do_negocio`. O §7
   ainda carrega a versão errada, e ficou como está por ser texto já revisado no #1861.)*
3. **Deployar `notificame-webhook`.** Sem o deploy, o callback continua sem fechar a linha —
   e o sintoma é silêncio, não erro.
4. **Regenerar os types depois do apply em prod**, nunca a partir de branch.
   `src/integrations/supabase/types.ts:1742-1778` está **stale**: nenhuma das seis colunas do
   #1721 está lá, e é por isso que o frontend usa `.from("blast_plan_recipients" as any)`.
5. **Abrir a errata do ADR-0028** (§2).

**Nada foi aplicado em produção. Nenhuma branch do Supabase foi criada** — ver §8.

---

## 7. Herdado, reportado e não consertado

- `HERDADO — supabase/functions/notificame-webhook/index.ts:1683` — `deno check` falha com
  `TS2322 SupabaseClient não é atribuível a StorageLike` no espelhamento de avatar.
  Confirmado idêntico na árvore limpa via `git stash`.
- `HERDADO — supabase/migrations/20270901000010_*.sql` — colisão de timestamp **viva na
  main** (dois arquivos), do #1854. Reprova
  `tests/unit/migration-version-collision-contract.test.ts` e
  `tests/unit/notificame-lead-link-rpc.test.ts`. Medido: os dois reprovam **igualmente na
  árvore limpa**.
- `HERDADO — tests/unit/protected-route.test.tsx` — suíte já vermelha. Na árvore limpa
  reprovam **8** casos ali; com a minha branch, 1.
- `HERDADO — .agent/skills/…/component-template.tsx` — erro fatal de parsing no ESLint, em
  diretório que o git **não rastreia**. É o único `error` do `lint:ratchet` e o CI não o
  enxerga. **Não regenerei a baseline.**
- `HERDADO — supabase/functions/_shared/blast-official-runner.ts` — usa `console.error`, e
  `_shared/CLAUDE.md` § "Não fazer" manda usar `logger`. Meus dois logs novos ali seguem o
  vizinho imediato de propósito: `logRuntime` numa linha com `console.error` na de baixo
  seria pior que consistente. O módulo **novo** (`fechar-entrega.ts`) segue a regra
  documentada. **39 arquivos de `_shared` têm o mesmo drift** — é issue própria, não desta
  fatia.

---

## 8. O que NÃO está provado

**Nenhuma branch efêmera foi criada** — a autorização estava de pé e eu não a usei. O que
isso deixa sem prova, nomeadamente:

- **`encerrar_entregas_vencidas()` nunca rodou contra um Postgres.** A lógica é um `UPDATE`
  com `FROM` e uma CTE modificadora; está lida e é SQL comum, mas **não foi executada**. Se
  algo desta fatia quebrar no apply, é o primeiro lugar a olhar.
- **Os grants nunca foram conferidos** (§6.1) — pela mesma razão do #1722: nada aplicado.
- **A varredura nunca encontrou uma linha vencida de verdade.** Produção não tem nenhuma:
  o Canal Oficial acabou de entrar e nenhum envio tem 30 dias.

Eu não subi a branch porque cada item acima custa um apply em prod para ser provado de
qualquer jeito, e o ensaio contra branch provaria a migration **sem** provar o cron (pg_cron
não roda em branch efêmera do jeito que roda em prod). O CTO decide se quer o ensaio antes.

---

## 9. O que me surpreendeu

- **O `select` do webhook não trazia `external_id`, e nenhum teste de comportamento
  consegue pegar isso.** O dublê de PostgREST **descarta a lista de campos**
  (`tests/helpers/supabase-mock.ts:236`, `select: (_fields?: string, …)`) e devolve a linha
  inteira. Removi a coluna do código e os nove testes de comportamento seguiram **verdes**.
  Eu já tinha escrito no `index.ts` que aquele teste reprovaria — era **falso**, e só
  descobri porque rodei a mutação. Virou guarda **estática**, que lê o texto do arquivo.
  **Lição que vale além desta fatia: neste repo, teste de comportamento não prova lista de
  colunas.**
- **A guarda de vocabulário do #1721 funcionou exatamente como projetada, e me pegou duas
  vezes.** Ela disparou quando gravei `delivered`, me obrigando a tratar a tela antes de
  seguir — e depois pegou dois arquivos que eu tinha esquecido de listar
  (`blast-recipient-view.ts` e o próprio `blast-official-runner.ts`, que só **cita**
  `unconfirmed` num comentário). Estopim que queima é estopim que serve.
- **Tipar o cliente em vez de usar `any` quebrou o ponto de chamada, não o módulo.**
  `deno check` no arquivo isolado passou; no webhook estourou `TS2589 Type instantiation is
  excessively deep`. O gate certo era o do brief — `deno check _shared/` **e** o
  chamador —, e eu só vi porque rodei os dois.
- **Eu planejei o resumo como RPC e estava errado.** O frontend deste repo deploya sozinho
  no merge para a main; a migration é botão do humano. Entre um e outro a RPC não existiria
  e o painel diria "0 enviados" — a mesma mentira que este ticket recusa para o custo. A
  função saiu da migration: ninguém a chamaria, e função sem chamador é andaime.
- **`processed = sent + skipped + failed` andava PARA TRÁS.** `delivered` é destino de
  `sent`: cada entrega confirmada **tirava** uma pessoa da conta e a barra recuava. O
  comentário na linha de cima existia justamente para impedir isso, com uma origem
  diferente. Duas telas tinham a mesma soma; agora a derivação mora uma vez só.
- **E eu consertei esse errado pelo lado errado**: ao incluir `delivered`, incluí `failed`
  em "enviados" também — e a tela mostra "N enviados · N falhas" na mesma linha, contando a
  mesma pessoa duas vezes. A revisão de spec pegou, citando a regra que o código antigo
  declarava ("`failed` … mas nunca soma em 'enviados'"). Está desfeito.
- **Trocar a RPC por soma no cliente derrubou um guarda de tenant sem eu notar.** A RPC
  carregava `get_my_organization_ids()`; o hook não carregava nada — `queryKey` sem `orgId`,
  `enabled: !!planId` — e passou a ler **dinheiro**. A revisão pegou. Agora é fail-closed
  como o irmão. **Trocar de mecanismo herda as responsabilidades do mecanismo antigo, e elas
  não vêm junto sozinhas.**
- **`.range()` sem `.order()` é indefinido**, e a tabela está sendo escrita pelo worker
  enquanto a tela lê. Páginas podem repetir ou pular linhas — e o sintoma seria um total de
  fatura errado, em silêncio. O irmão `useBlastPlanRecipients` já ordenava; eu copiei a
  paginação e não a ordem.
- **A premissa do brief "esta fatia é a primeira que escreve nessa coluna" não sobreviveu.**
  O worker do #1722 já grava `provider_message_id` em produção. Eu sou o primeiro que a
  **lê** — e foi isso que trouxe o `23505` para dentro do escopo, com o aval do CTO.

---

## 10. Fechamento

Os seis critérios estão fechados, com o critério 2 nomeado como parcial (§5) em vez de
declarado inteiro. O que ficou de fora é escopo de outras fatias: preço e Teto de Gasto
(#1725), erros da Meta como decisões (#1726), supressão (#1727), verdade por destinatário
no Chip (#1731).

**Para a #1725**: quem preenche `estimated_cost` é você. Esta fatia só copia
`estimated_cost → actual_cost` na entrega; enquanto ninguém carimbar preço, os dois custos
são `null` e a tela mostra travessão. Não suponha que já está feito.

**Para a #1726**: o código cru da Meta está em `channel_messages.raw_payload.status_event`,
alcançável pelo mesmo `external_id` que esta fatia usa como ponte (§5).

**Para a #1731**: a varredura filtra por `p.template IS NOT NULL` de propósito. Se você der
`sent_at` ao Chip, confira `encerrar_entregas_vencidas()` **antes** (§4.2).

---

## 11. Adendo — #1863: o `sent` órfão que o rename deixou para trás

Escrito por outro operário, depois que o PR #1861 já estava aberto e revisado. Uma linha
(`bd3030aa`), sem branch nova, sem tocar em mais nada do `StepMonitor`.

**O que era.** O rename das contagens por derivações nomeadas (§3) trocou seis nomes em
`StepMonitor.tsx:95-102`, e `StepMonitor.tsx:180` ficou apontando para `sent`, que deixou de
existir. `TS2552 — Cannot find name 'sent'`. A linha irmã (`:183`) já usava `pending` e
compilava, e é por isso que o buraco passou: **metade de um par foi renomeada e a outra
metade tinha cara de estar certa.**

**Por que `saiu`, e não `processed`.** A escolha estava em aberto no ticket, com `saiu` como
hipótese explícita a verificar. Três leituras independentes concordam:

1. `blast-delivery-summary.ts` documenta `saiuDaFila` como *"quantas pessoas RECEBERAM O
   ENVIO — o número que a tela chama de 'enviados'"*. `processados` é outra coisa declarada:
   a base da barra de progresso, somando `skipped`, `failed` e `desconhecidos`.
2. `StepMonitor.tsx:236`, **no mesmo componente**, já renderizava `saiu` sob `ReportRow
   label="Enviados"`. Com `processed`, o card em andamento contradiria o relatório 55 linhas
   abaixo dele — a tela discordando de si mesma.
3. `BlastPlanCard.tsx:324` imprime `{saiu} enviados`. As duas derivações vivem na lib
   justamente para as duas telas não divergirem (§4).

O critério 7 do #1722 ("progresso por pessoa, lido da fila") **não decide** entre os dois:
ambos derivam de linhas por destinatário via `useBlastPlanProgress` → `resumirDestinatarios`.
Quem decide é a docstring.

E `failed` fica fora de "enviados" pela mesma razão registrada no §9: a falha tem contador
próprio ao lado (`:238`), e somá-la contaria a mesma pessoa duas vezes na mesma linha. **A
armadilha de §9 continua armada para quem mexer aqui.**

**O gate, medido.** `typecheck:ratchet` foi de 81 para 80 introduzidos, e o `TS2552` sumiu
(provado por `git stash` + re-run). Os 80 restantes são drift de baseline local — o
`node_modules` de um clone não bate com o do CI, que reprovava com **um** erro. `lint:ratchet`
acusa 14, todos sob `.agent/skills/**`, que é gitignored (`.gitignore:5`) e não chega ao CI.
**Nenhuma baseline foi regenerada** — o erro era da branch, e baselinar erro próprio é o que
transforma ratchet em decoração.

`tests/unit/{disparo-wizard,blast-delivery-summary,blast-recipient-status-vocabulary}` →
45 verdes.

**Herdado, reportado, não consertado** (nasceu antes da #1863; vira issue, não diff):

- **Nada renderiza o `StepMonitor`.** `blast-delivery-summary.test.ts` cobre a derivação pura
  — e foi exatamente por isso que os testes passaram com a tela quebrada em render. Um smoke
  render do card em andamento pega esta classe inteira de erro; a cobertura de hoje não pega.
- **A legenda do card não fecha com a barra.** `pct` usa `processed` (`:107`), a legenda usa
  `saiu` + `pending` (`:180`, `:183`), e com `failed`/`skipped` > 0 os dois não somam `total`.
  O `BlastPlanCard` amortece imprimindo "· falhas · ignorados" inline (`:326-334`); o card em
  andamento não imprime. Mesma matemática nas duas telas — só a exibição difere.
- **O formato "N enviados" está triplicado** com `toLocaleString("pt-BR")` inline em `:180`,
  `:236` e `BlastPlanCard.tsx:324`. O número foi extraído para a lib; o formato não — e foi
  nessa duplicação que o `sent` órfão sobreviveu em um dos três lugares.

### 11.1 — A renumeração da migration, e por que ela entrou na mesma issue

`20270903000000_blast_ciclo_de_entrega.sql` virou **`20270903000030`** (`0afa968b`), com o
rollback junto e as quatro referências textuais, em três arquivos: a tabela do §3 e o item 2
do §6 deste handoff, `PLANO-1724.md:331` e `scripts/verificar-grants-1724.sql:2`.

**Por que.** O número foi escolhido em `e7b4f247` quando estava livre. A main andou 14
commits e trouxe `20270903000000_metrica_por_etapa_para_de_degradar.sql` — mesmo número,
outro arquivo. O guarda de colisão diz o custo melhor do que eu diria:

> `supabase db push` would SKIP one of them in silence — it would merge, CI would stay
> green, and the migration would never reach production.

Não é CI vermelho. É a migration **não chegar em produção sem ninguém perceber** — o mesmo
formato de falha que o §9 já catalogou nesta fatia: falha para dentro, silenciosa.

**Por que foi seguro.** O §6 registra que nada foi aplicado em produção. Sem ledger, não há
divergência. Renumerar migration **já aplicada** é outro problema, e não é este.

**Por que não é expansão de escopo.** Sem isto, o job `Lint & Build` morre em
`check-migration-versions.sh`, que roda **três passos antes** do `typecheck:ratchet` — o
gate que a #1863 existe para deixar verde. O conserto do `sent` ficava indemonstrável no CI.
Consertar o que impede a própria prova não é ampliar a tarefa; é terminá-la. Ainda assim, foi
**perguntado antes**, e a decisão foi do CTO.

**As duas metades do guarda pegam coisas diferentes, e as duas foram exercitadas:**

| Metade | O que lê | Antes | Depois |
|---|---|---|---|
| (a) duplicados no checkout | `ls` do diretório | 1 no **merge ref** (`20270903000000`) — invisível de cada lado isolado | **0 no merge ref** |
| (b) colisão com a base | `git ls-tree` de `HEAD` vs `origin/main` | 1 (`...000000` sob outro nome) | **0** |

⚠️ **A metade (a) só é verdadeira sobre o MERGE.** Os dois lados passam separados e a
colisão nasce no merge — foi assim na #1854 e foi assim aqui. Verificar no seu checkout
responde a pergunta errada; a árvore do merge é a que o CI monta:

```bash
T=$(git merge-tree --write-tree HEAD origin/main | head -1)
git ls-tree --name-only "$T" supabase/migrations/ | sed 's|.*/||' \
  | grep -oE '^[0-9]{14}' | sort | uniq -d     # vazio = limpo
```

⚠️ **O guarda lê `HEAD`, não a working tree** (`scripts/check-migration-versions.sh:70-74`,
`git ls-tree`). Renomear e rodar o guarda **sem commitar** devolve o resultado antigo, com
cara de que o rename não funcionou. Commite primeiro, depois prove.

**Resto de dívida, não meu e não consertado:** o checkout local ainda reprova a metade (a)
por `20270901000010` (dois arquivos). É o #1854, que a main já resolveu renumerando
`produtos_do_negocio`; esta branch está 14 commits atrás e ainda carrega o par. **Some no
merge** — provado: lá só existe `20270901000010_erp_pedidos_itens.sql`. Resolver exigiria
trazer a main para dentro da branch, e rebase/merge num PR já revisado é decisão do CTO, não
minha.

**A lição que o §6 pagou:** ele dizia *"sem colisão"* e **era verdade quando foi escrito**.
Aqui, afirmação sobre estado do repositório tem prazo de validade curto — a main anda. Por
isso o item 2 do §6 foi reescrito dizendo que expirou e por quê, em vez de só trocar o
número em silêncio.
