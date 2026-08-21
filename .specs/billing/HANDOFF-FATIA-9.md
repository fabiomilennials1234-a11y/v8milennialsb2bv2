# HANDOFF — Fatia 9 (provisionamento pós-pagamento)

Estado em 2026-08-12, 15h. **Metade entregue, metade bloqueada por dado que não existe.**

- **`existing_org`: MERGEADO** — PR #1545, 12/08 14:27.
- **`new_org`: EM CONSTRUÇÃO.** O bloqueio caiu com o merge do **#1553** (12/08 15:26), que trouxe `payment_link_buyers` e a porta `billing_resolve_charge_buyer` para a `main`.
- **Nada em produção.** A ponta de aplicação é a issue **#1548**.

---

## O que a fatia é

A Fatia 6 escreve o **fato** (assinatura corrente, paga). A 9 lê o fato e **abre a porta**. Sem ela: o dinheiro entra, a assinatura existe, e ninguém consegue usar o sistema.

## Entregue — `existing_org`

| peça | onde |
|---|---|
| Livro `subscription_provisionings`, `UNIQUE (provider_payment_id)` | migration `20270812100000` |
| RPC `billing_provision_existing_org(text)` — DEFINER, service_role, gate no corpo | mesma migration |
| Cron `billing-provision-worker` a cada 2 min, **agendado na migration** | mesma migration |
| Worker `supabase/functions/billing-provision-worker/` | edge function |
| 18 asserções pgTAP, **vermelhas antes** | `supabase/tests/provision_existing_org_test.sql` |

### As quatro decisões que sustentam isso

1. **Worker, não dentro do webhook.** O webhook responde 200 sempre (a fila do Asaas pausa em 15 falhas). Provisionar lá dentro faria a organização ficar **paga e inacessível em silêncio**. No worker, falha é vermelha e visível e a linha continua pendente.
2. **Ativar = escrever `subscription_status`, `subscription_plan`, `subscription_expires_at`.** Medido: é o que `org_get_subscription_status` lê.
3. **Nunca escrever `org_quotas`.** Grava-se o **nome** do plano e `trg_sync_org_plan_quotas` (SCRUM-338) sincroniza a cota sozinho. Há asserção que confere o **número do plano** — se alguém escrever cota direto, um teste ingênuo passaria; este só passa se o gatilho fez o trabalho.
4. **Idempotência é livro, não coluna de estado.** `CONFIRMED` + `RECEIVED` da mesma cobrança ativam **uma** vez, e quem recusa é o banco.

E **renovação SOMA**: renovar antes de vencer acrescenta o ciclo ao vencimento vigente. Sem isso, quem paga adiantado perde os dias que já tinha.

## Bloqueado — `new_org`

Precisa de **e-mail e documento do comprador**, que hoje **não são persistidos em lugar nenhum**. Medido: nem `payment_links` nem `payment_link_charges` os têm; `billing-payment-link` não cria cliente. O dado existe (a Asaas exige `cpfCnpj` para Pix e cartão no Brasil), mas passa pelo checkout e some.

**Contrato fechado com o Fole**, esperando a migration dele:

- **chave de entrada da 9:** `provider_charge_id` (venho de `org_subscriptions.provider_payment_id`);
- **pedido feito:** `UNIQUE (provider_charge_id)` em `payment_link_charges` — hoje **não existe índice nenhum** nessa coluna, e nada impede duas linhas com o mesmo valor. O handler da Fatia 6 usa `maybeSingle()` ali, então **uma duplicata quebraria em silêncio**;
- **PII em tabela IRMÃ**, não em colunas de `payment_link_charges`. O argumento decisivo é **alcance**, não retenção: aquela tabela é concedida a `anon` e `authenticated` *(medido em LOCAL — em prod ela ainda não existe)*, e a única defesa seria a policy. Em tabela irmã com `REVOKE`, a PII fica fora do PostgREST **por construção**.

~~**Não comece o `new_org` antes disso.**~~ **DESBLOQUEADO em 12/08 15:26, pelo merge do #1553.** A persistência do comprador está na `main`: `payment_link_buyers` (PK por link, `REVOKE` inclusive de `service_role`, RLS sem policy) e a porta `billing_resolve_charge_buyer(text)`, service_role-only.

A linha acima ficou tachada em vez de apagada de propósito: quem leu o handoff antes de hoje agiu segundo ela, e some-la esconderia que a ordem existiu e por quê.

### O que a porta devolve, e como ramificar

Por **`code`**, nunca por `ok` — `buyer_missing` volta com **`ok = true`**, porque cobrança nossa sem comprador não é falha de resolução:

| `code` | significa | o que a Fatia 9 faz |
|---|---|---|
| `ok` | comprador presente | provisiona (`buyer_email`, `buyer_legal_name`, `provider_customer_id`) |
| `buyer_missing` + `target_kind='existing_org'` | **normal** — não precisa de comprador | provisiona pelo caminho de `existing_org` |
| `buyer_missing` + `target_kind='new_org'` | **INCIDENTE** — pagamento confirmado sem como criar o admin | **não inventa e-mail, não cria organização pela metade**; registra estado visível e exige humano |
| `charge_not_found` | cobrança desconhecida | ordem de chegada, não incidente |

`tax_id` **não sai** por essa porta, e a Fatia 9 não precisa dele. É o que torna impossível vazar documento mesmo por acidente.

### E o `payment_history` do ramo `new_org`

`payment_history.organization_id` é `NOT NULL` e **não afrouxa** — é a chave de tenant e a RLS depende dela; anulável abriria linha órfã sem dono, que é pior que ausência.

Então a linha de `payment_history` do `new_org` é escrita **pela Fatia 9**, depois de criar a organização. Até lá a trilha vive em `payment_webhook_events`, que é gravado **antes** de resolver o dono e tem `organization_id` anulável de propósito.

**Consequência que evita diagnóstico errado:** no estado `buyer_missing`+`new_org`, o `payment_history` **ainda não existe — e isso é esperado, não sintoma**.

## Ordem de aplicação — e há um vão no ledger

Nenhuma migration do billing está em prod, e as duas do meio foram aplicadas fora de ordem. Detalhe completo em `HANDOFF-FATIA-6.md` e plano em **#1548**. Resumo:

```
20270811140000 (Fatia 5)  →  20270811220000 (Fatia 6)  →  20270812100000 (Fatia 9)
```

Cada uma lê o que a anterior cria. `db push` vai pedir `--include-all`, porque a `150000` e a `160000` já subiram na frente da `140000`.

## Armadilhas que valem para quem continuar

- **Diga em qual banco mediu.** "Medido em local" ≠ "medido em prod" — a diferença já custou um teste que passava no CI e quebraria contra produção.
- **`run.sh` conflita em toda fatia.** Manter todas as linhas, nas duas listas e no cabeçalho (issue #1524 propõe o manifesto que mata isso).
- **CI vermelho não é sinal** neste repositório: compare o conjunto de falhas do PR contra o da main nas **duas** dimensões (`not ok` e `Bad plan`) e prove que a coleta tem substância — coleta vazia é "não procurei", não "não achei".
- **PII nunca em mensagem de erro.** A redação do logger é por **nome de chave**, e uma frase não tem chave (PR #1547 documenta o limite com um teste que afirma o vazamento de propósito).
