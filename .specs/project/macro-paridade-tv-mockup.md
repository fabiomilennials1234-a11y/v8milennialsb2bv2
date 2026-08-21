# MACRO — PARIDADE da TV com o mockup `ff96` (objetivo único, substitui a fila do épico)

> Arquiteto (Cais) · 2026-07-27 · épico #1194 · mapa: `docs/design-tv-mockup-parity-map.md` · artifact `ff96ec52`. NÃO implementação. Macro + fatias internas. Issues após ratificação.

## Objetivo ÚNICO

**Critério de aceite: a TV reproduz o mockup** (menos as 2 elevações conscientes — número creme + hue no filete/gráfico; batimento honesto). Não "N defeitos corrigidos". Fatiar por defeito foi erro de coordenação (2 prints do CTO dizendo a mesma coisa). **Uma fatia com etapas internas; o CTO só vê tela quando estiver reconhecivelmente o mockup.**

## D — medidas que faltam (MEDIDO em prod, não suposto)

| # | Medida | Fonte medida em prod | Decisão |
|---|---|---|---|
| **D1 meta/alvo** (termômetro #1) | `goals(target_value, month, year, type, product_id, organization_id)` — **Milennials tem 32 linhas** | ✅ Fonte existe. = issue **#1268** (motor serve alvo). Motor lê `goals.target_value` da org+mês corrente → `Progresso` recebe alvo real. **NÃO inventar medida** — ligar a `goals`. |
| **D2 no-show** (#4) | `meeting_events.event_type ∈ {meeting_booked, meeting_held}` | ✅ **Nova medida-LEAF `reunioes_no_show`** = booked sem held na janela. É um count-leaf estático no `_metric_leaf` (ZERO EXECUTE intacto), **não** `a−b` no nó de razão. no-show% = `reunioes_no_show / reunioes_marcadas` (razão de 2 medidas do catálogo). |
| **D3 ticket recorrente/projeto** (#5/#6) | `products.type` existe; falta recorte por tipo + confirmar join `sale_events`→produto | ⚠️ Parcial. Adicionar recorte/filtro `product_type`; **confirmar na fatia** o caminho sale→produto→type. Mockup já mostra `—` p/ projeto → parcial é aceitável no v1. |
| **D4 funil de reunião** (#8) | `meeting_events` (booked/held) + `sale_events` (vendido); **R2/2ª reunião NÃO é event_type** | ⚠️ Parcial. Medida de funil de reunião = Marcadas(booked)→Comparecidas(held)→**[R2 precisa definição do CTO]**→Vendido(sale). v1: funil de 3 estágios reais (booked→held→sold); R2 é decisão de produto, não bloqueia o resto. |

## E — o COMPOSTO (a decisão dura; meu ceticismo, não obediência)

O CTO escolheu **construir o composto** (3 cards: Pré-vendas, Closers, Novos Leads mostram N medidas num card). Quebra "1 widget = 1 medida" (ADR-0023). **Pode existir SEM furar o catálogo fechado — e esse é o único desenho que aceito:**

**Composto = N measure-refs DO CATÁLOGO num card, renderizados juntos. NÃO é consulta livre.**
- `dashboard_widgets.measure_kind` ganha `composite`. Os membros vivem em tabela-filha `dashboard_widget_measures(widget_id, position, measure_kind, measure_id/num/den, recorte_id, filters, sub_label)` — **cada membro FK+trigger-validado contra o catálogo EXATAMENTE como um widget single**. Nenhum SQL livre, nenhum nome de coluna/tabela, `ZERO EXECUTE` intacto (cada membro passa por `fn_metric_measure`).
- `fn_dashboard_snapshot` resolve o composto chamando `fn_metric_measure` **por membro** → array de payloads sob o widget. O renderer compõe.
- **Renderer composto = conjunto FIXO** (não free-form): `table` (Closers: linha=closer, colunas=medidas), `sub_cards` (Pré-vendas: 3 sub-cards), `multi_view` (Novos Leads: número+linha+barra da MESMA medida em 3 recortes). Cap: N membros ≤ 4; renderer ∈ conjunto fixo. Trigger enforça.

**Por que NÃO é a porta dos fundos que dissolve o ADR:** o catálogo continua fechado (todo membro é medida do catálogo, validada na escrita); o composto é construto da **camada de composição** (quantas medidas-do-catálogo dividem um card + qual layout fixo), não da camada semântica, e **não abre consulta arbitrária**. A porta dos fundos seria permitir SQL/coluna livre no membro — proibido por FK+trigger. **Aprovado como formato composto, rejeitado como query-builder.**

### ADENDO OBRIGATÓRIO ao ADR-0023 (adendo, NÃO reescrita — parte do P3)
O contrato passa de **"1 widget = 1 medida"** para **"1 widget = 1..N medidas DO CATÁLOGO, sem expressão livre"**. A restrição que importa **nunca foi o número de medidas — era a ORIGEM delas** (catálogo fechado, validado na escrita, ZERO EXECUTE). O composto respeita a origem; só relaxa a contagem. Sem este adendo escrito, daqui a 3 meses alguém lê o ADR antigo ("1 medida") e acha que o composto foi **violação** — quando é extensão coerente. Escrever o adendo no ADR-0023 é entregável do P3.

Alternativa (decompor os 3 em N widgets single) — **rejeitada**: muda o look (3 cards viram 3+ soltos), e o requisito é paridade. O composto-como-N-refs entrega o look sem furar o catálogo.

## A — renderers que faltam (vocabulário)
`Progresso` (gauge:tube/bar/radial — card #1), `Funil` (bars/trapézio + taxa + ordem de estágio — #8), `Ranking` (podium/list — #9). Barra/Número/Linha/Donut já existem. **Requisito da Bancada dobrado aqui:** valor tem que caber COM FOLGA em `grid_w:2` real (`over=40@1920` — defeito real, independente do mockup); a correção de sizing vive nos renderers/WidgetFrame, não é fatia solta.

## B — vivacidade (#1258): acento cromático (filete/gráfico, número creme) + batimento honesto — em TODOS os cards. Sem A+B a tela reproduz a estrutura, não a vida.

## C — re-seed (composição): a parede da §1 do mapa vira `dashboard_pages`+`dashboard_widgets` semeados (NÃO precisa do Composer). Inclui `grid_h` por peso (finishing §1.3) e densidade sem linha vazia (§4). **Guarda F4:** o re-seed é **backfill de dado de cliente** → fn criada pela migration + invocação deliberada + backup (`dashboard_composition_backup`) + idempotência, NUNCA `DO` automático no apply.

## Ordem (caminho crítico) e o MENOR conjunto reconhecível

**D → A → E → B → C.** S4 (Composer UI) **sai da frente** (é pra o cliente mudar depois, não pra paridade — reordena o épico).

**Menor conjunto que já É reconhecivelmente o mockup (o gate do "quando mostrar"):**
`A (Progresso+Funil+Ranking) + B (acento+batimento) + C (re-seed dos 12) + D1 (meta) + D2 (no-show) + E (os 3 compostos, layout v1)`.
**Deferível SEM quebrar o reconhecimento** (o CTO reconhece a tela sem isto): **prêmios da corrida** (chocolate/pix — guarnição do pódio, o pódio lê sem eles), **exatidão do ticket-projeto** (D3 — mockup já mostra `—`), **R2 do funil** (D4 — funil de 3 estágios reais lê como funil). Ou seja: paridade reconhecível = tudo menos a guarnição de gamificação e as 2 exatidões parciais.

## Fatias INTERNAS (etapas, não entregas ao CTO)
1. **P1 — medidas (D1+D2):** motor serve alvo (liga `goals`, #1268) + leaf `reunioes_no_show`. Destrava termômetro e no-show. [D3/D4 parciais entram em P2 com o que der.]
2. **P2 — renderers (A):** Progresso, Funil (3 estágios), Ranking + o sizing `grid_w:2` com folga.
3. **P3 — composto (E):** schema `composite` + membros validados + os 3 renderers compostos (table/sub_cards/multi_view).
4. **P4 — vivacidade (B/#1258):** acento + batimento, todos os cards.
5. **P5 — re-seed (C):** a composição da §1 semeada (guarda F4), `grid_h` por peso, sem linha vazia.
**Paridade existe só com P1–P5 na tela.** O CTO vê quando o conjunto reconhecível está de pé (fim de P5, ou P5 sobre o subconjunto reconhecível).

## Abertos — minha leitura (pro Pauta não perguntar cego ao CTO)
- **Prêmios da corrida na v1?** Leitura: **DEFERIR.** É dado de gamificação/competição fora do catálogo de métrica; o pódio lê como o mockup sem os prêmios. Puxar gamificação pra parede de métrica é escopo novo — follow-up, não v1. (Decisão do CTO; recomendo fora.)
- **12 cards em 1 ou 2 páginas?** Leitura: **2 páginas.** Teto de densidade (§6.4 do widgets spec) = 12/página, mas **8 se há hero** — e o termômetro É hero. 12 cards + hero estoura o teto de 8 → tipo sub-3m. 2 páginas (hero + ~7 na pág 1, resto na 2), Bancada confirma a 3m. (Decisão do CTO; recomendo 2.)

## Áreas frágeis
Multi-tenant (re-seed escreve painel de org viva — guarda F4 + backup); catálogo fechado (composto NÃO pode virar query livre — revisor rubric bloqueante no P3); ZERO EXECUTE (motor, incl. no_show e composto). **Revisor bloqueante em P1 (motor/goals) e P3 (composto).**

## Riscos
| Risco | Mitigação |
|---|---|
| Composto vira porta dos fundos do ADR-0023 | Membro = measure-ref do catálogo, FK+trigger; renderer fixo; cap N≤4; ZERO EXECUTE. Revisor bloqueante P3 |
| Re-seed reescreve parede viva | Guarda F4 (fn+invocação deliberada+backup+idempotência), padrão S1 |
| R2/ticket-projeto sem fonte exata | v1 parcial declarado (funil 3 estágios; projeto=`—` como o mockup); exatidão = follow-up |
| Pixel não visto (Palco auth-gated) | Bancada verifica a 3m em 1920 E 3840 (gate do mapa §4); o CTO é o juiz final da paridade |
| Fatiar e o CTO fotografar partial | NÃO mostrar antes do conjunto reconhecível (gate acima) |

## CONTEXT PACKET — CP (paridade)
**Alvo:** motor (`goals`→alvo, `reunioes_no_show` leaf) · renderers Progresso/Funil/Ranking · schema `composite`+`dashboard_widget_measures`+3 renderers compostos · vivacidade (#1258) · re-seed (guarda F4). Paths: `supabase/migrations/*`, `src/modules/analytics/components/tv/composable/renderers/*`, `fn_metric_measure`/`fn_dashboard_snapshot`, `fn_seed_default_dashboard`.
**Descartado:** decompor os compostos (muda o look); composto como query livre (fura ADR); inventar medida de meta (goals existe); no-show como `a−b` no nó de razão (é leaf).
**Medido (prod):** goals 32 linhas Milennials/target_value; meeting_events booked+held; products.type existe; R2 não é event_type.
**Aberto (CTO):** prêmios v1 (recomendo fora), 1 vs 2 páginas (recomendo 2), R2 do funil (definição).
