# Prompt de arranque — Fatia 1: ligar o Estúdio ao motor (SCRUM-310)

Copiar o bloco abaixo inteiro para abrir a sessão de desenvolvimento. Ele é
auto-contido: não depende de nada desta conversa.

---

## Tarefa

Ligar as janelas do Estúdio de Métricas (`/metricas`) ao motor `fn_metric_measure`,
substituindo a amostra determinística. Ticket **SCRUM-310**, épico **SCRUM-307**.

Branch a partir de `origin/develop`. PR com base `develop`. **Nunca tocar `main`.**

Leia `.specs/features/metricas-v2/SPEC.md` antes de escrever qualquer linha — ele carrega
o estado de produção medido e as decisões já tomadas. O que segue é o recorte desta fatia.

## Contexto que evita retrabalho

O Estúdio existe e está integrado ao sistema. Hoje `MetricWindow.tsx` chama
`buildMetricSample(metric, periodKey)` num `useMemo` e recebe um objeto **síncrono e
completo**: `{ value, deltaPct, series[{label,value,open,high,low,close}], slices[{label,value}] }`.

Três comentários no código afirmam que trocar isso pelo motor "não toca nenhum
componente". **Isso foi verificado e é falso.** Trate como falso.

O motor devolve outra coisa:

```
fn_metric_measure(p_org_id, p_measure_ref jsonb, p_recorte text,
                  p_period text = 'month', p_ref date, p_start date, p_end date,
                  p_filters jsonb = '{}') → jsonb
```

- `measure_ref` é união fechada: `{kind:'leaf', id}` ou `{kind:'ratio', num, den}`
- **`value` XOR `series`** — `recorte='total'` dá `value` e `series: null`; qualquer outro
  recorte dá `value: null` e `series: [...]`
- **toda série vem ordenada por valor DESC**, inclusive `recorte='tempo'`
- `recorte='tempo'` bucketiza **sempre por dia**, `key='YYYY-MM-DD'`, sem zero-fill
- `kind='ratio'` devolve **`series: null` sempre**; denominador 0 → `value: null` +
  `empty_reason='no_rows'`
- o motor **degrada recorte em silêncio** e reporta o efetivo em `measure.recorte`
- período é `day | week | month | range` — **não existe `today`, não existe `quarter`**
- `empty_reason='no_rows'` vem junto com `value: 0`

Hook pronto: `useMetricMeasure` em `src/modules/analytics/hooks/useMetricMeasure.ts`
(queryKey completa, staleTime 30s, degrada para `null` via `isMissingSchemaError`).

## O primeiro entregável não é código de tela

Crie `src/modules/analytics/lib/metrics-studio-engine-map.ts`, ligando cada
`StudioMetric` a `{ measureRef, recorte, format_id, filters? }`.

Isso é o artefato central que falta. Hoje `StudioMetric` não carrega nenhum desses
campos — a ligação existe só como texto livre no campo `source`, e **id de métrica do
Estúdio não é id de medida do motor**:

| StudioMetric | no motor |
|---|---|
| `receita`, `leads_criados`, `reunioes_marcadas`, `reunioes_realizadas`, `tempo_medio_etapa` | leaf 1:1 |
| `taxa_conversao` | **ratio** `num_vendas / leads_criados` |
| `ticket_medio` | **ratio** `receita / num_vendas` |
| `negocios_por_etapa` | leaf `leads_na_etapa`, recorte `etapa` |
| `negocios_por_funil` | leaf `leads_na_etapa`, recorte `pipeline` |
| `receita_por_origem` | leaf `receita`, recorte `origem` |
| `reunioes_no_show`, `meta_definida` | ⚠ **não existem em prod** — ver abaixo |

Métrica sem entrada no mapa continua na amostra e é **marcada como tal na UI**. Não
invente mapeamento por semelhança de nome: par (medida, recorte) fora da tabela de
compatibilidade levanta `EXCEPTION 22023`, que **não** é capturado por
`isMissingSchemaError` e vira throw.

Compatibilidade real em prod, por medida:
- `receita`, `num_vendas` → closer, origem, pipeline, sdr, stream, tag, tempo, total
- `leads_criados` → origem, produto, tag, tempo, total
- `reunioes_marcadas`, `reunioes_realizadas` → origem, sdr, tag, tempo, total
- `leads_na_etapa` → etapa, pipeline, total
- `tempo_medio_etapa` → etapa, pipeline (**sem `total`**)

## Restrições de produção medidas em 2026-08-11

🔴 **O catálogo de prod tem 7 medidas, não 8.** A migration `20260727140000` nunca foi
aplicada — o ledger pula de `20260727120000` para `20260727140241`. Portanto **não
existem em prod**: a medida `reunioes_no_show`, a coluna `goal_type` e o `target` no
payload. As métricas `reunioes_no_show` e `meta_definida` do Estúdio ficam **fora desta
fatia** — ou se aplica aquela migration num ticket próprio antes.

🔴 **`fn_metric_measure` não consulta `composable_metrics_enabled`.** Só
`fn_dashboard_snapshot` consulta. Em prod a flag está ligada em **1 org de 99**. Decidir
explicitamente: o Estúdio com motor sai para todas as orgs ou respeita a flag? Se
respeitar, o gate é no front via `useComposableMetricsEnabled`.

## Decisões já tomadas na spec (não reabrir sem motivo novo)

1. **Vela sai do Estúdio nesta fatia.** O motor não tem OHLC e não há coluna nem
   agregação para isso. Remover `'candle'` dos `charts` das métricas que passarem a
   consumir o motor. Manter o componente `StudioCandleChart` no repo.
2. **`taxa_conversao` e `ticket_medio` perdem Linha e Pizza.** São razões e devolvem
   `series: null` sempre. Ajustar `charts` no catálogo, senão o gráfico nasce vazio.
3. **`empty_reason` exibe ausência, não zero.** Reusar o padrão da TV
   (`tv-metric-format.ts` → travessão), não imprimir "R$ 0".
4. **O rótulo segue `measure.recorte`, não o recorte pedido.** O motor degrada; ignorar
   isso faz a janela dizer "por Etapa" sobre um total.
5. **`deltaPct`**: o motor não compara períodos. Ou some, ou vira 2ª chamada com
   `period='range'` deslocado. Escolha e justifique no PR — não deixe o número mentir.
6. **Formato vem do `format_id`.** Existem **duas** funções `formatMetricValue` com
   assinaturas incompatíveis que compilam trocadas: `(value, unit)` no Estúdio e
   `(value|null, formatId)` na TV. Consolide numa só nesta fatia.
7. **Vocabulário de período**: `'today'` → `day`, `'quarter'` → `range` com
   `start`/`end`. O front **nunca** calcula fronteira — quem corta é
   `metric_period_bounds`, na timezone da org.

## Reuso obrigatório

Camada pura já pronta em `src/modules/analytics/lib/`:
- `tv-series.ts` — `headValueFromMeasure`, `seriesState`, `groupTopN`, `withShare`
- `tv-metric-format.ts` — `resolveHeadValue`, `isEmptyReason`, `formatMetricValue(value, formatId)`
- `tv-chart-type.ts` — `resolveChartType(recorteEfetivo, widgetStyle)`

`TVComposableWall.tsx` é a **referência viva** de como consumir `MetricMeasureResult` do
começo ao fim: eyebrow, recorte efetivo, head value, degradação e erro isolado. Leia
antes de escrever o consumo.

## Onde a mudança vai bater

`MetricWindow.tsx:62` deixa de ser `useMemo` síncrono e vira hook com loading/error/empty.
Como o componente é `memo()` com props posicionais, a mudança sobe para
`MetricsCanvas.tsx:64-82`. Planeje os três estados por janela **antes** de codar — a
janela é pequena e não comporta spinner grande.

Atenção ao custo: N janelas abertas = N chamadas a `fn_metric_measure`. Não há batch para
painel efêmero (`fn_dashboard_snapshot` é amarrado a página persistida no banco). Se a
troca de período disparar 10 RPCs, diga isso no PR.

## Definição de pronto

- Número exibido no Estúdio **bate** com o mesmo número no Comando e na TV, para o mesmo
  período e a mesma org. Divergência é bug bloqueante, não arredondamento.
- Métrica sem mapa continua em amostra e está **visivelmente marcada** como amostra.
- Os três estados por janela (carregando, vazio, erro) têm screenshot no PR.
- Nenhuma janela dispara `EXCEPTION 22023` por par (medida, recorte) incompatível.
- Teste unitário do mapa: todo `measureRef` referencia id existente no catálogo, e todo
  par (medida, recorte) está na tabela de compatibilidade.

## Gates antes do PR

```bash
npm run lint:ratchet
npm run typecheck:ratchet
npm run test:ratchet
npm run build
```

Nunca use `npm run lint` cru (sai 0 e imprime 29.142 problemas) nem `npm run test:unit`
cru (reprova por 178 falhas herdadas). Dívida que a branch não criou se reporta como
`HERDADO — arquivo:linha — o quê` e segue.

⚠ Esta máquina pode não sustentar `tsc` sobre o grafo transitivo — houve timeout em 500s
até com `include` restrito. Se o typecheck não fechar, **diga isso no PR** em vez de
omitir o gate.

## Fora de escopo desta fatia

Persistência no servidor (SCRUM-309), modo visualização × edição (SCRUM-308), portar
medidas legadas para o catálogo (SCRUM-311), relatórios (SCRUM-312), seletor de recorte e
filtro na UI, métrica personalizada (épico SCRUM-314).
