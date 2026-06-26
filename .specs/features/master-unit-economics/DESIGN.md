# DESIGN SPEC — Insights (Unit Economics por Organização) · `/insights`

> Área MASTER-ONLY de apresentação. O master seleciona uma org e apresenta CAC, Payback e Projeção **para o cliente, numa reunião**. Superfície de palco: confiança financeira, leitura instantânea, momento cinematográfico (Curva J). Dark-first. Refs: Stripe (clareza tabular financeira), Linear (densidade + segmented control + dark), Vercel (whitespace), Apple (reveal de número). Área **AZUL** — gêmea conceitual da Master (vermelha), chrome próprio, mais apresentacional. **Não** usa o `MasterLayout` vermelho.

## 1. Token novo — `--insights` (azul semântico)
Ancorado em `--chart-5` (`200 80% 50%`), refinado p/ hue 205 (distinto de destructive 0°, success 142°, gold 47°). Segue padrão HSL das vars + convenção de opacidade (`bg-insights/10`).

`src/index.css`:
```
:root (light) {
  --insights: 205 90% 40%;            /* azure forte — AA ~5:1 sobre cream L96 */
  --insights-foreground: 210 40% 98%;
}
.dark {
  --insights: 205 90% 60%;            /* mais claro p/ vibrar sobre warm-dark — AA ~6:1 */
  --insights-foreground: 36 11% 9%;
}
```
`tailwind.config.ts` → `theme.extend.colors`:
```ts
insights: { DEFAULT: "hsl(var(--insights))", foreground: "hsl(var(--insights-foreground))" },
```

## 2. Botão azul no `OrgSwitcher` (gêmeo do Master vermelho)
Mesmo desenho do botão Master (`OrgSwitcher.tsx:95-107`), cor azul, **ao lado** do vermelho, sob o gate `isMaster`. Ícone `LineChart` (Lucide). Label "Insights". Rota `/insights`.
```tsx
{isMaster && (
  <Button variant="outline" size="sm"
    className="gap-1.5 border-insights/30 text-insights hover:bg-insights/10 hover:text-insights"
    onClick={() => navigate("/insights")}>
    <LineChart className="w-3.5 h-3.5" />
    <span className="text-xs font-medium">Insights</span>
  </Button>
)}
```
Ordem: `[ org dropdown ] [ Master 🔴 ] [ Insights 🔵 ]`. Focus `ring-2 ring-insights ring-offset-2 ring-offset-background`.

## 3. Shell da página `/insights`
Rota master-only (gate `useMasterAuth().isMaster`; redireciona não-master p/ `/`). Chrome próprio (não o vermelho). Canvas dark, `px-8 lg:px-12 py-8`, conteúdo `max-w-[1180px] mx-auto`. Stage-light: 1 radial azul estático `radial-gradient(120% 80% at 50% -10%, hsl(var(--insights)/0.06), transparent 60%)` atrás do header. Dois momentos: (A) vazio/seleção; (B) org selecionada com abas Dados | Projeção.

## 4. Estado vazio — "Selecione uma organização"
Centro vertical. Eyebrow azul "INSIGHTS" (`text-[11px] font-semibold uppercase tracking-[0.14em] text-insights`) · headline `font-display text-3xl md:text-[32px] tracking-[-0.02em]` "Unit economics por organização" · sub muted "Selecione uma organização para apresentar CAC, payback e projeção." · **Combobox** (Command+Popover, busca por nome, ~30 orgs) `h-11`, ícone `Building2`, placeholder "Selecionar organização", `ChevronsUpDown`, item selecionado `Check` em `text-insights`. Fantasma SVG da Curva J ao fundo `opacity-[0.045]`. Entrada `cmd-rise` (translateY 14px + fade, .5s `cubic-bezier(.22,1,.36,1)`), seletor +80ms.

## 5. Header (org selecionada) + Segmented control Dados | Projeção
Sticky abaixo da topnav. Eyebrow "Insights · Unit Economics". Nome da org `font-display text-2xl md:text-[28px]` + org-switcher compacto (mesmo Combobox, ghost). **Segmented control** 2 segmentos (Linear/iOS): trilho `bg-muted/60 rounded-full p-1`, ativo `bg-insights text-insights-foreground rounded-full shadow-sm`, indicador desliza via `layoutId` (framer-motion), 250ms. **ToggleGroup horizonte** single: Mensal · Trimestral · Anual (ativo `bg-insights/12 text-insights border-insights/30`).
**Distinção Dados vs Projeção:** em Projeção, pílula `Cenário · Meta` (`bg-warning/12 text-warning border-warning/30`, ícone `Target`) + inputs com `border-dashed` + número-herói com sufixo "meta".

## 6. Aba Dados — Painel de inputs (FieldGroup shadcn)
Coluna esquerda sticky `col-span-12 lg:col-span-4`, card `bg-card border-border rounded-2xl p-6`. Título "Despesas & Investimento" + AutosaveIndicator inline (● Salvo / ◐ Salvando… / ⚠ Erro). Debounce 600ms, persistência **por org** (reusar `useAutoSaveField` de `src/shared/hooks/` se existir).
Grupos (FieldGroup + section labels): Investimento → Anúncios (R$); Custos variáveis → Embalagem (R$) · Frete (R$) · Impostos (%); Operação → Despesas administrativas (%) · Recompras (nº). Inputs `h-10` com adorno `R$`/`%`, `tabular-nums`, foco `ring-2 ring-insights/40 border-insights/50`.

## 7. KPI row (lidos do dado)
Coluna direita `col-span-12 lg:col-span-8`. 3 stat-cards: Ticket médio · Nº de vendas · Faturamento. Faixa lateral 3px em `--insights`. Valor `font-display text-2xl tabular-nums`. Reveal `useCountUp` (já existe), ~600ms ease-out, recount em troca de horizonte/org.

## 8. CAC em 3 bandas — `CacBandGauge`
Trilho de tolerância horizontal. Domínio `[0 … máx × 1.2]`. Zonas: `0→ideal` `bg-success/25`; `ideal→máx` `bg-warning/25`; `>máx` `bg-destructive/25`. Ticks dos 3 limiares (mín/ideal/máx) com label R$ (`tabular-nums`); ideal em `--insights`. Agulha do CAC atual `w-[3px] foreground` + cap 10px colorido pela zona. Animação: agulha desliza (spring `stiffness 120/damping 18`), zonas `scaleX` 0→1 origin-left stagger 60ms. **"Ver cálculo"**: disclosure mono-linha com fórmula + números substituídos: `CAC = Investimento ÷ Nº vendas = R$ 4.560 ÷ 30 = R$ 152` (`font-mono text-[12px] text-muted-foreground`).

## 9. Payback 1 & 2 — `PaybackCard` ×2
Fórmula sempre visível. Eyebrow "PAYBACK 1 · primeira compra" / "PAYBACK 2 · com recompra". Resultado `font-display text-4xl tabular-nums` + unidade "compras" (`useCountUp`). Fórmula `font-mono text-[12px]` conceitual + substituição numérica embaixo (`text-foreground/70`). Borda-topo de saúde: ≤~1 → `border-success`; 1–3 → `border-insights`; alto → `border-warning`. **Fórmulas exatas = donas da calc lib** (`P1 = CAC ÷ margemPorVenda`; `P2 = CAC ÷ margemComLtv`).

## 10. ⭐ Curva J de Payback — `JCurveChart` (a estrela)
Full-width `col-span-12`, card `rounded-2xl p-6 md:p-8`, `h-[420px] md:h-[480px]`. **SVG bespoke + framer-motion** (não recharts — controle total do draw). Pontos vêm de `computePaybackCurve` (calc lib) — UI só desenha path suave através deles.
- **Eixos:** Y "Caixa descontado" (R$); X "Tempo". Régua do zero tracejada `border` rotulada `R$ 0`.
- **Linha:** stroke `<linearGradient>` vertical (`userSpaceOnUse` no y do zero): verde `hsl(142 70% 45%)` acima → vermelho `hsl(0 62% 50%)` abaixo. `stroke-width 2.5`, `linecap round`. Curva suave (monotone/Catmull-Rom — **hand-roll do path generator se d3-shape não vier transitivo do recharts**, evita dep nova).
- **Áreas:** investimento (abaixo) fill vermelho `/0.30→/0` no zero; lucro (acima) fill verde `/0.28→/0` no zero.
- **Marcadores:** Caixa máximo consumido (fundo) dot 7px vermelho + dropline tracejada + label `−R$ X`; Ponto de equilíbrio (cruza zero) ring-dot azul `--insights` + label `período X`.
- **Labels 4 regiões** (`text-[11px] uppercase tracking-[0.08em]`): Investimento (`text-destructive/80`) · Autofinanciamento (`text-muted-foreground`) · Payback (`text-insights/90`) · Lucro (`text-success/90`). Divisores `border-border/40`.
- **Animação (cinematográfica, `useInView` 1×):** (1) eixos fade 200ms; (2) **draw-on** `motion.path` `pathLength 0→1`, **1600ms** `cubic-bezier(.4,0,.2,1)`; (3) áreas reveladas por clip-path retangular crescendo em X junto ao pathLength; (4) dots `scale 0→1` overshoot ao cruzar cada marco; (5) labels sobem em stagger 60ms pós-linha.
- **Hover:** crosshair vertical `insights/0.5` dashed + dot enfatizado + tooltip `bg-popover/97 backdrop-blur` com período + `Caixa descontado: ±R$ X` color-coded (vermelho neg / verde pos) + "Em investimento"/"Lucro acumulado".
- **Reduced motion:** sem draw — estado final imediato (`pathLength=1`, fills cheios).

## 11. Aba Projeção — cenário "meta"
Todos os campos viram input (metas): **Nº de vendas (meta) · Ticket médio (meta)** + as 6 despesas. Mesmos outputs. Distinção: inputs `border-dashed` + faixa pontilhada; sob cada input de meta uma linha-fantasma `Real: R$ X`; **Curva J com ghost overlay** — curva real fantasma (`opacity-0.18`, stroke `border`, sem fill) atrás da curva meta (cheia, animada); toggle "Comparar com real" (default on). KPIs com micro-eyebrow `meta` em `text-warning`.

## 12. Estados
- **Loading:** skeletons `animate-shimmer` (KPI row, gauge, paybacks) + Curva J como baseline reta tracejada respirando (`opacity` 0.4↔0.7, 2s).
- **Erro:** card centrado, `AlertTriangle` `text-destructive`, microcopy específica + ação. Nunca "algo deu errado".
- **Org sem vendas:** empty na aba Dados (ícone `Receipt`, "Esta organização ainda não tem vendas registradas…") + CTA "Projetar um cenário meta →" (leva à Projeção, que funciona sem dado).
- **Sem org:** estado vazio §4.

## 13. Motion (sistema)
Entrada cards `cmd-rise` 500ms stagger 60ms · troca Dados↔Projeção cross-fade+slide 12px 250ms (AnimatePresence) · segmented `layoutId` 250ms · números `useCountUp` 600ms ease-out · agulha gauge spring 120/18 · **Curva J draw-on 1600ms** `cubic-bezier(.4,0,.2,1)` · marcadores scale overshoot 400ms `cubic-bezier(.175,.885,.32,1.275)` · labels região stagger. Tudo sob `prefers-reduced-motion` (estado final imediato).

## 14. Tipografia & números
Heros `font-display` (Space Grotesk) + `tabular-nums` + `tracking-[-0.02em]` (KPI 24px, payback 36px, CAC atual 28px). Corpo/labels Inter. Eyebrows `text-[11px] uppercase`. Fórmulas `font-mono` 12px. Currency pt-BR sempre (`Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})`), percent `1.234,5 %`. **Todo** número `tabular-nums`.

## 15. Component breakdown (handoff)
`InsightsPage` (rota, gate, orquestra empty vs selected, estado org/horizonte/aba) · `InsightsEmptyState` · `OrgInsightsCombobox` (hero|compact) · `InsightsHeader` · `InsightsModeTabs` (segmented layoutId) · `ScenarioBadge` · `ExpenseInputsPanel` (prop `mode:'real'|'projection'`, autosave) · `AutosaveIndicator` · `MetricStatRow` · `CacBandGauge` · `PaybackCard` ×2 · `JCurveChart` · `JCurveMarker` · `JCurveRegionLabels` · `JCurveTooltip` · `JCurveGhostOverlay` · `InsightsSkeleton`/`InsightsErrorState`/`InsightsNoSalesState` · botão `Insights` no OrgSwitcher.
**Localização (decisão arquiteto):** `src/modules/identity/master/` — `pages/MasterInsights.tsx` + `components/insights/*` (coeso com lib/hooks já lá).

## 16. Microcopy (PT-BR)
Botão "Insights" · eyebrow "INSIGHTS · UNIT ECONOMICS" · headline "Unit economics por organização" · sub "Selecione uma organização para apresentar CAC, payback e projeção." · placeholder "Selecionar organização" · abas "Dados"/"Projeção" · pílula "Cenário · Meta" · horizonte "Mensal · Trimestral · Anual" · título inputs "Despesas & Investimento" · campos "Anúncios (R$)"/"Embalagem (R$)"/"Frete (R$)"/"Impostos (%)"/"Despesas administrativas (%)"/"Recompras (nº)" · projeção extra "Nº de vendas (meta)"/"Ticket médio (meta)" · ref real "Real: R$ X" · autosave "Salvo"/"Salvando…"/"Não foi possível salvar — tentar de novo" · KPIs "Ticket médio"/"Nº de vendas"/"Faturamento" · CAC "CAC atual"/"Mínimo"/"Ideal"/"Máximo"/"Ver cálculo" · payback "Payback 1 · primeira compra"/"Payback 2 · com recompra"/"compras" · curva regiões "Investimento"/"Autofinanciamento"/"Payback"/"Lucro" · marcos "Caixa máximo consumido"/"Ponto de equilíbrio" · tooltip "Caixa descontado"/"Em investimento"/"Lucro acumulado" · empty sem vendas "Esta organização ainda não tem vendas registradas. Os indicadores aparecem assim que houver a primeira venda." · CTA "Projetar um cenário meta →" · erro "Não foi possível carregar os indicadores desta organização." · comparar "Comparar com real". **Sem "Ops"/"Algo deu errado".**

## 17. Acessibilidade
Contraste AA (`--insights` light 5:1, dark 6:1). Cor nunca sozinha (gauge: posição+rótulo+cap; curva: shape+labels+sinal textual). Foco visível `focus-visible:ring-2 ring-insights ring-offset-2 ring-offset-background`. Segmented = `role=tablist/tab` (ou ToggleGroup `aria-pressed`); painéis `aria-labelledby`. Curva J `role="img"` + `aria-label` descritivo + tabela `sr-only` dos marcos. Inputs `inputMode="decimal"` + `aria-describedby`. Alvos ≥44px mobile.

## 18. Responsivo
Desktop lg+: grid 12-col (inputs `col-span-4` sticky · resultados `col-span-8`); Curva J full-width. Tablet md: empilha; Curva J 420px. Mobile: 1 col, segmented full-width, Curva J `h-[320px]` labels abreviadas, tooltip por tap. (Uso real = desktop em reunião.)

## 19. Checklist de aceite (QA visual)
Dark intencional · light AA · hover discernível por luminância · draw-on respeita reduced-motion · tokens via HSL var (zero hex novo) · `insights` no tailwind · spacing 4/6/8 + radius 2xl · `tabular-nums` + pt-BR · fórmulas auditáveis substituídas · Projeção inconfundível do real (tracejado+pílula+ref+ghost) · foco visível em tudo · curva `role=img` + tabela sr-only · estados loading/erro/sem-vendas/sem-org desenhados.
