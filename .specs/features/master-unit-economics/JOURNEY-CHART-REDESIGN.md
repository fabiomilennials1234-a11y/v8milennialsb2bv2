# DESIGN SPEC — ⭐ Jornada de Unit Economics · `/insights`

> **SUBSTITUI** o §10 do `DESIGN.md` (a `JCurveChart` de payback). O gráfico-estrela deixa de ser uma curva J única (caixa descontado × tempo) e passa a ser uma **linha do tempo canônica de unit economics** — a MESMA forma narrativa para todas as orgs, com um **marcador que desliza** mostrando onde a org está, e os **valores escalando pelos dados reais**.
>
> Tudo o mais do `DESIGN.md` permanece: token `--insights` (azul 205 90% 40/60%), dark-first, gold accent ausente neste card, Inter + Space Grotesk (`font-display`), framer-motion, currency pt-BR, `tabular-nums`. Esta spec é coerente com aquela linguagem; só troca a estrela.
>
> Referências citadas: **Stripe** (dual-axis financeiro honesto, dashes p/ série de unidade diferente), **Linear** (tint só no chrome, área de dados limpa, dark mastery), **Vercel** (whitespace + baseline como espinha), **Apple** (reveal coreografado, marcador-pin com física de "assentar"), **Airbnb** (narrativa emocional — "você está NESTE ponto da jornada").

---

## 0. Por que mudar (intenção)

A curva J atual responde "quando o caixa volta". A nova estrela responde **"onde esta org está na jornada de unit economics, e o que vem a seguir"** — investimento, ROI e caixa numa só linha do tempo, com fases fixas (mesma história pra todos) e um marcador que materializa o presente da org. É uma peça de **palco**: o master desliza o dedo da esquerda (prejuízo) até o marcador e diz "você está aqui, e o verde está logo ali".

A forma é **canônica e fixa**; só a **escala** (R$ do eixo, profundidade do caixa, altura do investimento, posição do marcador) vem do dado. Toda org reconhece a mesma narrativa — isso é o que a torna *deste produto* e não de um dashboard genérico.

---

## 1. Shell do card

Full-width `col-span-12`. Card `rounded-2xl border border-border bg-card p-6 md:p-8`. Plot `h-[420px] md:h-[480px]` (mobile `h-[340px]`). **SVG bespoke + framer-motion** (não recharts — controle total do draw, do marcador e do dual-axis com zero compartilhado). Reaproveita o gerador `monotoneCubicPath` já existente em `lib/jcurve-geometry.ts` (renomeado/estendido — §11).

**Header do card** (linha `flex items-baseline justify-between`):
- Esquerda: eyebrow `text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground` → "LINHA DO TEMPO" · título `font-display text-[17px] md:text-lg tracking-[-0.02em] text-foreground` → **"Jornada de unit economics"** · sub `text-[13px] text-muted-foreground` → "Investimento, ROI e caixa ao longo do tempo — e o momento desta organização."
- Direita: **Legenda compacta** (§8).

**Footer do card** (abaixo do plot, `mt-3`): faixa de **rótulos de fase** (§4, parte textual) — 4 chips alinhados às bandas.

---

## 2. As 3 linhas — tratamento (anti-spaghetti)

Princípio anti-spaghetti (Linear/Stripe): **uma só linha carrega fill, uma só é tracejada, uma hierarquia de tinta clara.** O olho ancora instantaneamente no protagonista; as outras duas têm texturas distintas que nunca se confundem.

| Linha | Papel | Cor (HSL token) | Espessura | Estilo | Fill |
|---|---|---|---|---|---|
| **Caixa acumulado** | 🥇 **Protagonista** | `--insights` (205 90% 60% dark / 40% light) | `2.75` | sólida, `linecap round` | **sim** — área `hsl(var(--insights)/0.16) → 0` (gradiente vertical, ancorado no baseline zero) |
| **Investimento em tráfego** | apoio | `--warning` (38 92% 55% dark) | `2` | sólida, `opacity 0.9` | não |
| **ROI** | linha-significado | split: `--success` (142 70% 45%) acima do zero / `--destructive` (0 62% 50%) abaixo | `2` | **tracejada** `stroke-dasharray "5 4"` | não |

**Por que essa divisão funciona:**
- **Caixa = azure sólido + fill.** É a única linha com área preenchida → vira o anchor visual imediato. É o herói que mergulha (o J) e sobe. Stroke `--insights` — a assinatura da área. O fill é sutil (0.16) pra não virar "montanha"; é só um halo de pertencimento que diz "esta é a linha principal".
- **Investimento = âmbar sólido, sem fill, opacity 0.9.** Lê como "combustível saindo". Sobe de forma quase monotônica (degraus nos ciclos) → vive na metade superior enquanto o caixa mergulha embaixo; as formas se separam naturalmente. Âmbar 38° é bem distante do azure 205° — zero ambiguidade. (O gold da marca 47° **não aparece neste card**, então âmbar não compete com nada.)
- **ROI = tracejada, split verde/vermelho no zero, sem fill.** O tracejado comunica "métrica de unidade diferente / eixo secundário" — convenção honesta do Stripe pra séries em eixo duplo. O split de cor no baseline é *justificado pela definição da métrica* (ROI<0 = perde, ROI>0 = ganha) e é o único split de cor do gráfico (o caixa é mono-azure) → não há confusão: **só o ROI muda de cor, e essa mudança É a história do ROI.** Reusa exatamente a técnica de `<linearGradient userSpaceOnUse>` partido no `zeroY` que a JCurve atual já implementa.

**Z-order de desenho (de trás pra frente):** bandas de fase → baseline zero → fill do caixa → linha investimento → linha ROI (tracejada) → linha caixa (protagonista por cima) → marcador → crosshair/hover.

**Realce no hover da legenda (anti-spaghetti ativo):** passar o mouse num item da legenda eleva aquela linha (opacity 1, +0.5 stroke) e esmaece as outras duas pra `opacity 0.25`, 150ms `ease-out`. Solta → volta. Dá controle ao apresentador quando quiser isolar uma narrativa ("olha só o caixa").

---

## 3. Eixos Y — **dual-axis com zero compartilhado**

**Decisão:** dois eixos Y, **zeros alinhados no mesmo pixel** (uma única régua horizontal de equilíbrio).
- **Eixo esquerdo = R$** → serve **Caixa acumulado** e **Investimento** (ambos em reais, diretamente comparáveis).
- **Eixo direito = ROI** (múltiplo/percentual) → serve só o ROI.
- **Os dois zeros caem na MESMA linha horizontal** (`zeroY`), rotulada `R$ 0 · ROI 0` — a **espinha** do gráfico.

**Justificativa (legibilidade > precisão):**
1. **Duas linhas em R$ no mesmo eixo é honesto e poderoso numa reunião:** o cliente vê "o que entrou de investimento" e "o que sobrou de caixa" nas mesmas unidades de dinheiro, na mesma régua.
2. **ROI é adimensional.** Forçá-lo no eixo de R$ o tornaria um fio invisível colado no zero, ou exigiria escala falsa. Eixo direito dedicado resolve.
3. **Zero compartilhado mata a "mentira do dual-axis".** O truque clássico de eixo duplo é deslizar os zeros pra enganar; aqui fazemos o oposto — **fixamos os dois zeros na mesma régua de propósito**, porque a narrativa quer que *break-even seja UM momento*: caixa cruza R$ 0 e ROI cruza 0 no mesmo instante visual (meses 4-5). A régua de equilíbrio é literalmente onde a história vira.

**Escala de cada eixo:**
- **Esquerdo (R$):** domínio `[min(caixa, 0) − folga, max(investimento, caixa) + folga]`, folga 8%. Inclui sempre o zero. Ticks R$ `tabular-nums` (3-4 níveis), `text-[10px] text-muted-foreground`, à esquerda do plot.
- **Direito (ROI):** zero pinado na régua compartilhada; extensões positiva e negativa escaladas **independentes** pra ROI ocupar bem o espaço vertical sem invadir as outras linhas (pico ROI ≈ 82% da altura acima do baseline; vale ≈ casado abaixo). Ticks ROI à direita, `text-[10px]`, cor `--success`/`--destructive` conforme sinal (ou neutro `text-muted-foreground` com sinal textual). **Formato recomendado: percentual** ("−100 %", "0", "+150 %", "+260 %") — mais punchy no palco que "×". *(A unidade exata é decisão da calc lib; o design pede que seja legível e centrada no 0.)*
- **Acima da régua = região de lucro/ROI+** (clima esverdeado das bandas); **abaixo = prejuízo/ROI−** (clima avermelhado). A régua de equilíbrio é tracejada `border` `4 4`, com os dois rótulos nas pontas (R$ à esq., ROI à dir.).

---

## 4. Faixas de fase (4 bandas verticais)

Fundo do plot dividido em 4 bandas proporcionais aos meses. **Tint só no "céu"** (Linear/Vercel): cada banda é um **gradiente vertical do topo** (cor/0.07 no topo → transparente em ~45% da altura), não um preenchimento chapado — assim a área onde as linhas vivem fica limpa, e a narrativa de fase mora no chrome superior. Divisores verticais finos `border-border/30` entre bandas. Rótulo no **topo** de cada banda (chip de fase) + repetido no footer textual.

| Fase | Meses | Tom (HSL) | Rótulo (chip topo) | Cor do rótulo |
|---|---|---|---|---|
| **Prejuízo** | 1–3 | `hsl(var(--destructive)/0.07)` → 0 | "Prejuízo" | `text-destructive/70` |
| **Break-even** | 4–5 | `hsl(var(--foreground)/0.045)` → 0 (neutro-quente) | "Break-even" | `text-muted-foreground` |
| **Ganho de margem** | 6–12 | `hsl(var(--success)/0.07)` → 0 | "Ganho de margem" | `text-success/70` |
| **Alavancagem** | 12–18 | `hsl(var(--success)/0.10)` → 0 (verde um tom mais forte) | "Alavancagem · ciclos" | `text-success/80` |

**Notas:**
- O **break-even é neutro** de propósito (não âmbar) — âmbar colidiria com a linha de investimento. Lê como o pivô calmo entre o vermelho e o verde.
- A **Alavancagem** ganha verde um tom acima + (opcional, sutil) um motivo de "onda" `opacity-[0.04]` repetido, sinalizando "zona dos ciclos". Não usar azure aqui (colidiria com a linha caixa).
- Rótulos de fase: `text-[10px] font-semibold uppercase tracking-[0.08em]`, ancorados no topo da banda com `mt-1`, alinhamento à esquerda da banda (`ml-2`). Em mobile, mostrar só as iniciais/abreviações ("Prej." / "B-E" / "Margem" / "Alav.") ou só os 2 extremos.
- As bandas nunca competem com as linhas: opacity ≤ 0.10 no pico do gradiente, sumindo antes da metade vertical.

---

## 5. ⭐ Marcador "Você está aqui" (o encantamento)

O coração da peça. Materializa o presente da org.

**Posição:** mês derivado do **CAC atual vs bandas** (a calc lib calcula `markerMes`):
- CAC atual **> máximo** → meses 1–3 (zona prejuízo)
- CAC atual **≈ máximo** → 4–5 (break-even)
- CAC atual **entre máximo e mínimo** → 6–12, **proporcional** (`frac = (máx − cac)/(máx − mín)`, mês = 6 + frac·6)
- CAC atual **≤ mínimo** → mês 12
- *Ex. Milennials: CAC 3.421 (máx 5.154, mín 1.288) → ~mês 8 → cai na banda "Ganho de margem".*

**Anatomia visual:**
1. **Linha vertical** no `markerMes`, do topo ao fundo do plot. `stroke hsl(var(--insights))` `width 2`, com brilho sutil `drop-shadow(0 0 6px hsl(var(--insights)/0.45))`. Não tracejada (o crosshair de hover é que é tracejado — distingue "fixo/seu" de "explorando").
2. **Pino/flâmula no topo:** chip `bg-insights text-insights-foreground rounded-full px-2.5 py-1 shadow-sm`, `text-[11px] font-semibold`, com um pequeno triângulo apontando pra baixo (pin de mapa). Texto: **"Você está aqui"** em uma linha, e abaixo (ou ao lado, `text-insights-foreground/80`) a fase + mês: **"Ganho de margem · mês 8"**. Em telas estreitas, só "Você está aqui".
3. **Dot protagonista:** onde a vertical cruza a **linha caixa**, um ring-dot grande `r 6.5` — `fill hsl(var(--card))`, `stroke hsl(var(--insights)) width 2.5` — com **halo pulsante** `box-shadow`/`circle` externo respirando `0.45→0` opacity, 2.4s ease-in-out (igual `cmd-livepulse`, mas em azure). Diz "sua posição de caixa AGORA é aqui".
4. **Ticks secundários (sutis):** onde a vertical cruza ROI e investimento, dots pequenos `r 3` na cor de cada linha, `opacity 0.8`, sem halo. Reforçam "neste mês, suas 3 métricas estão nestes pontos" sem poluir. (O detalhe numérico vem no tooltip do marcador.)

**Estado de hover do marcador:** passar o mouse sobre a linha/pino → halo intensifica, e sobe um **tooltip rico** (variante do §7) com header "Você está aqui · {fase}", os 3 valores no `markerMes`, e uma linha-explicação derivada do CAC: *"CAC atual R$ 3.421 está entre o ideal e o máximo — sua aquisição já é saudável e melhorando."* (microcopy condicional à zona — §9). Cursor `pointer` na faixa de hit do marcador.

**Sensação de "você está NESTE ponto":** o pino é a única coisa azure-sólida-cheia do gráfico (linhas são stroke; bandas são tint). Ele "pesa" mais que tudo → o olho vai direto. O halo respirando dá vida. É um pin de mapa numa trilha.

---

## 6. Animação de entrada (cinematográfica)

`useInView({ once: true, amount: 0.3 })`. Coreografia em camadas (Apple: cada beat tem propósito; nada entra junto):

1. **Bandas de fase** fade-in L→R, stagger 70ms cada, 300ms total. `opacity 0→1` + rótulo de fase desce `y 6→0`. Monta o palco.
2. **Régua de equilíbrio** (zero compartilhado) faz wipe L→R, 300→520ms, `ease-out`. A espinha aparece.
3. **Draw-on das 3 linhas** via **clip-reveal** (retângulo `width 0→full`, esquerda→direita) — uma máscara por linha, **não** `pathLength` (porque o ROI é tracejado e `pathLength` conflita com `stroke-dasharray`; clip-reveal preserva os dashes e unifica o "desenhar" das 3). Stagger:
   - **Caixa** (protagonista) começa primeiro: 520ms, dur **1500ms**, `cubic-bezier(.4,0,.2,1)`. O **fill** do caixa revela com o mesmo clip.
   - **Investimento** +150ms.
   - **ROI** +300ms.
   (O olho vê o herói nascer primeiro, depois o contexto.)
4. **Dots de cruzamento de fase** (opcional, sutil): quando o caixa cruza o zero no draw, um micro-flash no ponto de break-even — `scale 0→1` overshoot `cubic-bezier(.175,.885,.32,1.275)`, sincronizado ao avanço do clip.
5. **Marcador desliza** POR ÚLTIMO (após as linhas assentarem, ~+1600ms): a linha vertical + pino entram a partir da **borda esquerda** (`x = plotLeft`) e **deslizam até o `markerMes`**, `spring { stiffness 90, damping 16 }` (assenta com micro-overshoot — física de pin caindo no lugar). Ao parar: dot protagonista `scale 0→1` overshoot + **halo bloom** (um anel que expande e some, 600ms), e o texto do pino faz `fade + y 4→0`.
6. **Ticks dos eixos + legenda** fade-in 200ms durante o passo 5.

**`prefers-reduced-motion`:** estado final imediato — bandas visíveis, linhas cheias (clip `width=full`), marcador já no `markerMes`, dot presente, **sem** wipe/slide/halo-pulse/bloom. (Espelha o tratamento da JCurve atual e do `index.css`.)

---

## 7. Tooltip / hover (crosshair)

**Crosshair:** vertical tracejada `stroke hsl(var(--insights)/0.4)` `4 4`, segue o ponteiro e **snapa no mês mais próximo**. Nos 3 cruzamentos com as linhas, aparecem 3 dots `r 4` (cada um na cor da sua linha). (O tracejado distingue do marcador fixo, que é sólido.)

**Card do tooltip:** `bg-popover/95 backdrop-blur border border-border rounded-xl shadow-lg px-3 py-2.5`, segue o crosshair, **flip de lado** perto da borda direita, `-translate-y-full` acima do ponto mais alto. `role="status"`.
- **Header:** `Mês X` (`text-[11px] font-medium text-muted-foreground`) + chip de fase (`text-[10px] uppercase`, cor da fase). Se `mes === markerMes`, adiciona tag azure **"Você está aqui"**.
- **3 linhas**, cada uma `flex items-center gap-2`: swatch da cor (●/▬/┈) + label + valor `tabular-nums`:
  - Caixa acumulado → `±R$ X` (verde se ≥0, vermelho se <0) + hint `Lucro acumulado`/`Em investimento`.
  - Investimento em tráfego → `R$ X` (âmbar).
  - ROI → `+X %` / `−X %` (verde/vermelho).
- Ordem do protagonista primeiro (Caixa no topo).

**Hit area:** `<rect>` transparente sobre o plot capturando `mousemove` (idêntico ao padrão da JCurve atual); `onMouseLeave` limpa. Mobile: tooltip por tap.

---

## 8. Legenda (compacta)

Top-right do header do card. Inline, `flex items-center gap-3.5 flex-wrap`. Cada item `flex items-center gap-1.5`, `text-[12px]`:
- **● + mini-área azure** "Caixa acumulado" — label `text-foreground` (protagonista, levemente mais forte).
- **▬ âmbar** "Investimento" — label `text-muted-foreground`.
- **┈ verde/vermelho tracejado** "ROI" — label `text-muted-foreground`.
- separador `·` + **┃ azure (mini-tick vertical) + "Você está aqui"** — indicador do marcador.

Swatches: caixa = quadradinho `h-2.5 w-3.5 rounded-[2px]` com gradiente azure (evoca a linha+fill); investimento = traço `h-0.5 w-4 bg-warning`; ROI = traço tracejado `border-t-2 border-dashed` bicolor (ou só success com hint); marcador = `h-3 w-0.5 bg-insights`.

**Interação:** hover num item → realça a linha correspondente e esmaece as outras (§2). `role="list"`, cada item `role="listitem"` + `aria-label`. Não há toggle on/off (a narrativa precisa das 3).

---

## 9. Estados

- **Loading:** card com `ShimmerBlock` (reusar `InsightsStates.tsx`). Dentro, silhueta canônica fantasma: a régua de equilíbrio + 3 linhas-baseline em `opacity 0.25` respirando (`opacity 0.4↔0.7`, 2s) — ensina a forma antes do dado chegar. Bandas de fase em tint mínimo já visíveis.
- **Org sem vendas / CAC indefinido → SEM marcador:** o gráfico renderiza a **forma canônica esmaecida** (`opacity 0.5` nas 3 linhas, fill do caixa reduzido) com bandas e régua normais, **sem marcador**, e uma legenda inferior/caption: *"Sem vendas registradas — esta é a forma típica da jornada. O marcador aparece com a primeira venda."* (`text-[12px] text-muted-foreground`, centro-inferior). Assim o card nunca fica vazio: vira material didático.
  - *(Nota de fluxo: a página já desvia pra `InsightsNoSalesState` quando `numVendasReal <= 0` na aba Dados. Na aba **Projeção** — que funciona sem venda real — o gráfico usa o CAC das metas, então o marcador aparece normalmente. O sub-estado "sem marcador" do chart cobre o caso de CAC indefinido dentro de um cenário já válido.)*
- **Projeção (comparar com real):** linha **caixa real fantasma** por trás da caixa-meta — `stroke hsl(var(--border))`, `opacity 0.18`, sem fill, sem marcador (reusa o conceito `JCurveGhostOverlay`). Marcador segue o cenário ativo (meta). Toggle "Comparar com real" (default on), igual §11 do DESIGN.md. Pílula "Cenário · Meta" no header herda o tratamento `--warning` já especificado.
- **Reduced motion:** §6 (estado final imediato).
- **Degenerado (sem break-even no horizonte):** as linhas canônicas garantem a narrativa mesmo assim; marcador ainda posicionável pelo CAC. Sem erro.

---

## 10. Microcopy (PT-BR)

- Eyebrow: **"LINHA DO TEMPO"** · Título: **"Jornada de unit economics"** · Sub: **"Investimento, ROI e caixa ao longo do tempo — e o momento desta organização."**
- Linhas: **"Caixa acumulado"** · **"Investimento em tráfego"** · **"ROI"**.
- Fases: **"Prejuízo"** · **"Break-even"** · **"Ganho de margem"** · **"Alavancagem · ciclos"**.
- Marcador: **"Você está aqui"** + `{fase} · mês {n}`.
- Eixos: esquerda **"R$"**, direita **"ROI"**, X **"Meses"** (ou ticks "mês 1 … 18"). Régua: **"R$ 0 · ROI 0"** / rótulo de linha **"Linha de equilíbrio"**.
- Tooltip: header **"Mês {n}"** + fase; caixa **"Caixa acumulado"** + **"Lucro acumulado"** / **"Em investimento"**; **"Investimento em tráfego"**; **"ROI"**.
- Explicação do marcador (condicional à zona do CAC):
  - prejuízo: *"CAC atual {x} acima do máximo ({máx}) — cada venda ainda custa mais que o ticket."*
  - break-even: *"CAC atual {x} ≈ máximo ({máx}) — você está no ponto de virada."*
  - ganho: *"CAC atual {x} está entre o ideal e o máximo — aquisição saudável e melhorando."*
  - mínimo: *"CAC atual {x} no nível ideal ({mín}) — margem madura."*
- Legenda do marcador: **"Você está aqui"**. Comparar projeção: **"Comparar com real"**.
- Estado sem marcador: **"Sem vendas registradas — esta é a forma típica da jornada. O marcador aparece com a primeira venda."**
- **Proibido:** "Ops", "Algo deu errado".

---

## 11. Component breakdown (handoff p/ engenheiro)

**Substitui** `JCurveChart.tsx` + `lib/jcurve-geometry.ts`. Mantém localização: `src/modules/identity/master/components/insights/`.

| Componente | Responsabilidade |
|---|---|
| `UnitEconomicsJourneyChart` | ⭐ orquestra o card: header, legenda, SVG, footer de fases, tooltip, sr-only table. Props: `journey` (séries + fases + marcador + domínios), `ghostCaixa?` (projeção), `mode`. |
| `lib/journey-geometry.ts` | **puro/unit-testável.** Escalas dual-axis com **zero compartilhado** (`sxMes`, `syReais`, `syRoi`, `zeroY` único), gera os 3 paths via `monotoneCubicPath` (reaproveitar o gerador já existente — **mover** de `jcurve-geometry.ts`), path de área do caixa, geometria das bandas, posição px do marcador. Sem React. |
| `JourneyPhaseBands` | 4 bandas (gradiente-topo) + divisores + chips de rótulo. |
| `JourneyLine` | 1 linha parametrizada: `{ path, areaPath?, color, dashed?, splitAtZero?, width, reveal }`. Cobre as 3 (caixa com fill+sólida, investimento sólida, ROI tracejada+split). |
| `JourneyMarker` | linha vertical + pino/flâmula + dot protagonista + halo + ticks secundários + slide/spring + hover tooltip. |
| `JourneyLegend` | legenda compacta + hover-emphasis (controla `highlightedLine`). |
| `JourneyCrosshair` + `JourneyTooltip` | crosshair tracejado, 3 dots, card de 3 valores + fase. |
| `JourneyAxes` | ticks R$ (esq.), ticks ROI (dir.), ticks de mês (X), régua de equilíbrio rotulada. |
| `InsightsStates` (existente) | atualizar o skeleton do chart pra silhueta canônica de 3 linhas; manter `InsightsNoSalesState`. Adicionar caption "sem marcador" dentro do chart. |

**Contrato de dados que o chart consome** (a **calc lib** `unit-economics.ts` produz — trabalho do engenheiro, fora desta spec visual):
```
JourneyData {
  months: number[]                 // 1..N (N ≈ 18: 12 + ciclos)
  caixa:        {mes:number, valor:number}[]   // R$  — J + ondas crescentes
  investimento: {mes:number, valor:number}[]   // R$  — sobe, degraus nos ciclos 12+
  roi:          {mes:number, valor:number}[]   // ratio/% — neg→0→sobe→oscila
  phases: { key:'prejuizo'|'breakeven'|'margem'|'alavancagem', startMes:number, endMes:number }[]
  markerMes: number | null         // do CAC vs bandas; null → estado "sem marcador"
  markerPhaseKey: string | null
  axis: { reaisMin, reaisMax, roiMin, roiMax }  // zeros DEVEM coincidir no syReais(0)===syRoi(0)
}
```
Formas **canônicas e fixas**, só escaladas pelo dado: caixa ancora profundidade no `maxCashConsumed` real; investimento ancora no gasto de anúncios real; ROI cruza 0 no break-even real. (A calc já tem `buildCanonicalJ` — generalizar pra 3 séries sobre ~18 meses com ciclos.)

---

## 12. Tipografia & números

Herda §14 do DESIGN.md. Título `font-display` Space Grotesk `tracking-[-0.02em]`. Eyebrows/fases `text-[10/11px] uppercase tracking-[0.08–0.1em]`. Todos os números `tabular-nums`. Currency pt-BR (`formatBRL`/`formatSignedBRL` já existentes), ROI percentual pt-BR (`formatPercent`), mês via `formatMes`. Pino do marcador em Inter (UI), não display.

---

## 13. Acessibilidade

- **Cor nunca sozinha:** caixa identificada por fill+espessura (não só azure); investimento por sólido sem-fill; ROI por **tracejado + posição vs baseline + texto de sinal no tooltip** (não só verde/vermelho — protege deuteranopia, já que o protagonista é azure e o ROI carrega dash+posição+eixo próprio).
- **`role="img"` no SVG** + `aria-label` descritivo: *"Linha do tempo de unit economics em {N} meses. Você está no mês {markerMes}, fase {fase}. Caixa acumulado {x}, investimento {y}, ROI {z}."*
- **Tabela `sr-only`** dos pontos-chave: por fase, os 3 valores nos extremos + os valores no `markerMes` + os marcos (break-even, fundo do caixa). (Estende a tabela sr-only que a JCurve já tem.)
- **Foco visível** `focus-visible:ring-2 ring-insights ring-offset-2 ring-offset-background` em legenda interativa e na faixa de hit do marcador.
- Legenda `role="list"`; tooltip `role="status"`. Alvos ≥44px em mobile (tap-to-tooltip).
- Contraste: `--insights` dark ~6:1; success/destructive/warning sobre warm-dark passam AA pra stroke 2px.

---

## 14. Responsivo

- **Desktop lg+:** full-width `col-span-12`, plot `h-[480px]`, dual-axis com ticks ambos, 4 fases rotuladas, legenda inline completa. (Uso real = desktop em reunião.)
- **Tablet md:** `h-[420px]`, fases rotuladas, ROI no eixo direito mantido.
- **Mobile:** `h-[340px]`, rótulos de fase abreviados (ou só extremos), legenda quebra em 2 linhas, tooltip por tap, ticks R$ reduzidos a 3. Marcador e pino preservados (são a estrela).

---

## 15. Aceite (checklist QA visual)

- [ ] 3 linhas legíveis juntas no dark: **só caixa tem fill**, **só ROI é tracejada**, hues 205/38/142-0 bem separados.
- [ ] Protagonista (caixa azure) é o anchor imediato do olho.
- [ ] **Zero compartilhado**: `syReais(0) === syRoi(0)` — break-even é um único momento visual (régua "R$ 0 · ROI 0").
- [ ] 4 bandas de fase tingem só o céu (gradiente-topo, opacity ≤0.10), área de dados limpa; break-even neutro (não âmbar).
- [ ] Marcador desliza da esquerda até `markerMes`, assenta com spring; dot protagonista no caixa + halo respirando.
- [ ] Pino "Você está aqui · {fase} · mês {n}" legível, azure cheio, com triângulo de pin.
- [ ] Marcador no mês certo p/ o CAC (ex. Milennills → ~mês 8, banda Ganho de margem).
- [ ] Entrada coreografada: bandas → régua → 3 linhas (clip-reveal staggered) → marcador desliza; **reduced-motion = final imediato**.
- [ ] Tooltip mostra os 3 valores + fase + sinais; crosshair tracejado snapa no mês; tag "Você está aqui" no mês do marcador.
- [ ] Legenda compacta + hover-emphasis funcional.
- [ ] Estado sem-marcador: forma canônica esmaecida + caption; nunca card vazio.
- [ ] Projeção: ghost real por trás, pílula "Cenário · Meta", marcador segue a meta.
- [ ] Tokens via HSL var (zero hex novo); `tabular-nums` + pt-BR; foco visível; `role=img` + tabela sr-only.
- [ ] Microcopy sem "Ops"/"Algo deu errado".

---

## 16. Validação hm-designer (auto-check)

- **Sofisticação:** cada elemento justificado — fill só no herói, dash só no ROI (unidade diferente), zero compartilhado (honestidade dual-axis), tint só no céu. Nada decorativo.
- **Diferenciação:** a linha-do-tempo-canônica-com-marcador-deslizante + zero compartilhado + céu tingido por fase é uma assinatura que só poderia ser desta ferramenta master. Troca o logo e ainda é reconhecível.
- **Experiência/Encantamento:** o marcador que desliza e assenta com física, o halo respirando, o draw-on coreografado, a régua-espinha onde tudo vira — momentos de craft. O master traça o dedo da esquerda ao pino numa reunião.
- **Usabilidade:** hierarquia de tinta clara (herói → apoio → significado), bandas dão a narrativa sem ler número, tooltip dá o detalhe sob demanda, legenda-emphasis desfaz spaghetti sob controle.
- **Beleza:** dark-first, editorial (Space Grotesk + Inter), whitespace, cor com restrição (azure protagonista, âmbar/verde/vermelho semânticos). Sem grid genérico de SaaS.
- **Veredito:** atende a barra. Risco a vigiar na implementação: ROI tracejado+split com `pathLength` → usar **clip-reveal** (resolvido no §6/§11); e a legibilidade do ROI no dual-axis depende de escalar o eixo direito pra ROI ocupar bem o espaço sem invadir as outras linhas.
