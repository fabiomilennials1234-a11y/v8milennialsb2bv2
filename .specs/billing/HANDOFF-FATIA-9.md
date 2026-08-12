# HANDOFF — Fatia 9 (provisionamento pós-pagamento)

Estado em 2026-08-12, 15h. **Metade entregue, metade bloqueada por dado que não existe.**

- **`existing_org`: PRONTO** — PR **#1545**, aguardando merge (CI rodando).
- **`new_org`: NÃO COMEÇADO, de propósito.** Espera a persistência do comprador, que é a Fatia 8 do Fole.
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

**Não comece o `new_org` antes disso.** A metade difícil (idempotência, cota, renovação) já está provada; a fácil sem o dado é retrabalho.

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
