# HANDOFF — Fatia 6 (SCRUM-287, webhook do Asaas) — PR #1535

Estado em 2026-08-12. Escrito porque o contexto de quem construiu está no limite: se ele acabar, este arquivo é a diferença entre continuar e recomeçar.

Branch: `feat/scrum-287-webhook-asaas`. **Nada aplicado em produção.**

---

## O DEFEITO — CORRIGIDO em 2026-08-12 (era o que faria a fatia nascer morta)

`supabase/functions/asaas-webhook/index.ts`, na escrita da assinatura:

```ts
.upsert({...}, { onConflict: "organization_id", ignoreDuplicates: false })
```

O índice único de `org_subscriptions` é **PARCIAL**:

```sql
org_subscriptions_one_current_per_org  UNIQUE (organization_id) WHERE cancelled_at IS NULL
```

Postgres **só infere índice parcial** no `ON CONFLICT` se o comando **repetir o predicado**. Provado em prod, em transação revertida:

| comando | resultado |
|---|---|
| `ON CONFLICT (organization_id)` | **42P10** — no unique or exclusion constraint matching |
| `ON CONFLICT (organization_id) WHERE cancelled_at IS NULL` | passa da inferência (falhou só em 23503, FK, com UUID falso de propósito) |

**Por que é pior que um bug comum:** o handler engole erro e responde 200 (a fila do Asaas pausa em 15 falhas). Então o INSERT falharia, o log registraria, o Asaas receberia 200 — e **a organização nunca seria ativada, em silêncio, para sempre**. É exatamente o modo de falha contra o qual a fatia inteira foi desenhada, entrando pelo argumento de uma chamada.

### O conserto — FEITO: `billing_apply_paid_subscription`, RPC service_role-only

O handler chama a RPC; o `ON CONFLICT ... WHERE cancelled_at IS NULL` mora dentro dela. Grants medidos com `has_function_privilege` no pgTAP (anon não, authenticated não, service_role sim), e gate no corpo além do GRANT — para o dia em que um `DROP + CREATE` devolver EXECUTE a PUBLIC.

### Por que não dava para trocar só a string

O PostgREST **não expressa predicado**: `on_conflict` aceita nome de coluna, não cláusula `WHERE`. Não há como escrever isso pelo cliente.

A escrita da assinatura tem que ir por **RPC**, na migration desta fatia:

- `SECURITY DEFINER`, `search_path` fixo;
- `EXECUTE` **só** para `service_role` — nem `anon` nem `authenticated`, e **medir com `has_function_privilege` DEPOIS** (hoje já fechamos 24 RPCs por isso);
- o `INSERT ... ON CONFLICT (organization_id) WHERE cancelled_at IS NULL DO UPDATE` **dentro** dela.

A garantia continua no BANCO, não num `IF` — só muda de onde é chamada.

### O teste que faltava — FEITO (37/37, era 27)

Nenhuma das 27 asserções exercitava a criação **real** da assinatura contra o schema real — se exercitasse, teria estourado 42P10. Falta:

1. ✅ insere **de verdade** pela RPC e afirma plano, ciclo, cobrança e assentos;
2. ✅ segundo evento da mesma cobrança mantém **uma** linha viva; renovação com cobrança nova move a proveniência;
3. ✅ grants nome por nome;
4. ✅ **e uma asserção que trava o 42P10**: `ON CONFLICT (organization_id)` sem o predicado é recusado pelo Postgres. É a regressão que reabriria o silêncio.

**Verificado ainda:** o outro `upsert` que sobrou no handler (`payment_history`) aponta para `payment_history_asaas_payment_id_key`, que é índice **total** — inferência funciona. Medido, não presumido.

> Mesma lição do dublê mais frouxo que o real, que já custou um bug de produção com 70 pessoas: **teste que não toca o schema real não prova nada sobre o schema real.**

---

## O que está FEITO e correto

| peça | onde | estado |
|---|---|---|
| Livro de eventos, `UNIQUE (provider, provider_event_id)` | migration `20270811220000` | ok, 27/27 pgTAP |
| Livro de cupom, `UNIQUE (coupon_id, payment_id)` | mesma migration | ok |
| `increment_coupon_uses` sai de `authenticated` | mesma migration | ok |
| `org_subscriptions.provider_payment_id` (proveniência) | mesma migration | ok |
| Decisão pura (`decide.ts`) | 19/19 vitest | ok |
| Cadeia `payment.id → payment_link_charges → payment_links.quote` | `index.ts` | ok — a fonte é o **link**, não `payment_history` |
| `payment_history` **criado**, não só atualizado | `index.ts`, upsert por `asaas_payment_id` | ok (esse índice **não** é parcial) |
| Runbook do cadastro | `docs/runbooks/asaas-webhook-cadastro.md` | ok |
| Registro no `run.sh` (duas listas) + `config.toml` | — | ok |

## Decisões já tomadas — não reabrir sem motivo novo

1. **Cupom é LIVRO, não contador.** Consumir é inserir; a segunda vez é recusada pelo banco. `current_uses` vira projeção.
2. **UPSERT, não append-only por ciclo.** O índice parcial proíbe duas assinaturas vivas por org. Append-only exigiria derrubá-lo, e aí "quem é a corrente?" perde a resposta que vários leitores usam. Custo aceito: na **troca de plano** o snapshot antigo é sobrescrito — recuperável pela cadeia do link.
3. **`ASAAS_ENV` falha FECHADO.** Só o valor exato `sandbox` dispensa a allowlist de IP.
4. **200 SEMPRE.** Corpo ilegível, evento sem id, tipo desconhecido, falha de banco: todos 200 e registrados. 15 falhas consecutivas pausam a fila; em `SEQUENTIALLY` um evento envenenado bloqueia todos os seguintes.
5. **404, não 401**, para não-autorizado.
6. **Pago = `CONFIRMED` OU `RECEIVED`**, o que chegar primeiro, uma vez só. Cartão: `RECEIVED` 32 dias depois. Pix: **pula** o `CONFIRMED`.
7. **Escada monotônica** — `CONFIRMED` atrasado não rebaixa `RECEIVED`.

## Números medidos

- `payment_history` e `org_subscriptions`: **zero linhas** em produção. A fatia existe para mudar isso.
- pgTAP da fatia: **27/27** (vermelho antes da migration).
- vitest: **19/19**.
- Dependência de ordem: `invoice_url`/`receipt_url`/`billing_type` vêm do #1523 — **mergeado às 20:17 de 11/08**, então já está satisfeita.

## Pendências fora do código

- `supabase functions deploy asaas-webhook` (merge não sobe edge function).
- `supabase secrets set ASAAS_WEBHOOK_PATH_SECRET ASAAS_WEBHOOK_TOKEN ASAAS_ENV` — os dois primeiros **não existem ainda** e são escolha nossa; o token tem que bater com o do painel do Asaas.
- Cadastrar o webhook no painel — ver o runbook.

## Armadilhas do dia que valem para quem continuar

- **`run.sh` conflita em toda fatia** (sete vezes em 11/08). Manter **todas** as linhas, nas duas listas e no cabeçalho. Issue #1524 propõe o manifesto.
- **CI vermelho não é sinal** neste repo: compare o conjunto de falhas do PR contra o da main, nas **duas** dimensões (`not ok` **e** `Bad plan`), e prove que a coleta tem substância — coleta vazia é "não procurei".
- **Salve o log antes de re-rodar**: o rerun substitui o log do job.
- **Endereço da falha não é autoria da falha** (um 522 do esm.sh apontou para `logger.ts:12`, arquivo tocado pelo PR).
