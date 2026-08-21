# Revisão de spec — TV montável para o alvo VIVACIDADE (decisão CTO 2026-07-26)

> Épico **#1194** · revisa `design-tv-composable-widgets.md` (render) e `design-tv-composer-ui.md` (composição)
> Autor: Design (Vitral) · Status: **spec para fatiar** (não é código, não estima, não abre fatia)
> Gatilho: o CTO comparou a parede viva da Milennials com o mockup aprovado (artifact `ff96ec52` — "TV Comercial Torque · Monte sua TV") e decidiu que **o alvo do Composer é a vivacidade do mockup**, sabendo o custo sobre a §2.4 (cor semântica) e a §5.4 (badge LIVE morto).

---

## 0. O que muda e o que não muda

O delta medido foi **estrutural**: o mockup é um composer de ~12 estilos no look quente Torque; o ar é uma parede fixa de 4 formatos no `WidgetFrame` austero, sem editor. O CTO não quer o austero — quer a **identidade viva que ele já aprovou**.

Isto **não é um redesign meu.** O CTO já reprovou 3 mockups por "sem vida" ([[redesign-vs-elevate-existing]]). A referência viva é o `ff96`. Esta revisão **eleva** o que está construído até a vivacidade do mockup — parte do `ff96`, não de uma tese nova minha.

Duas coisas **não cedem**, e as duas eram acertos das specs originais:
1. **O `WidgetFrame` + a faixa de proveniência ficam** (§6 aqui). São a base; digo o que muda neles, não os jogo fora.
2. **Badge que mente continua morto** (§4 aqui). Vivacidade não compra desonestidade. O "ao vivo" vira um sinal honesto, atado ao instantâneo real.

---

## 1. Escolha × derivação — a decisão que destrava o Composer inteiro

> Foi ambiguidade desse tipo que travou o Forja no #1220. Resolvo aqui, sem deixar folga. [[fixed-threshold-vs-mechanism]] é a lente: derivação é o mecanismo; escolha é o override — não competem, se compõem.

### 1.1 A colisão real (e a colisão de nome que a esconde)

Hoje o tipo de gráfico **deriva** do recorte (`resolveChartType`, ratificado #1251): `total→número`, `tempo→linha`, `categórico→barra`. Não há coluna. Com o mockup, o cliente **escolhe** o estilo ("Receita como número / tendência / termômetro / gauge…"). Derivação e escolha colidem.

Pior: há uma **colisão de nome** que mascara a colisão de conceito. No código, `format_id` (`tv-metric-format.ts:8`) = **formatação de número** (`currency_brl`/`integer`/`percent_1`/…). No macro do Cais (§D), `format_id → metric_catalog_formats` = **formato visual** (os 7 shapes). Mesmo nome, dois conceitos. Se o Composer herdar essa ambiguidade, herda o travamento.

### 1.2 A resolução — três dimensões nomeadas, uma regra de precedência

O widget passa a carregar **três dimensões distintas**, com nomes que não colidem:

| Dimensão | Coluna proposta | O que é | Quem decide |
|---|---|---|---|
| **Estilo visual** | `widget_style` (novo, nullable) | número · barra · linha · donut · ranking · termômetro/gauge · funil | **cliente escolhe** na galeria; `null` → **derivado** |
| **Formatação de número** | `value_format` (= o `format_id` de hoje) | currency_brl · integer · percent_1 · duration_human · ratio_2 | **derivado** de `measure.unit`; override raro |
| **Cor de identidade** | `accent_hue` (novo, nullable) | qual hue quente do §2.5 o widget usa no canal gráfico | cliente escolhe; `null` → default por medida/posição (§3) |

**Regra de precedência, sem folga:** o renderer lê
```
estilo = widget_style ?? deriveStyle(measure, recorte)
```
`deriveStyle` é a `resolveChartType` de hoje, promovida a **default**. Explícito **sempre vence**; `null` cai na derivação. **A derivação não morre** — ela é o que faz "adicionar widget e já vir um widget bom" sem o cliente decidir nada. É o padrão Linear/Notion: default inteligente, controle total por cima.

**Restrição de compatibilidade (herda catálogo, macro §B):** a galeria só oferece estilos em `compatible_formats(measure)`. O default derivado é escolhido **dentro** desse conjunto pelo recorte. Estilo incompatível é **ausente** na galeria (composer §3.3), nunca erro. Assim `widget_style` nunca guarda um valor que o motor não sirva.

> **Sinalizo ao Cais, não implemento:** `value_format` e `widget_style` são hoje o mesmo nome (`format_id`) apontando para coisas diferentes. Têm que virar **duas colunas**. Não desenho o schema — mas a spec afirma que sem esse split o Composer nasce ambíguo.

### 1.3 O que isso mata no ar de hoje

`LineRenderer` e `DonutRenderer` **nunca renderizam em prod** (fato do Pauta: recortes usados = total/closer/etapa/origem/sdr → tudo número ou barra). Não é bug — é o sintoma do buraco: metade do #1251 está morta porque **derivação sem escolha** nunca chega em linha/donut. Com escolha na mesa, linha e donut passam a ser alcançáveis. A revisão **cura** o renderer morto, não o remove.

---

## 2. Vocabulário de formatos — 7 renderers cobrem os ~12 estilos do mockup

> O CTO pediu explícito: quais são formato de verdade e quais são variação de um formato — "não quero 12 renderers se 7 cobrem com parâmetro". Resposta: **7 formatos verdadeiros, o resto é parâmetro.** É a mesma contagem da §3.2 original — a riqueza do mockup entra como param, não como renderer novo.

Um **formato** = uma forma distinta de codificar o dado (uma engine de layout). Uma **variação** = o mesmo encoding com prop diferente. Referência: Apple Charts / Observable Plot — uma marca, muitos params; não uma classe por aparência.

### 2.1 Os 7 formatos verdadeiros

| # | Formato | Encoding | Params (as variações do mockup) | Base no código |
|---|---|---|---|---|
| 1 | **Número** | valor de cabeça, sem corpo | `trend` (rodapé sparkline da mesma medida no tempo) | `WidgetFrame` head (built) |
| 2 | **Linha** | série temporal | `variant: full \| spark` (spark = o mini de dentro do Número·trend) | `LineRenderer` (built, hoje morto) |
| 3 | **Barra** | categorias ordenadas, rótulo+valor no fim | `identity` (avatar/iniciais p/ pessoa §2.6c) · ordem vem do motor · maxN | `BarRenderer` (built) |
| 4 | **Ranking** | pessoas ordenadas c/ identidade | `layout: podium \| list` (layout=bars **delega à Barra**) | `TVRankingSimple` legado (pele) |
| 5 | **Progresso-para-meta** | valor ÷ alvo, com pace + delta | `gauge: tube(termômetro) \| bar(progresso) \| radial(velocímetro)` | `SalesThermometer` legado (pele) |
| 6 | **Donut** | composição ≥2 categorias, total no centro | maxN + "Outros" | `DonutRenderer` (built, hoje morto) |
| 7 | **Funil** | etapas + **taxa entre etapas** (intrínseca) | `shape: bars \| trapézio` · ordem de estágio (não valor-desc) | `SalesFunnel` legado (pele) |

### 2.2 Mapa dos ~12 estilos do mockup → formato · param

Isto é o que prova "7 cobrem 12":

| Estilo no mockup `ff96` | Formato · param |
|---|---|
| Número grande | Número |
| Com tendência (sparkline) | Número · `trend` |
| Velocímetro | Progresso · `gauge:radial` |
| Termômetro | Progresso · `gauge:tube` |
| Barra de progresso | Progresso · `gauge:bar` |
| Split Funil/Carteira | **Barra** · `recorte=stream` (2 cat + total no cabeçalho) — **não é formato**, é recorte |
| Pódio | Ranking · `layout:podium` |
| Lista ordenada | Ranking · `layout:list` |
| Barras (ranking) | **Barra** · `identity` |
| Barras por etapa (funil) | Funil · `shape:bars` |
| Funil trapézio | Funil · `shape:trapézio` |
| Conversão % "rosca" | **Progresso · `gauge:radial`** — ver nota |
| Donut de composição | Donut |

> **Correção consciente de um deslize do mockup:** o `ff96` mostra "Conversão 8,8%" como uma **rosca** (donut). Donut é composição de partes que somam um todo; um único percentual não é composição — é progresso de um valor contra 100%. Renderizar 8,8% como rosca ensina que os 91,2% restantes são "outra categoria", o que é falso. **Conversão isolada = Progresso·radial**, não donut. Elevo o mockup aqui: mantenho o anel (a forma que o CTO gostou), corrijo a semântica (é gauge, não composição). Donut fica para quando há categorias de verdade (origem, produto).

### 2.3 O que fica fora do vocabulário de widget único (e por quê)

O mockup tem **composições multi-medida**: a tabela de Closers (nome + vendas + ticket + %) e os 3 cards de Pré-vendas (marcadas/compareceu/no-show, cada um com breakdown por vendedor). **Composable v1 é uma medida por widget** (macro). Uma tabela de 3 medidas não cabe no contrato.

Não force isso em Barra/Ranking. São **compositos multi-medida** — ou entram como `legacy:*` pinados (§5), ou viram fatia v2 de "widget composto". Registro como limite, não como buraco a tapar na marra.

### 2.4 Rótulo de categoria — nome humano, não chave de sistema (e o caso das 36 etapas)

> Verdade de prod (Bancada): o widget `leads_na_etapa · etapa` da Milennials tem **36 categorias**, e o `BarRenderer` corta em 4+Outros (a regra §3.1 funciona) — **mas rotula com a stage-key crua** (`novo`, `p_funil`, `compareceu`). Chave de sistema numa parede a 3m é ruído: o time comercial não lê `p_funil`.

Duas correções, ambas de dado servido pelo motor, não de pixel:

1. **O rótulo da série é o nome de exibição da categoria, nunca a chave.** `etapa` → nome da etapa (`Compareceu`), não `compareceu`; `stream` → `Carteira`, não `carteira`; `origem` → `Meta Ads`, não `meta_ads`. O motor devolve `{key, label, value}` (macro §C) — o renderer usa `label`, e o `label` tem que vir **humano** do motor. Rótulo cru na série = **erro no motor** (mesma doutrina da âncora, §4 original: semântica mora onde o dado mora).
2. **`recorte = etapa` sem escopo de pipeline é semanticamente turvo.** 36 etapas somando leads de pipelines diferentes não é um funil — é uma pilha de estágios de funis que não se comparam. `leads_na_etapa · etapa` só significa algo **filtrado por um pipeline** (aí é o Funil, §2.1 #7, com ordem de estágio). Sem filtro, o widget honesto é `leads_na_etapa · total` (o 2151 que a parede também tem). **Recomendo:** a galeria, ao oferecer `etapa`, exige/sugere um filtro de pipeline; sem ele, degrada para `total`. Decisão de produto — sinalizo, não imponho.

---

## 3. Cor — dois canais, nunca cruzados

> O CTO devolveu a cor quente por widget à mesa, mas a §2.4 não morreu à toa: exige que eu diga **como** cor decorativa convive com legibilidade a 3m e com estado (bom/ruim/alerta) sem virar arco-íris sem significado. Se os dois competem pelo mesmo canal, resolvo aqui — não empurro pro Forja.

### 3.1 O diagnóstico: o mockup colore o canal errado

O `ff96` pinta os **números** de azul/verde/vermelho/roxo/ciano (as KPI tiles: Reuniões azul, Ticket roxo, Leads ciano). Dois problemas: (a) número pequeno colorido **morre a 3m** — cor em texto pequeno é o que a distância mais penaliza; (b) o número é onde o **estado** vive (delta verde/vermelho), então um número azul-decorativo colide com o verde-de-alta. Um canal, dois significados brigando.

### 3.2 A regra que resolve — separar VALOR de GRÁFICO

**Dois canais de cor, e eles nunca se cruzam:**

1. **Canal do VALOR + DELTA — semântico, reservado, honesto.**
   - O número de cabeça é **neutro** (`--foreground` creme) ou **gold** (`--primary`) quando é *o* número que importa (hero, máx 1–2/página).
   - O delta é **estado**: `--success` (+), `--destructive` (−), `--warning` (alerta).
   - **O número NUNCA recebe hue decorativo.** É o canal onde o estado tem que ser inequívoco.

2. **Canal do GRÁFICO + ACENTO — quente, identitário, decorativo.**
   - A cor quente por widget vive na **geometria**: preenchimento de barra, arco do donut, segmento do funil, anel do pódio, tubo do termômetro, traço da linha.
   - Para o widget **sem** gráfico (um Número puro), a identidade vai num **acento fino**: um filete no topo do card (1–2px) ou um tick antes do eyebrow, no hue do widget. É assim que a KPI tile fica "a tile azul de Leads" **sem colorir o número** — a cor migra pro filete, que lê a 3m e não briga com estado.

**A paleta decorativa já existe — reuso, não invento.** É a §2.5: `--chart-1..5` (categórico quente: gold/azure/violeta/âmbar-laranja/teal) e `--metric-ramp-1..5` (ordinal mono-gold). Elas **já excluem** os hues de estado (evitam 142° success e 0° destructive, §2.5). Então o canal gráfico é quente e distinto do canal de estado por construção. `accent_hue` (§1.2) escolhe qual entrada da paleta o widget usa.

### 3.3 O que isso preserva da §2.4 e o que revoga

- **Preserva:** hierarquia por valor. Gold ainda é "o número que importa agora", máx 1–2 por página, **no canal do valor**. Muitos gráficos quentes numa página **não** violam isso, porque a hierarquia mora nos números (gold vs creme), não nos gráficos.
- **Revoga:** a frase da §2.4 "a maioria dos números na tela é branco-creme, cor decorativa é proibida". Cor decorativa volta — **no canal gráfico**. A §2.4 estava certa sobre o *número*; estava larga demais ao proibir cor em *tudo*.
- **Mantém morto:** o `colorMap` de 6 cores do `KPICard` que pintava o **valor** (reuniões azul, no-show vermelho). Aquilo colidia valor com estado — exatamente o que a regra de 2 canais proíbe. A cor daquelas tiles vai pro filete de acento, não volta pro número.

### 3.4 Funil — ordinal quente, não arco-íris

O `ff96` pinta as etapas do funil azul→ciano→âmbar→vermelho→verde. O vermelho e o verde ali são **decorativos** mas colidem com estado (vermelho=ruim, verde=bom), e a etapa "Vendido" ficar verde ensina que vender é "estado bom" por cor, não por posição. Funil é **ordinal** (etapas têm ordem) → usa a **rampa ordinal** `--metric-ramp-*` (§2.5): intensidade decrescente mono-gold/âmbar. Quente, legível como "afunila", e sem sequestrar o vermelho/verde de estado. Elevo a energia do mockup, corto o arco-íris que mente.

### 3.5 Legibilidade a 3m — a regra de uma linha

**Cor em geometria, texto em alto contraste.** Barra colorida lê a 3m; rótulo colorido pequeno não. Todo texto (número, rótulo, proveniência) fica em creme/gold/estado de alto contraste; o hue decorativo só toca formas grandes e filetes. Referência: **Apple Health / Apple Watch** — anéis e barras coloridíssimos, numerais sempre neutros; **Stripe** — o gráfico colore, a tabela de números fica neutra.

---

## 4. "Ao vivo" honesto — o batimento, não o piscar

> A linha que não cede: badge que mente continua morto. O CTO topou: se quer sinal de "ao vivo", que ele **só acenda quando o dado realmente acabou de chegar** — atado ao instantâneo, não a um `setInterval`. Vivo e honesto, ou não vai.

Mata-se o `.tv-live-badge` (vermelho, pulsante, **estático** — piscava "AO VIVO" sem relação com fetch nenhum). No lugar, **um batimento real**:

- **Indicador único no header do painel** (não por widget), dirigido pelo **timestamp de chegada do snapshot**.
- No **momento** em que um novo `fn_dashboard_snapshot` chega com sucesso, um **pulso único de 400ms** (`--tv-dur-slow`, `--tv-ease-out`) num ponto gold — **um batimento por refresh real**. Entre fetches, o ponto fica **estático** (não pisca). O pulso **é** o dado chegando; não há loop.
- Texto ao lado: `atualizado agora` no fetch → degrada para `atualizado 14:32` → após 3 falhas, `dados de 14:32` em `--warning` (mantém §5.4b do stale, só troca o mecanismo do "vivo").
- `prefers-reduced-motion`: **sem pulso** — só o timestamp atualiza. O sinal honesto não depende de movimento.

Assim o "LIVE" do mockup existe, mas **ganho**: pisca uma vez, quando é verdade. Referência: **Vercel / Linear** — o ponto de status pulsa num evento real (deploy, sync), fica quieto no resto. Não é enfeite periódico.

---

## 5. Os `legacy:*` embutidos — triagem, não ponte permanente

> Fato novo (Bancada): a parede montável já embute **4 widgets `legacy:*`** (`legacy:thermometer`, `legacy:closer-performance`), `pinned`, repetidos nas 2 páginas, via `renderer_id: legacy:*`. A ponte de legado **já vive dentro do composable** — não só no caminho flag-OFF. Isso muda o cutover: não é flip de flag, é **promoção por widget** conforme o vocabulário cresce.

### 5.0 O estado real hoje é pior que "austero" — são 4 células VAZIAS

> Verdade de prod (Bancada, MCP read-only, sem impersonation): a parede da Milennias é a **semeadura padrão do #1207, nunca customizada** (17 widgets = o template). Os 13 composable renderizam head certo (`headValueFromMeasure`, `tv-series.ts:36`). Mas **os 4 `legacy:*` pinned renderizam frame + head `—` e SEM corpo** — o corpo legado (termômetro, pódio-closer) é a **#1219, não construída**. Então **4 células aparecem literalmente em branco na TV real.**

Isto reenquadra a triagem: o `legacy:*` não é "uma ponte que funciona e a gente promove com calma". É uma **ponte pela metade** — semeia o widget mas não tem renderer de corpo. Na parede, isso é pior que austero: é 4 buracos de `—` sem explicação, e é parte concreta do "na TV está OUTRO" do CTO.

> **Regra dura, nova: célula pinada em branco não sobe.** Nenhum `legacy:*` fica no ar renderizando `—` sem corpo. Ou ganha corpo nativo (promoção, abaixo), ou é substituído por um widget nativo equivalente, ou sai da semeadura. O que não pode é continuar branco.

Regra geral: **um `legacy:*` é uma ponte, não um formato.** A triagem é por uma pergunta só — *o vocabulário novo (§2) expressa isto?*

| Legacy embutido | O vocabulário novo expressa? | Destino |
|---|---|---|
| `legacy:thermometer` | **Sim** — Progresso·`gauge:tube` (§2.1 #5) | **Promove a primeira classe.** Migra o seed para o formato nativo; aposenta a ponte. Vira componível (cliente troca tube/bar/radial). |
| `legacy:closer-performance` | **Depende** — se for ranking de closers por 1 medida, **sim** (Ranking·podium, §2.1 #4); se for tabela multi-medida (vendas+ticket+%), **não** | Se 1 medida → **promove a Ranking nativo** (a parede já tem `receita/closer` em barra — vira pódio, e a célula legada some por redundância). Se multi-medida → corpo composto é a #1219/v2; **enquanto não existe, não semeia em branco** (regra 5.0). |

**Como o `legacy:closer-performance` se comporta no Composer:**
- Renderiza **dentro do `WidgetFrame`** (moldura + proveniência o envolvem — §8.4.2 original: legado dentro do frame lê como parte do sistema).
- É `pinned` e **não abre a galeria de estilos** — não há estilo para escolher, é um composto fixo.
- No Composer aparece com um marcador de bloqueio honesto: **`widget avançado · ainda não editável`** (não "erro", não some). O cliente entende que existe e que não se mexe nele ainda.
- **O Composer nunca deixa CRIAR um `legacy:*`.** Só herda os semeados. Widget novo é sempre formato nativo (§2).

Isso resolve o cutover que a Bancada apontou: a migração é **incremental por widget**, guiada pela pergunta acima, não um big-bang de flag.

---

## 6. O que muda no `WidgetFrame` e na proveniência (a base fica)

O `WidgetFrame` construído (`WidgetFrame.tsx`) e a `ProvenanceLine` **ficam**. Mudanças cirúrgicas:

1. **Canal de acento (novo):** o frame aceita `accentHue` e o expõe como (a) filete de 1–2px no topo do card e/ou (b) tick antes do eyebrow. Default `null` → sem filete (o widget hero gold não precisa). **O head value não muda de cor** — continua `--foreground`/`--primary` via a lógica atual. Só entra um canal novo, o número fica intocado.
2. **`children` recebe os 3 formatos novos:** `TVWidgetBody` ganha `ranking`, `progresso`, `funil` além de `bar`/`line`/`donut`. O `switch` cresce; a casca não.
3. **Estado `legacy-locked` (novo):** para o `legacy:closer-performance` — frame normal + marcador `widget avançado · ainda não editável`. Reusa o padrão do estado de erro (frame permanece, §5.3), com tom neutro, não destrutivo.
4. **Proveniência:** **inalterada.** Continua sendo a âncora de honestidade. O "ao vivo" (§4) **não** entra na proveniência — proveniência é *escopo do dado* (base/período/recorte), não *frescor*. Frescor vive no header do painel. Mantê-los separados é o que impede a faixa de virar lixeira de status.
5. **Loading/empty/erro (§5.1–5.4b originais):** inalterados. Nunca `0` no load, `—` na ausência, frame não some no erro, `nenhum cliente recomprou` no estruturalmente-vazio. A vivacidade não toca nisso — são honestidade, não austeridade.

---

## 7. Seções superseded (o que ler como atual)

| Doc · seção | Status | Substituída por |
|---|---|---|
| `design-tv-composable-widgets.md` §2.4 (cor: só gold+neutro, decorativa proibida) | **AMENDADA** | §3 aqui (2 canais; decorativa volta no gráfico) |
| `design-tv-composable-widgets.md` §5.4 (badge morto, sem substituto vivo) | **AMENDADA** | §4 aqui (batimento honesto atado ao snapshot) |
| `design-tv-composable-widgets.md` §3.2 (7 formatos, funil/ranking distintos) | **CONFIRMADA + expandida** | §2 aqui (7 formatos + mapa dos params do mockup) |
| `design-tv-composer-ui.md` §3–§5 (fluxo de montagem, escolha de formato) | **CONFIRMADA + resolvida** | §1 aqui (escolha×derivação; galeria de estilo = mockup) |
| `design-tv-composer-ui.md` (não tratava `legacy:*`) | **ADICIONA** | §5 aqui (triagem da ponte) |
| §2.5 (rampas de cor), §2.6c (identidade de pessoa), §4 (proveniência), §5.1–5.3, §5.4b | **inalteradas** | — |

Tudo que não está na tabela **permanece como escrito.** Não reabri o que estava certo.

---

## 8. Aceite (checklist pro QA visual)

- [ ] Número de cabeça **nunca** tem hue decorativo — só creme/gold; delta só estado
- [ ] Cor quente aparece na **geometria** (barra/arco/anel/tubo/traço) e em **filete/tick** de acento
- [ ] KPI tile "de Leads" é azul **no filete**, número creme — não o número azul
- [ ] Funil usa rampa **ordinal** quente, não arco-íris com vermelho/verde de etapa
- [ ] `widget_style` explícito vence; `null` cai na derivação `#1251` — renderer sem ambiguidade
- [ ] Galeria só oferece estilo **compatível** com a medida (incompatível ausente, não erro)
- [ ] "Ao vivo" pulsa **uma vez por snapshot real**; estático entre fetches; sem pulso em reduced-motion
- [ ] `legacy:thermometer` migrado para Progresso nativo; `legacy:closer-performance` pinado, emoldurado, `ainda não editável`
- [ ] Composer não deixa criar `legacy:*`
- [ ] `WidgetFrame` + proveniência intactos exceto acento + 3 formatos + estado legacy-locked
- [ ] Nenhum token de cor novo — reusa §2.5 (`--chart-*`, `--metric-ramp-*`) + `.dark`/`[data-surface=tv]`
- [ ] Load nunca mostra `0`; ausência é `—`; frame não some no erro (§5 originais intactos)

## 9. Referências

- **Artifact `ff96` (mockup aprovado pelo CTO)** — a identidade viva a elevar: pódio com degraus, termômetro, cor quente, energia "ao vivo". Parti dele.
- **Apple Health / Apple Watch** — anéis e barras coloridíssimos, numerais sempre neutros. Base do canal de 2 cores (§3).
- **Stripe Dashboard** — o gráfico colore, a coluna de números fica neutra; delta colado ao número (§3, §6).
- **Vercel / Linear** — ponto de status pulsa num evento real, quieto no resto. Base do batimento honesto (§4).
- **Apple Charts / Observable Plot** — uma marca, muitos params, não uma classe por aparência. Base de "7 formatos, resto é param" (§2).
- **Linear / Notion** — default inteligente + override total. Base do escolha×derivação (§1).

## CONTEXT PACKET — CP-v3

**Mapa verificado**
- `tv-metric-format.ts:8` — `format_id` no código = formatação de NÚMERO (`currency_brl/integer/percent_1/duration_human/ratio_2`), **não** formato visual.
- macro §D — `format_id → metric_catalog_formats` = formato VISUAL. **Colisão de nome com o de cima** → precisa virar 2 colunas (`value_format` + `widget_style`).
- `tv-chart-type.ts:31` — `resolveChartType(recorte, explicit)`: explicit já vence; vira `deriveStyle` (default) na §1.2. Sem retrabalho.
- `WidgetFrame.tsx` / `ProvenanceLine` — base intacta; mudam só acento + 3 formatos + estado legacy-locked (§6).
- §2.5 (`--chart-1..5`, `--metric-ramp-1..5`) — paleta quente que já exclui hues de estado = o canal gráfico do §3. Reuso, não invento.
- Formatos legado como pele: `SalesThermometer`→Progresso, `SalesFunnel`→Funil, `TVRankingSimple`→Ranking (§2.1).

**Achados (novos, provados)**
- Parede Milennials PROD = semeadura padrão #1207, **nunca customizada** (17 widgets = template; Bancada via MCP). Confirma imutabilidade no nível de dados.
- **4 células `legacy:*` renderizam em BRANCO hoje** (frame + `—`, sem corpo — #1219 não construída, `tv-series.ts:36`). No ar = number/ratio/barra + 4 placeholders vazios; zero funil/pódio/gauge/termômetro-com-conteúdo (§5.0). Endurece o veredito estrutural.
- `LineRenderer`/`DonutRenderer` nunca renderizam em prod (recortes = total/closer/etapa/origem/sdr) — morte por *derivação-sem-escolha*; a §1 cura.
- `leads_na_etapa·etapa` = **36 categorias, rótulo = stage-key cru** (`novo`/`p_funil`/`compareceu`); cap 4+Outros funciona, label não (§2.4). Recorte etapa sem pipeline é turvo.
- Ponte `legacy:*` vive DENTRO do composable (4 widgets pinned, 2 páginas) — cutover é promoção por-widget, não flip de flag (§5).
- Mockup `ff96` colore o VALOR (morre a 3m + colide com estado) — corrigido movendo cor pro canal gráfico/acento (§3.1–3.2).
- Mockup mostra "Conversão" como donut (semanticamente errado — é gauge) — corrigido em §2.2.

**Descartado**
- "12 renderers para 12 estilos": falso — 7 formatos + params cobrem (§2.2).
- "cor decorativa vs §2.4 é escolher um": falso — são 2 canais, coexistem (§3.2).
- "vivacidade exige o badge piscante": falso — batimento por-snapshot é vivo E honesto (§4).

**Aberto**
- Split de `format_id` em `value_format` + `widget_style` — **decisão de schema do Cais** (design afirma que sem isso o Composer nasce ambíguo).
- `accent_hue`: default por medida ou por posição? (favoreço por medida — estável entre páginas).
- Compositos multi-medida (closers table, pré-vendas cards): `legacy:*` pinado no v1 ou fatia v2 de widget composto? — decisão de escopo do Cais.
- Screenshot vivo da Milennials (Bancada, bloqueada em auth prod) — fecha só os itens de acabamento, não muda esta revisão.

**Comandos que valem**
- Rota `/tv` → `TVDashboardRouter` (`TVDashboard.tsx:53`); switch = `useComposableDashboard.ts:20` (`organizations.composable_metrics_enabled`).
- Derivação de estilo: `resolveChartType` (`tv-chart-type.ts:31`).
- Paleta do canal gráfico: `--chart-*` / `--metric-ramp-*` em `[data-surface="tv"]` (widgets doc §2.5).
