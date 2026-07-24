# Catálogo de estilos de widget — TV montável

> Épico **#1194** · Camada 2 · protótipo aprovado pelo CTO (`docs/design/tv-prototype/tv-montavel-aprovado.html`)
> Autor: Design · Status: **spec visual para implementação** · pareado com a spec de motor/persistência do Cais.
> **Este doc é a fonte canônica do vocabulário de estilos.** O contrato `(métrica, estilo) válido` que o motor enforce ancora na §1.

---

## 0. Princípio

Um widget é `(medida, recorte, filtros, **estilo**)`. A medida diz *o que*; o estilo diz *como aparece*. O mesmo número — receita — vira número grande, velocímetro, termômetro ou split, sem tocar código: só troca o `style_id` na config.

**Identidade Torque, inegociável** (o protótipo é a verdade, não a spec fria antiga):
- Paleta **quente**: creme `#f8f5e7` (texto), cinza-quente `#8a857a` (labels), laranja `#ed9326`, amarelo `#ffd400`, verde `#4ade80`, vermelho `#f87171`, azul `#3b82f6`, ciano `#22d3ee`, roxo `#a855f7`. Fundo `#0a0a0a` com textura de pontos.
- **Cor semântica por categoria** — cada métrica tem sua cor, não tudo gold+creme.
- **Gamificação viva** — pódios, medalhas, coroa, LIVE, prêmios. Central, não decoração.
- **Glow + gradiente** — termômetro brilha, funil tem gradiente por etapa.
- Escala tipográfica dos 5 degraus calibrada na **#1223** (`--tv-hero/value/value-sm/label/meta`), tokens `[data-surface="tv"]`.

---

## 1. Contrato — matriz `(família de métrica × estilo)`

**Design define a matriz (o que faz sentido ver); o motor a enforce na escrita da config (`config inválida = erro`).** Assim visual e validação nunca divergem.

**Matriz canônica — `id | shape | pré-condição`.** É esta a fonte que o Cais transcreve para o guard de escrita, com teste de paridade (código == doc, senão CI vermelho).

| `style_id` | `shape` que consome | Pré-condição sobre a métrica (motor recusa se falha) |
|---|---|---|
| `big-number` | `scalar` | — (toda escalar/razão aceita) |
| `trend` | `series` | métrica tem série temporal no período |
| `gauge` | `vs_meta` | meta definida |
| `thermometer` | `vs_meta` | meta definida |
| `progress-bar` | `vs_meta` | meta definida |
| `stream-split` | `split` | métrica decomponível por stream (receita) |
| `podium` | `ranking` | ≥ 1 linha |
| `ranked-list` | `ranking` | ≥ 1 linha |
| `ranked-bars` | `ranking` | ≥ 1 linha |
| `stage-bars` | `stages` | métrica ordenada por etapa |
| `trapezoid` | `stages` | métrica ordenada por etapa |
| `conversion-donut` | `stages` | etapa inicial e final definidas |
| `category-donut` | `ranking` | recorte categórico; ≤ 5 categorias (6ª+ = "Outros") |

**Famílias de métrica → shape que o motor produz** (contexto para ler a coluna de pré-condição):
escalar/razão → `scalar` · escalar com série → `series` · escalar com meta → `vs_meta` · recortado por pessoa/categoria → `ranking` · recortado por etapa → `stages` · receita por stream → `split`.

> **`race` NÃO está na matriz do motor — é gamificação, não estilo de medida** (decisão do Cais, alinhada ao mapa do #1194: `TVCompetitionBlockV2` = gamificação, nunca entra no motor de métricas). `race` não consome uma **medida** canônica; consome **contexto de competição** (prêmios + prazo + live) do subsistema de **campanhas**, não do motor. A biblioteca v1 do motor = **13 estilos** (os 14 menos `race`). O spec visual de `race` fica em §5.3.4 como referência de render, mas com fonte própria e fatia própria — **ninguém deve implementá-lo como estilo de uma medida.**

**Famílias de métrica** (derivadas do catálogo v1):
- **escalar** — receita, nº vendas, leads criados, leads na etapa, reuniões marcadas/realizadas, tempo médio na etapa.
- **razão** — conversão, no-show, ticket médio (divisão livre entre duas medidas).
- **vs-meta** — qualquer escalar com meta (progresso de meta).
- **ranking** — qualquer medida recortada por pessoa/entidade, top-N.
- **funil** — qualquer medida recortada por etapa ordenada.
- **receita multi-stream** — receita decomposta em Funil/Carteira/Total.

> **Regra de fallback (decisão de design, motor implementa):** toda métrica escalar aceita no mínimo `big-number`. Se o cliente escolhe um estilo cuja pré-condição a métrica não satisfaz (ex.: `thermometer` sem meta), o motor recusa na escrita **e** a UI de montagem esconde o estilo do seletor — nunca oferece o que não pode renderizar. Falha dupla: barra na escrita, some na oferta.

---

## 2. Shapes de payload (a confirmar com o Cais)

Discriminados por `kind`. Todo payload carrega `anchor` (string pronta, §3) e `state` (§4).

**SEIS shapes canônicos** (fechados com o Cais). O motor **não conhece estilo** — entrega um dos seis; cada estilo declara qual consome. Vários estilos → mesmo shape.

```
scalar   { kind:"scalar",  value:number, unit:Unit, delta?:Delta, anchor, state }
series   { kind:"series",  points:[{t:string, v:number}], value:number, anchor, state }
vs_meta  { kind:"vs_meta", value:number, target:number, pct:number, anchor, state }   // SEM pace no v1 (#1216→v2)
ranking  { kind:"ranking", rows:[{key,label,value:number,rank:number}], unit:Unit, anchor, state }
stages   { kind:"stages",  stages:[{key,label,count:number,value?:number,pct_prev:number,pct_first:number}], anchor, state }
split    { kind:"split",   parts:[{stream:"funnel"|"carteira", value:number}], total:number, anchor, state }

Unit  = "brl" | "count" | "pct" | "days"
Delta = { pct:number, dir:"up"|"down" }   // "vs período anterior imediato", derivado no motor, OPCIONAL
```

> **Propriedade de perf que fecha o desenho** (Cais): trocar estilo **dentro do mesmo shape** = só re-render (barato, zero servidor); trocar para estilo de **outro shape** = nova query. É o que faz "trocar estilo" ser operação de primeira classe sem estourar a TV.

**Fronteiras Design↔Motor, fechadas:**
- **Âncora vem string pronta do motor**, derivada da MEDIDA (#1205 adendo). O estilo **renderiza**, não decide frase. ✅ confirmado.
- **Avatar, medalha, coroa são 100% render-derivados** — medalha/coroa do `rank`, avatar = iniciais do `label`. ✅ confirmado. **O `rows[].label` já pode vir anonimizado pelo motor** (iniciais/anon) conforme a permissão de exposição de PII da org (#1214, v2) — decisão do MOTOR, não do estilo. O pódio renderiza **o que vier em `label`**, sem decidir.
- **Não existe shape `category` separado.** Donut por origem/tag/produto consome o shape **`ranking`** (linhas `label`+`value`, `rank` por valor desc); o render deriva `pct = value/Σvalue`. Colapsa no conjunto de seis.
- **Formatação de valor** (`value`+`unit` → `R$ 1,34 mi` / `18h` / `3,2 dias`) é do render, camada única (#1223 §2.6b).
- **`race` consome `ranking`** + exige **contexto de competição** (prêmios, prazo, live). ⚠️ **Fonte do contexto em aberto com o Cais** — vem junto do ranking ou de feed de competições separado? Até resolver, `race` = `ranking` + contexto a definir. Sem contexto, `race` é inválido (não vira `podium` mudo).

---

## 3. Âncora temporal — comum a todos

Faixa de rodapé fixa, presente em **100%** dos estilos, uma linha, `--tv-meta`, `--muted-fg`, glifo `⌖`. String vem pronta do motor. Formas (derivadas da medida):
`base: entradas · jul` · `base: fechamentos · jul` · `base: hoje` (retrato, sem período).
Degradação por medição de largura, tipo de âncora nunca some (#1223 §4.4). Nunca quebra em duas linhas.

---

## 4. Estados — comuns a todos

Discriminador `state` no payload. Eyebrow e âncora vêm da config, renderizam sempre (nunca esperam dado).

| `state` | Render |
|---|---|
| `ok` | valor normal. |
| `loading` (cliente, pré-payload) | valor vira bloco `≈4ch` pulsando `--muted` 0.4↔0.7 em 2s. **Nunca `0`.** Sem shimmer. |
| `empty` + `empty_reason` | valor `—`; âncora ganha fragmento pela razão (tabela abaixo). |
| `error` | frame permanece, valor `—`, borda `--red`/30%, âncora vira `⚠ indisponível · tentando de novo`. Sem código/stack na parede. |

**Divisão fechada com o Cais: o motor sabe o PORQUÊ, o Design sabe COMO DIZER.** `state="empty"` traz um `reason` (enum semântico, extensível **no motor**). Este catálogo declara a frase de cada `reason` — a redação é escolha de design (`nenhum cliente recomprou` foi redação, não derivação), diferente da âncora que é derivação pura 1:1 com a medida. Um **teste de paridade** garante que todo `reason` do enum tem frase aqui (senão o empty fica mudo).

`empty.reason` → frase (declaração canônica de design):

| `reason` (motor) | frase | sujeito |
|---|---|---|
| `no_data_in_period` | `· sem registros` | mundo |
| `never_had_recompra` | `· nenhum cliente recomprou` | **cliente** (não o sistema — #5.4b) |
| `no_meta` | `· meta não definida` | mundo |
| `div_zero` | (sem fragmento; valor `—` já comunica) | — |
| *(desconhecido)* | `· sem dados` | **fallback obrigatório** — nunca mudo |

**Regra do sujeito** (fechada): `empty` → sujeito é o **mundo/cliente**; `error` → sujeito é o **sistema** (`⚠ indisponível · tentando de novo`). Confundir os dois faz a mensagem mentir na direção oposta.

Widget com erro **mantém a célula** — a grid nunca dança (US 24). Boundary por célula, não global.

---

## 5. Os estilos, um a um

Cada estilo: métricas · anatomia · dados · estados específicos · comportamento. Tokens `[data-surface="tv"]`, escala #1223, paleta quente §0.

### 5.1 Escalares

#### `big-number` — Número grande
- **Métricas**: qualquer escalar ou razão.
- **Anatomia**: eyebrow (`--tv-label`, cor da categoria); valor `--tv-hero` peso 600, `tabular-nums`, `-0.03em`; cor = **gold se é o número-âncora da página (máx 1–2), senão creme**; delta colado abaixo (`--tv-label`, `--success`/`--destructive` conforme `dir`); âncora no rodapé.
- **Dados**: `scalar`.
- **Comportamento**: entrada = count-up 900ms ease-out (respeita `prefers-reduced-motion` → set direto). Hover → chip `trocar estilo`.

#### `trend` — Com tendência (sparkline)
- **Métricas**: escalar/razão **com série**.
- **Anatomia**: valor `--tv-value` no topo + delta; corpo = sparkline (área a 12% + linha 3px). Linha na cor da categoria (receita → verde `#4ade80`); sem eixo, sem grid, sem tooltip. Último ponto ganha dot.
- **Dados**: `series` (`points` + `value` de cabeça).
- **Comportamento**: linha desenha (stroke-dashoffset) 1.4s na entrada; área faz fade depois. Reduced-motion → estática.

#### `gauge` — Velocímetro
- **Métricas**: **vs-meta**.
- **Anatomia**: arco 270° semicircular; trilho `--muted`, preenchimento gradiente `--amber→--yellow` com glow; `pct` grande no centro (`--tv-value`, gold). **Sem marca de pace no v1** (pace → v2, #1216). Escala do arco = 0→meta(100%), fill dirigido por `pct`, cap visual em ~120%.
- **Dados**: `vs_meta` (`value`, `target`, `pct`). Sem `ceiling` — o render define a escala do arco.
- **Estados**: `no_meta` → arco vazio + `—` central + âncora `· meta não definida`.
- **Comportamento**: arco preenche da esquerda 1.2s; número count-up. 

#### `thermometer` — Termômetro (peça-assinatura)
- **Métricas**: **vs-meta**.
- **Anatomia (v1)**: card dourado de meta no topo (`R$ 260,0K / META DO MÊS`, gradiente `--amber→--yellow`, sombra); tubo vertical com escala (5 marcas), fill gradiente `--amber→--yellow` + **glow** `box-shadow rgba(237,147,38,.6)`; bolha circular `%` no nível; tag de valor **separada da bolha** (não sobrepõe — correção validada); rodapé `Falta R$ Y para a meta` (= `target − value`, derivável).
- **⚠️ Pace é v2, não v1.** O marcador tracejado `esperado` e o alerta `↓ R$ X atrás do esperado` que aparecem no protótipo (e na TV atual) **dependem de pace** — que foi para o v2 (#1216). No **v1 o termômetro montável não os traz.** Isto é coerente com a #8.4.1: o `Thermometer` inline atual, **com** pace, fica **legado/pinned até o v2**; este `thermometer` estilo é o v1 sem pace. O protótipo aprovado ilustrou um elemento v2 — a build v1 não o promete.
- **Dados**: `vs_meta` (`value`, `target`, `pct`). Sem `pace`.
- **Regra dura**: **tubo sempre gold, nunca verde/vermelho** — tubo = progresso, julgamento fica no rodapé (#8.2c).
- **Comportamento**: fill sobe 1.4s ease-out na entrada.

#### `progress-bar` — Barra de progresso
- **Métricas**: **vs-meta**.
- **Anatomia**: valor `--tv-value` topo; barra horizontal, trilho `--muted`, fill gradiente `--amber→--yellow`; `X% da meta` à esquerda, `meta R$ Y` à direita, `--tv-meta`.
- **Dados**: `vs_meta` (`value`, `target`, `pct`).
- **Comportamento**: fill cresce 0→pct 1s.

### 5.2 Receita multi-stream

#### `stream-split` — Funil + Carteira
- **Métricas**: **receita** decomponível por stream.
- **Anatomia**: eyebrow `RECEITA POR ORIGEM`; duas barras rotuladas — `Funil` (azul `#3b82f6`) e `Carteira` (verde `#4ade80`) — com valor à direita; linha `Total` destacada (gold) no rodapé, acima da âncora.
- **Dados**: `split` (`parts` + `total`).
- **Estados**: Carteira `empty`/`no_recompra` → barra Carteira em zero **visível** (não some) + `Total` = só Funil; âncora `· nenhum cliente recomprou`. (Janela estrutural #5.4b.)
- **Comportamento**: barras crescem em stagger 80ms.

### 5.3 Ranking

Base comum: `rows` ordenadas por `rank`. Avatar = iniciais do `label` (fallback), medalha/coroa render-derivadas do `rank`. Máx 5 linhas + `e mais N`. **Acompanhantes nunca ganham cor de estado.**

#### `podium` — Pódio
- **Anatomia**: 3 degraus com **alturas** proporcionais (1º mais alto, centro); 🥇🥈🥉 + 👑 coroa no 1º; nome + valor sob cada degrau; 1º em gold com glow, 2º prata, 3º bronze.
- **Dados**: `ranking` (usa top-3; resto ignorado ou em lista abaixo se couber).
- **Comportamento**: degraus sobem em spring stagger; coroa faz leve float.

#### `ranked-list` — Lista ordenada
- **Anatomia**: linhas `pos · avatar · nome · valor`; 1ª posição gold; micro-barra opcional na ordenadora.
- **Dados**: `ranking` (até 5 + `e mais N`).
- **Comportamento**: linhas entram em stagger x-6.

#### `ranked-bars` — Barras
- **Anatomia**: barra horizontal por linha, rótulo à esquerda, valor no fim; rampa **ordinal** gold-decrescente (`--metric-ramp-*`) — a ordem é a cor.
- **Dados**: `ranking`.
- **Comportamento**: width 0→valor stagger.

#### 5.3.4 `race` — Corrida (gamificação — **FORA do motor de métricas v1**)
> **Não é estilo de medida.** Fonte = subsistema de **competições/campanhas**, não o motor de métricas. Fatia própria (onde `TVCompetitionBlockV2` já vive). Especificado aqui só como referência de render — não entra na matriz §1, não consome shape de medida.
- **Anatomia**: pódio 3 níveis (como `podium`) + badge **`LIVE`** pulsante + `N participantes · Xd restantes` + cards de **prêmio** (`🍫 Chocolate / 1º lugar`, `💸 Pix R$ 100 / meta batida`) no rodapé.
- **Dados**: contexto de competição `{ rows, prizes, deadline_days, live }` — do feed de campanhas, **não** do `get_dashboard_snapshot`.
- **Comportamento**: pontos pulsantes LIVE; pódio anima na entrada. Reduced-motion → LIVE estático.

### 5.4 Funil

#### `stage-bars` — Barras por etapa
- **Anatomia**: barras horizontais decrescentes, **gradiente por etapa** (azul→ciano→laranja→laranja-vermelho→verde, a linguagem atual da TV); `count` na barra, `pct_prev` à direita; valor R$ **só na etapa final** (Vendido, verde) — evita a inversão que confunde (R$ intermediário maior que anterior); rodapé `Taxa total X% de conversão` (`--green`).
- **Dados**: `stages`.
- **Comportamento**: width 0→pct, easing `[0.2,0.85,0.25,1]`, stagger.

#### `trapezoid` — Trapézio
- **Anatomia**: funil geométrico clássico — segmentos empilhados que estreitam; cor por etapa (mesma rampa de `stage-bars`); `count` + `label` dentro do segmento.
- **Dados**: `stages`.
- **Comportamento**: segmentos entram de cima em stagger.

#### `conversion-donut` — Donut de conversão
- **Métricas**: funil (deriva conv de etapa inicial→final).
- **Anatomia**: anel; arco preenchido = taxa de conversão; centro = `%` grande (gold) + `X de Y` em `--tv-meta`. Máx destaque no arco, sem fatias múltiplas.
- **Dados**: `stages` (render deriva `total_conv` de `pct_first` da última etapa).
- **Comportamento**: arco desenha na entrada.

### 5.5 Categórico

#### `category-donut` — Donut por origem/tag/produto
- **Métricas**: escalar recortado por categoria.
- **Anatomia**: anel espesso, total no centro; legenda-no-elemento com cor + rótulo + valor; rampa **categórica** (`--chart-1..5` redefinida quente, evita colisão com verde-success/vermelho-destructive); ≤ 4 fatias + `Outros`.
- **Dados**: `ranking` (`rows` = categorias; render deriva `pct = value/Σvalue` e o `total`).
- **Nota**: donut é o formato mais fraco a 3m; usado só para "de que é feito", nunca para comparar magnitude. Se ≥ 6 categorias, a UI de montagem **sugere** `ranked-bars`.
- **Comportamento**: anel desenha; total count-up.

---

## 6. Comportamento comum — hover "trocar estilo"

Na **Minha TV** (read-mostly), hover num widget revela um chip `⚙ trocar estilo` no canto (só hover, não colide com header — correção validada). Clique → abre o mesmo seletor da Biblioteca **filtrado pelos estilos válidos daquela métrica** (a matriz §1). Na TV pura (parede sem interação) o chip nunca aparece. Isto é a costura entre as duas views do protótipo: a Biblioteca escolhe, a Minha TV troca no lugar.

---

## 7. Aceite (QA visual do catálogo)

- [ ] Todo estilo em paleta quente §0; zero token frio da spec antiga.
- [ ] Cada estilo respeita a escala #1223 (5 degraus, sem `text-[Npx]` arbitrário).
- [ ] Âncora `base: …` presente em 100% dos estilos, string do motor, nunca decide frase no front.
- [ ] Os 4 estados em cada estilo; **nunca `0` em loading**.
- [ ] Tubo do termômetro sempre gold; acompanhantes de ranking sem cor de estado.
- [ ] `race` sem `context` = inválido (não renderiza como `podium` mudo).
- [ ] Seletor de estilo só oferece estilos cuja pré-condição a métrica satisfaz.
- [ ] Gamificação (pódio/coroa/medalha/LIVE/prêmio) fiel ao protótipo aprovado.
- [ ] Formatação de valor numa camada só (#1223 §2.6b); `mi`/`mil`, vírgula decimal, duração troca unidade em 48h.

---

## 8. Sincronização com o Cais (motor)

Este catálogo é a referência canônica do vocabulário de estilos. O contrato do motor ancora na **matriz §1** (id | shape | pré-condição) e nos **seis shapes §2**. Fechado com o Cais:
- ✅ 6 shapes canônicos (motor não conhece estilo; estilo declara shape). Trocar estilo mesmo-shape = re-render; cross-shape = nova query.
- ✅ Âncora string pronta, derivada da medida.
- ✅ `label` pode vir anonimizado pelo motor (PII #1214); estilo renderiza o que vier.
- ✅ `empty.reason` = enum do motor; Design declara a frase; teste de paridade + fallback `sem dados`.
- ✅ Matriz: Design define, motor enforce, teste de paridade código==doc.
- ✅ pace fora do v1 (vs_meta sem pace; termômetro v1 sem `esperado`).
- ✅ `race` **fora do motor de métricas v1** — é gamificação, fonte = competições, fatia própria (mapa #1194). Biblioteca do motor = **13 estilos**.

**Sem pendência aberta.** Os 13 estilos da matriz §1 estão fechados e prontos para o Cais ancorar o motor. `race` (§5.3.4) segue como referência de render de gamificação, fonte própria.

Design define a matriz e o visual; motor enforce e entrega os shapes. Nenhum vocabulário de estilo nasce fora deste doc.
