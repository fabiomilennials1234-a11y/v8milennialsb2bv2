# Reconciliação — etiqueta de fluxo de receita (#1198)

`sale_events.revenue_stream` **como está gravado hoje** × `metric_revenue_stream`
(decisão 6 do CTO: primeira compra é `novo_negocio`, recompra é `carteira`).

Gerado em **2026-07-22** contra **produção** (`jsjsmuncfkbsbzqzqhfq`), somente
leitura. Script: `scripts/reconcile-revenue-stream-1198.sql`.

Esta fatia **não escreveu nada**. Ela existe para que a #1203 — que reetiqueta o
livro vivo — decida com número real em vez de estimativa.

---

## O veredito em uma linha

**51 das 205 vendas vivas estão etiquetadas errado — 24,9% das linhas e
R$ 198.684,96.** Todas no mesmo sentido: `carteira` que deveria ser
`novo_negocio`. Nenhuma no sentido inverso.

## Por que 100% das etiquetas `carteira` estão erradas

Não existe **uma única recompra** no livro-razão:

| | |
|---|---|
| Vendas vivas | 205 |
| Leads distintos com venda | **205** |
| Leads com 2ª compra | **0** |
| Vendas que a regra canônica classificaria como `carteira` | **0** |
| Vendas etiquetadas `carteira` hoje | **51** |

Um lead, uma venda. Pela decisão 6, `carteira` exige venda anterior — e não há
nenhuma. Logo toda etiqueta `carteira` existente diverge por construção, e o
valor canônico de `carteira` hoje é **R$ 0,00**.

Isso não é acidente: as recompras vivem em `upsell_orders` (273 linhas), que
**ainda não entrou no livro-razão**. Ela entra na #1201. Enquanto não entrar, o
livro não tem como conter uma segunda compra.

## Por org

| Organização | Vendas vivas | Divergentes | `carteira`→`novo` | `novo`→`carteira` | `carteira` hoje | `carteira` canônico | Valor em disputa |
|---|---:|---:|---:|---:|---:|---:|---:|
| Milennials | 84 | 32 | 32 | 0 | R$ 123.096,00 | R$ 0,00 | **R$ 123.096,00** |
| testevideo | 3 | 1 | 1 | 0 | R$ 49.550,00 | R$ 0,00 | **R$ 49.550,00** |
| Basic4u | 51 | 10 | 10 | 0 | R$ 18.183,16 | R$ 0,00 | **R$ 18.183,16** |
| Improving | 6 | 2 | 2 | 0 | R$ 5.370,00 | R$ 0,00 | **R$ 5.370,00** |
| Barulinho Bom | 10 | 3 | 3 | 0 | R$ 1.533,80 | R$ 0,00 | **R$ 1.533,80** |
| Drink Express | 2 | 2 | 2 | 0 | R$ 952,00 | R$ 0,00 | **R$ 952,00** |
| Alamaster | 1 | 1 | 1 | 0 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| **Total** | **205** | **51** | **51** | **0** | **R$ 198.684,96** | **R$ 0,00** | **R$ 198.684,96** |

Sete organizações afetadas. Nenhuma organização tem divergência no sentido
`novo_negocio` → `carteira`, o que é consistente com "não existe recompra".

Alamaster diverge em linha mas não em dinheiro: a venda tem `sale_value` nulo.
Vale registrar porque contagem e valor não andam juntos — uma reetiquetagem que
só olhe dinheiro deixaria essa linha para trás.

## Por produtor — o defeito NÃO é só histórico

| Produtor | Vendas vivas | Divergentes | Valor em disputa |
|---|---:|---:|---:|
| `backfill` | 175 | 50 | R$ 149.134,96 |
| `trigger` | 30 | **1** | R$ 49.550,00 |

Importa separar: se a divergência fosse só do `backfill`, o defeito estaria no
passado e bastaria corrigir o histórico. **Ela aparece nos dois.** O produtor
vivo (`fn_capture_sale_event`) também etiqueta pela regra errada, então a
#1203 precisa vir acompanhada da troca nos produtores — reetiquetar o passado
sem corrigir a fonte só adia a divergência.

## Conferência com os números do briefing

O briefing trazia "etiqueta carteira no livro: 52 vendas, R$ 198.684,96". As duas
metades vêm de populações diferentes:

| Recorte | Vendas | Valor |
|---|---:|---:|
| `carteira` **total**, incluindo estornadas | 52 | R$ 248.234,96 |
| `carteira` **vivas** | **51** | **R$ 198.684,96** |
| `carteira` **estornada** (a diferença) | 1 | R$ 49.550,00 |

A contagem 52 é do total; o valor R$ 198.684,96 é só das vivas. Este relatório
usa **vivas** nos dois, de ponta a ponta — daí 51 e não 52.

Os demais números do briefing batem exatos:

| | Briefing | Medido |
|---|---|---|
| Vendas `sale` (bruto) | 214 | 214 |
| `sale_reversed` | 9 | 9 |
| Receita viva (líquida) | ~R$ 751.020,71 | **R$ 751.020,71** |

## O que a fatia entrega

| Artefato | Caminho |
|---|---|
| Função canônica | `supabase/migrations/20260722230000_metric_revenue_stream_canonical.sql` |
| pgTAP (17 asserções) | `supabase/tests/metric_revenue_stream_test.sql` |
| Script deste relatório | `scripts/reconcile-revenue-stream-1198.sql` |

`metric_revenue_stream(org, lead, sold_at, exclude)` é `STABLE SECURITY INVOKER`
com `search_path` pinado. Serve os dois produtores e o recálculo sobre
histórico. Decisões de borda provadas por teste: estorno não conta como venda
anterior; empate exato de `sold_at` não conta; a exclusão remove a linha
nomeada e não a classe; org alheia nunca vaza.

## O que ela deliberadamente NÃO faz

- **Nenhuma escrita em `sale_events`.** Reverter é `DROP FUNCTION`.
- **Não altera os produtores.** Trocar a expressão em `fn_capture_sale_event` e
  `fn_backfill_state_sales` é da #1203, que ativa junto com a #1201.
- **Não aplicou a migration em produção.** A função existe no repo e foi
  validada contra o schema real de prod reproduzido localmente (baseline
  `20260101000000`). Os números acima vieram do predicado equivalente rodado
  inline em prod, read-only.

## Ponto de atenção para a #1203

Quando `upsell_orders` entrar no livro (#1201), a fotografia muda: os 273
pedidos de Carteira passam a ser vendas anteriores, e aí `carteira` deixa de ser
zero. **A ordem importa** — reetiquetar antes da #1201 zeraria a Carteira de
todas as sete organizações, e o número certo só existe depois que as recompras
entrarem. Este relatório mede o estado de hoje, não o estado final.
