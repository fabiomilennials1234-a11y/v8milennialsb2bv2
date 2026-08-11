# Runbook — backfill das mensagens órfãs de WhatsApp

Companheiro de `scripts/backfill-orphan-whatsapp-messages.sql`.
Tudo aqui foi medido em prod (`jsjsmuncfkbsbzqzqhfq`) em **2026-08-11**.

> ⚠️ **NÃO AGENDADO.** Decisão do CTO em 2026-08-11: o backfill **não** vai
> rodar. O objetivo é estancar a perda, e para isso bastam a migration e o
> deploy das edge functions — nenhum dos dois depende deste script.
>
> O que fica em aberto ao não rodar, com número: **385.828** linhas seguem sem
> `instance_id` (invisíveis na thread) e **10.641** conversas em 24 orgs seguem
> apontando para instância morta (fora da lista do inbox). Nada disso piora com
> o tempo depois do deploy — o estoque para de crescer.
>
> Este runbook fica versionado como receita pronta, medida, para o dia em que a
> decisão mudar.

---

## 1. O que é isto

A FK `whatsapp_messages_instance_id_fkey` era `ON DELETE SET NULL`. Excluir uma
instância desligava o `instance_id` de **todo** o histórico dela. Como o chat
filtra por `instance_id`, a conversa inteira sumia da tela — continuando viva no
banco e no WhatsApp.

Este script reata o vínculo do passivo. **Ele não conserta a causa.**

---

## 2. Ordem obrigatória — inegociável

> **1. migration em prod (MANUAL) → 2. deploy das edge functions (MANUAL) → 3. backfill**

Nesta ordem. Não é "1 e 2 juntos"; não é "deploy depois". O passo 2 é um passo
próprio porque **dropar a FK sozinho NÃO estanca a hemorragia**.

### Por que a FK não basta

A FK era `ON DELETE SET NULL`, mas quem apaga uma Instance hoje é o
`whatsapp-api-proxy`, e ele anula `whatsapp_messages.instance_id` **em código** —
`nullifyInBatches` → `nullifyByIds` → `.update({ instance_id: null })` — *antes*
do DELETE, justamente para o cascade não estourar o statement timeout.

Esse é o caminho **dominante**, não um detalhe: das **2.994** órfãs nascidas nos
últimos 7 dias, **2.979 (99,5%)** têm prefixo Uazapi — linha recente anulada em
código, não linha antiga tocada pela FK.

| janela | órfãs novas |
|---|---:|
| últimas 24 h | 14 |
| últimos 7 d | 2.994 |
| últimos 30 d | 46.780 |

Com a migration aplicada e o proxy **ainda não** deployado, a guarda de FK passa,
o backfill recupera ~163k linhas e a próxima exclusão pela UI zera tudo de novo.
A hemorragia medida foi exatamente essa: excluir + recriar pela UI, **111 s**.

A versão deployada do proxy decide sozinha (`whatsappMessagesFkState` sonda o
catálogo e só tira `whatsapp_messages` da lista quando prova que a FK sumiu). A
versão **antiga não sonda nada** — anula sempre.

### Segundo escritor, independente da FK

`process-scheduled-user-messages` inseria a linha **já com `instance_id` NULL**
(`message_id` = `sched_…`), porque lia `scheduled_user_messages.whatsapp_instance_id`,
que é `ON DELETE SET NULL`. Corrigido na mesma leva (passa a gravar a instância
resolvida). **Deploye-o junto com o proxy.**

### A guarda tem duas checagens

| | prova | como |
|---|---|---|
| **1a** | schema | a FK sumiu de `pg_constraint` |
| **1b** | código | nenhuma órfã nasceu depois de `:proxy_deployed_at` |

1b é um invariante observável, não uma lista de funções: depois do deploy correto
nenhuma linha nova pode nascer órfã, então **qualquer** escritor que ainda zere
`instance_id` derruba a guarda — inclusive um que ninguém previu.

Testada em prod em 2026-08-11 com `proxy_deployed_at = 2026-08-08`:

```
ERROR:  ABORTADO (1b): 363 orfa(s) nasceram DEPOIS do deploy informado
        (2026-08-08 00:00:00+00) — a mais recente em 2026-08-11 14:00:06.
```

Hoje ela aborta — **como deve**. Se abortar no dia, o deploy não está de pé:
não adiante a data para contornar.

A hemorragia é ativa e mensurável: as órfãs saíram de **385.828** (medição do
diagnóstico) para **385.829** durante a redação deste runbook.

---

## 3. Teto: 42,1%. Mais que isso não existe.

| | linhas | % |
|---|---:|---:|
| Órfãs totais | 385.829 | 100% |
| **Recuperável** | **~162.600** | **42,1%** |
| Irrecuperável | ~223.200 | 57,9% |

> Era 167.300 / 43,4% antes de o P0 ganhar a trava de prefixo (§4.1). As **4.244**
> linhas de diferença não eram recuperação: eram atribuição ao chip errado.

O irrecuperável:

- **203.410** sem prefixo no `message_id` e sem `raw_payload` — era
  Evolution/history-sync, que nunca carimbou a origem.
- **11.321** em orgs com zero instâncias hoje: Castropil 10.093, NatuPlast 1.158,
  testevideo 69, Plinio 1. Não há destino para onde apontar.

Não prometa mais que isso a ninguém. Os 56,6% exigem outra fonte (export do
provider), não SQL.

---

## 4. Alvos por passe

| Passe | Linhas | Critério | Natureza |
|---|---:|---|---|
| **P0** | 32.330 | org de 1 instância **+ prefixo que casa** | evidência direta |
| **P1** | 87.751 | prefixo `numero:` casando chip único da org | evidência direta |
| **P1b** | 26.491 | desempate do único (org, chip) duplicado | evidência + regra |
| | **146.572** | *subtotal — caminho padrão* | |
| **P2** | ~16.000 | consenso de thread, trava dupla | **inferência — opcional, §13** |
| | **162.572** | *total em `whatsapp_messages`* | |
| **P3** | 3.363+ | `whatsapp_conversation_summary` | linhas de **lista**, não somar |

Divergência pequena contra o desenho original é a hemorragia rodando entre as
medições. Divergência grande = premissa mudou: pare e remeça.

### 4.1 O P0 tinha um buraco — e ele mandava 4.244 linhas para o chip errado

O P0 dizia "org com exatamente 1 instância → determinístico: não existe outro
destino possível". **Isso é falso.** Não existe outro destino **vivo** — mas
existe outro chip de **origem**: a mensagem pode ter saído de um chip anterior,
já excluído, e o provider carimbou qual no prefixo do `message_id`.

Atribuir essas linhas à instância atual funde histórico de dois chips diferentes
numa thread só — exatamente o dano que o desenho proíbe, em UPDATE de dado de
cliente que **não tem undo**.

Medido em prod (2026-08-11), sem a trava:

| org | chip atual | prefixo da órfã | linhas |
|---|---|---|---:|
| Bennedita Pan | 5511948583181 | 5513996351231 | 1.314 |
| Motor 100 | 554788879460 | 554891005289 (+2) | 1.072 |
| Improving | 554891199347 | 554888794649 | 690 |
| All Mix | 5522992290731 | 553284676832 | 534 |
| Teste a1 | 555185960716 | 554891005289 | 317 |
| Elvéra | 5511973435775 | 5511968985550 | 46 |
| Chique Distribuidora | 555597350981 | 555525100747 | 7 |
| | | | **3.980** |

Mais **264** linhas em 2 orgs (Café Jurerê 168, Brasil Engrenagens 96) cuja
instância única tem `phone_number` **NULL** — sem número não há como *provar*
que o prefixo é dela, e sem prova não se atribui. Total barrado: **4.244**.

A correção dá ao P0 **a mesma trava que o P1 já tinha**: aceita linha sem
prefixo, ou com prefixo que casa o número da instância única. Linha com prefixo
de outro número fica NULL **de propósito**.

> **Inverter a ordem P1 → P0 não resolveria.** As órfãs de chip antigo não casam
> instância viva nenhuma, escapam do P1 e cairiam no P0 do mesmo jeito. A trava
> tem de estar **no P0**.

### Sobre o P2 e o número 16.481

O alvo do P2 é **medido depois** de P0/P1/P1b rodarem, porque cada linha que eles
preenchem vira âncora nova para o consenso. Antes dos passes o P2 vale **16.000**;
simulando a Basic4u já com o P1b aplicado, ela sozinha sobe de 11.524 para
**13.198** (+1.674). O 16.481 do desenho está dentro dessa banda. Use a consulta
de conferência na hora de rodar o P2 — ela lê o estado corrente, não o de ontem.

---

## 5. Os dois guardas (o segundo não estava no desenho)

Existe `UNIQUE (message_id, instance_id)`. Hoje as órfãs convivem porque NULL não
colide com NULL no índice. Preencher `instance_id` **acorda** a UNIQUE, e são
dois riscos distintos:

**(a) Colisão com linha já atribuída** — o eco do webhook já gravou o mesmo
`message_id` com a instância nova. Coberto por `NOT EXISTS`. Medido: **853**
linhas só no alvo do P0. A órfã é descartada (a nova já é a boa) e fica NULL.

**(b) Colisão entre duas órfãs do mesmo lote** — duas órfãs com o mesmo
`message_id` indo para a **mesma** instância. O `NOT EXISTS` **não vê isto**,
porque nenhuma das duas está atribuída ainda: o UPDATE **aborta inteiro com
23505**. Coberto por `row_number()`.

> O guarda (b) não constava do desenho aprovado. Sem ele, P0 e P2 **não rodam** —
> abortam no primeiro lote grande. Medido: **3.385** linhas excedentes no alvo do
> P0 (4 orgs: SORVFOODS 2.678, Bennedita Pan 544, Promove 137, Barulinho 26) e
> **827** no alvo do P2 da Basic4u.

Verificação end-to-end do guarda (b), rodada como SELECT em SORVFOODS 2026-07:

```
cand_pos_guarda_a   11.963
seria_atualizado     9.285
descartado_guarda_b  2.678   ← sem o row_number(), 23505 e lote perdido
```

**Nota sobre a Alamaster:** ela tem 9.175 pares de órfãs com `message_id` igual,
mas são mensagem interna entre dois chips da própria org — mesmo timestamp e
conteúdo, `direction` e `normalized_phone` **diferentes**. São duas linhas
legítimas de duas instâncias diferentes. O `row_number()` particiona por
`(message_id, instância)`, então as duas sobrevivem. Elas não caem no P1 (sem
prefixo) nem no P2 (56 chips reprovam na trava).

---

## 6. Por que dá para rodar com o sistema de pé

Verificado em `pg_trigger`: os seis gatilhos de efeito colateral de
`whatsapp_messages` são **AFTER INSERT** (webhooks, pausa de copiloto, resumo de
conversa, histórico, detecção de resposta), e o normalizador de telefone é
`BEFORE INSERT OR UPDATE **OF phone_number**`.

Este script só escreve `instance_id`. Portanto:

- nenhum copiloto é pausado (`trg_human_pause_on_manual_send` é INSERT);
- nenhum webhook é enfileirado;
- o `search_tsv` e o `normalized_phone` não são recalculados.

O **P3** escreve numa segunda tabela, `whatsapp_conversation_summary`. Ela **não
tem gatilho nenhum** (verificado em `pg_trigger`: zero linhas não-internas) e não
tem FK — só a PK. O UPDATE dela também não dispara nada.

### O que não é inerte: Realtime

`whatsapp_messages` **está** na publicação `supabase_realtime` (verificado em
`pg_publication_tables`). Cada linha que P0/P1/P1b/P2 escrevem vira **evento de
replicação** — ~146k eventos no caminho padrão. Não é gatilho e não muda dado,
mas passa por WAL e chega aos clientes conectados.

É a razão de verdade para a janela de baixa carga e para o `LIMIT :lote`, e o
motivo de **não** colar os passes num loop sem respiro.

`whatsapp_conversation_summary` **não** está na publicação — o P3 é silencioso
nesse aspecto.

---

## 7. P3 — a segunda superfície: a LISTA do inbox

Os passes P0–P2 consertam a **thread**. Não fazem a conversa voltar para a
**lista** — são tabelas diferentes.

A lista não lê `whatsapp_messages`: lê a tabela-resumo
`whatsapp_conversation_summary`, via `get_whatsapp_conversation_list`. Aquela
tabela **não tem FK**, então ninguém a nulificou — ela ficou apontando para id de
instância que não existe mais. Medido: **10.641** linhas → **62** instâncias
mortas, **24** orgs. E o gatilho que a mantém
(`trg_whatsapp_conversation_summary`) é **AFTER INSERT**: o UPDATE dos passes
anteriores não o dispara, então ela não se conserta sozinha.

Por isso o P3 existe (seção 8 do `.sql`).

### O resolvedor de chip não salva o passado

Tentador achar que `whatsapp_chip_instance_ids` (da migration) resolve isso — ele
acha os ids históricos do chip lendo a lápide `whatsapp_instance_reap_queue`.
**Não resolve.** Das 62 instâncias mortas que a tabela-resumo referencia, apenas
**4** estão na lápide (que tem 7 linhas no total, e só ganha `phone_number` a
partir da migration). As outras **58** morreram antes de existir lápide.

> A lápide resolve o **futuro**. O P3 resolve o **passado**.

### Chave e evidência

A PK é `(organization_id, instance_id, normalized_phone)` — lida de
`pg_constraint`, e é a mesma do `ON CONFLICT` do gatilho. O telefone é a chave da
thread; o `instance_id` é o que o P3 reescreve.

Para cada linha órfã, o P3 olha as mensagens da **mesma org e mesmo telefone**
que já têm instância viva. Só re-aponta quando o destino é **único**; thread
tocada por 2+ instâncias fica como está e é **contada, não chutada**.

### Rode por último — é dependência, não preferência

A evidência do P3 são as mensagens **já reparadas** pelos passes anteriores.
Medido na Basic4u: as threads resolvíveis saltam de **412** (estado de hoje) para
**811** depois de P0/P1/P1b.

Medido em 23 das 24 orgs (9.878 das 10.641 linhas — a Alamaster, 763 linhas,
estourou o timeout da sonda; meça-a na hora), **simulando P0/P1/P1b aplicados**:

| classe | linhas | tratamento |
|---|---:|---|
| resolvível (evidência única, sem colisão) | 3.363 | re-aponta |
| colisão de PK (já existe linha viva) | 1.097 | não toca — já está na lista |
| ambígua (2+ instâncias candidatas) | 787 | não toca — reporta |
| sem evidência nenhuma | 4.631 | não toca |

> ⚠️ **Não se assuste com zero.** Rodada **hoje**, antes dos passes de mensagem, a
> conferência devolve `resolvivel = 0` em praticamente toda org (verificado em
> Milennials, SORVFOODS e Goletric Perdizes). Não é bug: hoje, thread que tem
> mensagem com instância viva também já tem linha-resumo viva, e cai em
> `colisao_com_viva` (Milennials: 173). O alvo do P3 só **materializa** depois que
> P0/P1/P1b criam instância viva em thread que não tinha nenhuma.

### Os dois guardas do P3

A PK acorda quando o `instance_id` muda — mesmo problema dos passes de mensagem.

**(a) Colisão com linha viva** — já existe `(org, alvo, telefone)`. **1.097**
linhas. Não re-aponta e **não apaga nada**: a linha viva já põe a conversa na
lista, o objetivo já está cumprido. O RPC faz
`DISTINCT ON (normalized_phone) ORDER BY last_message_time DESC` sobre todos os
ids do chip, então duas linhas do mesmo telefone já colapsam em uma na leitura.

**(b) Colisão entre duas órfãs** — a mesma thread tem linha-resumo sob **duas
instâncias mortas diferentes**, e ambas resolvem para o mesmo alvo. Medido:
**1.081 threads**, **2.263 linhas**, pior caso **7** linhas numa thread. Sem o
`row_number()` o UPDATE aborta inteiro com **23505**. Vence a de
`last_message_time` mais recente — a mesma que o `DISTINCT ON` do RPC escolheria.

---

## 8. Execução

Janela de baixa carga. Uma org por vez, mês a mês. A janela de órfãs vive inteira
entre **2026-02 e 2026-08** — sete fatias cobrem tudo.

```bash
psql "$PROD_URL" -f scripts/backfill-orphan-whatsapp-messages.sql
```

O script começa com `\set ON_ERROR_STOP on`, e isso **não é formalidade**: sem
essa linha o `psql` apenas *imprime* o erro e segue para o comando seguinte — a
guarda da FK abortaria a si mesma e os `UPDATE`s rodariam assim mesmo, com a FK
ainda de pé. Se for rodar os passes colados à mão numa sessão interativa, ligue
`ON_ERROR_STOP` antes.

Editando no topo do `.sql`:

```sql
\set org '17c46b69-e9fa-4ce0-9732-dc416d847dc8'    -- comece PEQUENO; Basic4u é a última
\set ini '2026-03-01'
\set fim '2026-04-01'
\set lote 20000
\set proxy_deployed_at '2026-08-12 14:30:00+00'   -- ver §2
\set run_p2 false                                  -- opt-in do P2; ver §13
```

`org` nasce como `PREENCHER` no arquivo e a guarda **1c** aborta se você não
escolher. É de propósito: o default anterior era a Basic4u — justamente a org que
a §13 manda deixar por último —, e default perigoso em arquivo que se roda com
`-f` acerta quem não leu.

`proxy_deployed_at` é o horário UTC do deploy **mais tardio** entre
`whatsapp-api-proxy` e `process-scheduled-user-messages`. Deixe o placeholder
`PREENCHER` e a guarda 1b aborta de propósito.

`run_p2` é a trava **mecânica** do P2: com `false` (o default), o `\if` da seção 7
do `.sql` pula o passe inteiro. Aviso em comentário não impedia nada — `psql -f`
roda o arquivo de cima a baixo.

> Nota de implementação: o valor entra por
> `SELECT set_config('backfill.proxy_deployed_at', :'proxy_deployed_at', false)`
> **antes** do bloco `DO`. O psql **não** interpola `:variavel` dentro de string
> dollar-quoted (`$$…$$`) — ler `:'…'` lá dentro deixaria a guarda inerte, que é
> justamente a falha silenciosa que ela existe para impedir.

**Rode cada passe até ele reportar `UPDATE 0`.** O `LIMIT :lote` existe para não
fazer transação gigante: cada `UPDATE` de `instance_id` reescreve **7 índices**
(`idx_whatsapp_messages_instance`, `…_instance_jid_ts`, `…_org_inst_dir_ts`,
`…_org_instance_phone`, `…_org_instance_ts`, `…_unread_cover` e a UNIQUE).

`UPDATE 0` é resultado normal, não script quebrado — ver §10.

### Por que fatiar por (org, mês)

Com `organization_id` + `instance_id IS NULL` + intervalo de `timestamp`, o plano
usa `idx_whatsapp_msgs_org_instance_ts` com Index Cond completo:

```
Update on whatsapp_messages m  (cost=0.56..5708.65 rows=0 width=0)
  ->  Index Scan using idx_whatsapp_msgs_org_instance_ts
        Index Cond: ((organization_id = …) AND (instance_id IS NULL)
                     AND (timestamp >= …) AND (timestamp < …))
```

**Sem o intervalo**, o planner cai em `idx_whatsapp_messages_timestamp` e varre a
tabela inteira — foi assim que as sondas de medição estouraram o timeout. Nunca
rode um passe sem `:ini`/`:fim`.

Efeito colateral bom: conforme as linhas ganham `instance_id`, elas **saem** da
faixa `instance_id IS NULL` do índice, então cada reexecução é mais barata que a
anterior.

**Nunca faça loop por thread.** Um único lookup de thread mediu 3.281 ms com
3.728 buffers de disco; por thread, isto levaria horas.

---

## 9. Ordem e idempotência

A ordem P0 → P1 → P1b se auto-aplica: todo passe filtra `instance_id IS NULL`,
então cada um só vê o que o anterior deixou. Reexecutar é seguro e é o modo de
operação previsto.

O **P2 é opcional** e fica fora do caminho padrão (§13). O **P3 roda por último**,
depois de todas as orgs e todos os meses — ele depende das mensagens já
reparadas (§7). O P3 também é idempotente: só toca linha cujo `instance_id` não
existe mais, e não é fatiado por mês (a chave da tabela-resumo não tem data).

Uma órfã descartada pelo guarda (b) fica NULL. Na reexecução, o irmão vencedor já
está atribuído, então o `NOT EXISTS` a descarta de novo — de forma estável, sem
oscilar.

---

## 10. Leitura dos resultados

`UPDATE 0` num passe é normal: cada passe só pega o que o predicado dele alcança
naquele mês. Exemplo medido — a **Alamaster** tem 46.314 linhas de P1, mas todas
entre **2026-05 e 2026-08**; em 2026-03/04 ela tem 68.212 órfãs e o P1 devolve
**0**, porque aquele período é da era Evolution e não carimbou prefixo nenhum.

Distribuição das órfãs por mês (duas maiores orgs):

| mês | Basic4u | Alamaster |
|---|---:|---:|
| 2026-02 | 0 | 4 |
| 2026-03 | 14.410 | 11.201 |
| 2026-04 | 20.942 | 57.011 |
| 2026-05 | 23.802 | 49.889 |
| 2026-06 | 22.309 | 19.588 |
| 2026-07 | 5.796 | 13.858 |
| 2026-08 | 0 | 4.123 |

Os 4.123 da Alamaster em 2026-08 são a hemorragia corrente.

---

## 11. Ao final

1. `orfas_restantes` deve cair de **385.829** para **~223.200** se o P2 **não**
   rodar (caminho padrão), ou **~207.200** se ele rodar.
   Bem acima disso = sobrou org ou mês; a consulta por org mostra onde.
   Bem abaixo = algum passe pegou mais do que devia — **investigue antes de
   comemorar**.
2. Rode o SELECT de `cross_tenant` **por org**. Tem que voltar `0`.
   A versão global faz join de 2,3M linhas e estoura o timeout — por isso ele é
   escopado em `:org`.
3. `resumo_orfao_restante` deve cair de **10.641** para ~**7.278** (mais o que a
   Alamaster render, não medida). O resto **não é falha**: 1.097 são colisão com
   linha viva, 787 ambíguas e 4.631 sem evidência — as três classes ficam como
   estão, de propósito (§7).
4. `resumo_cross_tenant` tem que voltar `0`. Essa roda global — a tabela-resumo é
   pequena. Baseline medido hoje: `0`.

---

## 12. Detalhe do P1b

Hoje o prod tem exatamente **um** `(org, phone_number)` com duas instâncias:

| org | número | instância | status | criada |
|---|---|---|---|---|
| Basic4u | 554797890485 | `ab9c373a…` "bruna 2" | disconnected | 2026-07-16 |
| Basic4u | 554797890485 | `899c0f2f…` "Bruna Basic4u" | **connected** | 2026-07-22 |

Vai para a `connected`, com a mais recente como desempate. O passe está escrito
de forma **genérica** — se surgir outro chip duplicado, ele cobre sem UUID novo.

Existe um segundo número repetido no prod, **554891199347**, mas em **duas orgs
diferentes** ("Marcos SDR"/Improving e "torque marcos"/Milennials). Como todo
casamento é escopado por org, ele não é ambíguo e cai no P1 normal. Vale saber
que ele existe antes de alguém "corrigir" o `HAVING count(*) > 1`.

---

## 13. P2 — ⚠️ OPCIONAL, exige OK do CTO

> **P0, P1 e P1b CASAM evidência. O P2 ADIVINHA.**

O P2 é o **único** passe que atribui sem prova, e por isso está **fora do caminho
padrão**. O backfill é considerado completo com **P0 + P1 + P1b + P3**. Rodar o
P2 é uma decisão separada, com dono.

**Como ligar:** trocar `\set run_p2 false` por `\set run_p2 true` no topo do `.sql`.
Enquanto estiver `false`, o `\if` da seção 7 pula o passe — o P2 não roda nem por
engano, nem por pressa. Editar essa linha é o ato deliberado que o passe exige.

**Pré-condições — todas as três:**

1. **OK explícito do CTO** nesta sessão.
2. **Amostragem manual numa org pequena primeiro** — Vanilla (20 linhas) ou
   REALSC (6). Rode o passe lá, abra as threads no chat e confirme que as
   mensagens caíram no chip certo.
3. **Só depois**, e só se a amostra estiver limpa, a **Basic4u**.

A Basic4u é **11.524** das ~16.000 linhas e tem **4 chips**. A concordância
medida com 4 chips é **92%** — ou seja, **~8% (≈900 linhas)** vão para o vendedor
**errado** dentro da mesma org. É erro menos grave que o do P0 destravado (não
vaza entre orgs, não funde chips de números diferentes), mas é erro, e **não tem
undo**.

> Pular o P2 custa ~16.000 linhas que ficam NULL — recuperáveis a qualquer
> momento. Rodar errado **não** é recuperável.

### Por que o P2 tem trava dupla

A concordância do consenso contra o P1 (que sabe a resposta) **cai com o número
de chips**: 99,2% com 2 chips, 92,0% com 4, **9,6%** com os ~56 da Alamaster.

Sem a trava, o passe envenenaria justamente a maior org. Com ela, Alamaster (56)
e HGE (5) ficam de fora — e ambas contribuiriam **0** de qualquer forma.

A trava está **dentro do SQL**, como subconsulta que lê o número de chips na
hora: se a org estiver fora de 2..4, a temp table nasce vazia e o passe vira
no-op. Não depende de o operador escolher a org certa.

Descartadas por ambiguidade (thread tocada por 2+ chips), que ficam NULL **de
propósito**: Basic4u 17.759, Milennials 2.889, Mapila 1.404.
