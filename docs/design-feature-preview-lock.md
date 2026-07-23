# Spec visual — Preview Lock (tela de bloqueio como momento de venda)

> Contexto: épico **#1194** (TV montável). Surgiu como sinalização em `docs/design-tv-composable-widgets.md` §5.6.
> Autor: Design · Status: **spec para implementação** · **Independente do catálogo e do acesso a dev.**
> Primeiro consumidor: `tv_dashboard`. Desenhado como **padrão**, não como tela avulsa.

---

## 0. O achado que motiva isto

`tv_dashboard` não é flag por organização — vem de `subscription_plans.features` (jsonb), `false` no plano base, `true` nos três superiores. **A TV é recurso de plano pago.** Quem não tem cai em `FeatureLockedScreen`.

Li a tela atual (`src/modules/platform/components/feature-lock/FeatureLockedScreen.tsx`). **Ela está correta para a maioria das features e errada para esta.** Dois problemas, um de fundo e um que é bug de layout:

### Problema 1 — a TV é a única feature que se vende com uma imagem

Todas as outras features bloqueadas são **fluxos**: workflows, campanhas, carteira. Um fluxo se explica em uma frase, e a tela genérica ("X está bloqueado · Disponível no plano Y · Fazer upgrade") faz um trabalho honesto.

A TV é **uma imagem**. Ninguém entende "painel de parede em tempo real" por descrição — a pessoa precisa *ver* a parede. É a única feature do produto cujo valor inteiro é visual e cujo argumento de venda cabe numa tela.

Descrever a TV em texto é como vender um filme lendo a sinopse.

### Problema 2 — em `/tv` a tela bloqueada é um beco sem saída

`/tv` é rota **standalone**: sem `LayoutWrapper`, portanto **sem topnav, sem sidebar, sem nada** (`src/App.tsx:493-503`). Nas demais rotas, `FeatureLockedScreen` aparece dentro do layout — o usuário lê e clica em outra coisa.

Em `/tv` ele aparece sozinho numa página vazia, com `min-h-[60vh]` centralizado no nada. **Não existe caminho de volta além do botão do navegador.** O único botão da tela abre link externo ou joga em `/configuracoes`.

> Isto é um bug de UX real, presente em produção agora, e independe de tudo que esta spec propõe. **Corrigir mesmo que o resto seja recusado.**

---

## 1. A decisão: um padrão novo, não uma tela especial

A saída preguiçosa é fazer uma página bonita só para a TV. Recuso — vira precedente para 20 telas de bloqueio artesanais e ninguém mantém isso.

Proponho **duas variantes** de bloqueio, e uma regra clara de quando cada uma vale:

| Variante | Quando | Feature |
|---|---|---|
| `FeatureLockedScreen` (atual) | O valor da feature se explica em uma frase | workflows, campanhas, carteira, o resto |
| **`FeaturePreviewLock`** (novo) | O valor da feature **é** visual e demonstrável sem interação | `tv_dashboard` — hoje, o único |

**Critério de admissão, para não virar farra:** só entra em `FeaturePreviewLock` a feature que pode ser exibida **estática, sem interação e sem dado real**, e que perde a maior parte do argumento quando reduzida a texto. Hoje isso é uma feature: a TV. Se um dia forem duas, ótimo. Se alguém quiser a terceira "porque fica bonito", o critério é a resposta.

---

## 2. Anatomia

```
┌────────────────────────────────────────────────────────────┐
│  [Torque]                                        Voltar ✕  │ ← escape SEMPRE visível
│                                                            │
│    ┌──────┐  ┌────────────┐  ┌────────┐  ┌────────┐        │
│    │ 78%  │  │ R$ 412,0k  │  │ ▓▓▓▓▓  │  │  ①②③   │        │ ← a TV de verdade,
│    │ meta │  │  receita   │  │ funil  │  │ranking │        │   renderizada,
│    └──────┘  └────────────┘  └────────┘  └────────┘        │   com dado de exemplo,
│                                                            │   sob scrim
│  ┌──────────────────────────────────────┐                  │
│  │ Painel de parede                     │                  │
│  │                                      │  ← card ancorado │
│  │ Os números do dia numa TV do         │    embaixo-esq,  │
│  │ escritório. Atualiza sozinho.        │    NUNCA no meio │
│  │                                      │                  │
│  │ [Fazer upgrade]   [Voltar]           │                  │
│  │ Disponível no plano Performance      │                  │
│  └──────────────────────────────────────┘                  │
│                                                            │
│                                    exemplo · não são seus  │ ← marca d'água fixa
└────────────────────────────────────────────────────────────┘
```

### 2.1 O fundo é a TV de verdade, não um PNG

**Não usar screenshot.** Um PNG fica velho na primeira mudança de layout, não acompanha tema, não localiza, e pesa.

O fundo é o **renderer real** — os mesmos `WidgetFrame` da spec do #1194 — alimentado por um **snapshot de demonstração estático**, com a mesma forma que `get_dashboard_snapshot` devolve.

Isso é quase de graça e é a razão de esta spec depender do #1194: **quando o motor existe, a prévia é uma constante de dados, não uma tela.** Ela nunca fica desatualizada, porque é a TV.

Tratamento do fundo:
- `scale(0.82)`, origem no topo, para caber a composição inteira e ler como "peça exposta", não como app em uso.
- `opacity: 0.55` + scrim de gradiente: transparente no topo → `--background` a 92% na base esquerda, onde o card fica. Gradiente e não overlay chapado — chapado apaga o produto que você está vendendo.
- `pointer-events: none` no fundo inteiro. Nada ali é clicável, e um clique que não faz nada frustra mais que um bloqueio honesto.
- **Sem animação.** Nem entrada escalonada, nem rotação de página. Isto é uma vitrine, não uma demo rodando. Movimento aqui sugere que a feature está ligada.

### 2.2 O dado de exemplo — regra dura

> **O snapshot de demonstração é constante, versionado em código, e nunca vem do banco.**

Três razões, em ordem de gravidade:

1. **Isolamento.** Puxar dado de outra org para "ficar convincente" é vazamento cross-tenant numa tela cuja função é ser vista por quem não tem acesso. Não é hipótese remota: é o caminho que uma implementação apressada toma naturalmente.
2. **Não entregar a feature de graça.** Puxar o dado *da própria org* seria dar a TV para quem não pagou — mal renderizada, mas dada.
3. **Honestidade.** Números plausíveis sem marcação viram print no WhatsApp e alguém acha que são os dele.

Por isso a **marca d'água é obrigatória e permanente**: `exemplo · não são seus números`, no canto inferior direito, `--tv-meta`, `--muted-foreground` a 70%. Nunca some, nunca é coberta pelo card.

E os nomes do ranking de exemplo **não podem parecer time real**: usar `Vendedor A` / `Vendedor B` / `Vendedor C`. Nomes próprios inventados (`Marina`, `Caio`) parecem gente e reintroduzem o problema de PII por confusão — alguém do time vai perguntar quem é a Marina.

> Isto conecta com o pré-requisito de PII registrado em `design-tv-composable-widgets.md` §8.2(a). Mesma raiz: **a TV é vista por quem não está autenticado nela.** Aqui a superfície é ainda mais exposta, porque a tela de bloqueio é, por definição, mostrada a quem não tem o direito.

### 2.3 O card — ancorado, não centralizado

Card no canto **inferior esquerdo**, `max-width: 30rem`, margem de 48px.

**Nunca centralizado.** Modal no meio cobre exatamente o que você está vendendo. Este é o erro mais comum em paywall com prévia, e é o motivo de a maioria delas não converter: a pessoa vê um retângulo, não um produto.

Inferior-esquerdo e não inferior-direito: leitura ocidental começa à esquerda, e o canto direito fica livre para a marca d'água.

| Elemento | Token | Nota |
|---|---|---|
| Superfície | `--popover`, `border` 1px `--border` | Sólida. Sem blur: o fundo já está sob scrim. |
| Raio | `--radius` (0.75rem) | |
| Título | `text-2xl`, peso 600, tracking `-0.02em` | **Nome do que a feature FAZ**, não o rótulo técnico |
| Descrição | `text-sm`, `--muted-foreground`, máx 2 linhas | |
| CTA primário | `gradient-primary`, peso 600 | Padrão já existente no repo |
| CTA secundário | `variant="ghost"` | **Voltar** — hoje não existe |
| Plano-alvo | `text-xs`, `--muted-foreground` | **Abaixo** dos botões, não acima |

**Sem ícone de cadeado.** O `FeatureLockedScreen` atual põe um cadeado âmbar de 64px no topo. Numa tela que quer vender, o primeiro elemento não pode ser o símbolo de "você não pode". O scrim já comunica bloqueio; o cadeado só repete em tom acusatório.

**Plano-alvo abaixo dos botões** porque a ordem de leitura importa: primeiro o que é, depois o que fazer, e só então o preço. Invertido, a pessoa lê "plano Performance" antes de saber o que ganha e descarta. É a ordem de qualquer página de produto bem feita.

### 2.4 Escape — corrigir independentemente

Barra superior fina (56px), fundo `--background`, borda inferior `--border`:
- Logo Torque à esquerda.
- **Voltar** à direita, com ícone `X`, sempre visível.

`Voltar` usa `navigate(-1)` com fallback para `/` — em rota standalone alcançada por link direto não há histórico.

Teclado: `Esc` fecha, com o mesmo destino. **`autoFocus` no CTA primário** — quem chega ali por link direto e usa teclado precisa de um ponto de entrada.

---

## 3. Microcopy

Aplico as mesmas regras da spec do #1194: voz ativa, zero adjetivo de magnitude, sem alarme.

| Slot | Texto |
|---|---|
| Título | **Painel de parede** |
| Descrição | Os números do dia numa TV do escritório. Atualiza sozinho, sem ninguém mexer. |
| CTA primário | `Fazer upgrade` · fallback `Falar com Comercial` |
| CTA secundário | `Voltar` |
| Plano-alvo | `Disponível no plano Performance` |
| Marca d'água | `exemplo · não são seus números` |

**Título é o que a feature faz, não o rótulo do registro.** Hoje o título vem de `getFeatureMeta().label`, que é vocabulário interno ("Dashboard TV"). "Painel de parede" diz o que a pessoa vai ter. Isso pede um campo novo no `feature-registry` — `sellingName` — ou o reuso honesto do `description`. **Sinalizado ao Forja: é mudança de registry, não de CSS.**

**Reprovado:**
- ~~"Dashboard TV está bloqueado"~~ — abre pelo negativo, e "Dashboard TV" não significa nada para quem nunca viu.
- ~~"Desbloqueie o poder dos seus dados"~~ — marketing vazio, poderia ser qualquer produto. Reprova pelo critério de diferenciação.
- ~~"Faça upgrade e libere X e os demais recursos do plano"~~ (texto atual do `UpgradeModal`) — "e os demais recursos do plano" é enchimento; ninguém compra um plano por "demais recursos".

---

## 4. Estados

| Estado | Comportamento |
|---|---|
| **Carregando** (`!isReady`) | `TorqueLoader` como hoje. **Não** mostrar a prévia antes de saber se está bloqueado — piscar a TV e retirá-la é pior que esperar. |
| **Bloqueado, plano-alvo conhecido** | CTA `Fazer upgrade`, linha de plano visível. |
| **Bloqueado, plano-alvo desconhecido** (`featureUnlockPlan` vazio) | CTA `Falar com Comercial`, linha de plano **some** (não escrever "plano indisponível"). |
| **Sem `VITE_UPGRADE_CONTACT_URL`** | Navega para `/configuracoes`, como hoje. |
| **Viewport estreita** (< 768px) | Prévia some; cai no `FeatureLockedScreen` de sempre. Uma TV renderizada a 360px não vende nada e custa render. |
| **`prefers-reduced-motion`** | Sem efeito — não há motion nesta tela por design (§2.1). |

---

## 5. Acessibilidade

- Prévia é **decorativa**: `aria-hidden="true"` no contêiner inteiro. Um leitor de tela não deve narrar 12 widgets falsos.
- O card carrega toda a informação: `role="region"`, `aria-labelledby` no título.
- Contraste do card sobre o scrim: o gradiente garante `--background` a ≥ 92% na área do card, então os contrastes do tema valem sem ajuste.
- Marca d'água em `--muted-foreground` a 70% sobre scrim ≈ 4.6:1 — **AA**. Não baixar mais: ela é uma declaração de honestidade e precisa ser legível.
- Foco: `autoFocus` no CTA primário; `Esc` sai; ordem de tabulação = CTA primário → Voltar → Voltar da barra.

---

## 6. Aceite

- [ ] `Voltar` visível e funcional na barra superior. **Este item vale mesmo que o resto seja recusado.**
- [ ] `Esc` sai da tela.
- [ ] Prévia é `pointer-events: none` e `aria-hidden`.
- [ ] **Snapshot de demonstração é constante em código. Zero query ao banco nesta tela.**
- [ ] Nomes do ranking de exemplo são `Vendedor A/B/C` — nenhum nome próprio.
- [ ] Marca d'água sempre visível, nunca coberta pelo card.
- [ ] Card no canto inferior esquerdo. Não centralizado.
- [ ] Sem ícone de cadeado.
- [ ] Plano-alvo abaixo dos botões.
- [ ] Zero animação.
- [ ] Abaixo de 768px cai no `FeatureLockedScreen` padrão.
- [ ] `FeatureLockedScreen` das outras features **inalterado**.

---

## 7. Referências

| Produto | O que aproveitamos |
|---|---|
| **Linear** (páginas de feature) | Produto renderizado de verdade sob scrim, card ancorado no canto. Nunca modal centralizado sobre o que está sendo vendido. |
| **Figma** (arquivo acima do limite do plano) | Conteúdo real visível e não-interativo; o bloqueio é evidente sem cadeado gritando. |
| **Apple** (páginas de produto) | Ordem de leitura: o que é → o que faz → quanto custa. Preço nunca antes do valor. |
| **Stripe** (docs e paywall de features) | Microcopy que descreve capacidade, não plano. |

---

## 8. Dependências e sinalizações

**Depende do #1194** para o fundo ser o renderer real. Antes disso, a prévia teria de ser PNG — e aí **prefiro não fazer**: um PNG que envelhece é pior que a tela genérica atual. **Ordem recomendada: implementar depois dos renderers, não antes.**

**Exceção — fazer agora, independente:** o escape (§2.4). `/tv` bloqueado é beco sem saída em produção hoje.

**Ao Forja:**
1. `feature-registry` precisa de `sellingName` (ou uso honesto de `description`) — o `label` atual é vocabulário interno.
2. O snapshot de demonstração é uma constante versionada, com a forma de `get_dashboard_snapshot`. **Nunca uma query.**
3. Escape em rota standalone: `navigate(-1)` com fallback para `/`.

**Não levado ao Cais.** Por orientação do Pauta, nada desta linha vai adiante enquanto o CTO não responder as pendências do catálogo (§8.2 da spec do #1194).
