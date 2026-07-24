# Spec visual — TV montável (sistema de widgets)

> Épico **#1194** · ADR-0023 · fatias #1195–#1209
> Autor: Design · Status: **spec para implementação** (não é código)
> Escopo: superfície visual da TV como primeiro consumidor do motor de métricas montáveis.

---

## 0. Tese

A TV não é uma tela de app grande. É **sinalização**: vista de 3 metros, de relance, ligada o dia inteiro, sem ninguém para clicar nela.

Isso muda três coisas em relação ao resto do produto:

1. **Tipografia é a hierarquia inteira.** Não há hover, não há tooltip, não há clique para revelar. O que não está legível está perdido.
2. **Cor é semântica, nunca decorativa.** Numa tela montada pelo cliente, onde ele escolhe 12 widgets sem coordenar entre si, cor decorativa produz arco-íris com garantia matemática.
3. **Movimento é reservado para mudança.** Animação em loop numa parede ligada 12h é distração periférica, custo de GPU contínuo e risco de burn-in.

A TV de hoje viola as três. A migração para o motor é a oportunidade de corrigir — não como polimento, mas porque **um sistema montável só funciona se as peças forem intercambiáveis**, e peças com cor arbitrária e escala tipográfica arbitrária não são.

### O achado que organiza tudo

Auditei os 17 componentes de `src/modules/analytics/components/tv/`. O padrão é perverso:

> **Os 9 componentes vivos são justamente os que abandonaram os tokens do design system. Os 8 órfãos são os que usavam tokens.**

Vivos usam uma paleta paralela hardcoded — `#f8f5e7`, `#8a857a`, `#ed9326`, `#ffd400`, `#1c1c1c`, `rgba(255,255,255,0.03)` — e nenhum arquivo do diretório usa `hsl(var(--…))`. O que sobreviveu à evolução do produto foi o código que saiu do sistema.

Isso não é culpa de ninguém: a TV **precisava** de valores diferentes dos do app (parede iluminada, brilho alto, 3m) e não havia como expressar isso. A pessoa fez a única coisa possível — hardcodou.

**A correção não é "usar os tokens do app".** Os valores do app estão errados para TV. A correção é dar à TV um **escopo de tema**, exatamente como `.dark` já faz: os mesmos nomes de token, valores recalibrados. Detalhe em §2.

---

## 1. Anatomia — o `WidgetFrame`

Um componente-casca, sete corpos. A casca é o que faz 12 widgets diferentes lerem como um sistema.

```
┌─────────────────────────────────────────┐
│  RECEITA POR CLOSER              ①      │   eyebrow — a pergunta
│                                         │
│  R$ 1,3 mi          ↑ 18%        ②      │   valor de cabeça + delta
│                                         │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Marina    412k│      │
│  ▓▓▓▓▓▓▓▓▓▓        Caio      288k│ ③    │   corpo — o formato
│  ▓▓▓▓▓▓▓           Rafa      201k│      │
│ ─────────────────────────────────────── │
│  ⌖ base: fechamentos no período · jul   │   ④ proveniência
└─────────────────────────────────────────┘
```

### ① Eyebrow (obrigatório)
O nome do widget. UPPERCASE, `--tv-label`, peso 600, tracking `+0.08em`, cor `--muted-foreground`.
É a **pergunta**. Gerado da spec (`medida + recorte`), com override curto opcional (≤ 28 caracteres — ver §7).

### ② Valor de cabeça (obrigatório — inclusive nos gráficos)
**Todo formato tem um número no topo. Sem exceção.**

Um card de gráfico sem valor de cabeça não entrega nada ao olhar de 2 segundos — a pessoa precisa interpretar a forma para extrair um número, e a 3m ela não vai. Linha mostra o total do período. Pizza mostra o total. Funil mostra a entrada. Ranking mostra a soma.

O delta de comparação fica **ligado ao bloco do valor** — mesma linha quando couber, imediatamente abaixo quando não. **Nunca no rodapé, nunca separado por espaço em branco.** Regra do Stripe Dashboard: delta sem o número que ele modifica é ruído.

> Corrigido após a prova da #1223: eu havia escrito "sempre na mesma linha". Empilhado logo abaixo lê igualmente bem e sobrevive melhor a células estreitas. O que importa não é a linha — é a **proximidade**. O delta tem que pertencer visualmente ao número.

### ③ Corpo
A única região que varia entre os 7 formatos. Detalhe em §3.

### ④ Linha de proveniência (obrigatória, sempre visível)
Separada por 1px de `--border` a 50%, altura fixa. Detalhe em §4 — é o requisito do CTO e tem seção própria.

### Densidade e peso

O widget declara **peso**, não estilo. Peso é uma propriedade de layout que amarra tamanho de célula à escala tipográfica:

| Peso | Célula (12×6) | Valor de cabeça | Uso |
|---|---|---|---|
| `hero` | 4×3 ou 6×3 | `--tv-hero` (56–96px) | O número da empresa. **Máx 1 por página.** |
| `primary` | 3×2 | `--tv-value` (36–56px) | Os 3–5 números que importam. |
| `secondary` | 2×2 ou 3×1 | `--tv-value-sm` (24–36px) | Contexto. |

**Diferenciação entre widgets é por peso e posição, não por cor.** É como Linear e Apple resolvem hierarquia em superfície densa.

---

## 2. Tokens

### 2.1 A decisão: escopo de tema, não paleta paralela

Introduzir `--tv-bg`, `--tv-card`, `--tv-text` seria criar um sistema paralelo — exatamente o que a regra da casa proíbe. Não faço isso.

**Faço o que o `.dark` já faz**: um seletor de escopo redeclara os **mesmos nomes** com valores calibrados.

```css
/* src/index.css — @layer base, logo após o bloco .dark */

/* ─── Superfície TV — parede vista a 3m, ambiente iluminado ─────────
   Mesmos nomes de token do app; valores recalibrados para distância
   e brilho alto. Isto substitui a paleta hardcoded de components/tv/
   (#f8f5e7 / #8a857a / #ed9326 / rgba(255,255,255,0.0x)), que hoje é
   um sistema paralelo não-tematizável. */
[data-surface="tv"] {
  color-scheme: dark;

  /* Fundo mais profundo que o app: TV tem brilho alto e a sala tem luz
     ambiente. 9% do app "lava" em parede; 7% segura o preto. */
  --background:        36 12% 7%;
  --foreground:        45 20% 95%;

  /* Superfície do widget — sólida. Ver 2.3 sobre a remoção do blur. */
  --card:              35 10% 11%;
  --card-foreground:   45 20% 95%;

  /* Elevação do hero: +3% de L. A 3m, sombra não lê; luminância lê. */
  --popover:           35 10% 14%;
  --popover-foreground:45 20% 95%;

  /* Borda VISÍVEL. O `border-white/5` de hoje some a 3m — o widget perde
     o contorno e a grid vira sopa. */
  --border:            40 8% 20%;
  --input:             40 8% 20%;

  --muted:             35 9% 15%;
  --muted-foreground:  40 8% 62%;   /* 62% vs 56% do app: +contraste p/ distância */

  --primary:           47 100% 50%; /* gold — inalterado, é a marca */
  --primary-foreground:30 18% 12%;

  --success:           142 62% 52%; /* +L vs app: verde escuro some em parede */
  --destructive:         0 72% 60%;
  --warning:            38 92% 58%;
}
```

**Contraste verificado (WCAG 2.1):**

| Par | Ratio | Verdicto |
|---|---|---|
| `--foreground` 45 20% 95% sobre `--card` 35 10% 11% | ≈ 15.4:1 | AAA |
| `--muted-foreground` 40 8% 62% sobre `--card` | ≈ 6.3:1 | AA (AAA para texto ≥ 18.66px — o eyebrow a 12–16px passa AA com folga) |
| `--primary` 47 100% 50% sobre `--card` | ≈ 10.1:1 | AAA |
| `--success` 142 62% 52% sobre `--card` | ≈ 7.4:1 | AAA |
| `--destructive` 0 72% 60% sobre `--card` | ≈ 5.2:1 | AA |
| `--border` 40 8% 20% sobre `--card` 11% | ≈ 1.6:1 | Não-texto; acima do mínimo 3:1 exigido? **Não.** Ver nota. |

> **Nota sobre a borda.** 1.6:1 fica abaixo do mínimo de 3:1 do critério 1.4.11 (Non-text Contrast). Isso é **aceito conscientemente**: a borda aqui é decoração de agrupamento, não é o único meio de identificar o widget — o agrupamento também é dado por espaçamento (gap 20px) e pela diferença de luminância entre `--card` (11%) e `--background` (7%), que é o portador real. Subir a borda para 3:1 exigiria `40 8% 34%`, que a 3m lê como uma grade de linhas brancas e destrói a leitura editorial. **Se o QA quiser 3:1**, a saída correta é aumentar o contraste `--card`↔`--background` e remover a borda inteiramente, não engrossá-la.

### 2.2 Escala tipográfica (tokens novos — não existe equivalente no repo)

O repo **não tem escala tipográfica tokenizada**: tudo é `text-*` do Tailwind mais valores arbitrários. Na TV isso degenerou em **14+ tamanhos distintos** (`text-[8px]`, `[8.5px]`, `[9px]`, `[9.5px]`, `[10px]`, `[11px]`, `[12px]`, `text-xs`…`text-5xl`, mais dois `fontSize` inline em `TVRankingSimple`). Isso não é estilo, é ausência de sistema.

Cinco degraus. Só cinco.

```css
[data-surface="tv"] {
  /* Escala fluida: trava no mínimo em 1080p janelado e cresce até 4K.
     vw como unidade porque a TV é sempre fullscreen — a viewport É a tela. */
  --tv-hero:     clamp(3.5rem,   5vw,    12rem);    /*  56 →  96px @1920 → 192px @4K */
  --tv-value:    clamp(2.25rem,  2.9vw,  7rem);     /*  36 →  56px @1920 → 112px @4K */
  --tv-value-sm: clamp(1.5rem,   1.875vw,4.5rem);   /*  24 →  36px @1920 →  72px @4K */
  --tv-label:    clamp(0.75rem,  0.83vw, 2rem);     /*  12 →  16px @1920 →  32px @4K */
  --tv-meta:     clamp(0.6875rem,0.73vw, 1.75rem);  /*  11 →  14px @1920 →  28px @4K */
}
```

**Por que esses números.** Regra de sinalização (altura de caractere ≈ distância ÷ 200): 3m exige ~15mm. Numa TV 55" a 1920px, 15mm ≈ 24px de altura-de-x, o que em Inter (x-height ≈ 0.727em) pede `font-size` ≈ 33px. Então **36px é o piso do que é lido a 3 metros**, e é exatamente onde `--tv-value` começa.

Isso é deliberadamente **dois orçamentos de distância**, como o Apple TV:
- **Leitura a 3m** — `--tv-hero` e `--tv-value`. É o que a sala inteira consome.
- **Leitura a 1,5m** — `--tv-label` e `--tv-meta`. É para quem se aproxima. Proveniência e eyebrow não precisam ser lidos da mesa do fundo; precisam **existir** e ser lidos por quem duvidar do número.

**Comparativo com hoje:** label do KPI `8px` → `12–16px` (2×). Valor do KPI `text-lg` = `18px` → `36–56px` (2–3×). **Esta única mudança altera a tela mais do que todas as outras juntas.**

#### O teto tinha um defeito — corrigido pela medição da #1223

A primeira versão desta escala travava em `6rem`/`3.5rem`/… e batia o teto por volta de **1745–1900px de viewport**. Medição da Bancada em 7 viewports confirmou: de 1920 para 3840 a escala **não crescia nada**.

**Por que isso é grave e não é detalhe.** A escala é `vw` justamente porque, numa parede, a largura do viewport é procuração para a largura física da tela — e o tamanho *físico* do glifo é o que decide se lê a 3 metros. Um mesmo painel de 55" a 1920 mostra o hero a 96px = **5% da largura**; a 3840 com teto de 96px mostra **2,5%**. Mesma parede, mesma distância, **metade do tamanho físico**. O teto derrotava a própria razão de usar `vw`.

Corrigido: os coeficientes `vw` são exatamente os valores de 1920 expressos em porcentagem, e o teto é **o dobro**, atingido só acima de 3840. Assim o tamanho físico fica **constante de 1200px a 4K**, que é a faixa em que a tela é realmente uma parede.

#### O piso não é defeito — é degradação para modo janela

A mesma medição mostrou que abaixo de ~1200px o piso passa a valer, e `value-sm` cai a 24px — abaixo do piso de 36px que a regra de sinalização exige.

**Isso está certo e é preciso dizer por quê**, porque lido isolado parece violação: enquanto o `clamp` não trava, `vw` mantém o tamanho **físico** constante em qualquer resolução — uma TV 720p de 55" mostra `value` a 38px de 1280, que é a mesma fração física que 56px de 1920. O piso só passa a mandar em viewports onde **ninguém está a 3 metros**: janela de laptop, prévia, desenvolvimento.

> **Regra explícita:** o piso de 36px vale para **viewport de parede (≥ 1280px)**. Abaixo disso a escala degrada de propósito para uso em janela, onde a restrição de 3 metros não se aplica. Não é o mesmo contrato e não deve ser verificado com o mesmo critério.

#### `--tv-label` e `--tv-meta` são um tamanho com dois tratamentos

Confirmado na prova: 16px e 14px têm razão **1,14** — visualmente o mesmo tamanho. Isso é **intencional**. A distinção entre eyebrow e proveniência é feita por **peso (600 vs 450), caixa (alta vs normal) e tracking (+0,08em vs +0,01em)**, não por escala.

Registrado para que ninguém "conserte" o intervalo: abrir a diferença de tamanho aqui rouba contraste do salto que importa, que é `value-sm` → `label`.

### 2.3 Tipografia — regras

| Elemento | Família | Peso | Tracking | Numeral |
|---|---|---|---|---|
| Valor (todos os níveis) | **Inter** | 600 | `-0.03em` | `tabular-nums` |
| Eyebrow | Inter | 600 | `+0.08em`, uppercase | — |
| Proveniência | Inter | 450 | `+0.01em` | `tabular-nums` |
| Título da página (header) | `font-display` (Space Grotesk) | 600 | `-0.02em` | — |

**Números NÃO usam `font-display`.** Space Grotesk tem numerais com personalidade geométrica que sabotam a leitura tabular a distância — dígitos ficam ambíguos entre si. Inter com `tabular-nums` é a escolha certa; é o que Linear e Stripe fazem em superfícies numéricas. Space Grotesk fica reservado ao título da página, onde personalidade é o objetivo.

Peso 600 e não 700/800/900 nos valores: em display grande sobre fundo escuro, peso alto engrossa o traço e **reduz** legibilidade por sangramento óptico (halation). Hoje há `font-black` em `TVMetricsGrid` e `SalesThermometer` — corrigir.

`body` já traz `font-feature-settings: "cv11","ss01"` — `cv11` (numeral "1" com serifa) é especialmente valioso aqui: a 3m, `1` sem serifa confunde com `l` e com o eixo. Manter.

### 2.4 Cor — a regra de ouro (literal)

**Três papéis. Nada mais.**

1. **Gold `--primary`** — o número que importa AGORA. **Um por página, no máximo dois.** É o hero.
2. **Neutro `--foreground`** — todo o resto dos valores. Sim: **a maioria dos números na tela é branco-creme.** É isso que separa Linear de um painel administrativo de 2015.
3. **Estado `--success` / `--destructive`** — exclusivamente delta de comparação e resultado ganho/perda. **Nunca** para colorir um valor neutro.

**Mata o `colorMap` de 6 cores do `KPICard`** (`TVDashboard.tsx:512-520`) e o campo `color: "blue"|"emerald"|"amber"|"red"|"purple"|"orange"` de `TVKpi` (`tv-config-from-quiz.ts:14`). Hoje reuniões é azul, conversão é esmeralda, no-show é vermelho, ticket é roxo — **atribuição arbitrária**. Num sistema onde o cliente monta 12 widgets, isso é arco-íris garantido, e pior: o vermelho de "no-show" colide semanticamente com o vermelho de "delta negativo", então a tela ensina duas gramáticas de cor contraditórias ao mesmo tempo.

> **Isto é uma remoção de campo, não só de CSS.** `TVKpi.color` sai da interface. Sinalizado ao Forja porque é mudança de contrato.

### 2.5 Séries de gráfico

Formatos com múltiplas séries precisam de diferenciação cromática. Duas rampas, escolhidas pela **natureza do dado**, não pelo gosto:

```css
[data-surface="tv"] {
  /* ORDINAL — funil, barra, ranking. O dado tem ordem, então a cor tem ordem.
     Mono-gold decrescente em L e S. A 3m isso lê como "intensidade",
     que é exatamente o que a ordem significa. */
  --metric-ramp-1: 47 100% 50%;
  --metric-ramp-2: 45  78% 44%;
  --metric-ramp-3: 42  56% 38%;
  --metric-ramp-4: 40  36% 32%;
  --metric-ramp-5: 38  20% 27%;

  /* CATEGÓRICO — pizza/donut por origem, tag, produto, stream.
     Sem ordem, então hues distintos. Redefinição consciente de --chart-*
     dentro do escopo TV para não colidir com semântica de estado:
     evita 142° (success) e 0° (destructive). */
  --chart-1: 47 100% 50%;   /* gold      */
  --chart-2: 205 90% 60%;   /* azure     — = --insights dark, já no sistema */
  --chart-3: 271 65% 68%;   /* violeta   */
  --chart-4: 25  85% 58%;   /* âmbar-laranja */
  --chart-5: 190 70% 52%;   /* teal      */
}
```

> **Refactor consciente sinalizado, não executado aqui.** No app, `--chart-1..5` hoje são `gold / verde-success / marrom / vermelho-destructive / azul`. Ou seja: **`--chart-2` é literalmente `--success` e `--chart-4` é praticamente `--destructive`.** Qualquer gráfico categórico do produto inteiro pinta uma categoria de verde-"bom" e outra de vermelho-"ruim" sem que o dado diga isso. **É um bug de sistema pré-existente, fora do escopo desta fatia.** Aqui só corrijo dentro de `[data-surface="tv"]`. Registro para o Cais decidir se vira dívida rastreada.

### 2.6 Superfície — cortar o blur

Hoje: `bg-white/[0.022] border border-white/5 backdrop-blur-sm` (`TVDashboard.tsx:486-487`).

**Cortar `backdrop-blur-sm`.** Três razões: (a) não há nada atrás para borrar — o fundo é liso; (b) `backdrop-filter` é composição de GPU **contínua**, por card, numa tela ligada 12 horas; (c) a 3m o efeito é invisível. É custo puro.

Elevação passa a ser **luminância + 1px de borda**, não sombra. Sombra em dark a 3m não lê.

### 2.6b Formatação de valor — camada própria, não detalhe de renderer

> **Gap da minha própria spec, encontrado na revisão por camadas.** §8.3 lista "uma formatação de moeda" como *benefício* da migração, mas benefício não é fatia: sem regras escritas e sem dono, cada um dos 7 renderers formata o seu, e a v1 entrega **7 formatadores divergentes novos** em vez de consertar os 7 antigos.

O motor devolve **valor + unidade**. A formatação é **uma função, uma vez**, consumida por todos os renderers e pela escala do termômetro.

#### O bug que isso expõe

`TVDashboard.tsx:30-34`:

```ts
const formatCurrency = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000)    return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
};
```

**Quatro defeitos numa função de quatro linhas:**

1. **`.toFixed()` sempre produz ponto decimal.** A TV mostra **`R$ 412.0K`** — separador dos EUA, num produto pt-BR, na parede do cliente. Passa despercebido porque o número está sempre compacto e o ponto se disfarça de separador de milhar.
2. **`K`/`M`** em vez de `mil`/`mi`.
3. **A função chamada `formatCurrency` não emite `R$`.** Devolve `"412.0K"` cru; quem chama cola o símbolo por fora. O nome mente e o contrato é implícito.
4. **Corta em 1.000**, exatamente onde o compacto começa a destruir informação relevante.

> **O defeito 3 já produz a divergência que o invariante desta seção existe para impedir — e produz dentro do termômetro, hoje, em produção.**
>
> No mesmo card: os ticks da escala chamam `formatCurrency` **sem** prefixo (`TVDashboard.tsx:371`) enquanto o valor da meta, o vendido, o delta e o "falta" chamam **com** (`:383`, `:432`, `:447`, `:452`). Resultado na parede: a escala mostra `412.0K` e o rótulo ao lado mostra `R$ 412.0K`, no mesmo widget, a 30 centímetros um do outro.
>
> Isso vale mais que o argumento teórico: o invariante "tick e valor nunca discordam dentro do mesmo card" não é precaução — é a correção de um defeito que já está na tela.

**Escala real do problema: 14 arquivos da TV tocam `toFixed`/`Intl.NumberFormat`.** A auditoria inicial contou 7 reimplementações de moeda; contando toda formatação numérica, são 14. "Sete formatadores divergentes" era otimista.

#### Regras

| Tipo | Regra | Exemplo |
|---|---|---|
| **Moeda ≥ 10 mil** | compacto, **1 decimal**, vírgula | `R$ 412,0 mil` · `R$ 1,3 mi` |
| **Moeda < 10 mil** | integral, separador de milhar, sem decimal | `R$ 8.450` |
| **Percentual ≥ 10%** | inteiro | `32%` |
| **Percentual < 10%** | 1 decimal | `4,2%` |
| **Contagem** | inteiro, separador de milhar acima de 1.000 | `1.284` |
| **Duração < 48h** | horas inteiras | `18h` |
| **Duração ≥ 48h** | dias, 1 decimal | `3,2 dias` |
| **Ausente / divisão por zero** | travessão | `—` |

**Justificativas, porque cada uma é uma escolha e não um default:**

- **Corte em 10 mil, não em 1.000.** Abaixo disso o compacto destrói informação relevante: `R$ 8,4 mil` esconde R$ 450, e numa venda isso importa. Acima, o dígito exato não muda decisão nenhuma a 3 metros.
- **Sempre 1 decimal no compacto.** Zero decimal perde granularidade (`R$ 1 mi` pode ser 1,0 ou 1,4 — 40% de erro). Dois decimais são ruído ilegível a 3m.
- **`mil` e `mi` por extenso, não `K` e `M`.** `K` é convenção de engenharia; o público da parede é time comercial brasileiro. `R$ 1,3 mi` se lê em voz alta como se fala.
- **Vírgula decimal, ponto de milhar.** `Intl.NumberFormat('pt-BR')`, não `.toFixed()`.
- **Percentual com precisão relativa.** `4,2%` e `32%`: abaixo de 10% um ponto percentual é uma variação grande em termos relativos, e arredondar apaga o sinal.
- **Duração muda de unidade, nunca extrapola.** `77 horas` obriga a pessoa a dividir de cabeça. `3,2 dias` já é a resposta. (Cobre `tempo médio na etapa`, medida do catálogo v1 que eu não havia especificado como se renderiza.)

**Invariante:** valor de cabeça, rótulo de barra, célula de ranking e escala do termômetro usam **a mesma função**. Hoje os ticks do termômetro e o valor usam `formatCurrency`, mas vários componentes reimplementam o seu — daí a divergência de `.toFixed(0)/(1)/(2)` espalhada pelos 14 arquivos.

### 2.6c Identidade de pessoa no ranking

Segundo gap da mesma revisão. O ranking é o único formato que exibe **pessoas**, e eu não especifiquei o que acontece quando falta avatar — hoje `useAvatarMap` devolve `undefined` e cada um dos três rankings resolve do seu jeito.

- **Com avatar**: círculo de 2.5rem, `object-cover`, borda 1px `--border`.
- **Sem avatar**: **iniciais** (até 2 letras) sobre `--muted`, tipo em `--tv-meta` peso 600, `--muted-foreground`. **Nunca silhueta genérica** — a 3m um ícone de pessoa cinza é ruído idêntico em todas as linhas, e iniciais ainda distinguem quem é quem.
- **Sem nome**: `—` na célula de nome. Não escrever "Sem nome" (é o que o código faz hoje), que ocupa mais espaço que a informação que carrega.
- Avatar é **complemento**, nunca o único identificador: o nome sempre aparece ao lado. Requisito de acessibilidade e de leitura a distância pelo mesmo motivo.

### 2.7 Motion — tokens

```css
[data-surface="tv"] {
  --tv-ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* expo-out */
  --tv-dur-instant: 50ms;
  --tv-dur-fast:   150ms;   /* troca seca, reduced-motion */
  --tv-dur-base:   250ms;   /* mudança de valor */
  --tv-dur-slow:   400ms;   /* entrada, rotação de página */
}
```

> O repo já tem duas curvas quase-iguais em uso (`.22,1,.36,1` em `.cmd-rise`, `.2,.8,.2,1` em `.tv-kpi`). **Padronizo em uma só.** Não introduzo terceira variante.

---

## 3. Os 7 formatos

### 3.1 Regras de convivência

Isto é o que impede colcha de retalhos. Vale para todos:

1. **Valor de cabeça sempre** (§1②). Inclusive nos gráficos.
2. **Nenhuma legenda flutuante.** Rótulo vai *no* elemento — no fim da barra, dentro do segmento do funil, na ponta da linha. Legenda separada obriga ida-e-volta do olhar; a 3m isso mata.
3. **Eixo só quando a magnitude importa.** Barra e ranking: sem eixo, valor no fim de cada barra. Linha: eixo Y com **2 marcas** (mín/máx), não 5. Eixo X com **3 marcas**, não 12.
4. **Máximo 5 categorias.** A 6ª+ vira "Outros". Exceção: ranking vai a 5 linhas + `e mais N`.
5. **Sem gridlines.** Nem horizontais nem verticais. A 3m viram textura cinza.
6. **Sem tooltip.** Não existe cursor numa parede. Se o dado só existe no tooltip, o dado não existe.

### 3.2 Tabela de formatos

| Formato | Pergunta | Recorte compatível | Corpo | Base no código |
|---|---|---|---|---|
| **Número grande** | "quanto?" | nenhum, ou 1 filtro | só o valor de cabeça, promovido a `--tv-hero` | `MetricCard` (privado em `TVMetricsGrid`) |
| **Termômetro** | "quanto falta?" | progresso de meta | tubo gold + escala 0/25/50/75/100 + marcador de pace + delta | `SalesThermometer` — melhor peça do lote |
| **Barra** | "quem/qual mais?" (≤5) | categórico | barras horizontais, rótulo + valor no fim | **nasce do zero** |
| **Ranking** | "quem mais?" (pessoas) | responsável/closer/sdr | linhas com nome, **até 3 medidas**, micro-barra na ordenadora | `TVRankingSimple` / `TVCompetitionBlockV2` |
| **Linha** | "está subindo?" | tempo | série única, área a 12%, 2 marcas Y | **nasce do zero** |
| **Funil** | "onde vaza?" | etapa | barras decrescentes + taxa entre etapas | `SalesFunnel` — tratamento visual bom |
| **Donut** | "de que é feito?" (≤5) | origem/tag/produto/stream | anel + total no centro | `OriginDonut` (fora de `tv/`, recharts) |

> **Custo real** (validado com o Forja): 4 dos 7 têm pele aproveitável, 3 nascem do zero. **Mas os 17 componentes são tipados em campos de negócio, não em série genérica** — `SalesFunnel` pede `reunioesMarcadas/comparecidas/marcandoR2/…`, nenhum aceita `{label, value}[]`. Então **o contrato inteiro é reescrito nos 7; só a pele sobrevive.** Orçar como reescrita-com-referência-visual, não como wrapper. O custo está no contrato, não no pixel.

### 3.3 Nota sobre a pizza

**Pizza é o formato mais fraco para TV.** Comparar ângulos a 3m é ruim, e ângulo é a única codificação que ela oferece. O catálogo a inclui, então ela existe — mas na forma **donut com o total no centro**, máx 4 fatias + "Outros". O anel dá espessura constante (mais legível que ângulo) e o centro carrega o valor de cabeça, resolvendo a regra 1 sem card extra.

Se o cliente escolhe donut para 8 categorias, a UI de montagem **sugere** barra. Sugere, não bloqueia — decisão de tom em §7.

### 3.4 Eixos e chart lib

Alvo real: **recharts 2.x** (`^2.15.4`, API 2.x — **não** 3.x) com o wrapper shadcn em `src/components/ui/chart.tsx`. Motion: **framer-motion `^12.24.7`**.

Só **linha** e **donut** usam recharts. Barra, funil, termômetro e ranking continuam em `div` + CSS — a 3m são geometria simples, e recharts para 5 barras horizontais é peso morto no bundle e um `ResponsiveContainer` a mais recalculando em resize.

Config recharts para TV:
- `<CartesianGrid>` — **ausente**.
- `<YAxis>` — `tickCount={2}`, `axisLine={false}`, `tickLine={false}`, `tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--tv-meta)' }}`.
- `<XAxis>` — `interval="preserveStartEnd"`, máx 3 ticks.
- `<Tooltip>` — **ausente** (regra 6).
- `<Line>` — `strokeWidth={3}` (2px some a 3m), `dot={false}`, `activeDot={false}`, `stroke="hsl(var(--primary))"`, `isAnimationActive` só na entrada.

---

## 4. Rótulo de âncora temporal

> Requisito explícito do CTO: "Foto do período" é o padrão e **o widget tem que dizer isso na cara**. É a user story 5.

### 4.1 Forma

Faixa de rodapé, **sempre presente em todo widget**, uma linha, `--tv-meta`, `--muted-foreground`, separada por 1px de `--border` a 50%, altura fixa.

```
⌖ base: fechamentos no período · jul/2026 · por closer
```

Até 4 fragmentos separados por `·`:

| # | Fragmento | Obrigatório | Exemplo |
|---|---|---|---|
| 1 | **Âncora** | sim — nunca some | `base: fechamentos` |
| 2 | **Período** | só em âncora de fluxo | `jul/2026` · `1–22 jul` |
| 3 | **Recorte / stream** | condicional | `por closer` · `carteira` · `total` |
| 4 | **Ressalva** | condicional | `sem registros` · `inclui Carteira desde {data-da-virada}` |

Glifo de âncora `⌖` à esquerda, `--muted-foreground` a 70%. Um glifo, não um ícone Lucide — ícone puxa atenção; glifo é pontuação.

> **O fragmento de período não é universal.** `base: hoje` é retrato de estado: o "quando" já está na âncora, e acrescentar `· jul` seria contradição — o retrato não é do mês, é de agora. As duas âncoras de fluxo (`entradas`, `fechamentos`) levam período; a de retrato não leva.
>
> A versão anterior marcava o fragmento 2 como obrigatório sem exceção. Corrigido pela prova da #1223, onde os cards de retrato apareceram — corretamente — sem período, contra a regra escrita.

### 4.2 Microcopy da âncora

"Foto do período" é vocabulário interno. Ao usuário, **três frases fixas, escolhidas pela medida — não pelo cliente**:

| Frase | Medidas |
|---|---|
| `base: entradas` | leads criados, reuniões marcadas |
| `base: fechamentos` | receita, nº de vendas, reuniões realizadas |
| `base: hoje` | leads na etapa, tempo médio na etapa |

> **Encurtado após a prova da #1223 — e o encurtamento é melhoria, não concessão.**
>
> A forma original era `base: fechamentos no período · jul`. Na captura em **1920** — a resolução de parede mais provável — ela **quebrava em duas linhas** nos cards de 2 colunas, violando a regra dura de §4.4. Em 4K não quebrava, o que a fazia parecer boa numa prova e ruim na outra.
>
> Ao encurtar, ficou claro que **`no período` era redundante**: o fragmento 2 já diz qual é o período, logo ali ao lado. Uma frase que repete o que a vizinha afirma não está sendo cuidadosa, está sendo prolixa. `base: fechamentos · jul` diz o mesmo em 40% menos espaço.
>
> `situação de hoje` → `hoje` pela mesma razão: `situação` não distingue de nada, já que as outras duas âncoras também são situações.

Isso resolve exatamente a ambiguidade que a user story 5 pede — "o que aconteceu no período" versus "o que entrou no período" — sem expor o termo técnico.

> **A frase é campo do payload, derivada da medida dentro do motor. O front renderiza o que recebe.**
>
> A tabela acima é a **especificação da regra**, não uma tabela de consulta para o frontend implementar. Se o front mantivesse esse mapeamento, ele viveria separado do catálogo — e medida nova no catálogo apareceria com âncora faltando, em silêncio. Medida sem âncora declarada é **erro no motor**, não string vazia na tela.
>
> Contrato fechado em #1205. É a mesma doença que o épico cura: os 23 hooks viraram 23 porque a semântica morava fora do lugar onde o dado mora.

> A terceira frase é a mais importante e é a que a TV de hoje esconde por completo: "leads na etapa" é um **retrato de estado**, não um fluxo, e hoje aparece lado a lado com métricas de fluxo sem nenhuma distinção visual. Isso é uma leitura errada acontecendo em produção agora.

### 4.3 Por que rodapé fixo e não tooltip/condicional

- **Não tooltip**: TV não tem cursor.
- **Não condicional** (só quando ambíguo): nota que aparece às vezes treina o olho a ignorar. E o requisito é que o widget diga na cara, sempre.
- **Repetida em 12 widgets, ela vira textura, não ruído.** Mesma altura, mesma cor, mesma posição — o olho aprende em 3 segundos que aquela faixa é sempre a mesma coisa e para de processá-la ativamente, mas ela continua disponível para quem duvidar do número. É o mesmo mecanismo do caption fixo sob foto em layout editorial.

**Referência:** Stripe Reporting fixa a nota de escopo sob o número, não em hover. Apple Health fixa a faixa de datas sob todo gráfico. Ambos pelo mesmo motivo: o número sozinho é uma afirmação sem sujeito.

### 4.4 Truncamento

**Nunca quebra em duas linhas.** Ordem de sacrifício: fragmento 4 → 3 → abrevia o 2 (`jul/26`) → colapsa o 1 para `⌖ fechamentos` (sem `base:`). **O tipo de âncora nunca some.**

> **A regra por contagem de células estava errada.** A versão anterior mandava colapsar em widget `< 2 células`. A prova da #1223 mostrou a proveniência quebrando em card de **exatamente 2 células** a 1920 — dentro do limite, e mesmo assim sem caber.
>
> Contagem de célula é **procuração** para largura, e procuração falha: a mesma célula tem larguras diferentes por resolução, por gap e por padding. **A regra é ajuste medido, não limiar de layout** — o degrau seguinte entra quando o anterior não couber em uma linha, verificado em tempo de render.
>
> Mesma família do teto do clamp: nos dois casos eu escrevi um limiar fixo onde o certo era deixar o mecanismo se acomodar.

O `WidgetFrame` recebe `aria-label` com o texto completo sempre que a linha tiver sido degradada.

---

## 5. Estados obrigatórios

### 5.1 Carregando

**Não é skeleton de tela.** O frame já está na tela com eyebrow e proveniência **reais** — eles vêm da configuração, não do dado, então nunca precisam esperar. Só o valor pulsa.

- Valor: bloco `≈4ch` de largura, `--muted`, `opacity` 0.4↔0.7 em 2s.
- **Sem shimmer.** O sweep de brilho a 3m lê como flicker. (Cortar o keyframe `shimmer` do uso na TV.)
- **Numa TV que refaz fetch a cada 30s, skeleton de tela inteira pisca a sala.** Por isso a estrutura fica: refetch nunca volta ao estado de carregamento; ele troca o valor no lugar (§6.2).

> **Regra dura: nunca mostrar `0` durante carregamento.** O repo já pagou essa dor — "Base Ativa" hardcoded em 0 (Fix #23 em `tv-config-from-quiz.ts`). Zero é um dado; ausência de dado é `—`.
>
> **Isto está quebrado hoje em 3 componentes vivos** (`CloserPerformanceBlock`, `NewLeadsBlock`, `SDRPerformanceBlock`): consomem hooks direto e renderizam zeros durante o fetch. Numa parede, zero parece dado real e ninguém sabe que está olhando para nada.

### 5.2 Vazio (consulta ok, sem registros)

Valor vira `—` em `--muted-foreground`, no tamanho do peso do widget. Proveniência ganha fragmento 4: `· sem registros`.

**Sem "Nenhum dado encontrado".** Ocupa espaço e não informa mais que o travessão. Divisão por zero: idem (o épico já define travessão).

### 5.3 Erro (widget quebrado, isolado)

O motor isola erro por widget (`get_dashboard_snapshot`). Visualmente:

**O widget NÃO some.** Se sumir, a grid dança e o espectador acha que alguém mudou a tela — pior que o erro.

- Frame permanece, valor vira `—`.
- Borda: `--destructive` a 30%.
- Proveniência substituída por: `⚠ indisponível · tentando de novo`.
- **Sem stack, sem código de erro, sem "Erro 500" na parede.** Diagnóstico vai para `runtime_logs`, não para a sala.

Tom: Apple TV — "Não foi possível carregar. Tentando novamente." Fato + o que está sendo feito.

### 5.4 Dados velhos (stale)

TV ligada 12h com refetch falhando. Hoje existe `.tv-live-badge` — vermelho, pulsante, e **estático**: diz "AO VIVO" independente de estar. **Um badge que sempre mente é pior que não ter badge.** Cortar.

Substituir por indicador no header do painel (um só, não por widget):
- Saudável: `atualizado agora` em `--muted-foreground`. Sem ponto pulsante.
- Após 3 falhas consecutivas: `dados de 14:32` em `--warning`.

### 5.4b Recorte estruturalmente vazio — o caso `stream = Carteira`

Estado que não é "sem dados neste período", e sim **"esta opção não pode ter dados ainda"**. Precisa de tratamento próprio, senão o widget mente por omissão.

**Por que existe.** Medição em prod (Cais): **não há uma única recompra no livro** — toda venda é a primeira do seu lead. Logo a etiqueta `carteira` hoje nunca significa recompra, e 51 de 205 vendas (R$ 198.684,96, 7 orgs) estão etiquetadas `carteira` sendo primeiras compras. Depois que a reetiquetagem corrigir isso, **`stream = carteira` fica com zero linhas**.

> **A janela NÃO vem da ordem das fatias.** As duas ativam juntas e atomicamente por org (decisão do Cais: uma regra, dois produtores — ativar em ordens diferentes poria dois significados simultâneos da mesma etiqueta no livro). Mesmo com ativação atômica perfeita, o zero acontece: o produtor só emite `carteira` quando o lead já tiver venda anterior, e **não existe nenhuma**. O primeiro `carteira` só nasce quando houver uma recompra real no mundo — ou quando o backfill dos 273 pedidos entrar, dos quais 121 são recompras.
>
> Isso torna o estado **mais** necessário, não menos: não é artefato de sequenciamento que se evita sendo esperto. É o estado correto do mundo, e dura de semanas a meses.

**Tratamento.** Distinto do vazio comum (§5.2):

| | Vazio comum | Estruturalmente vazio |
|---|---|---|
| Valor | `—` | `—` |
| Proveniência | `· sem registros` | `· nenhum cliente recomprou` |
| Donut/barra por stream | fatia some | fatia **não some** — a categoria aparece com valor zero, para que a ausência seja legível |

**A escolha da frase, porque ela é o trabalho todo.** Descartei `ainda não há recompra registrada` por dois defeitos:

- **`ainda`** marca pendência. Numa tela que atualiza sozinha a cada 30s, "ainda" se lê como *o sistema não terminou* — exatamente a suspeita de erro que a frase existe para dissolver.
- **`registrada`** põe o sistema como sujeito. "Não registrada" convida a pergunta *quem deixou de registrar?*, que aponta para falha de operação.

`nenhum cliente recomprou` corrige os dois: **o sujeito é o cliente, não o sistema.** Afirma um fato sobre o mundo, e um fato sobre o mundo não pode estar quebrado. O pretérito já carrega "até agora" sem precisar de advérbio de pendência, e a ausência de recorte temporal a distingue do vazio comum — que é sempre sobre o período.

**Quando usar cada uma** (regra, não julgamento caso a caso):

| Condição | Frase |
|---|---|
| A org **nunca** teve recompra | `· nenhum cliente recomprou` |
| A org tem recompra, mas nenhuma no período | `· sem registros` |

Depois do backfill, orgs vão divergir: umas terão recompra e outras não, simultaneamente. A regra acima resolve as duas sem ramificação nova, porque depende do histórico da org e não de uma data global.

> **A distinção vem do payload, não de uma consulta do front.** "A org já teve alguma recompra?" é pergunta **fora dos limites do período** — todas as demais medidas são recortadas por período, esta é histórica. Se o front resolvesse sozinho, precisaria de query própria, e a semântica voltaria a morar fora do lugar onde o dado mora.
>
> O motor devolve *vazio no período* ou *nunca existiu*; o front escolhe a frase correspondente e nada mais. Contrato em #1205.

> **Não é estado permanente e não deve virar arquitetura.** A frase sai sozinha na primeira recompra da org — nenhuma flag, nenhuma data, nenhuma remoção manual.

### 5.5 Sem permissão

Widget que o espectador não pode ver **some do layout**, não vira frame vazio. Diferente de erro. Raro na TV (roda em conta fixa de org), obrigatório no Comando.

### 5.6 Sem o plano — nota de escopo

`tv_dashboard` **não é flag por organização**: vem de `subscription_plans.features` (jsonb), `false` no plano base e `true` nos três planos superiores. A TV montável é, portanto, **recurso de plano pago**.

Isso não cria estado novo *dentro* do widget — `FeatureRoute` barra a rota inteira antes de qualquer widget montar. Duas consequências de design, ambas fora desta spec mas registradas para não virarem surpresa:

1. **A tela de bloqueio da TV é um momento de venda, não um 403.** Quem chega em `/tv` sem plano deveria ver o que está perdendo — uma prévia estática da parede, não "Recurso indisponível". Isso é spec própria; sinalizo, não desenho aqui.
2. **O motor de widgets é mais amplo que a TV.** Ele vai para o Comando, que tem gating diferente. Nenhuma decisão desta spec pode assumir "quem vê widget tem plano pago" — o `WidgetFrame` é agnóstico a plano por construção.

---

## 6. Rotação

> A TV mostra mais widget do que cabe. O problema real não é caber — é **não perder o fio**.

### 6.1 A decisão: páginas, não slots

**Modelo errado — o de hoje:** slots individuais rotacionando (`RotatingSlot`). Se 3 cards giram em fases diferentes, a tela **nunca está parada e nunca existe inteira**. Quem olha por 5 segundos vê uma composição que nunca foi projetada.

**Modelo certo: páginas.** O painel tem N páginas; a página inteira troca de uma vez; entre trocas a tela fica **absolutamente parada**.

Validado com o Forja: **página é mais barato que slot.** O snapshot vem inteiro numa chamada, então trocar de página é troca de nó em memória, sem fetch. O padrão do `RotatingSlot` (41 LOC, `AnimatePresence mode="wait"`) sobe um nível para a grid inteira keyed por `pageIdx` — custo idêntico.

> **Ressalva do Forja que muda a spec:** o `RotatingSlot` de hoje **não tem timer próprio** — ele avança no tick do `TVPeriodContext`. Cadência própria de página é **timer novo**, não reuso. Assumido.

`RotatingSlot` sobrevive apenas como overflow **dentro** de um card fixo (ex.: lista longa de ranking). Não como mecanismo primário.

### 6.2 Parâmetros

- **Cadência: 20 segundos.** Ler 12 números a 3m leva 8–12s; 20s dá folga sem cansar. (Digital signage usa 8–15s para *uma* mensagem; aqui é uma tela densa.)
- **Uma página → sem rotação, sem indicador.** Nunca girar por girar.
- **Transição:** crossfade `--tv-dur-slow` (400ms) + rise 6px, stagger 25ms **apenas nas células que mudam**. **Sem slide horizontal** — slide sugere "dá para voltar", e não dá.

### 6.3 O fio — três âncoras

**a) Widgets fixados (`pinned`).** Não rotacionam; ocupam a mesma célula em todas as páginas. O termômetro de meta é o caso canônico e **já é assim hoje** ("SEMPRE mês civil, não rotaciona" — `TVDashboard.tsx:133`). Formalizar como propriedade.

> É o mecanismo do placar de estádio: o placar nunca sai, o resto gira. Há sempre uma âncora imóvel; só a área ao redor troca.

**b) Título da página.** Cada página tem nome curto no header: `Fechamento` · `Topo de funil` · `Time`. **Sem isso, o espectador não percebe que o contexto mudou e compara maçã com laranja.** Este é o principal risco de perder o fio e ele se resolve com um rótulo, não com animação.

**c) Régua de progresso.** No rodapé do painel: segmentos horizontais, um por página, largura proporcional, 3px. O ativo preenche em `--primary` ao longo dos 20s.

Segmentos, não bolinhas: comunica **posição e tempo restante ao mesmo tempo**. É o problema que os stories do Instagram resolveram — mas aqui em gold e 3px, não branco e gordo.

### 6.4 Teto de densidade

Máx **12 widgets por página**. Se houver um `hero`, máx **8**. Acima disso, o motor distribui em páginas novas.

Não é preferência: a 1080p com valores de 36–56px, 12 células é o ponto onde a escala mínima ainda cabe. Passar disso força tipo menor, e tipo menor quebra a leitura a 3m — que é a razão de a tela existir.

> **O gatilho do teto de 8 é a TIPOGRAFIA, não o tamanho da célula.** Só conta como `hero` o widget que usa `--tv-hero` (56–96px). Um bloco grande em células mas com tipo `--tv-value` — caso do `Thermometer` congelado, que ocupa 3×4 — **não** dispara o teto de 8.
>
> Sem essa distinção, qualquer widget largo derrubaria o teto pela metade e a regra ficaria intratável. Encontrado ao calcular o layout real da v1 (§8.4.6); é correção da regra, não exceção a ela.

**Contabilidade de células.** `pinned` (§6.3a) ocupa a mesma célula em **todas** as páginas, então gasta o orçamento **uma vez por página, sempre** — não uma vez no painel. É o custo escondido do widget fixo e precisa entrar na conta antes de fixar qualquer coisa.

---

## 7. Aviso de virada (Carteira → livro-razão)

> Quando o produtor de Carteira liga, a receita exibida cresce de forma abrupta. Todo relatório salvo, meta e print anterior muda de sentido.

> **Cifras corrigidas contra o banco (não use as do brief original).** Medido em prod pelo Cais: ledger inteiro = **R$ 1.016.510,71** (`trigger` R$ 524.263,81 + `backfill` R$ 492.246,90); Carteira fora do livro = R$ 836.789,84. O brief comparava a Carteira contra os R$ 492k, que são **a fatia de backfill e não o livro**, fazendo o salto parecer maior do que é. A ordem de grandeza real é **~R$ 1,0 mi → ~R$ 1,85 mi** — quase dobra, não quase triplica.
>
> **A microcopy não muda uma vírgula**, porque ela não cita cifra — por decisão deliberada (regra 2: zero adjetivo de magnitude, e cifra é adjetivo de magnitude disfarçado). É a prova prática da regra: o número errado do brief circulou por um ciclo inteiro e **não chegou à parede**, porque a mensagem nunca dependeu dele.

> ⚠️ **`{data-da-virada}` é variável, não literal.** Os exemplos abaixo usam uma data ilustrativa. A data real é **quando a flag do produtor de Carteira for ligada em produção**, que ainda não aconteceu e não é conhecida no momento em que esta spec foi escrita.
>
> Ela precisa vir de **uma fonte única** — a data de ativação da flag, lida em runtime — e nunca ser escrita à mão em três lugares. Os três consumidores (faixa, marcador na linha do tempo, nota de proveniência) têm que ler a mesma origem: se divergirem, o painel afirma três datas diferentes para o mesmo evento contábil.
>
> **Este é um pressuposto meu que quase virou defeito.** Escrevi a data de hoje como ilustração e ela aparecia três vezes lida como literal — implementada ao pé da letra, a faixa subiria anunciando uma virada na data errada. Mesma família do `formatCurrency` sem `R$`: contrato implícito não fica implícito, fica inconsistente.
>
> Os números R$ 492k e ~R$ 1,3 mi vêm do épico #1194, **não** foram verificados por mim. Se a reconciliação der outro valor, a mensagem não muda (ela não cita cifra, de propósito — ver regra 2 de microcopy), mas o contexto desta seção sim.

**Não é toast** (some, ninguém lê). **Não é modal** (a TV é uma parede, ninguém clica). **Não é badge "NOVO"** (isto é mudança de contabilidade, não feature).

Três superfícies, uma mensagem.

### A. Faixa de virada — 30 dias após ligar (TV + Comando)

Faixa de 40px no topo da grid, abaixo do header. Fundo `--warning` a 8%, borda-esquerda 3px `--warning` sólida. Ícone: `git-merge` (Lucide) — **não** triângulo de alerta, que é alarmista para um fato que não é um problema. Texto em `--tv-meta`, uma linha:

> **A receita agora inclui a Carteira.** A partir de {data-da-virada}, pedidos aprovados entram no mesmo total das vendas de funil. Números anteriores a essa data não incluem a Carteira.

### B. Marcador na linha do tempo

Todo widget de formato **linha** cujo eixo temporal cruze a data ganha uma vertical tracejada de 1px em `--warning` a 40%, com rótulo `Carteira` na base.

**Esta é a peça mais honesta das três.** Sem ela, o gráfico mente visualmente mesmo com a faixa no topo: o salto aparece sem explicação no lugar exato onde acontece. É o padrão de *event annotation* de Grafana e Datadog, e existe por esse motivo.

### C. Nota permanente na proveniência

Widget de receita cujo período cruze a data ganha fragmento 4: `· inclui Carteira desde {data-da-virada}`.

**A faixa (A) expira em 30 dias; a nota (C) não expira.** A faixa é o anúncio; a nota é o registro.

### Regras de microcopy aplicadas

Honesto sem assustar, decomposto:

1. **Voz ativa, sujeito é o sistema.** "A receita agora inclui a Carteira." Não "Houve uma alteração no cálculo de receita."
2. **Zero adjetivo de magnitude.** Nada de "grande aumento", "salto", "mudança significativa". O número já é grande — **adjetivar é o que assusta.**
3. **Não pedir desculpa, não dizer "não se preocupe".** Ambos plantam a dúvida que estão tentando remover.
4. **Enquadrar como completude, não como correção.** "agora inclui" > "estava faltando". É verdade e é a leitura certa: o dado sempre existiu, só não estava no livro. "Estava faltando" implica que o sistema errou, e o cliente passa a duvidar de tudo.
5. **Data, não "recentemente".** Data é verificável; "recentemente" é vago e vago assusta.

**Reprovado explicitamente:**
> ⚠️ *Atenção: os valores de receita foram atualizados e podem diferir de relatórios anteriores.*

Passiva ("foram atualizados" — por quem?), alarmista (⚠️ + "Atenção"), vaga (quais valores? quanto?), e **"podem diferir" é covarde** quando você sabe exatamente que diferem e por quê.

---

## 8. Os 17 componentes mapeados

### 8.1 Tabela

| Componente | Vivo? | Destino | Nota |
|---|---|---|---|
| `SalesFunnel` | vivo | **Widget → funil** | Pele boa. Contrato reescrito (hoje pede 8 campos de negócio). Gradientes hex → `--metric-ramp-*`. |
| `SalesThermometer` | **órfão** | **Widget → termômetro** | Melhor peça do lote e está morta. **Ressuscitar como o renderer canônico de progresso-de-meta.** |
| `TVRankingSimple` | vivo | **Widget → ranking** | Base do renderer. 100% hardcoded → tokens. |
| `TVCompetitionBlockV2` | vivo | **Chrome de engajamento** | Ranking **com prêmios e prazo** não é métrica do catálogo — é gamificação. Vira widget de tipo próprio fora do motor. Ver §8.3. |
| `TVCompetitionBlock` (v1) | **órfão** | **Deletar** | Substituído pelo V2. |
| `TVMetricsGrid` | **órfão** | **`MetricCard` promovido → número grande** | O `MetricCard` privado dentro dele **é literalmente o `WidgetFrame`**. Extrair. Grid em volta morre (o motor faz layout). Corrigir bug `bg-${color}/20` (interpolação dinâmica; Tailwind não gera a classe). |
| `ConversionByCloser` | **órfão** | **Absorvido → barra** (razão vendas÷propostas, recorte closer) | **Componente inteiro vira uma spec de 3 campos.** Melhor uso de tokens do lote — usar de referência para o renderer de barra. |
| `NoShowByCloser` | **órfão** | **Absorvido → barra** (razão, recorte closer) | Idem. Duas telas viram duas linhas de config. **É a prova da tese do épico.** |
| `IndividualGoals` | **órfão** | **Absorvido → barra** (progresso de meta, recorte responsável) | Idem. |
| `CloserPerformanceBlock` | vivo | **Absorvido → ranking multi-coluna** | 7 colunas por closer = 7 medidas do catálogo num só recorte. Precisa de variante `ranking` com colunas — ver §8.2 (gap). |
| `SDRPerformanceBlock` | vivo | **Absorvido → 3 widgets de barra** | Hoje 3 colunas num card. Vira 3 widgets independentes, ou 1 ranking multi-coluna. |
| `NewLeadsBlock` | vivo | **Decompõe em 2** | Número grande (leads criados) + linha (por dia). O bloco de origens vira donut separado. |
| `MonthlySales` | **órfão** | **Não é widget** | **O nome mente**: é uma *lista de vendas*, não gráfico. Feed de eventos ≠ métrica agregada. Ver §8.2 (gap). |
| `HotProposals` | **órfão** | **Não é widget** | Lista de leads com calor. Mesmo caso. Ver §8.2. |
| `AICoachSection` | vivo | **Não é métrica — chrome** | Texto gerado por LLM. Fica fora do motor como bloco de tipo próprio. **Melhor tratamento de estados do repo** (loading + error + retry) — usar de referência. |
| `PeriodPill` | vivo | **Chrome** | Único 100% em tokens. Vira controle de período do painel, no header. |
| `RotatingSlot` | vivo | **Chrome, rebaixado** | Deixa de ser mecanismo primário (§6.1). Sobrevive como overflow interno. Corrigir 2 bugs: `panels[idx]` sem guard, e `useEffect` sem skip-first (nunca mostra `panels[0]`). |

### 8.2 Os 3 gaps — ✅ DECIDIDO: os três vão para o v2

> **Decisão do CTO.** O catálogo v1 fica **exatamente como o grill fechou**: ranking de 1 medida, sem pace. Os três gaps — (a) lista de registros, (b) ranking multi-medida, (c) pace no termômetro — vão **todos para o v2**.
>
> O desenho abaixo **continua válido**; só mudou o *quando*. Está preservado para as issues do v2 nascerem prontas.
>
> **Consequência de escopo:** os dois componentes que dependem de (b) e (c) **não migram na v1** — ficam legado, intocados. Migrá-los sem b e c entregaria menos do que a TV já faz, o que é regressão em tela viva. Detalhe em §8.4.

> **Registro de erro de processo, mantido de propósito.** Antes desta decisão, li uma recomendação do Pauta no terminal dele e a propaguei como decisão do CTO — marquei itens com ✅ nesta seção. O Pauta corrigiu. **Regra: se não vi a fala do CTO, não houve fala do CTO.**
>
> O registro fica **porque a decisão real saiu diferente da recomendação** — o Pauta havia recomendado b e c no v1, e o CTO mandou os dois para o v2. Isso prova o ponto melhor do que qualquer aviso: recomendação e decisão não são a mesma coisa, e tratar uma como a outra teria colocado no v1 um escopo que o CTO recusou.

#### (a) Listas de registros — **v2**

`MonthlySales` (feed de vendas) e `HotProposals` (leads quentes). O catálogo agrega; estes **listam registros individuais**. Não há medida+recorte+formato que produza "as 8 vendas mais recentes com nome do lead".

**Consequência, se aprovado como v2:** os dois morrem na migração sem substituto. Ambos já são órfãos hoje, então não há regressão de tela viva — mas **há perda de intenção**: um time de vendas quer ver o nome de quem fechou, e a parede deixa de dar isso até o v2. Registrado para não ser redescoberto como bug.

> **Pré-requisito do v2, não detalhe de implementação: lista de registros numa parede é PII em tela pública.**
>
> Nome de lead, empresa e valor de proposta ficam expostos a quem passa na sala — visita, faxina, candidato em entrevista. A TV não tem sessão de leitor: ela roda em conta fixa e fica ligada sem ninguém na frente. **Isso é decisão de permissão, não de formato**, e precisa estar resolvida *antes* de o formato existir — senão o formato nasce e o vazamento vem junto.
>
> Direção mínima para quando o v2 for desenhado: o formato precisa de um modo de exibição que preserve a utilidade sem o identificador (iniciais, primeiro nome, ou só o valor e o closer), e a escolha entre modos precisa ser uma permissão de org, não uma opção estética de quem monta o painel. Sinalizado ao Cais.

#### (b) Ranking multi-medida — **v2**

`ranking` aceita **até 3 medidas**: uma ordena, duas acompanham. Sem isso `CloserPerformanceBlock` regride de 7 colunas para 1.

O risco de desenho é óbvio: 3 números por linha a 3 metros vira tabela financeira, e tabela financeira não se lê de longe. A saída é **hierarquia interna dura** — as três medidas não são pares.

```
  RECEITA POR CLOSER
                              vendas   conv.
  ① Marina         412k          18     32%
  ② Caio           288k          11     24%
  ③ Rafa           201k           9     21%
```

| Papel | Tamanho | Cor | Peso | Alinhamento |
|---|---|---|---|---|
| **Medida ordenadora** (1ª) | `--tv-value-sm` | `--foreground` | 600 | direita, `tabular-nums` |
| **Acompanhantes** (2ª, 3ª) | `--tv-meta` | `--muted-foreground` | 450 | direita, `tabular-nums` |

Regras:
- **Cabeçalho de coluna só para as acompanhantes**, em estilo eyebrow, uma vez no topo. A ordenadora não leva cabeçalho — o eyebrow do widget já a nomeia. Isso remove uma linha de ruído e deixa claro qual coluna manda.
- **A micro-barra codifica só a ordenadora.** Três barras por linha é ilegível.
- **Acompanhantes nunca ganham cor de estado.** Uma conversão de 21% não é "ruim" — é um fato. Colorir aqui recria o arco-íris que §2.4 mata.
- **Teto de 3 é rígido.** Widget com 3 medidas exige peso `primary` ou `hero`; em `secondary` o motor derruba para 1 medida. Não cabe e não adianta tentar.
- **Máx 5 linhas + `e mais N`.**

> `CloserPerformanceBlock` tem 7 medidas hoje. Com teto de 3, o cliente monta **dois widgets de ranking** — ex.: `receita · vendas · conversão` e `reuniões · propostas · ticket`. Isso é melhor que a grade de 7 colunas atual, que a 3m ninguém lê inteira de qualquer forma. **A migração não é perda; é a grade admitindo que sempre foi densa demais para a parede.**

#### (c) Pace no termômetro — **v2**

"Onde deveria estar hoje" é **propriedade do formato termômetro**, não medida nova do catálogo — é derivação (`meta × fração do período decorrido`). Barato, e preserva a informação mais acionável da tela.

Já existe em `SalesThermometer` e no `Thermometer` inline do `TVDashboard`. O que a spec fixa:

- **Marcador**: linha tracejada de 1px, largura total do tubo, em `--foreground` a 55%. Tracejada e não sólida — sólido lê como "meta", e a meta já é o topo. Tracejado lê como "referência".
- **Rótulo do marcador**: `esperado` em `--tv-meta`, `--muted-foreground`, à esquerda do tubo, alinhado verticalmente ao marcador. Sem valor numérico — o valor está na escala ao lado, e repetir polui.
- **Delta**: no rodapé do widget, acima da proveniência. `↑ R$ 84k acima` / `↓ R$ 31k atrás`, em `--success`/`--destructive`. **É o único lugar do termômetro onde cor de estado aparece** — o preenchimento do tubo é sempre gold, nunca verde/vermelho.
- **Marcador acima de 100%**: fixa no topo e o rótulo vira `esperado (batido)`.
- **Período sem pace definido** (meta sem janela): marcador some, delta some. Nada de marcador em posição 0.

> **Por que o tubo não muda de cor.** Tentação óbvia: verde quando adiantado, vermelho quando atrasado. Errado — o tubo codifica *progresso*, o delta codifica *julgamento*. Misturar os dois faz o mesmo pixel carregar duas informações e a 3m só uma chega. Separar é o que permite ler "quanto" e "bom ou ruim" em duas sacadas independentes.

### 8.3 O que MELHORA

1. **Estados deixam de ser opcionais.** Hoje só `AICoachSection` trata loading + error. 3 componentes vivos renderizam zeros durante o fetch — **numa parede, zero parece dado real**. O `WidgetFrame` torna os 4 estados estruturais: impossível esquecer, porque não há onde esquecer.
2. **Uma escala tipográfica.** De 14+ tamanhos arbitrários para 5 degraus, e o valor cresce 2–3×. É a mudança mais visível.
3. **Uma formatação de valor.** Hoje **14 arquivos da TV** tocam `toFixed`/`Intl.NumberFormat` com regras divergentes, e a função central tem 4 defeitos em 4 linhas (§2.6b). O motor devolve valor + unidade; a formatação vive num lugar só.
4. **Uma implementação de ranking.** Hoje três coexistem (`TVCompetitionBlock`, `V2`, `TVRankingSimple`), com a ordenação de pódio `[2º,1º,3º]` duplicada nas três.
5. **8 órfãos resolvidos.** 4 viram renderers, 3 viram spec de 3 campos, 1 é deletado. ~1.000 LOC mortas saem do repo.
6. **A âncora temporal passa a existir.** Hoje não há nenhuma, em lugar nenhum — e "leads na etapa" (retrato) convive com "leads criados" (fluxo) sem distinção visual. Isso é leitura errada em produção agora.

---

### 8.4 Migração híbrida — a v1 sai com zero regressão

> **Decisão do CTO: opção A.** Os componentes que dependem de (b) e (c) não migram na v1. Ficam legado, intocados na lógica. A TV fica híbrida por um tempo: **feia por dentro, idêntica por fora.**

#### 8.4.1 Correção de escopo — o termômetro congelado não é o `SalesThermometer`

Verificado por `grep`:

| Arquivo | Importadores | Status |
|---|---|---|
| `components/tv/SalesThermometer.tsx` | **zero** | **ÓRFÃO — está morto** |
| `Thermometer` inline em `pages/TVDashboard.tsx:349-457` | é o que a parede renderiza | **VIVO — é ele que tem o marcador de ritmo** |
| `components/tv/CloserPerformanceBlock.tsx` | `TVDashboard.tsx:16`, `:251` | VIVO ✓ |

**Se a fatia disser "SalesThermometer não migra", congela-se um arquivo morto (efeito zero) e migra-se o termômetro vivo — perdendo o marcador `esperado`.** É exatamente a regressão que a opção A existe para impedir, acontecendo por causa do nome no papel.

> **Os 2 congelados são: `CloserPerformanceBlock` e o `Thermometer` inline de `TVDashboard.tsx`.**
> `SalesThermometer` (órfão) segue o destino dos outros órfãos — recomendo **guardar como referência visual** do renderer de termômetro do v2; é a melhor peça do lote.

#### 8.4.2 Como os 2 legados convivem — **frame sim, corpo não**

Nem shim solto, nem "assume que fica diferente". **Contêiner de compatibilidade**, e é a opção barata.

Os 2 legados são **embrulhados no `WidgetFrame`** — herdam moldura, eyebrow, escala tipográfica, superfície, borda e **a faixa de proveniência**. O corpo continua legado, intocado. **O contrato de props não muda.**

Mais uma passada mecânica *dentro* dos 2 arquivos: trocar hex/rgba hardcoded pelos nomes de token, para herdarem `[data-surface="tv"]`. Isso é achar-e-substituir de cor e tamanho de fonte — **não** é mudança de contrato.

**Por que esta e não as outras duas saídas:**

1. **A parede lê como sistema por causa da moldura, não do corpo.** A 3 metros ninguém vê estrutura interna. Igualadas moldura, paleta e escala, a incoerência deixa de existir **opticamente** mesmo com o interior legado.
2. **A faixa de proveniência é invariante duro** (§4: "presente em 100% dos widgets"). Se 2 de 17 não a têm, a regra morre no dia 1 e o argumento de "repetida vira textura, não ruído" desaba junto. Os 2 legados sabem a própria âncora — é string estática, não vem do motor. Custo ≈ zero.
3. **Prova a costura.** Se a moldura aguenta um corpo legado, o `WidgetFrame` está no lugar certo. Se não aguentar, isso se descobre na v1 e barato, não na v2 e caro.

**Critério de aceite da fatia de compatibilidade:**
- [ ] Os 2 legados renderizam dentro de `WidgetFrame`, com eyebrow e faixa de proveniência.
- [ ] `grep -E '#[0-9a-fA-F]{6}|rgba?\('` nos 2 arquivos retorna vazio.
- [ ] Tipografia dos 2 usa os 5 degraus `--tv-*`; nenhum `text-[Npx]` arbitrário.
- [ ] **Props e lógica de negócio inalteradas** — o diff não toca campo nenhum.
- [ ] **`CloserPerformanceBlock` deixa de renderizar zeros durante o fetch.** É o único bug de estado que *ativamente engana* numa parede, e ficaria em produção a v1 inteira. Pequeno, alto retorno.

#### 8.4.3 Layout — os 2 vivem DENTRO do grid

Como **célula fixa (`pinned`)**, com `w`/`h` declarados e um id de renderer que o motor reconhece mas não avalia — `legacy:closer-performance`, `legacy:thermometer`. Sem medida, sem recorte: célula reservada.

**Por que dentro e não fora:** se vivessem fora, a parede passaria a ter **dois sistemas de posicionamento**, e o Comando herdaria essa bagunça quando o drag chegar. Com eles dentro, o grid continua fonte única de layout, e **matar o legado no v2 é trocar um id de renderer — não é re-diagramar a parede.**

Ambos obrigatoriamente `pinned`: o termômetro já é a âncora imóvel da rotação (§6.3a), e o `CloserPerformanceBlock` não é dirigido pelo período do motor, então não pode entrar no rodízio de páginas.

#### 8.4.4 O número "15" é mole — quebra real dos 17

O enunciado "15 migram, 2 ficam" mistura trabalhos muito diferentes. Quebrando de verdade:

| Grupo | Qtd | Componentes | Trabalho |
|---|---|---|---|
| **Congelados** (§8.4.1) | 2 | `CloserPerformanceBlock`, `Thermometer` inline | Compatibilidade, sem tocar lógica |
| **Órfãos** | 8 | `SalesThermometer`, `ConversionByCloser`, `NoShowByCloser`, `TVMetricsGrid`, `HotProposals`, `MonthlySales`, `IndividualGoals`, `TVCompetitionBlock` v1 | **Deleção**, não migração. 4 colhidos como referência de renderer; 3 viram spec de 3 campos; 1 deletado |
| **Chrome** | 2 | `PeriodPill`, `RotatingSlot` | Reposicionados, não migrados |
| **Não são métrica** | 2 | `AICoachSection`, `TVCompetitionBlockV2` | Ficam fora do motor por natureza |
| **Viram widget do motor** | **5** | `SalesFunnel`, `SDRPerformanceBlock`, `NewLeadsBlock`, `TVRankingSimple`, `KPICard` inline | Conversão real |

**Cinco conversões reais.** Isso **não reduz o trabalho** — o Forja já apontou que o custo está no *contrato* (nenhum dos 17 aceita `{label, value}[]`, então os renderers são reescrita e não wrapper). Mas muda o **fatiamento**: 5 conversões + 1 fatia de deleção + 1 fatia de compatibilidade é um mapa diferente de "15 migrações".

#### 8.4.5 Dois riscos adicionais no que sobrou

**(a) `SDRPerformanceBlock` tem o mesmo furo do Closer, menor.** São 3 colunas, cada uma com número grande + top-4 + **rodapé com uma taxa** (no-show %). Número + taxa por coluna = 2 medidas — mesmo gap de multi-medida.

→ **Não recomendo congelar.** Vira 3 rankings + 1 widget de razão para a taxa = 4 células no lugar de 1 card. Isso é **mais** informação, não menos. Mas é **orçamento de layout**, não de catálogo: precisa caber dentro do teto de 12 widgets/página (§6.4).

**(b) `NewLeadsBlock` depende do renderer de LINHA**, um dos 3 que nascem do zero. Se linha atrasar, a migração dele perde o sparkline diário.
→ Não é furo de catálogo, é **sequenciamento**: `NewLeadsBlock` não pode entrar em fatia anterior à do renderer de linha.

#### 8.4.6 Orçamento de layout da v1 — **veredito: `SDRPerformanceBlock` MIGRA**

O Cais devolveu a decisão como constraint condicional: migra se o grid absorver as 4 células, congela se não. Fiz a conta.

**Inventário da parede v1** — 19 widgets:

| Origem | Widgets | Células |
|---|---|---|
| `Thermometer` (pinned, legado) | 1 | 3×4 = 12 |
| `CloserPerformanceBlock` (pinned, legado) | 1 | 4×2 = 8 |
| `KPICard` inline → números grandes | 6 | 6 × (2×1) = 12 |
| `SDRPerformanceBlock` → 3 rankings + 1 razão | 4 | 3×(3×2) + 1×(3×1) = 21 |
| `NewLeadsBlock` → número + linha + donut | 3 | 2×1 + 4×2 + 3×2 = 16 |
| `SalesFunnel` → funil | 1 | 5×3 = 15 |
| `TVRankingSimple` → ranking | 1 | 3×2 = 6 |
| `AICoachSection` + `TVCompetitionBlockV2` (fora do motor) | 2 | 2 × (3×2) = 12 |

Grid = 12 × 6 = **72 células por página**. Os 2 `pinned` comem **20 células em toda página**.

**Distribuição em 2 páginas:**

| Página | Conteúdo | Widgets | Células |
|---|---|---|---|
| **1 — Fechamento** | 2 pinned + 6 números + funil + ranking | **10** | 20 + 12 + 15 + 6 = 53 / 72 |
| **2 — Time e topo de funil** | 2 pinned + 4 do SDR + 3 do NewLeads + coach + competição | **11** | 20 + 21 + 16 + 12 = 69 / 72 |

Ambas **abaixo do teto de 12**, e nenhuma usa `--tv-hero`, então o teto de 8 não dispara (regra esclarecida em §6.4).

> **Veredito: `SDRPerformanceBlock` migra. Não congela.** As 4 células cabem, e a decisão do Cais está certa pela razão certa — ele não precisa de capacidade da v2; ranking-de-1 + razão da v1 cobrem o caso exatamente.

**Duas observações que saem da conta e valem registro:**

1. **A pergunta "cabe em uma tela?" é malformada.** Não cabe, e **nunca coube** — a TV de hoje já esconde conteúdo atrás de `overflow-y-auto` (§ auditoria), que numa parede é conteúdo que ninguém rola. Páginas não são um recurso para o excesso; são o que torna o excesso legível. 19 widgets em 2 páginas é confortável; 19 numa página seria ilegível a qualquer distância.

2. **Os 2 `pinned` legados custam 20 de 72 células — 28% de cada página, permanentemente.** A página 2 fecha em 69/72, ou seja **sem folga**. É o preço real da TV híbrida, e ele não aparece em nenhuma fatia porque está diluído.
   → **Argumento para matar o legado cedo no v2**, e para não fixar mais nada enquanto ele existir. Se aparecer um widget novo obrigatório na v1, a página 2 estoura e a saída será uma terceira página — não um encolhimento de tipo.

## 9. Prévia da montagem (direção, não tela final)

> A TV é read-only. Mas a edição nasce no Comando, e cinco decisões precisam estar tomadas **agora** para não pintar a gente num canto.

**1. A grid é o contrato.** 12×6, célula com `w`/`h`, gap 20px, padding 24px. O épico já põe posição em **coluna real** (não JSON) — correto. A TV read-only já persiste no formato que o drag vai usar. O Comando só adiciona o arrasto.

**2. `WidgetFrame` é o MESMO componente nas duas telas.** Não duplicar. Muda só o escopo de tema: `data-surface="tv"` vs `data-surface="app"`, com a escala tipográfica compacta no segundo. Isso **paga a dívida de convergência** que o próprio épico registra (TV e Comando em arquivos de tipo separados, formatos quase idênticos mas divergentes).

**3. Edição é uma camada, não outro componente.** Ao editar: overlay de grid (1px `--border` a 30%), handle de resize no canto SE, sombra de arrasto. **O widget continua renderizando dado real durante o arrasto** — não vira retângulo cinza. Notion e Linear arrastam conteúdo vivo; Grafana vira placeholder e é pior.

**4. Preview é contínuo, não um botão.** O motor já tem `get_metric_widget` para isso. Config à direita, widget em **tamanho real** à esquerda, atualizando a cada mudança com debounce de 300ms. Não existe botão "Pré-visualizar".

**5. A montagem é uma frase, não um formulário.** Esta é a decisão de maior impacto e a que precisa ser tomada antes de o Comando começar.

Em vez de 4 dropdowns empilhados:

```
[Receita] por [closer] em [barra], base [fechamentos no período]
```

Cada colchete é um popover de escolha. Por quê:
- **A frase fica agramatical antes de ficar errada.** "Tempo médio na etapa por origem em termômetro" *soa* errado — o usuário auto-corrige sem precisar de validação bloqueante.
- É o padrão de query-builder do **Linear** (filtros) e do **Stripe Sigma**. Ambos escolheram frase sobre formulário para o mesmo problema: composição livre sobre vocabulário fechado.
- Formulário de 4 selects trata as 4 escolhas como independentes. **Elas não são** — o formato depende do recorte, a âncora depende da medida.

**6. NÃO construir** — os três caminhos mais curtos para a colcha de retalhos:
- seletor de cor por widget
- ícone por widget
- título livre longo (limitar a override de ≤ 28 caracteres)

Cada um destrói o sistema visual e nenhum resolve um problema real do usuário.

---

## 10. Aceite (checklist para o QA visual)

**Sistema**
- [ ] Nenhum hex, `rgba()` ou cor Tailwind crua (`text-blue-400`) em `components/tv/`. Só `hsl(var(--…))`.
- [ ] `grep -rE '#[0-9a-fA-F]{6}|rgba?\(' src/modules/analytics/components/tv/` retorna vazio.
- [ ] Nenhum `text-[Npx]` arbitrário. Só os 5 degraus `--tv-*`.
- [ ] Formatação num lugar só, consumida por todos os renderers **e** pela escala do termômetro (§2.6b).
- [ ] `Intl.NumberFormat('pt-BR')` — zero ocorrências de `.toFixed()` em valor exibido.
- [ ] Compacto usa `mil`/`mi`, nunca `K`/`M`.
- [ ] `tempo médio na etapa` troca de unidade em 48h; nunca renderiza `77 horas`.
- [ ] Ranking sem avatar cai em iniciais, nunca em silhueta genérica (§2.6c).

**Legibilidade (medir a 3m, ou a 55cm num monitor 27" — equivalente óptico)**
- [ ] Todo valor de cabeça legível a 3 metros.
- [ ] Eyebrow e proveniência legíveis a 1,5 metro.
- [ ] Valores em `tabular-nums` — números não dançam ao trocar.
- [ ] Nenhum valor em peso > 600.

**Cor**
- [ ] No máximo 2 valores em gold por página.
- [ ] `--success`/`--destructive` só em delta e ganho/perda. Nenhum valor neutro colorido.
- [ ] `TVKpi.color` removido da interface.
- [ ] Widget continua legível em escala de cinza (prova de que a informação não depende de cor).
- [ ] Colunas acompanhantes do ranking **sem** cor de estado.
- [ ] Tubo do termômetro sempre gold — nunca verde/vermelho.

**Ranking multi-medida (§8.2b) — v2, não verificar na v1**
- [ ] Máx 3 medidas. Em peso `secondary`, o motor derruba para 1.
- [ ] Só a ordenadora tem micro-barra.
- [ ] Cabeçalho de coluna só nas acompanhantes.
- [ ] Máx 5 linhas + `e mais N`.

**Termômetro com pace (§8.2c) — v2, não verificar na v1**
- [ ] Marcador tracejado, não sólido.
- [ ] Rótulo `esperado` sem valor numérico repetido.
- [ ] Delta é o único elemento com cor de estado.
- [ ] Sem pace definido → marcador e delta somem (nunca marcador em 0).

**Estados**
- [ ] Os 4 estados verificados em cada um dos 7 formatos.
- [ ] **Nenhum `0` renderizado durante carregamento**, em nenhum widget.
- [ ] Widget com erro mantém a célula; a grid não dança.
- [ ] Vazio é `—` + `· sem registros`. Nenhuma frase de placeholder.
- [ ] Nenhum código de erro ou stack visível na tela.

**Proveniência**
- [ ] Presente em 100% dos widgets, sem exceção.
- [ ] Fragmento de âncora nunca truncado.
- [ ] Nunca quebra em duas linhas.
- [ ] "situação de hoje" aparece em `leads na etapa` e `tempo médio na etapa`; "fechamentos" em receita e vendas.

**Motion**
- [ ] **Zero animação em loop infinito.** (Hoje há 3: `tvLive`, `tvSheen`, pulso do bulbo do termômetro.)
- [ ] `backdrop-blur` removido de `components/tv/`.
- [ ] Refetch de 30s não re-anima barras nem re-dispara entrada.
- [ ] `prefers-reduced-motion`: entrada vira fade 150ms sem translate; rotação vira corte seco.
- [ ] Uma única curva de easing (`--tv-ease-out`).

**Rotação**
- [ ] Uma página → sem rotação e sem indicador.
- [ ] Widget `pinned` na mesma célula em todas as páginas.
- [ ] Toda página tem título.
- [ ] Régua de progresso indica posição **e** tempo restante.
- [ ] Tela absolutamente parada entre transições.

**Virada**
- [ ] Faixa presente em TV e Comando; expira em 30 dias.
- [ ] Widget de linha que cruza a data tem o marcador vertical.
- [ ] Nota de proveniência é permanente.
- [ ] Microcopy sem ⚠️, sem "Atenção", sem voz passiva, sem adjetivo de magnitude.
- [ ] **A data da virada vem de fonte única lida em runtime.** Zero data literal no código; faixa, marcador e nota de proveniência leem a mesma origem e nunca divergem.

**Acessibilidade**
- [ ] Contraste conforme §2.1 (foreground AAA, muted AA).
- [ ] `WidgetFrame` com `aria-label` completo quando a proveniência colapsa.
- [ ] Informação nunca codificada só por cor.
- [ ] Sem dependência de hover para nenhum dado.

---

## 11. Referências citadas

| Produto | O que aproveitamos |
|---|---|
| **Apple TV / tvOS** | Dois orçamentos de distância — título enorme, metadata pequena. Tom de erro: fato + o que está sendo feito, sem código. |
| **Linear** | Hierarquia por peso e posição, não por cor. Escala tipográfica curta. Carrega estrutura e preenche, em vez de skeleton de tela. Query-builder como frase. |
| **Stripe** (Dashboard, Reporting, Sigma) | Delta colado ao número. Nota de escopo fixa sob o valor, não em hover. Numerais tabulares. Composição livre sobre vocabulário fechado. |
| **Vercel** | Superfície neutra + um accent só. Remoção agressiva de chrome de gráfico. |
| **Grafana / Datadog** | *Event annotation* — marcador vertical no ponto exato onde a série muda de significado. |
| **Instagram Stories** | Régua segmentada que resolve posição + tempo restante ao mesmo tempo. |
| **Placar de estádio** | Âncora imóvel + área que gira. É o modelo de rotação sem perder o fio. |
| **Monday.com** | Modelo do épico: coluna tipada semanticamente + widget como configuração interpretada em runtime. |

---

## 12. Pendências e sinalizações

**Verificação visual BLOQUEADA.** O projeto dev `bcfadphgsibjzivtbjvc` foi **aposentado** pelo CTO (2026-07-22) — estava 404 migrations atrás de prod. O padrão novo é **branch efêmera do Supabase a partir de prod**, mas ela está travada: o replay das 840 migrations do repo morre em jan/2026, e destravar exige o **baseline do histórico** (dump do schema de prod → migration `0001`, as antigas para `archive/`). O CTO autorizou o baseline e o Forja está nisso.

Enquanto não replayar, **não existe ambiente de validação** e a `/tv` não pode ser vista. A Bancada se recusou, corretamente, a fabricar login.

A rota é `/tv`, **standalone** (sem `LayoutWrapper`, monta `OrgFeaturesProvider` explícito — `src/App.tsx:493-503`), gated por `FeatureRoute feature="tv_dashboard"`, que vem de `subscription_plans.features` e não de flag por org (§5.6).

Esta spec foi construída sobre **leitura de código, não sobre a tela viva**. Nada aqui deve mudar em substância — o diagnóstico vem de fontes primárias (os 17 arquivos, os tokens, o épico). Mas **os cinco degraus da escala tipográfica merecem prova ocular antes de o Forja implementar**: são o coração da spec e a única parte cujo acerto depende de ver a parede. Recomendo que a primeira coisa a subir em dev seja um widget só, em cada peso, para calibrar.

**Decisões escaladas — ✅ RESOLVIDAS pelo CTO. Os três vão para o v2.**

Catálogo v1 fica como o grill fechou: ranking de 1 medida, sem pace. Desenho dos três preservado em §8.2 para as issues do v2 nascerem prontas. Estratégia de migração: **opção A**, detalhada em §8.4.

1. `ranking` até 3 medidas → **v2** (§8.2b)
2. Pace no termômetro → **v2** (§8.2c)
3. `lista de registros` → **v2**, com **pré-requisito de permissão/PII** (§8.2a)

**Dívida pré-existente registrada, fora do escopo desta fatia:**
`--chart-2` é literalmente `--success` e `--chart-4` é praticamente `--destructive` no tema do app. Todo gráfico categórico do produto pinta uma categoria de "bom" e outra de "ruim" sem que o dado diga isso. Corrigido aqui **apenas** dentro de `[data-surface="tv"]` (§2.5).

**Ao Forja:** três mudanças de contrato, não só de CSS — `TVKpi.color` sai da interface; os 7 renderers precisam aceitar `{label, value}[]` (nenhum dos 17 aceita hoje); rotação de página precisa de timer novo (o `RotatingSlot` não tem um).
