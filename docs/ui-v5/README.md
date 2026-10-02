# V5 — sistema visual do Torque

Referência aprovada pelo CTO em 2026-09-30 (mockup navegável "Torque CRM V5").
Linguagem: **bancada quente com grade, cartões brancos de bento, tinta e ouro.**

O que é tela real e o que era só ideia do mockup está em
[`validacao-telas.md`](./validacao-telas.md). **Estilo do mockup, conteúdo da main.**

## Tokens (src/index.css · tailwind.config.ts)

| Papel | Token | Tailwind |
|---|---|---|
| Bancada (fundo da área de trabalho, com grade de 28 px) | `--background`, `--canvas-grid` | `bg-background` (a grade é automática em `[data-layout="main"]`) |
| Cartão | `--card`, `--card-border`, `--relevo`, `--radius-card` | `rounded-card border border-card-border bg-card shadow-relevo` |
| Tinta (lateral, painel-herói, pílula, tooltip) | `--ink`, `--ink-2`, `--ink-3`, `--ink-line`, `--ink-foreground`, `--ink-muted` | `bg-tinta text-tinta-foreground`, `text-tinta-muted`, `border-tinta-line` |
| Ouro (marca, foco, ativo) | `--primary`, `--gold-soft` | `bg-primary`, `bg-primary-soft text-primary-soft-foreground` |
| Verde legível (texto/ícone sobre cartão) | `--success-strong` (o `--success` é preenchimento; como texto reprova AA no claro) | `text-success-strong` |
| Vermelho legível | `--destructive-strong` | `text-destructive` **já resolve para ele** (`textColor` no config); `bg-`/`border-destructive` seguem no preenchimento |
| Pares legíveis na tinta | `.bg-tinta`/`.bg-sidebar` reescopam os três `-strong` para os valores do escuro | automático |
| Sombras | `--relevo`, `--relevo-alto`, `--relevo-tinta`, `--brilho-ouro` | `shadow-relevo`, `shadow-relevo-alto`, `shadow-relevo-tinta`, `shadow-brilho-ouro` |
| Raios | `--radius` (14 px), `--radius-card` (22 px), `--radius-panel` (28 px) | `rounded-lg`/`md`, `rounded-card`, `rounded-panel` |
| Fonte | Plus Jakarta Sans | `font-sans` (padrão) |
| Curvas | `standard` (0.2,0,0,1), `out-expo` (0.16,1,0.3,1), `drawer` (0.32,0.72,0,1) | `ease-standard`, `ease-out-expo`, `ease-drawer` — **nunca** `ease-[cubic-bezier(...)]`: o `tailwindcss-animate` também aceita valor arbitrário em `ease-*`, a classe fica ambígua e não gera CSS |

O escuro mantém o **preto puro** de fundo (decisão de 20/08). Tinta e lateral sobem um
degrau acima do cartão para continuarem lidas como objeto.

## Primitivos (src/components/ui)

- `Button` — pílula. `default` = ouro com brilho (**um por cabeçalho**); `ink` = pílula escura
  ("Ver agenda", "Abrir chat"); `outline` = branco com sombra; `icon` = quadrado arredondado.
- `Badge` — pílula; tons `soft · success · warning · info · gold · ink`.
- `Card` — bento (raio 22, sombra, sem borda no claro). `CardTitle` é 16 px bold.
- `Tabs` — `TabsList variant="pill"` (navegação de página, pílula escura com ativo em ouro),
  `"segmented"` (alternador claro dentro de bloco), padrão `"underline"` (abas dentro de cartão).
  A pílula que não cabe rola: esmaece a borda que esconde aba e traz a ativa para dentro.
- `Input`/`Select`/`Textarea` — fundo do cartão.
- `Dialog`/`AlertDialog` — branco, raio 28. `Sheet` lateral — flutua (12 px de respiro, raio 28) a partir de `sm`.
- `Tooltip` — tinta.
- `Table` — cabeçalho em rótulo micro maiúsculo.

## Composição (src/components/ui/page-header.tsx, bento.tsx)

- `PageHeader` — título 28 px extrabold apertado, subtítulo, ações à direita, `tabs` (pílula) abaixo, `back` opcional.
  O título tem piso de largura: quando não cabe, as ações quebram para baixo em vez de espremer o nome.
  `secondaryActions` (importar, exportar, histórico) são pílulas brancas a partir de `sm` e um menu `⋯` no
  celular; `actions` fica só para o que é sempre visível (primário em ouro, no máximo um `ink`).
- `KpiTile` — rótulo, valor grande tabular, ícone em chip tintado (`tone`), delta ou nota, mini-gráfico em `children`.
- `KpiRow cols={2|3|4|5}` — **toda** fileira de `KpiTile`. Grade no desktop; no celular vira carrossel com snap
  (empilhados, três ou quatro cartões ocupavam a tela inteira antes do conteúdo).
- `InkPanel` + `InkRow` — **um** painel-herói em tinta por tela, para o que pede ação agora. A linha selecionada vira ouro.
- `FocusCard` + `FocusTile` — o cartão de ouro (detalhe do foco) e seus sub-blocos translúcidos.
- `DeltaChip`, `ValueUnit` — variação e unidade/centavos pequenos.

## Regras

1. **Resumo antes do detalhe:** KPIs → filtros → herói (se houver fila de ação real) → bento.
2. **Ouro é escasso:** um `FocusCard` por vista, um botão primário por cabeçalho; o resto é branco, tinta e cor semântica.
3. **Números são o herói:** grandes, tabulares, tracking negativo; unidade/centavos menores (`ValueUnit`).
4. **Só tokens.** Nada de `#hex`/`text-yellow-400`/`bg-green-50` em componente: quebra o escuro. Cor de série de gráfico pode ser literal.
5. **Não inventar dado.** Se o mockup tinha um bloco que a tela real não tem, ele não entra (ver validação).
6. **Contratos de teste valem.** `data-testid`, papéis e nomes acessíveis não mudam num restyle.
7. **Celular é tela, não sobra.** Ações secundárias do cabeçalho viram menu `⋯`; filtros viram faixa que rola;
   KPIs viram carrossel. Confira cada tela a 390 px antes de dar por feita (`scripts/ui-preview/shoot.mjs`).
