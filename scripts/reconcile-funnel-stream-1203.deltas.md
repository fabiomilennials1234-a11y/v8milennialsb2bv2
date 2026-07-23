# Produtor de funil etiqueta pelo momento do cliente (#1203) — provas locais

**NÃO EXECUTADO EM PROD. FLAG NÃO LIGADA.** Esta é a única fatia que muda
etiqueta de receita viva; tratada com o cuidado de dinheiro.

Gerado em 2026-07-22.

---

## O que muda

O gatilho vivo de funil (`fn_capture_sale_event`) passa a decidir
`revenue_stream` pela **mesma** `metric_revenue_stream` (#1198) que o produtor
de Carteira — quando a flag da org está ligada. Uma regra, dois produtores.

Antes: `EXISTS (upsell_clients ativo)` → "é cliente de Carteira", que etiqueta
até a **primeira** compra como `carteira`. Depois: "existe venda anterior?" →
recompra é `carteira`, primeira é `novo_negocio`.

## Flag — a MESMA da #1201

Reusa `organizations.carteira_emits_revenue_enabled`. O Crivo travou que #1201 e
#1203 ligam juntas, por org. Uma flag, uma decisão operacional — duas flags que
têm de ligar juntas são convite para ligar só uma e deixar o livro meio-certo.

## Flag desligada = idêntico byte a byte

Método das fatias anteriores: impressão digital `md5` por linha, rollback como
passo 1.

1. Reverti a #1203 (rollback → definição antiga).
2. Gravei 5 vendas de funil, todas com cliente de Carteira ativo, **flag off**.
3. Impressão digital.
4. Apliquei a #1203, flag ainda off.
5. Regravei as mesmas 5.

| | Vendas | Impressão digital |
|---|---:|---|
| Definição **antiga** | 5 | `699c9d64fdeb4a95e5b2f4814b521d08` |
| Definição **#1203, flag off** | 5 | `699c9d64fdeb4a95e5b2f4814b521d08` |

Hash idêntico. Com a flag desligada, o funil grava exatamente o que gravava —
inclusive nos leads com cliente de Carteira ativo, que é onde as duas expressões
poderiam divergir.

## pgTAP — 9 asserções

| Bloco | Prova |
|---|---|
| (a) | **flag off**: primeira venda com cliente de Carteira ativo → `carteira` (comportamento antigo preservado) |
| (b) | **flag on**: primeira venda apesar do cliente ativo → `novo_negocio` (a correção) |
| (c) | **flag on**: venda com compra anterior no livro → `carteira` (recompra real) |
| (d) | o rótulo do funil == `metric_revenue_stream`: uma regra, dois produtores |
| (e) | filtros Funil/Carteira/Total: novo + carteira == total, soma sem inflar |
| (f) | **planted**: sob a definição antiga o caso (b) sairia `carteira` — a mudança é load-bearing |

### Duas notas de método no teste

- **`now()` é constante dentro de uma transação.** O gatilho grava
  `sold_at = now()`, então duas vendas de funil na mesma transação de teste têm
  `sold_at` idêntico e a regra de empate (#1198) as trata como primeira compra.
  Em produção cada venda é uma transação separada, `now()` distinto, e a cascata
  funciona. O teste contorna semeando a compra anterior no passado (bypass) — é
  a única forma de ter uma anterior *estrita* numa única transação.
- **`pipeline_entries` tem um gatilho que auto-cria `pipeline_stage_events`.**
  Ele dispararia o produtor uma vez a mais e duplicaria a venda no teste.
  Desligado na fixture para que só a emissão explícita conte.

## As 51 linhas já gravadas erradas — MEDIÇÃO das duas opções (decisão do CTO)

Esta fatia conserta o **fluxo**: novas vendas de funil saem certas. As linhas já
gravadas são histórico no livro imutável. Reetiquetá-las é operação à parte.

Medido em prod, read-only:

| | |
|---|---:|
| Linhas vivas etiquetadas errado | **51** |
| Valor | **R$ 198.684,96** |
| Organizações | **7** |
| Sentido | 100% `carteira` → deveria-ser-`novo_negocio` (zero no inverso) |

### Opção A — deixar as 51 como estão; a flag só afeta daqui pra frente

| | |
|---|---|
| Trabalho | nenhum |
| Escrita no livro | zero |
| Estado final | fluxo correto, histórico com 51 linhas erradas |
| Custo | o dashboard mostra `carteira` inflada em R$ 198.684,96 e `novo_negocio` deprimida no mesmo valor, **para sempre**, nas 7 orgs. Como a Carteira ainda não emitiu (a #1201/#1202 não rodaram em prod), hoje toda `carteira` do livro é justamente essas 51 linhas erradas. |

### Opção B — reescrever via produtor (estorno + reemissão), como o #1202

| | |
|---|---|
| Trabalho | uma função de reescrita, no molde do backfill |
| Escrita no livro | **102 linhas** (51 estornos + 51 reemissões com etiqueta certa) |
| Estado final | histórico e fluxo ambos corretos |
| Custo | receita **total** inalterada (estorno anula, reemissão repõe); só a divisão Funil/Carteira muda, exatamente nas 51. Mais volume no livro e uma operação de dinheiro a auditar. Idempotente e reversível pela identidade de produtor, como o #1202. |

**Não decido.** Registro que a Opção A tem custo permanente e visível (a métrica
que o CTO pediu nasce errada nas 7 orgs) e a Opção B tem custo único e auditável
(102 linhas, total preservado). A recomendação implícita da própria existência
desta cadeia — "a etiqueta tem que significar a mesma coisa" — pende para B, mas
é dinheiro e é decisão do CTO.

## Escopo — o que NÃO foi tocado, de propósito

- **`fn_backfill_state_sales`** mantém a expressão antiga. É set-based
  (`INSERT...SELECT`); alinhá-lo com `metric_revenue_stream` reintroduziria o
  problema 1-vs-N (a cascata não acontece dentro de um único INSERT — provado na
  #1202). Ele não roda em runtime. Alinhá-lo é fatia de limpeza própria; se
  alguém o re-executar antes disso, reintroduz o viés.
- **Atribuição** do funil segue `COALESCE(sale_responsible_id, closer_id)` — o
  mesmo que já tinha. É outro finding (R5), outro escopo.

## Arquivos

- `supabase/migrations/20260722260000_funnel_stream_by_customer_moment.sql`
- `supabase/migrations/rollback/20260722260000_funnel_stream_by_customer_moment.sql`
- `supabase/tests/funnel_stream_by_customer_moment_test.sql` (registrado no `run.sh`)
