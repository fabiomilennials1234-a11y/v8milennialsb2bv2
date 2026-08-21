# Mapa de paridade — mockup `ff96` → o que falta construir (decisão CTO 2026-07-27)

> Épico **#1194** · critério de aceite fechado: **a TV reproduz o mockup** (`ff96ec52` "TV Comercial Torque · Monte sua TV", tela **Minha TV**).
> Autor: Design (Vitral) · Status: **lista fechada para fatiar** (não é acabamento — é o que falta pra tela ficar igual ao aprovado).
> Duas elevações do CTO ficam de pé (não desviam do mockup, entregam a 3m o que ele queria): **número creme + hue no filete/gráfico** (mockup colore o número, que morre a 3m) e **batimento honesto** no lugar do badge que mentia. Fora esses dois, **o mockup é a verdade**.

---

## 0. Contagem

**Mockup "Minha TV" = 12 cards.** Semeados hoje = **15** (por Pauta, 2026-07-27). Não é falta de quantidade — é falta de **formato, medida e composição**. Os 15 de hoje são number/ratio/barra + 4 `legacy:*` que rendem vazio; nenhum é pódio, termômetro-com-meta, funil-com-taxa, velocímetro, nem os 3 compositos.

---

## 1. O mapa — cada card do mockup

Grid alvo **12×6**. Coords são tradução fiel do layout do mockup (250px-esquerda + 6-col-direita → 12×6); Cais ajusta a inteiro se precisar. `acento` = entrada da paleta §2.5 no canal gráfico/filete (o número fica creme).

| # | Card no mockup | Métrica (catálogo) | Formato · variante (dos 7) | Acento | grid `col/row/w/h` | Existe hoje? |
|---|---|---|---|---|---|---|
| 1 | **Meta de Julho** (termômetro, R$260K, 33%, "falta R$173,5K") | `receita` total **÷ meta** | Progresso · `gauge:tube` | gold (hero) | 1/1 · 3×6 | **falta renderer** (Progresso não construído; `legacy:thermometer` rende vazio) **+ falta MEDIDA DE META** (alvo) |
| 2 | KPI **Reuniões** (24) | `reunioes_realizadas` total | Número | azure | 4/1 · 3×1 | ✅ construído (número) — confirmar realizadas×marcadas |
| 3 | KPI **Conversão** (45%) | ratio (`comparecimento`? `realizadas/marcadas`) | Número | neutro | 7/1 · 3×1 | ✅ ratio existe — **qual é 45% é ambíguo** |
| 4 | KPI **No-Show** (38%) | — | Número | âmbar-alerta | 10/1 · 3×1 | **falta MEDIDA** — não é prof-1 (`a−b`); só `1−comparecimento` ou medida `no_show` nova |
| 5 | KPI **Ticket recorrente** (17K) | `receita/num_vendas` filtrado produto=recorrente | Número | violeta | 4/2 · 3×1 | **falta split de produto** (recorrente×projeto) |
| 6 | KPI **Ticket projeto** (—) | idem, produto=projeto | Número | neutro | 7/2 · 3×1 | idem #5 (mockup já mostra `—`) |
| 7 | KPI **Leads** (104) | `leads_criados` total | Número | teal | 10/2 · 3×1 | ✅ construído |
| 8 | **Funil de Vendas** (5 etapas + taxa) | funil de reunião (Marcadas→Comparecidas→R2→Vendido) | Funil · `shape:bars` + taxa | rampa ordinal | 1/nova pág · 6×3 | **falta renderer Funil** (taxa entre etapas) **+ ordem de estágio no motor** (hoje val-desc) **+ medida de funil de reunião** |
| 9 | **Corrida SDRs** (pódio + prêmios) | ranking `sdr` por [medida] | Ranking · `layout:podium` | gold | 7/nova pág · 3×3 | **falta renderer Ranking(podium)** **+ PRÊMIOS** (chocolate/pix = dado de gamificação, fora do catálogo) |
| 10 | **Pré-vendas** (3 sub-cards, por vendedor) | **multi-medida** (marcadas + compareceu + no-show × `sdr`) | **composto · `sub_cards`** (número+delta, 3 membros) | azul/verde/âmbar | `w4×h3` (piso w3) | **falta renderer COMPOSTO** ou decompor em 3 widgets (muda o look) |
| 11 | **Closers** (tabela nome/vend/ticket/%) | **multi-medida** (`num_vendas`+ticket-moeda+conversão × `closer`) | **composto · `table`** (4 membros, inclui moeda) | gold no líder | `w6×h3` — **PISO w≥6** | **falta renderer COMPOSTO** (`legacy:closer-performance` rende vazio). **Moeda em coluna estreita trunca abaixo de w6 — mesmo modo de falha do `R$ 14 ...`** |
| 12 | **Novos Leads** (nº + histórico + top origens) | `leads_criados`: total + `tempo` + `origem` — **3 vistas de 1 medida** | **composto · `multi_view`** (3 recortes) | teal | `w8×h2` (banda inferior larga) | **falta renderer COMPOSTO** ou 3 widgets |

> **Footprint dos compostos revisado (2026-07-27, tee-up do fixture da Bancada).** O dimensionamento antigo (`table ~w3-4`) sub-reportaria truncamento — a lição do dia. Por tipo de `composite_render`, o que a legibilidade a 3m exige:
> - **`table` (Closers, 4 membros + moeda): piso `w6`.** Coluna de tabela é mais estreita que card KPI; `R$ 45,5K` em `--tv-value-sm` pede ~150px/coluna × (nome + 4 membros) ≈ 780px ≈ 6 colunas. Abaixo de w6 a coluna de moeda trunca. `h3` p/ header + 3–4 linhas legíveis (~100px/linha).
> - **`sub_cards` (Pré-vendas, 3 números+delta): `w4×h3`.** 3 sub-cards lado a lado = ~213px cada em w4; os 3 números grandes leem a 3m, o breakdown por vendedor é detalhe de 1,5m. `w3` é piso se o breakdown for sacrificado.
> - **`multi_view` (Novos Leads, 1 medida × 3 recortes): `w8×h2`.** É a banda inferior larga do mockup (`b6` = full-width); número grande à esquerda + histórico, top-origens à direita. `h2` basta pelo layout de 2 colunas (largo, não alto).
> - **`col`/`row` seguem a paginação final (1 ou 2 páginas) — decisão da Bancada a 3m. O que o fixture precisa agora é `w×h`, e é isto.**

---

## 2. Os buracos, agrupados por natureza (é isto que o Cais fatia)

### A. Renderers dos 7 formatos que faltam — **S5 (vocabulário)**
- **Progresso** (`gauge:tube/bar/radial`) — cards #1; cobre termômetro, barra-progresso, velocímetro.
- **Funil** (`shape:bars/trapézio` + taxa entre etapas + ordem de estágio) — card #8.
- **Ranking** (`layout:podium/list`) — card #9.
- (Barra, Número, Linha, Donut já existem.)

### B. Vivacidade — **S6 (#1258)**
- **Acento cromático** (filete/gráfico, número creme) — TODOS os cards.
- **Batimento honesto** no header — a parede inteira.
- Sem A+B a tela reproduz a ESTRUTURA do mockup mas não a **vida** dele.

### C. Composição — **re-seed**
- A parede do mockup vira `dashboard_pages`+`dashboard_widgets` semeados nas coords da §1. **Não precisa do Composer** — o Composer é pra mudar depois; pra ficar igual agora, basta semear a composição.
- Inclui o `grid_h` por peso (§1.3 da finishing) e a densidade sem linha vazia (§4).

### D. Medidas que faltam no catálogo — **bloqueiam paridade, precisam de decisão**
1. **Meta/alvo** (card #1) — Progresso é valor÷alvo; **de onde vem a meta?** Sem fonte de meta, o termômetro não existe, degrada a número. **Decisão Cais.**
2. **No-Show** (card #4) — não é prof-1. Ou medida `no_show` nova, ou motor computa `1−comparecimento`. **Decisão Cais/Forja.**
3. **Ticket por tipo de produto** (cards #5/#6) — ratio com filtro produto=recorrente/projeto. Existe o filtro de produto? **Confirmar.**
4. **Funil de reunião** (card #8) — as etapas do mockup são de reunião (Marcadas→Comparecidas→R2→Vendido), não `leads_na_etapa`. Medida de funil de reunião existe? **Confirmar.**

### E. Fora do catálogo de métrica — **decisão de escopo**
- **Prêmios da corrida** (card #9: chocolate/pix) = dado de gamificação/competição, não métrica. Reproduzir fiel exige puxar isso. **Entra na paridade ou fica pra depois? Decisão CTO.**
- **3 compositos multi-medida** (cards #10/#11/#12) = **o maior buraco escondido**. Não cabem nos 7 formatos (um widget = uma medida). Reproduzir fiel exige **renderer composto** (novo, além dos 7) OU **decompor cada um em N widgets single-measure** — o que **muda o look** (3 cards viram 3+ cards soltos). **Decisão dura:** paridade fiel = composto; paridade aproximada = decompor. Recomendo compor os 3 como formato composto v1 mínimo (não o Composer, só o renderer + seed), senão a tela nunca fica "igual".

---

## 3. O que isto muda no épico (Pauta)

**Caminho crítico vira: S5 (vocabulário) + S6 (vivacidade) + re-seed (composição) + compositos (D/E).** **S4 (Composer UI) SAI DA FRENTE** — não é preciso pra reproduzir o mockup; é pra o cliente mudar depois.

Ordem que entrega paridade sem fragmentar por defeito:
1. **Medidas (D)** destravadas por decisão (meta, no-show, ticket-split, funil-reunião) — senão os cards que dependem delas nascem degradados.
2. **Renderers (A)** — Progresso, Funil, Ranking. Sem eles, 3 cards + o termômetro não existem.
3. **Compositos (E)** — Pré-vendas, Closers, Novos Leads. O buraco que nenhuma fatia anterior viu.
4. **Vivacidade (B/#1258)** — acento + batimento. Onde a vida chega.
5. **Re-seed (C)** — a composição da §1 vira seed. É o passo que faz a tela **ser** o mockup.

**Só quando 1–5 estão na tela a paridade existe.** Qualquer subconjunto reproduz um pedaço e o CTO fotografa de novo — foi o padrão dos 2 prints.

---

## 4. Aceite (o gate que faltou)

- [ ] Os 12 cards do mockup existem na parede, no formato e posição da §1
- [ ] Termômetro mostra meta+progresso (não número degradado); Funil mostra taxa entre etapas; Ranking é pódio
- [ ] Os 3 compositos (Pré-vendas/Closers/Novos Leads) rendem como no mockup (ou decisão explícita de decompor)
- [ ] Acento no filete/gráfico, número creme; batimento honesto no header
- [ ] Nenhum card vazio, nenhuma reticência, nenhum id de razão cru (finishing §1-3)
- [ ] Parede enche o grid, sem linha vazia (finishing §4)
- [ ] **Verificado na tela a ~3m, print 1920 E 3840** — meu olho antes do CTO
- [ ] Lado a lado com `ff96`: a tela **é** o mockup (menos as 2 elevações conscientes)

## CONTEXT PACKET — CP-v5

**Mapa verificado**
- Mockup "Minha TV" = 12 cards (§1). vs 15 semeados hoje (Pauta). Falta formato/medida/composição, não quantidade.
- 3 renderers faltam (Progresso/Funil/Ranking) = S5; acento+batimento = S6/#1258; composição = re-seed.
- 3 compositos multi-medida (Pré-vendas/Closers/Novos Leads) **não cabem nos 7 formatos** — buraco não visto em nenhuma revisão de código.

**Achados (novos, provados)**
- Meta do termômetro, No-Show, Ticket-por-produto, Funil-de-reunião = **medidas que faltam no catálogo** (§2.D). Bloqueiam paridade.
- Prêmios da corrida = gamificação, fora do catálogo de métrica (§2.E).
- S4 (Composer) não é pré-requisito de paridade — sai do caminho crítico.

**Descartado**
- "acabar os defeitos = paridade": falso — defeito morto ≠ mockup reproduzido (foi a lição dos 2 prints).
- "os 7 formatos cobrem o mockup": falso pros 3 compositos multi-medida (§2.E).

**Aberto (decisão)**
- Fonte da meta (Progresso); No-Show medida×`1−comparecimento`; filtro ticket-produto; medida funil-reunião — Cais/Forja.
- Compositos: renderer composto v1 (recomendo) ou decompor em N widgets — CTO/Cais.
- Prêmios da corrida entram na paridade v1? — CTO.
- 12 cards em 1 página (denso, sem tipo-hero → teto §6.4 ok) ou 2 páginas — Bancada mede a 3m.

**Comandos que valem**
- Mockup: `ff96ec52` tela "Minha TV" (não a "Biblioteca" — essa é o Composer, fase 2).
- Base: `WidgetFrame` (fica), `TVWidgetBody` (+3 renderers), `tv-chart-type.ts` (deriveStyle), seed em `fn_seed_default_dashboard`.
