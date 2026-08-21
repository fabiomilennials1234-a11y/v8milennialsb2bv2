# Spec de acabamento — a parede S1 no ar (decisão CTO 2026-07-27)

> Épico **#1194** · acabamento sobre `design-tv-vivacity-revision.md` e `design-tv-composable-widgets.md`
> Autor: Design (Vitral) · Status: **spec para fatiar** (não é código, não redesenha a TV — acaba o que existe)
> Gatilho: print de `torquecrm.com.br/tv` (Fechamento, S1 no ar). A dívida que os dois PRs aceitaram foi **"render de pixel não capturado"** — e o problema está todo no pixel. Dado/lógica/RLS/concorrência/rollback foram verificados; a tela, não.

---

## 0. O diagnóstico honesto

O S1 trocou "célula em branco com `—`" por "célula com um número e um vão". Não é obviamente melhor. Quatro defeitos, todos de acabamento, todos na base já construída (`WidgetFrame.tsx`, `tv-metric-format.ts`) — nenhum exige repensar a arquitetura:

| # | Na tela | Causa no código |
|---|---|---|
| 1 | `RECEITA`/`LEADS NA ETAPA`: número no topo, ~70% de vão, rodapé embaixo | `WidgetFrame.tsx:96` — `flex-1` **só abaixo** do valor empurra tudo pro topo; + `grid_h` legado herdado sem meta que preencha |
| 2 | `R$ 14 ...` **truncado** (real: R$ 14.411) | `WidgetFrame.tsx:84` — `truncate` (reticência CSS) no valor; `clamp()` não encolhe por conteúdo; razão não usa moeda compacta |
| 3 | rótulo da razão = **id das medidas concatenado**, cortado | eyebrow da razão montado de `num/den` cru, não de label humano |
| 4 | 6 widgets, **metade da tela vazia** | grid 12×6 fixo, poucos widgets em células mínimas, sem preencher |

As 4 decisões abaixo resolvem cada um, com a justificativa de 3 metros que o CTO pediu.

---

## 1. Widget alto com conteúdo curto — o conteúdo preenche a altura, e o peso é o botão

### A pergunta do CTO
Progresso sem meta degrada pra Número (§2.1 da revisão: progresso é valor÷alvo; sem alvo, é só o valor). Mas herdou a **altura** da célula legada do termômetro. Um número de uma linha numa célula alta = 70% de vão. Altura acompanha conteúdo, ou conteúdo preenche altura?

### A decisão: **as duas — e o PESO reconcilia.**

O peso já é o botão único que amarra footprint + escala (§1 densidade, widgets doc). O bug é que **duas coisas se soltaram do peso**: (a) o valor não foi centralizado nem escalado ao peso da célula, e (b) o `grid_h` veio do legado, não do peso. Conserto os dois:

**1.1 Regra de render — o valor preenche a célula, centralizado.**
Hoje o frame é `eyebrow (topo) → valor (logo abaixo) → flex-1 (vão) → proveniência (base)`. O `flex-1` só embaixo joga o valor pro topo. Correção: **o bloco do valor centraliza verticalmente no espaço entre o eyebrow e a proveniência** — espaçador acima **e** abaixo (ou `justify-center` na região do valor). O número passa a morar no centro óptico do card, não no topo.
- Efeito numa célula baixa: número centrado, card compacto, sem vão.
- Efeito numa célula alta: número centrado com folga em cima e embaixo — **respira**, não flutua.

**1.2 Regra de render — a escala segue o peso, sempre.**
O valor usa `typeScaleForWeight(weight)`. Numa célula alta de peso `hero`, isso é `--tv-hero` (56–96px) — grande o bastante pra preencher. O defeito foi um valor em `--tv-value` (peso primário) numa célula com `grid_h` de hero: escala de primário em corpo de hero = vão. **Peso, footprint e escala andam juntos ou não andam.**

**1.3 Regra de seed — `grid_h` = footprint canônico do peso. Sem altura legada órfã.**
Todo widget semeado tem `grid_h` igual ao footprint do seu peso (hero 6×3, primário 3×2, secundário 2×2 — widgets §1). O termômetro promovido que virou Número **não herda o 3×4 do legado**: ou (a) é re-semeado como Número primário (3×2, célula baixa) — é o certo pro default, porque ele era um *fallback*, não foi escolhido pra ser hero; ou (b) recebe uma meta e volta a ser Progresso de verdade, que **usa** a altura.

### Justificativa de 3 metros
Um número gigante centrado numa célula alta é **sinalização premium** — é o `leadbig` do próprio mockup, é o big-stat do Keynote/Stripe. Um número pequeno flutuando com vão embaixo é um **bug que lê como "meio carregado"**. Então: conteúdo preenche a altura (centralizar + escalar ao peso), e a altura default segue o peso (o fallback não vira hero por acidente). A **forma alta existe** — mas por escolha de peso `hero`, não por herança de `grid_h` legado.

> Não é redesenho: é o peso fazendo o que a spec sempre disse que ele faz. O que faltou foi **centralizar** e **casar grid_h com peso** no seed.

---

## 2. Rótulo de razão — nome humano do catálogo, nunca id concatenado

### O defeito
O eyebrow da razão vem como `num_vendas / leads_criados` (ou pior, cortado no meio). Id de sistema numa parede a 3m é ilegível, e a razão é o widget que mais precisa de nome — a conta não se explica sozinha.

### A decisão: **o eyebrow da razão é um label humano, derivado onde o dado mora. O front nunca concatena id.**

Dois níveis, porque há dois tipos de razão:

**2.1 Razão nomeada (os presets) → label próprio no catálogo.**
`metric_catalog_ratios.label` **já é coluna** (confirmado Forja: migration `20260723100000_metric_catalog_tables.sql:131` CREATE, `:208` INSERT com label) — os presets são semeados COM label: `conversao → "Conversão"`, `ticket_medio → "Ticket médio"`, `comparecimento → "Comparecimento"`. Curto por construção, cabe no eyebrow, lê a 3m. Suporte de schema **existe**; a razão nomeada só precisa que o `buildEyebrow` **puxe esse label** em vez de compor de num/den.

> **A realidade de código a consertar (confirmada Forja):** hoje o ramo `ratio` do `buildEyebrow` concatena `label[num] / label[den]` (ou **id cru** no fallback). Por isso a parede mostra `Nº DE VENDAS / LEAD…` e, no pior caso, id cortado. Dois consertos, ambos de código (motor+front), **zero schema**: (a) razão nomeada → **lookup do `metric_catalog_ratios.label`**, não composição; (b) razão ad-hoc → compor com **"por"** (§2.2), não `/`. O harness do Forja já prova os dois: widget D = fallback cru, widget B = `/` concatenado com label.

**2.2 Razão ad-hoc (num/den escolhidos livres) → o motor compõe de dois labels, com conector que lê como taxa.**
Quando o cliente monta uma razão fora dos presets, o motor compõe o eyebrow de `num.label` + `den.label` com **"por"**, não "/": `Vendas por lead`, `Reuniões por SDR`. "por" lê como taxa em português; barra e id nunca. A composição é do **motor** (mesma doutrina da âncora §4 e do rótulo de etapa §2.4 da revisão: rótulo humano mora onde o dado mora). O front renderiza o `eyebrow` que recebe.

**2.3 Catálogo ou display?** **Catálogo** para as nomeadas (`label` é coluna de `metric_catalog_ratios`); **motor-composto** para as ad-hoc (dos dois `label`). O front **nunca** monta. E o `eyebrow_override` do Composer (composer §5.1, ≤28) segue disponível pro cliente renomear.

> Sinalizo ao Cais/Forja: **razão sem `label` humano servido pelo motor = erro no motor**, não string de id no front. É a mesma cura do épico — semântica fora do lugar onde o dado mora vira 23 hooks; aqui vira um eyebrow ilegível.

### Justificativa de 3 metros
O eyebrow é a **pergunta** do widget (widgets §1①). "Conversão" é a pergunta; "num_vendas / leads_criados" é a implementação vazando pra parede. A 3m o time comercial lê "Conversão", nunca decodifica ids.

---

## 3. Valor que não cabe — compacto primeiro, reticência NUNCA

### O defeito e a causa
`R$ 14 ...` é o `truncate` do `WidgetFrame.tsx:84` cortando com reticência, porque o `clamp()` da escala é por **viewport**, não por conteúdo — não encolhe pra caber, e o número transborda a célula. Some com o `truncate`: reticência num número é uma mentira (`R$ 14…` pode ser 14 mil ou 14 bilhões).

### A decisão: **compacto por construção + zero reticência + encolher até um piso, nunca quebrar linha.**

Ordem de defesa, do primeiro ao último recurso:

**3.1 Compacto primeiro (o conserto principal).**
Moeda ≥ 10 mil → **`R$ 14,4 mil`** (1 decimal — widgets §2.6b). O ticket R$ 14.411 vira `R$ 14,4 mil` e cabe folgado. **A razão com unidade de moeda tem que usar a MESMA moeda compacta** — o defeito é que a razão renderizou `R$ 14.411` cheio; ela não passou pela `formatCurrencyForWall`.
> Bug de fronteira que isto expõe: `formatCurrencyForWall` (`tv-metric-format.ts:24`) corta em **1.000** com **0 decimais** (`R$ 14 mil`), divergente da §2.6b (**≥10 mil, 1 decimal** → `R$ 14,4 mil`). Alinhar a função à regra escrita — é a fonte única de formatação, tem que bater com a spec.

**3.2 Sem reticência. Nunca.** Remover `truncate` do bloco do valor (não do eyebrow — eyebrow é label, reticência com `title` ali é aceitável; número, jamais).

**3.3 Encolher-para-caber até um piso, como backstop.**
Se, depois de compacto, ainda não couber (raro — compacto não passa de ~`R$ 999,9 mil`/`R$ 12,3 mi`, ~10 chars), a escala **encolhe** da escala do peso até um **piso de legibilidade** (primário: 36px, widgets §2.2 — o mínimo de 3m). Encolhe proporcional à largura disponível, não abaixo do piso.

**3.4 Se nem no piso couber → degrada o FORMATO, não a legibilidade.**
`R$ 14,4 mil` não coube no piso? Vai pra `mi` mais cedo, ou corta um decimal — muda a **formatação**, nunca quebra linha (número quebrado lê como dois números a 3m) e nunca desce do piso (abaixo de 36px não existe leitura a 3m, que é a razão da tela existir).

### Justificativa de 3 metros
A 3m ninguém precisa de `R$ 14.411` exato — `R$ 14,4 mil` decide igual. Compacto é a forma honesta da parede. Reticência destrói o número; quebra de linha duplica o número; encolher abaixo de 36px mata a leitura. Logo: compacto primeiro, e as barreiras só existem como backstop.

---

## 4. Densidade da parede — o grid preenche, sem linha vazia

### O defeito
6 widgets num grid 12×6 (72 células) em footprints mínimos = metade da tela vazia. Numa sinalização, espaço morto é **sinal desperdiçado** e lê como "quebrado / meio-carregado".

### A decisão: **página publicada não tem linha vazia. Poucos widgets → células maiores; o grid é alvo de preenchimento, não moldura de células mínimas.**

**4.1 O grid é alvo de ocupação, não gaiola de mínimos.**
Com poucos widgets, eles **crescem** pra ocupar o 12×6, respeitando a razão de peso — 6 widgets viram ~4×3 cada (6 × 12 = 72 = cheio), não 6 × (3×2=6) = 36 = metade. Crescer numa parede é **bom**: célula maior = tipo maior = mais legível a 3m.

**4.2 Regra dura: nenhuma linha da grade fica vazia numa página publicada.**
Se os widgets em footprint de peso não preenchem, um passo de preenchimento distribui as células restantes (cresce a última linha / infla proporcional) até não sobrar linha vazia. Isso amarra com o teto do §6.4 (máx 12/página, 8 com hero): o teto é o limite **superior** (tipo não pode ficar pequeno demais); esta regra é o limite **inferior** (parede não pode ficar vazia demais). Entre os dois, a página respira cheia.

**4.3 Conserto imediato do seed.**
A parede default (17 widgets, 2 páginas) tem que ser re-semeada pra **ocupar**: ou mais widgets por página, ou os existentes em footprint maior. Com os 4 legacy resolvidos (§5 da revisão) e os widgets restantes crescidos ao alvo de ocupação, Fechamento enche o 12×6 sem vão.

### Justificativa de 3 metros
Uma parede pela metade não é minimalismo — é uma tela que parece que não terminou de carregar, na frente da sala. Signage preenche o meio de propósito (placar de estádio, painel de aeroporto): cada centímetro carrega sinal. Poucos widgets = widgets maiores = mais legíveis, não uma ilha de cards no canto.

---

## 5. O que muda no `WidgetFrame` (cirúrgico — a base fica)

Nenhuma reescrita. Quatro mudanças pontuais:

1. **Centralizar o valor verticalmente** (`WidgetFrame.tsx:73,96`): espaçador acima **e** abaixo do bloco do valor (ou `justify-center` na região entre eyebrow e proveniência). Mata o vão do §1.
2. **Tirar `truncate` do valor** (`:84`): número nunca reticencia. Adicionar o encolher-para-caber (§3.3) como fit-to-width sobre a escala do peso.
3. **Moeda compacta alinhada à §2.6b** (`tv-metric-format.ts:24`): corte em 10 mil, 1 decimal; e a razão-moeda passa por ela.
4. **Eyebrow da razão = label humano** vindo do payload (§2), nunca `num/den` montado no front.

Proveniência, estados (loading/empty/erro/estruturalmente-vazio), escala tipográfica, âncora — **intactos**. Isto é acabamento do valor de cabeça e do layout da célula, não dos invariantes de honestidade.

---

## 6. Aceite (checklist pro QA visual — este é o que faltou nos 2 PRs)

- [ ] Nenhum widget com número no topo + vão embaixo — valor **centralizado** na célula
- [ ] Célula alta sem meta → número no centro com folga, OU re-semeada como célula baixa (não vão)
- [ ] `grid_h` de todo widget = footprint canônico do peso (sem altura legada órfã)
- [ ] **Zero reticência em número** — em nenhum valor, em nenhuma largura de célula
- [ ] Ticket/razão-moeda mostra `R$ 14,4 mil`, não `R$ 14.411` nem `R$ 14 ...`
- [ ] `formatCurrencyForWall` bate com §2.6b (≥10 mil, 1 decimal)
- [ ] Eyebrow de razão = nome humano (`Conversão`, `Ticket médio`), nunca id concatenado
- [ ] Nenhuma linha da grade vazia numa página publicada
- [ ] Fechamento enche o 12×6 — sem metade morta
- [ ] Verificado **na tela a ~3m / print 1920×1080**, não só em dado/lógica

## 7. Referências

- **Apple Keynote / Stripe big-stat** — número gigante centrado preenche a célula alta como sinalização premium (§1).
- **Placar de estádio / painel de aeroporto** — signage preenche o meio; espaço morto é sinal perdido (§4).
- **Widgets doc §2.6b** — regra de moeda compacta (≥10 mil, 1 decimal) que a `formatCurrencyForWall` tem que honrar (§3).
- **Revisão §2.4** — rótulo humano do motor (etapa/stream); a razão herda a mesma doutrina (§2).

## CONTEXT PACKET — CP-v4

**Mapa verificado**
- `WidgetFrame.tsx:84` — `truncate` no valor = reticência (`R$ 14 ...`). Remover; número nunca reticencia.
- `WidgetFrame.tsx:73,96` — valor no topo + `flex-1` só abaixo = vão. Centralizar vertical.
- `tv-metric-format.ts:24` — `formatCurrencyForWall` corta em 1.000/0-dec; diverge da §2.6b (10 mil/1-dec). Alinhar; razão-moeda tem que passar por ela.
- `typeScaleForWeight` (`tv-metric-format.ts:107`) — `clamp()` por viewport, não encolhe por conteúdo. Add fit-to-width até piso 36px (primário).
- `metric_catalog_ratios` (Forja semeou) — fonte do `label` humano das razões nomeadas (§2.1).

**Achados (novos, provados)**
- S1 no ar troca "branco com —" por "número + vão"; não é melhoria óbvia. 4 defeitos, todos de pixel (§0).
- Dívida "render de pixel não capturado" dos 2 PRs = exatamente a lacuna; QA visual a 3m/1920 é o aceite que faltou (§6).
- Progresso promovido do termômetro sem meta degrada a Número mas herda `grid_h` legado (3×4) → vão. Seed tem que casar grid_h↔peso (§1.3).

**Descartado**
- "altura acompanha OU conteúdo preenche": falso dilema — o **peso** reconcilia (footprint+escala+seed) (§1).
- "reticência resolve valor longo": proibido — compacto+encolher-até-piso, nunca reticência/quebra (§3).

**Aberto (decisão)**
- Split `format_id`→`value_format`+`widget_style` (Cais) — herdado do CP-v3, ainda aberto.
- Passo de preenchimento do grid: cresce footprint automático ou re-seed com mais/maiores widgets? (§4.3 — favoreço re-seed determinístico p/ a parede default; auto-grow p/ o Composer).
- ~~`metric_catalog_ratios.label` já existe como coluna?~~ **RESOLVIDO** (Forja): sim, migration `20260723100000:131/:208`, presets semeados com label. Falta só código: `buildEyebrow` puxar o label (nomeada) e compor com "por" (ad-hoc) — hoje concatena `/` ou id cru.

**Comandos que valem**
- Print alvo: `torquecrm.com.br/tv` (Fechamento) a 1920×1080 — o aceite é visual, não de dado.
- Base: `WidgetFrame.tsx`, `tv-metric-format.ts` (`formatCurrencyForWall`, `typeScaleForWeight`, `formatMetricValue`).
