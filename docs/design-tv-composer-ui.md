# Spec visual — Composer da TV montável (superfície de composição)

> Épico **#1194** · ADR-0023 · Camada 2 (composição) · irmã de `design-tv-composable-widgets.md`
> Autor: Design (Vitral) · Status: **spec para implementação** (não é código)
> Escopo: a superfície onde o **cliente monta a TV** — escolhe medida do catálogo, recorte, formato, peso, posição. Consome o contrato do Forja (`fn_metric_catalog` / `fn_metric_measure` / `dashboard_pages` / `dashboard_widgets`). Roda em paralelo ao motor.

---

## 0. Tese

O composer não é uma tela de configuração. É um **estúdio de montagem** — o cliente arranja a parede que a sala inteira vai olhar o dia todo. Duas forças o definem, e uma decisão de modelo cai das duas:

1. **O artefato final é visual e tem spec dura própria** (o `WidgetFrame` e os 7 formatos, doc irmã). Logo o composer não deve *descrever* o widget com dropdowns e depois pedir fé — ele deve **mostrar o widget real** enquanto o cliente monta. O composer **é** a TV, em modo de edição.
2. **A composição é um vocabulário fechado** (ADR-0023: só referencia IDs do catálogo; a validação real mora no banco — FK + CHECK + trigger). Logo o composer nunca precisa *reportar erro de composição inválida* na cara do usuário — ele torna o inválido **inalcançável**. A regra do catálogo vira disclosure progressivo, não validação a posteriori.

Disso segue o modelo, e é o que separa isto de um painel admin de 2015:

> **Canvas + inspector, manipulação direta.** O canvas é a TV a 16:9 renderizando `WidgetFrame`s reais com dado real da org. O inspector configura o widget selecionado. Não há "preview" separado da "config" — o preview é a config. É o modelo Figma/Framer, aplicado a dashboard.

O modelo errado — e o default preguiçoso — é um formulário: cinco `<select>` empilhados (medida, recorte, formato, peso, posição) + um botão "salvar". Isso reprova em Sofisticação (cada dropdown é uma pergunta sem resposta visual), em Diferenciação (poderia ser qualquer admin) e em Experiência (montar não parece nada). Recusado.

### A frase que organiza a interação

Toda config de widget lê como **uma pergunta em português**:

> **Receita** · por **closer** · como **ranking** · tamanho **primário**

Essa frase é a espinha do composer. O add-flow a constrói da esquerda pra direita; o inspector a edita fragmento a fragmento; o eyebrow do widget renderizado é a mesma frase em versão curta. É o toque humano do Airbnb aplicado a config técnica: o cliente monta uma pergunta, não preenche um cadastro. E é honesto — a frase é literalmente `measure + recorte` (design §1①), o mesmo que gera o eyebrow.

---

## 1. Anatomia — três regiões

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ◂ Painel da TV          Fechamento · Topo de funil · Time    + página   │  ① header
│                          ─────────────                        Publicar ▸ │
├──────────────────────────────────────────────────────┬──────────────────┤
│                                                        │                  │
│   ┌────────┬────────┬──────────────┬────────┐         │   INSPECTOR      │
│   │        │        │              │        │         │                  │
│   │ hero   │        │  primary     │ sec.   │         │  Receita         │
│   │        │        │              │        │         │  ▸ por closer    │
│   ├────────┴────────┼──────────────┼────────┤   ②     │  ▸ ranking       │  ③
│   │  primary        │  primary     │   ⊕    │ canvas  │  ▸ primário      │
│   │                 │              │ ghost  │ (a TV)  │                  │
│   └─────────────────┴──────────────┴────────┘         │  Eyebrow  0/28   │
│                                                        │  Fixar  ▢        │
│   12 × 6 · grade visível só em edição                  │  Remover         │
│                                                        │                  │
├────────────────────────────────────────────────────────┴────────────────┤
│  ▓▓▓▓▓▓▓ ░░░░░░ ░░░░░░   3 páginas · rotação 20s      rascunho não publ. │  ④ régua
└─────────────────────────────────────────────────────────────────────────┘
```

### ① Header
Nome do painel (editável inline), **tabs de página** (Fechamento · Topo de funil · Time), `+ página`, e a ação de saída **Publicar** (§9). Tab ativa sublinhada em `--primary`. A tab é o mesmo rótulo que a TV mostra no header ao rotacionar (design §6.3b) — o cliente nomeia aqui, a parede exibe lá.

### ② Canvas — a TV em modo de edição
- Proporção **16:9 travada**, centralizado, `max-width` confortável (~ 960–1120px). É a parede em miniatura.
- Escopo `[data-surface="tv"]` **real** — mesmos tokens, mesma escala tipográfica, mesmos `WidgetFrame`s da doc irmã. O que se vê aqui é o que a parede mostra. Não é mock.
- **Grade 12×6 visível só em edição**: linhas a `--border` (TV) a 40%, 1px. Somem no modo Prévia (§8) e na TV real.
- **Dado real da org**, buscado por widget conforme configurado (§7). Sem dado → o composer mostra o **estado vazio real** (§6), não um placeholder mentiroso.
- Célula vazia mostra afordância fantasma **⊕** (§4.1).

### ③ Inspector — propriedades do que está selecionado
- **Widget selecionado**: a frase (medida · recorte · formato · peso) como controles empilhados + eyebrow override + fixar + remover (§5).
- **Nada selecionado**: propriedades da **página** — título, rotação (`rotation_seconds`, default 20), reordenar/remover página, e um resumo de densidade (§6.4 da doc irmã: `9/12 · 1 hero`).
- Largura fixa ~320px. Fundo `--card` (app dark). É a única região em tokens de **app**, não de TV — é cromo de ferramenta, não parede (§2).

### ④ Régua de páginas + estado de publicação
Rodapé: mesma **régua de segmentos** da TV (design §6.3c) — mas aqui clicável, cada segmento é uma página, o segmento ativo é a página em edição. À direita, o **estado de rascunho** (§9): `rascunho não publicado` / `publicado agora`.

---

## 2. Tokens

### 2.1 Dois escopos convivendo — decisão consciente

O composer é a única superfície do produto onde **duas paletas aparecem lado a lado de propósito**:

- **Cromo da ferramenta** (header, inspector, régua, sheets, botões): tokens de **app dark** (`.dark` já no sistema). É o Torque, warm-dark `#191714`, gold `--primary`.
- **Canvas** (a TV em miniatura): escopo `[data-surface="tv"]` (doc irmã §2). Fundo mais profundo (7% L vs 9%), contraste de distância, escala tipográfica de TV.

Isso **não** é sistema paralelo — é o `.dark` e o `[data-surface="tv"]` que já existem, montados na mesma tela. A fronteira entre eles é uma decisão de leitura: **a moldura do canvas separa "a ferramenta" de "a parede"**. O cliente entende sem legenda que a área escura-e-densa central é *o que vai pra parede*, e a área ao redor é *onde ele mexe*. É o modelo do Figma: o canvas tem o tema do artefato, o chrome tem o tema do app.

> **Nenhum token novo.** O composer reusa `.dark` (cromo) e `[data-surface="tv"]` (canvas), ambos já especificados. Introduz só **utilitários de layout** (grade, seleção, arraste) que são geometria, não cor — §2.2.

### 2.2 Cromo de edição — geometria, não paleta

Elementos que só existem no modo edição e não têm equivalente na TV nem no app. São **estados de ferramenta**, expressos em tokens existentes:

| Elemento | Token | Uso |
|---|---|---|
| Grade do canvas | `--border` (TV) a 40% | 1px, some fora de edição |
| Anel de seleção | `--primary` (gold) a 100%, 2px + `--primary` a 12% de preenchimento | o widget selecionado |
| Hover em célula/widget | `--foreground` (TV) a 6% overlay | afordância de clique |
| Fantasma de célula vazia | `--muted-foreground` (TV) a 24%, borda 1px tracejada | o ⊕ de adicionar |
| Drop-target válido | `--primary` a 8% preenchimento | onde o widget vai cair |
| Drop-target inválido | `--destructive` (TV) a 8% + cursor `not-allowed` | colisão / fora da grade |
| Guia de snap | `--primary` a 60%, 1px | linha que aparece no alinhamento |

Referência: **Keynote/Figma** — guias de alinhamento em cor de acento, finas, que aparecem só no gesto e somem no repouso. Nunca decoram; só informam.

---

## 3. Fluxo de montagem — a frase, da esquerda pra direita

O add-flow constrói a frase `medida · recorte · formato · peso` numa **folha de composição** (composer sheet) que desliza da direita, sobre o inspector. Não é wizard de 4 telas (peso morto); é **uma folha com revelação progressiva** — cada decisão desbloqueia a próxima, e a próxima só mostra o que o catálogo permite.

```
   ┌─ Novo widget ──────────────────────────────┐
   │                                             │
   │  1 · O QUE MEDIR                            │
   │  ┌─ Uma medida ─┬─ Uma razão ─┐             │  ← toggle medida | razão
   │  └──────────────┴─────────────┘             │
   │                                             │
   │  entradas ─────────────────────────────     │  ← agrupado por âncora
   │   ● Leads criados   ● Reuniões marcadas      │
   │  fechamentos ──────────────────────────      │
   │   ● Receita   ● Nº de vendas   ● Reuniões…   │
   │  hoje ─────────────────────────────────      │
   │   ● Leads na etapa   ● Tempo médio na etapa  │
   │                                             │
   │  2 · COMO RECORTAR         (revela ao pick)  │
   │   total · closer · sdr · origem · tag …      │  ← só compatíveis acesos
   │                                             │
   │  3 · QUE FORMA            (revela ao pick)   │
   │   [▪] número  [▬] barra  [◗] ranking …       │  ← mini-preview de cada
   │                                             │
   │  4 · QUE TAMANHO          (revela ao pick)   │
   │   hero · primário · secundário               │
   │                                             │
   │            Cancelar      Adicionar ▸         │
   └─────────────────────────────────────────────┘
```

### 3.1 Passo 1 — a medida (âncora da frase)

A medida é a decisão primária: ela determina **quais recortes e formatos existem** (compatibilidade do catálogo, macro §B). Por isso vem primeiro e ocupa mais espaço.

- As **7 medidas** como cartões, **agrupadas pelas 3 âncoras** do catálogo (`entradas` / `fechamentos` / `hoje` — design §4.2). O agrupamento ensina a semântica de graça: o cliente vê que "receita" e "nº de vendas" são a mesma natureza (fechamento), e que "leads na etapa" é outra coisa (retrato de hoje). Isso resolve, na montagem, a confusão fluxo-vs-retrato que a TV de hoje comete na renderização.
- Cada cartão: rótulo (`--tv-value-sm` no cromo, i.e. legível) + a âncora como caption. Sem ícone por medida — ícone vira ruído e força uma decisão de iconografia arbitrária pra 7 conceitos abstratos. O **nome** é a identidade.

### 3.2 O toggle medida | razão — a razão sem susto

A razão (conversão, no-show, ticket médio) é o único caso composto (ADR-0023 §3: profundidade 1, exatamente 2 filhos). **Não** se expõe um construtor de expressão com "A ÷ B" cru — assusta e convida erro.

- Toggle segmentado no topo: **Uma medida** | **Uma razão**.
- Em **Uma razão**, o passo 1 vira dois seletores: **numerador** e **denominador**, cada um uma medida do catálogo.
- **Presets nomeados** aparecem primeiro, como atalhos: `Conversão (vendas ÷ leads)`, `Comparecimento (realizadas ÷ marcadas)`, `Ticket médio (receita ÷ vendas)`. Clicar num preset preenche num/den. O construtor num/den fica abaixo como escape hatch pra quem quer outra razão.
- **A unidade deriva sozinha e é mostrada**: `contagem ÷ contagem → %`, `moeda ÷ contagem → R$` (macro §C). Abaixo do denominador, uma linha viva: `resultado: percentual` / `resultado: R$ por venda`. O cliente entende o que vai ver antes de ver.
- `den = 0 → —` (não zero, não erro). O composer avisa em design-time se o denominador for estruturalmente vazio (§6).

> **Referência: Stripe.** O construtor de métricas do Stripe Billing oferece razões nomeadas comuns antes do builder livre, e mostra a unidade derivada inline. Presets pra 90% dos casos, builder pros 10%.

### 3.3 Passo 2 — recorte (só o compatível existe)

Ao escolher a medida, o passo 2 **revela** os recortes. **Só os compatíveis aparecem acesos**; os incompatíveis **não aparecem** (não são mostrados desabilitados-com-erro — simplesmente não existem para aquela medida). Ex.: `tempo_medio_etapa` só oferece `etapa` e `tempo`; `receita` não oferece `etapa`.

> **Por que ausência e não desabilitado-com-tooltip.** Numa TV a 3m não há tooltip; num composer, um recorte cinza com "incompatível com receita" é ruído que ensina o que *não* fazer. Mostrar só o possível é a regra do Linear: o software nunca deixa você construir um estado inválido. A trigger do banco é o backstop; a UI é o guia. Nunca colidem, porque a UI lê a mesma tabela de compatibilidade (`fn_metric_catalog`).

`total` (nenhuma quebra) é sempre o primeiro e o default — é o widget mais simples, "quanto de receita, ponto".

### 3.4 Passo 3 — formato (com mini-preview real)

Revela os formatos compatíveis (design §3.2), cada um com **um mini-glifo do formato real** — não um ícone genérico, uma redução do próprio `WidgetFrame` (barra = 3 barras horizontais; ranking = 3 linhas; donut = anel; linha = sparkline; termômetro = tubo; número = dígito grande; funil = trapézios). O cliente reconhece a forma que vai pra parede.

- Formatos incompatíveis com o recorte escolhido: ausentes (mesma regra §3.3). Ex.: `total` sem quebra → só "número grande" e "termômetro" fazem sentido; barra/ranking/donut precisam de quebra e não aparecem.
- **Sugestão suave, não bloqueio** (design §3.3): se o recorte tem > 5 categorias e o cliente mira donut, um aviso inline gentil: `Muitas fatias pra pizza — barra lê melhor a 3m`. Sugere, não impede. Tom em §10.

### 3.5 Passo 4 — peso (tamanho amarrado à escala)

Três pesos: `hero` · `primário` · `secundário`. Escolher o peso define a **pegada na grade** e a **escala tipográfica** do valor (design §1 tabela de densidade):

| Peso | Pegada default (12×6) | Valor |
|---|---|---|
| hero | 6×3 | `--tv-hero` |
| primário | 3×2 | `--tv-value` |
| secundário | 2×2 | `--tv-value-sm` |

- **`hero` desabilitado se já existe um na página** (design §6.4: máx 1). Não some — fica visível com a razão: `Já há um hero nesta página`. Distinto de incompatível-de-catálogo (que some): incompatibilidade de catálogo é *impossível*; teto de hero é *regra de layout que o cliente pode resolver* (demover o outro). Mostrar dá caminho.
- Ao confirmar, o widget entra no **primeiro encaixe livre** da grade (varredura top-left) já no tamanho do peso. O cliente reposiciona por arraste (§4).

### 3.6 Confirmar
`Adicionar ▸` fecha a folha, o widget aparece no canvas já selecionado (anel gold), o inspector mostra suas propriedades. Motion §8.

---

## 4. Manipulação direta na grade (12×6)

Depois de existir, o widget se move e se dimensiona no canvas — gesto tátil, não formulário.

### 4.1 Afordância de adicionar
Células vazias contíguas mostram um **⊕ fantasma** ao passar o mouse na região (não um ⊕ por célula — vira sarampo). Clicar abre a folha de composição (§3) já com a **posição pré-escolhida** (o encaixe onde clicou). Atalho de teclado: `N` (novo widget) abre a folha sem posição.

### 4.2 Mover
Arrastar o corpo do widget. Durante o arraste:
- O widget segue o cursor a `--tv-dur-instant`, opacidade 0.9, `cursor: grabbing`.
- **Drop-target válido**: célula-alvo preenche `--primary` a 8%; guias de snap (§2.2) aparecem no alinhamento com vizinhos.
- **Colisão / fora da grade**: alvo em `--destructive` a 8%, `cursor: not-allowed`, o widget não cai — volta à origem com `--tv-dur-base`.
- Solta → assenta com `--tv-ease-out`, `--tv-dur-base`.

### 4.3 Dimensionar — o gesto que muda o peso
Handles nos cantos do widget selecionado. **Redimensionar não é livre: encaixa nas pegadas válidas do peso**, e passar o limiar de uma pegada **promove/rebaixa o peso** (secundário → primário → hero) com a escala tipográfica atualizando ao vivo.

> **Por que amarrar as duas coisas.** Peso e tamanho são a mesma decisão vista de dois ângulos — "quão importante" e "quão grande". Separá-los (um dropdown de peso + resize livre) permite o estado incoerente "hero num quadradinho 2×2", que a doc irmã (§6.4) teve que proibir por regra. Amarrando, o estado incoerente **não é construível**. Um gesto, uma verdade. É o modelo do Figma: mudar constraints muda o objeto, não um painel paralelo.

- A cromo de seleção mostra o **peso atual** como micro-rótulo (`primário`) no canto — o cliente sempre sabe em que degrau está.
- Custo backend do gesto = **zero** (confirmado Forja): `weight` é coluna enum; dropdown ou gesto gravam o mesmo valor. A viabilidade do gesto é de frontend/timeframe (§14.3).
- **Restrição dura do trigger (Forja), que o gesto tem que respeitar:** o banco impõe **máx 1 hero/página**. Promover um widget a `hero` **sem rebaixar o hero corrente na mesma escrita = rejeição no banco**. Logo o gesto de promoção a hero **rebaixa o hero atual atomicamente** (para `primário`, seu peso natural anterior ou o default) na mesma transação. Não é opção da UI — é obrigação do contrato. Visualmente: ao arrastar um widget para hero, o hero corrente **encolhe para primário ao vivo** no mesmo gesto, com a mesma interpolação de escala. O cliente vê a troca de coroa acontecer, não recebe um erro.
- Se o cliente quiser cancelar no meio: soltar fora do limiar reverte ambos (`--tv-dur-base`).

### 4.4 Fixar (pinned)
Widget com `pinned` (design §6.3a — o termômetro de meta é o caso canônico) ganha um **glifo de alfinete** gold no canto e, no canvas, uma marca sutil de "presente em todas as páginas". No inspector, o toggle `Fixar` traz a nota: `Aparece em todas as páginas — ocupa a célula em cada uma`. Isso torna visível o custo escondido do §6.4 (pinned gasta orçamento por página).

---

## 5. Inspector — a frase, editável fragmento a fragmento

Widget selecionado → inspector mostra:

```
   Receita                          ← medida (abre picker inline)
   ▸ por closer                     ← recorte (só compatíveis)
   ▸ ranking                        ← formato (só compatíveis)
   ▸ primário                       ← peso (hero trava se ocupado)

   Eyebrow                   12/28
   ┌─────────────────────────────┐
   │ RECEITA POR CLOSER          │  ← placeholder = auto; vazio usa auto
   └─────────────────────────────┘

   Filtros              (§5.2)
   ▸ pipeline · —
   ▸ produto · —

   ▢ Fixar em todas as páginas
   ─────────────────────────────
   Remover widget
```

### 5.1 Eyebrow override (≤ 28 chars)
- Campo pré-preenchido com o **valor automático** (`RECEITA POR CLOSER`, derivado de medida+recorte — design §1①), mostrado como **placeholder ghosted**, não como valor digitado. Vazio = usa o automático. O cliente vê o que vai ganhar sem digitar nada.
- **Contador vivo `n/28`** à direita do rótulo. `--muted-foreground` normal; vira `--warning` de 25–28; trava em 28 (não deixa digitar o 29º — o CHECK do banco é backstop, mas a UI não deixa chegar lá).
- UPPERCASE é aplicado na renderização da TV (design §2.3), **não** no campo — o cliente digita natural, vê o resultado no canvas em caixa alta. Não force caps no input (rouba legibilidade da edição).
- Referência: **Linear** — títulos com contador que fica âmbar perto do limite, nunca vermelho-alarme por um limite editorial.

### 5.2 Filtros (allowlist)
Os filtros do payload (`pipeline_id, member_id, origin, tag_id, product_id, stream` — macro §D) aparecem **só quando fazem sentido pro recorte/medida**, cada um um seletor de valor (pipeline → lista de funis da org; produto → produtos; stream → novo_negócio/carteira). `organization_id` **nunca** aparece — vem do auth, regra da casa. Default `—` (sem filtro). É a diferença entre "receita por closer" e "receita por closer, só do pipeline Propostas".

### 5.3 Remover
`Remover widget` em `--destructive` (app), texto, no rodapé do inspector. Sem confirmação modal para um widget (é reversível até publicar — §9); a remoção anima o widget saindo (`scale-in` reverso, `--tv-dur-fast`) e as células liberam.

---

## 6. Estados vazios — o composer diz a verdade em design-time

Os estados vazios **de renderização** já são spec da doc irmã (§5). Aqui a contribuição é outra: **o composer os revela na montagem**, antes de publicar, para o cliente não montar um widget que na parede aparece vazio sem entender por quê.

O motor devolve `empty_reason ∈ {null, "no_rows", "never_existed"}` (macro §C). O composer consome isso em design-time:

| `empty_reason` | No canvas (real) | No inspector (nota de design-time) |
|---|---|---|
| `null` (tem dado) | valor real | — |
| `no_rows` (vazio no período) | `—` + proveniência `· sem registros` | `Sem registros no período atual. Na TV aparece com travessão.` |
| `never_existed` (ex.: `stream = carteira`, design §5.4b) | `—` + `· nenhum cliente recomprou` | `Esta combinação ainda não pode ter dados. `[link] `Por quê?` |

> **Por que isto importa e é o move world-class.** Sem essa camada, o cliente monta "Receita da Carteira", vê `—` na parede e conclui que o sistema está quebrado — a exata suspeita que a doc irmã §5.4b trabalha pra dissolver na renderização. O composer resolve na origem: te avisa **enquanto você monta** que aquela combinação é estruturalmente vazia hoje, com a mesma frase honesta (`nenhum cliente recomprou` — sujeito é o cliente, não o sistema). O builder que te conta a verdade antes de você se comprometer é o que Stripe/Linear fazem; o builder que te deixa cair num vazio silencioso é admin de 2015.

A nota é **informativa, nunca bloqueante** — o cliente pode legitimamente querer o widget lá esperando a primeira recompra. Tom em §10.

---

## 7. Dado no canvas — real, com prévia debounced

O canvas busca **dado real da org** por widget (`fn_metric_measure`), debounced ~400ms a cada mudança de config. Enquanto busca, **só o valor pulsa** (design §5.1: eyebrow e proveniência são da config, já estão na tela; nunca skeleton de tela inteira, nunca `0` durante load — `—`).

- **Por que real e não amostra.** Honestidade. O cliente monta contra os próprios números; um ranking com nomes reais dos closers dele decide melhor que "Fulano 1 / Fulano 2". Stripe e Linear pré-visualizam com dado real. Amostra só se o motor não responder em design-time — e aí **marcada explicitamente** como `exemplo` na proveniência, nunca disfarçada de real.
- **Custo confirmado com o Forja: viável e barato.** `fn_metric_measure` é `STABLE` + indexado (fatia 5); N chamadas em design-time ficam muito abaixo do orçamento do hot-path (30s × 12 da TV). Sem fallback sob demanda. **Requisito do Forja, incorporado:** cache no cliente por chave `(measure_ref, recorte, filters, period)` — não refazer chamada idêntica no mesmo widget (ex.: só mudar o peso não redispara o fetch, pois peso não entra na chave).
- O período do preview segue um **seletor de período do composer** (mesmo vocabulário do `TVPeriodContext`: mês / hoje / custom), no header. Assim o cliente testa como o widget se comporta em mês cheio vs. hoje antes de mandar pra parede.

---

## 8. Modo Prévia — ver a parede sem a régua

Um toggle `Editar | Prévia` no header. Em **Prévia**:
- Grade some, anéis de seleção somem, ⊕ some, inspector recolhe.
- O canvas vira a TV **exata** — inclusive a **rotação de páginas** rodando (design §6, cadência 20s) e a régua de progresso real.
- É o "ver na parede" antes de publicar. `Esc` ou o toggle volta pra edição.

Referência: **Framer/Figma preview** — sair do chrome de edição pro artefato vivo, um toque, reversível.

---

## 9. Rascunho e publicação — proteger a parede

A TV fica **ligada 12h e relê a cada 30s** (macro §E). Se a edição fosse autosave direto em `dashboard_widgets`, a parede repintaria no meio da montagem — widget meio-configurado, vazio, pulando de lugar, na frente da sala. Inaceitável.

**Modelo: rascunho + publicar.** O cliente edita um **rascunho**; `Publicar na TV` promove o rascunho a configuração viva de uma vez, atômica. A parede só muda quando o cliente decide.

- Estado no rodapé (§1④): `rascunho não publicado` (`--warning`, app) quando há mudança não publicada; `publicado agora` (`--muted-foreground`) quando sincronizado.
- `Publicar na TV` (botão primário gold, header). Ao publicar: micro-confirmação **inline** (não modal) — `Publicado · a parede atualiza em até 30s`. Honesto sobre o poll.
- **Descartar rascunho** disponível enquanto não publicado — reverte ao vivo atual.

> **Desenho do schema fechado com o Forja — não precisa de versão/cópia-espelho pesada:**
>
> - `dashboard_widgets` = **verdade PUBLICADA** (FK + CHECK + trigger). É o **único** que a TV lê, via `fn_dashboard_snapshot` de página completa e válida. A TV nunca vê meia-parede porque só existe estado publicado e válido para ela ler.
> - **Rascunho = coluna `draft jsonb` em `dashboard_pages`** — staging editável, **não** passa por FK enquanto é rascunho (é onde o cliente monta antes de comprometer). O Forja já adiciona essa coluna na fundação (fatia do motor), pra não exigir migration nova depois.
> - **Preview do canvas (§7)** lê `fn_metric_measure` direto do `measure_ref` do rascunho — read-only, nada gravado.
> - **`Publicar na TV` = uma RPC** que valida o `draft` e troca as linhas de widget da página **numa transação** → atômico. **Essa RPC de publish é desta fatia de composição (Vitral), não da fundação** — o Forja entrega a coluna `draft` + o esquema publicado + o snapshot; o publish é construído em cima.
>
> Consequência de design: o **estado visual "não publicado"** (rodapé §1④) mapeia direto para "o `draft` da página diverge das linhas publicadas". Simples e honesto.

---

## 10. Microcopy

Sem fluff, sem "Ops". Cada string é um fato ou uma ação.

| Contexto | Copy |
|---|---|
| Add vazio | `Adicionar widget` · atalho `N` |
| Passo medida | `O que medir` |
| Toggle | `Uma medida` · `Uma razão` |
| Razão unidade | `resultado: percentual` · `resultado: R$ por venda` |
| Passo recorte | `Como recortar` |
| Passo formato | `Que forma` |
| Sugestão donut | `Muitas fatias pra pizza — barra lê melhor a 3m` |
| Passo peso | `Que tamanho` |
| Hero ocupado | `Já há um destaque nesta página` |
| Eyebrow vazio | placeholder = o valor automático em caixa alta |
| Filtro sem valor | `—` (não "Todos", não "Nenhum") |
| Vazio no período | `Sem registros no período atual. Na TV aparece com travessão.` |
| Estruturalmente vazio | `Esta combinação ainda não pode ter dados.` + `Por quê?` |
| Página cheia | `Página cheia — 12 de 12. Nova página?` |
| Página cheia c/ hero | `Página cheia — 8 de 8 com um destaque.` |
| Publicar | `Publicar na TV` |
| Pós-publicar | `Publicado · a parede atualiza em até 30s` |
| Rascunho | `rascunho não publicado` · `publicado agora` |
| Descartar | `Descartar alterações` |
| Fixar | `Fixar em todas as páginas` + `Ocupa a célula em cada uma` |
| Remover | `Remover widget` |

Regra dura, herdada da doc irmã: **nenhum adjetivo de magnitude**, nenhuma cifra na copy fixa (§7 daquela doc). "Muitas fatias" é limiar de contagem (5, regra do catálogo), não elogio.

---

## 11. Motion

Tokens da doc irmã §2.7 (`--tv-*`) para o canvas; tokens de app para o cromo. `prefers-reduced-motion`: todas as transições caem a `--tv-dur-fast` (150ms) troca-seca, sem translate/scale — **sempre**.

| Interação | Duração · easing |
|---|---|
| Folha de composição entra | `--tv-dur-slow` (400) · `--tv-ease-out`, slide-right + fade |
| Revelação de passo (2→3→4) | `--tv-dur-base` (250) · `--tv-ease-out`, `panel-down` (já no sistema) |
| Widget cai no canvas | `--tv-dur-base` · `--tv-ease-out`, `scale-in` de 0.96 |
| Arraste (follow) | `--tv-dur-instant` (50) |
| Snap ao soltar | `--tv-dur-base` · `--tv-ease-out` |
| Drop inválido (volta) | `--tv-dur-base` · `--tv-ease-out` |
| Troca de escala no resize/peso | `--tv-dur-base`, valor tipográfico interpola |
| Seleção (anel aparece) | `--tv-dur-fast` (150) |
| Remover widget | `--tv-dur-fast` reverso |
| Editar ↔ Prévia | `--tv-dur-slow` crossfade |
| Publicar (confirmação inline) | `fade-in` 300 |

Movimento é **reservado pra mudança de estrutura** (add, mover, resize, publicar). Nada em loop, nada decorativo — coerente com a tese da parede. O composer não anima à toa mais do que a TV.

---

## 12. Acessibilidade (WCAG AA mínimo)

- **Teclado completo.** `N` novo widget; setas movem o widget selecionado célula a célula; `Shift+setas` redimensionam (mesma amarração peso↔tamanho); `Tab` navega widgets em ordem de leitura (top-left → bottom-right); `Enter` seleciona/abre inspector; `Esc` desmarca / sai de Prévia; `Delete` remove. Manipulação direta **não pode ser só mouse** — arraste tem paridade de teclado. Referência: Figma tem tudo no teclado.
- **Foco visível** em todo controle: anel `--ring` (gold) 2px, offset 2px. O anel de seleção do widget (§2.2) e o anel de foco de teclado são visualmente distintos (preenchimento vs. contorno) pra não confundir "selecionado" com "focado".
- **Alvos ≥ 44×44px** nos handles de resize e no ⊕.
- **Contraste**: cromo em `.dark` já verificado no sistema; canvas em `[data-surface="tv"]` já verificado na doc irmã §2.1. A grade a 40% e as guias de snap são **cromo não-textual auxiliar** — a posição do widget também é dada pela própria célula, então a grade fina não é o único portador (mesma lógica da borda da doc irmã §2.1).
- **Estado não só por cor**: drop-válido/inválido tem cursor (`grabbing`/`not-allowed`) além da cor; rascunho-não-publicado tem a palavra além do `--warning`; hero-ocupado tem a frase além do disabled.
- **`aria-label`** no canvas descrevendo o widget completo (`Receita por closer, ranking, primário, célula 1×1 a 3×2`); anúncio `aria-live` educado ao adicionar/mover/publicar.
- **Contador do eyebrow** com `aria-live=polite` e `aria-describedby` no limite.

---

## 13. Aceite (checklist pro QA visual)

- [ ] Canvas é `[data-surface="tv"]` real — o que se monta é o que a parede mostra, não mock
- [ ] Cromo (inspector/header/régua) em app-dark; a moldura separa ferramenta de parede sem legenda
- [ ] Recorte/formato incompatível é **ausente**, não desabilitado-com-erro
- [ ] Hero-ocupado é **visível com razão**, não ausente (regra de layout ≠ incompatibilidade de catálogo)
- [ ] Peso e tamanho são **um gesto só** — "hero num 2×2" é inconstruível
- [ ] Eyebrow: placeholder = automático; contador vira `--warning` em 25–28; trava em 28
- [ ] `empty_reason` aparece no inspector em design-time, com a frase honesta da doc irmã
- [ ] Preview é dado real; amostra (se houver) marcada como `exemplo`, nunca disfarçada
- [ ] Nunca `0` durante load; sempre `—`
- [ ] Rascunho não publicado é visível; a parede só muda ao Publicar
- [ ] Modo Prévia mostra rotação real de páginas rodando
- [ ] Teclado tem paridade com o mouse (mover, resize, add, remove)
- [ ] `prefers-reduced-motion` derruba tudo pra troca-seca 150ms
- [ ] Zero token novo de cor — só `.dark` + `[data-surface="tv"]` existentes
- [ ] Microcopy sem adjetivo de magnitude, sem cifra fixa, sem "Ops"

---

## 14. O que precisa de decisão (para o Pauta rotear)

**Resolvido com o Forja (2026-07-23) — não abre mais:**

- ✅ **Preview real por widget (§7)** — viável e barato (`fn_metric_measure` STABLE + indexado). Sem fallback sob demanda. Requisito incorporado: cache no cliente por chave `(measure_ref, recorte, filters, period)`.
- ✅ **Resize promove peso (§4.3)** — custo backend zero (`weight` é enum). **Restrição dura incorporada:** promoção a hero **rebaixa o hero corrente atomicamente na mesma escrita**, senão o trigger rejeita (máx 1 hero/página). A viabilidade do *gesto em si* segue como item 3 abaixo (frontend).
- ✅ **Rascunho + publicar (§9)** — `draft jsonb` em `dashboard_pages` (Forja entrega na fundação) + `dashboard_widgets` como verdade publicada + **RPC de publish é desta fatia (Vitral)**, valida o draft e troca as linhas numa transação. Sem versão/espelho pesado.

**Ainda aberto:**

1. **Presets de razão (§3.2)** — `Conversão / Comparecimento / Ticket médio`. São seeds nomeados do catálogo (Forja) ou atalhos só-de-UI? Recomendo seeds no catálogo pra a UI não hardcodar num/den. **Decisão Cais/Forja.**
2. **Gesto de resize↔peso (§4.3)** — o custo backend é zero, mas o *gesto* unificado (arrastar promove peso + rebaixa hero corrente ao vivo) é mais caro de construir que dropdown de peso + resize-snap. **Cabe no timeframe da fatia?** Fallback já desenhado: dropdown de peso no inspector + resize que só encaixa nas pegadas do peso atual (a amarração peso↔tamanho se mantém; só o gesto degrada). **Decisão de esforço — Pauta/Forja.**
3. **Permissão** — quem monta a TV? Admin da org, presumo (config de parede é decisão de gestão). Confirmar se membro comum vê o composer ou só a TV publicada. **Decisão Cais.**
4. **v1 = só TV** (macro escopo) — o composer assume `surface = 'tv'`. Comando reusa o mesmo composer depois; nenhuma decisão desta spec trava isso. Só ratificar.

---

## 15. Referências citadas

- **Figma / Framer** — canvas com o tema do artefato + inspector com o tema do app; manipulação direta; constraints que mudam o objeto (não painel paralelo); preview de um toque. Base do modelo inteiro (§0, §2, §4, §8).
- **Linear** — nunca deixa construir estado inválido (compatibilidade vira ausência, não erro); contador editorial âmbar; dark denso; tudo no teclado (§3.3, §5.1, §12).
- **Stripe** — construtor de métrica com razões nomeadas antes do builder livre, unidade derivada inline; preview honesto com dado real (§3.2, §7).
- **Airbnb** — config lê como frase humana ("Receita por closer"), não cadastro (§0).
- **Apple / Keynote** — guias de alinhamento em cor de acento que aparecem no gesto e somem no repouso; inspector que muda com a seleção (§1③, §2.2).
- **Notion** — afordância `+` / `N` de bloco pra adicionar, picker focado (§3, §4.1).
