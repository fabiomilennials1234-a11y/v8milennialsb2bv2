# Reescrita das vendas de funil mal-etiquetadas (#1203, Opção B) — provas locais

**NÃO EXECUTADO EM PROD.** Construído e provado no stack local. Reescrever
dinheiro no livro-razão é decisão do CTO, no pacote do piloto Milennials.

Gerado em 2026-07-22. **Corrigido na volta 1 (reprova do Crivo).**

---

## O erro que a volta 1 pegou — e que este documento agora corrige

A versão anterior deste relatório afirmava: "reescreve as 51 linhas →
novo_negocio, carteira cai R$ 198.684,96". **Estava errado para 46 das 51.**

`metric_revenue_stream` conta QUALQUER venda anterior (`event_type='sale'`) como
"prior" — inclusive as do produtor de **Carteira** (#1202). Medido em prod:

| | Linhas | Valor |
|---|---:|---:|
| Total mal-etiquetadas **contra o livro incompleto** | 51 | R$ 198.684,96 |
| Destas, com **pedido de Carteira aprovado anterior** | **46** | **R$ 191.533,66** |
| Destas, **primeira compra de verdade** (sem Carteira antes) | **5** | **R$ 7.151,30** |

As 46 têm um `upsell_order` aprovado com `sold_at` **anterior** à venda de funil.
Quando o #1202 insere essas vendas de Carteira no livro, as 46 viram **recompra
legítima** → `metric_revenue_stream` = `carteira` → a etiqueta `carteira` que
elas já têm está **certa**. Reescrevê-las para `novo_negocio` inverteria o erro.

A medição "51 divergentes" foi feita contra o livro **incompleto** — sem as
vendas de Carteira, porque o #1202 ainda não havia rodado. O deliverable
dependia de uma ordem de execução que ninguém havia fixado, e a ordem certa
colapsa **51 → 5**.

## Alvo declarado — o número CERTO

A reescrita só faz sentido contra o livro **completo** (após o #1202). Aí:

| | |
|---|---:|
| Linhas realmente mal-etiquetadas | **~5** |
| Valor | **~R$ 7.151,30** |
| As outras 46 | ficam `carteira` — **corretas**, não divergem mais |
| Receita viva total | **inalterada** |

O número exato de "~5" será reconfirmado no ensaio contra o livro de prod já com
a Carteira dentro (passo 2 do procedimento) — pode variar um pouco conforme o
tratamento dos pedidos de Carteira na #1202 (o de valor idêntico excluído etc.).

## As duas correções de código (volta 1)

### 1. GUARD de ordem na função

`fn_reetiqueta_funnel_streams` agora **recusa** rodar (execução real) se o livro
não tem nenhuma venda de produtor `carteira` na org — sinal de que o #1202 não
rodou e o livro está incompleto. Torna impossível reescrever contra livro
incompleto e congelar as 46 erradas. O ensaio (`dry_run`) não é bloqueado, mas
emite `NOTICE` avisando que o número virá inflado.

### 2. O caso CEGO no teste

O teste antigo era cego ao modo de falha: seu único "não-reescrever" usava uma
venda de **funil** anterior. Não havia nenhum caso com venda de **produtor
Carteira** anterior — exatamente as 46. Agora há:

- Lead com venda `producer='carteira'` em janeiro + venda de funil marcada
  `carteira` em março → a de março **não** é reescrita (é recompra). Vale 90% do
  dinheiro em prod.
- Asserção do guard barrando execução sem Carteira no livro.

## Prova local — total inalterado, divisão muda SÓ no valor real

Fixture com 4 leads: um primeira-compra-real, um caso-cego (Carteira antes), uma
recompra via funil, uma já correta.

| | receita viva | `carteira` viva |
|---|---:|---:|
| Antes | 15.000,00 | 6.500,00 |
| Depois | **15.000,00** | 5.500,00 |
| Δ | **0,00** | −1.000,00 (só o lead primeira-compra-real) |

**Reescreve 1, não 3** — o caso-cego e a recompra ficam `carteira`. Total
inalterado; só R$ 1.000 (a primeira-compra-real) move para `novo_negocio`.

## pgTAP — 15 asserções

`supabase/tests/reetiqueta_funnel_streams_test.sql`, registrado no `run.sh`:

| Bloco | Prova |
|---|---|
| (a) | estrutura + só service_role |
| (b) | **guard**: recusa rodar sem Carteira no livro |
| (c) | **caso cego**: funil-carteira com Carteira anterior segue `carteira`, não é estornado |
| (d) | reescreve só a primeira-compra-real (1, não 2) |
| (e) | total inalterado; `carteira` cai só R$ 1.000 |
| (f) | idempotência, zero comissão, rollback restaura |
| (g) | recompra via funil intocada |

## Idempotência / comissão / rollback

Inalterados da versão anterior e revalidados: 2ª execução = 0; zero comissão
(`source='backfill'`); rollback restaura o estado byte a byte, removendo só o par
estorno+reemissão por identidade de produtor.

## Procedimento para quando o CTO autorizar — ORDEM É PARTE DO CONTRATO

1. **O #1202 (backfill de Carteira) tem que ter rodado REAL** (não dry-run) na
   org. Sem isso, o guard aborta a reescrita — de propósito.
2. Impressão digital de prod.
3. Ensaio: `fn_reetiqueta_funnel_streams(<org>, true)` → conferir **~5 linhas /
   ~R$ 7.151,30**, NÃO 51. Se vier 51, o #1202 não rodou — pare.
4. Real: `fn_reetiqueta_funnel_streams(<org>, false)`.
5. Conferir: receita viva total inalterada; as 46 recompras seguem `carteira`.
6. Divergiu? `fn_rollback_reetiqueta_funnel(<org>)` e reportar.

Piloto Milennials primeiro. Ordem dentro da org: #1201 (flag) → #1202
(backfill Carteira) → #1203 já mergeado → **esta reescrita por último**.

## Escopo — o que NÃO foi tocado

- `fn_backfill_state_sales` mantém a expressão antiga (débito da #1203).
- Atribuição e valor preservados exatos da linha original.
