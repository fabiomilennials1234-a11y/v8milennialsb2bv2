# DESIGN.md — Torque CRM

A regra que decide tudo:

> ## Simples › Intuitivo › Bonito

Não é um lema. É **ordem de desempate**. Quando duas qualidades entram em conflito — e elas entram o tempo todo — a da esquerda ganha. Sempre.

- Uma tela mais simples ganha de uma mais explicada.
- Uma tela mais compreensível ganha de uma mais elegante.
- Bonito nunca é desculpa para as outras duas.

O erro que essa ordem existe para impedir: resolver "o usuário não entendeu" adicionando alguma coisa. Tooltip, tour, coach-mark, texto de ajuda, vídeo. Cada um deles é uma confissão de que a tela falhou — e cada um torna a tela mais complexa, o que piora a causa real.

**Quando algo não está intuitivo, a primeira tentativa é sempre remover.**

---

## 1. Simples

Simples não é "pouca coisa na tela". É **o menor número de peças que resolve o trabalho de verdade**. Uma tela vazia que obriga o usuário a ir em outros três lugares não é simples — é incompleta.

### Regras

**Uma tela, um trabalho.** Se a tela responde a duas perguntas diferentes de duas pessoas diferentes, são duas telas. O Kanban responde "o que precisa de mim agora". O relatório responde "como fomos no mês". Não se misturam.

**Corte antes de acrescentar.** Toda adição de elemento precisa responder: o que sai no lugar? Se nada sai, o argumento para entrar precisa ser mais forte do que "seria útil ter".

**Padrão que serve a maioria, sem pedir configuração.** Configuração é complexidade transferida para o usuário. Se 90% quer o mesmo comportamento, esse é o comportamento — sem pergunta. Configurável só quando a divergência é real e medida, nunca "por precaução".

**Um caminho, não três.** Se existem três formas de criar a mesma coisa, duas são dívida. Escolha a que serve mais gente e apague o resto.

**Nada de tela intermediária que só repassa.** Uma tela que só existe para levar a outra deve morrer e virar link direto.

### Testes

- Consigo remover este elemento e a tarefa ainda se completa? Então remova.
- Este campo tem valor útil em mais da metade dos casos? Se não, sai do caminho principal.
- Esta tela precisa de um texto explicando como usá-la? Então a tela está errada, não o texto.

---

## 2. Intuitivo

A pessoa sabe o que fazer **sem ter aprendido antes**. O sistema fala a língua de quem vende, não a de quem programa.

### Nomeie pelo que a pessoa reconhece

O usuário do Torque é vendedor de fábrica e distribuidora. Ele não sabe o que é um pipe, uma entry, um deal ou um webhook — e não precisa saber.

| Não escreva na UI | Escreva |
|---|---|
| pipe, pipeline_entry | funil, etapa |
| deal | negócio |
| lead score / qualification_score | qualificação |
| trigger, node, DAG | gatilho, passo, automação |
| org, tenant | empresa |
| churn, MRR, CAC | perda de cliente, receita mensal, custo por cliente |
| sync, fetch, retry | atualizar, buscar, tentar de novo |

Termo técnico na interface é jargão importado do banco de dados. Se a palavra só existe porque a tabela se chama assim, ela não passa.

### O estado precisa ser visível

Nada acontece em silêncio. Toda ação tem uma consequência que se vê:

- O botão diz o que vai acontecer (`Publicar`), e o aviso depois confirma que aconteceu (`Publicado`).
- Ação em andamento mostra que está em andamento — no próprio botão, não numa barra distante.
- Ação destrutiva pede confirmação **e diz o que será perdido**, com número: "Isto remove 47 leads deste funil."

### Os quatro estados são obrigatórios

Nenhuma lista, tabela ou painel entra em produção com um só. Toda superfície que mostra dados precisa dos quatro:

1. **Vazio** — diz por que está vazio e qual é a próxima ação. Nunca uma caixa em branco.
2. **Carregando** — esqueleto com a forma do conteúdo real, não um spinner centralizado.
3. **Erro** — diz o que falhou e o que fazer. Nunca "algo deu errado". Nunca um código de erro sozinho.
4. **Sem permissão** — diz que não tem acesso e quem libera. Nunca simplesmente esconder sem explicação.

### Erro fala com quem lê

Errado: "Erro ao processar requisição (500)."
Certo: "Não conseguimos enviar a mensagem — o WhatsApp desta empresa está desconectado. Reconecte em Configurações."

Sem pedido de desculpas, sem vagueza, sem culpar o usuário.

### Número tem que ser lido sem esforço

- Toda coluna de número usa `font-variant-numeric: tabular-nums`. Dígito tem que alinhar.
- Número sempre com unidade: `R$ 42.800`, `62 dias`, `35%`. Nunca `42800` solto.
- Valor inexistente é travessão (`—`), nunca `0`. Zero é um fato; travessão é ausência. Confundir os dois mente.
- Número grande vem com referência ao lado, senão não significa nada: comparação com o período anterior, com a meta, ou com a média.

---

## 3. Bonito

Refinamento vem por último — o que **não** quer dizer que seja opcional. Quer dizer que nunca compra as duas primeiras camadas. Contraste vence elegância. Clareza vence sofisticação.

### Identidade

Dark-first, mas os dois temas são primários — nenhum é uma inversão automática do outro. O tema claro do Torque é **creme quente** (`42 25% 96%`), não branco; o escuro é **quase-preto quente** (`36 11% 9%`), não cinza neutro. Essa temperatura é a marca. Branco puro e cinza frio são a maneira mais rápida de o produto virar template.

Referências de barra: Linear, Stripe, Vercel. Não para copiar — para calibrar o nível de acabamento.

### Cor

**Ouro (`--primary`, `47 100% 50%`) é para dinheiro e para ação.** Valor de negócio, receita, botão principal, foco. Nada mais. Ouro em decoração destrói o sinal onde ele importa.

**Mas ouro nunca é o texto.** Sobre o creme do tema claro (`42 25% 96%`), o ouro dá cerca de 1,7:1 — reprova AA com folga. A regra acima e a acessibilidade colidem exatamente no lugar mais importante: o numeral de dinheiro.

A resolução é de composição, não de paleta. **O numeral fica em `--foreground`, com contraste cheio nos dois temas, e o ouro vira uma linha de dinheiro** — um traço curto (cerca de 38×3px) imediatamente acima do valor. A identidade ancora o dinheiro sem pintar o número, e o ouro sólido segue exclusivo de CTA, foco e pílula de ênfase.

Não invente um segundo tom de ouro para "resolver" o contraste: dois ouros no mesmo produto é o começo do fim de uma paleta.

**Cor semântica é separada do accent e não conta como ele:**

| Token | Significa |
|---|---|
| `--success` | confirmado, pago, ganho |
| `--warning` | precisa de atenção, prazo perto |
| `--destructive` | erro, perdido, inadimplente |
| `--silver` | neutro com ênfase (2º lugar, secundário) |
| `--muted-foreground` | texto de apoio |

**Cor nunca é o único sinal.** Sempre acompanhada de texto, forma ou ícone — daltônico e impressão em preto e branco continuam funcionando.

### Tipografia

Inter, com `cv11` e `ss01` ativos (o `cv11` dá o "1" legível em horário e valor).

- Escala definida e obedecida. Tamanho fora da escala é bug.
- Peso carrega hierarquia melhor do que tamanho. Prefira 600 a aumentar 4px.
- Título com `text-wrap: balance`.
- Texto corrido perto de 65 caracteres de largura.
- Rótulo em maiúscula leva `letter-spacing` — sem isso fica apertado e ilegível.

### Espaço e densidade

CRM é **operado**, não lido. Densidade alta é a escolha certa: o vendedor quer ver 12 negócios sem rolar, não 4 com respiro editorial. Densidade alta ≠ apertado — o alinhamento é que faz a leitura, não o espaço vazio.

Espaçamento vem de `gap` em flex/grid, nunca de margem por elemento. Conteúdo largo (tabela, gráfico, kanban) rola dentro do próprio contêiner; a página nunca rola de lado.

### Movimento

Movimento explica, não enfeita. Serve para mostrar de onde uma coisa veio ou para onde foi.

- Transição de estado: 150–200 ms. Acima disso a interface parece lenta.
- Nada anima na entrada só porque pode.
- `prefers-reduced-motion` respeitado sempre.

### Acessibilidade é parte do acabamento, não extra

- Foco de teclado visível em tudo que é interativo.
- Alvo de toque mínimo de 44 px.
- Contraste mínimo AA nos dois temas — o tema claro é o que costuma falhar; cheque o ouro sobre creme.

---

## 4. Tokens — o que existe e quando usar

Fonte de verdade: `src/index.css` (74 no `:root`, 44 no `.dark`). Nunca escreva cor literal em componente. Se falta um token, o token é que precisa nascer.

### Superfície e texto

| Token | Uso |
|---|---|
| `--background` | fundo da página |
| `--card` / `--popover` | superfície elevada |
| `--muted` | superfície rebaixada, faixa alternada |
| `--foreground` | texto principal |
| `--muted-foreground` | texto de apoio, rótulo |
| `--border` / `--input` | traço de 1px |
| `--ring` | anel de foco (é ouro) |

### Famílias específicas

- **`--bubble-*`** (5 famílias × 3 tokens): balão de chat por origem — `outgoing`, `incoming`, `ai`, `workflow`, `system`. Só no chat.
- **`--chat-*`**: densidade do chat (padding, gap, altura de linha, avatar). Não variam por tema.
- **`--sidebar-*`**: a sidebar é escura nos dois temas, de propósito.
- **`--command-palette-*`**: matiz neutro-frio 220°, separando perceptivamente do warm 36° do resto. Essa diferença é intencional — não "corrija".
- **`--chart-1..5`**: série de gráfico. Não use fora de gráfico.
- **`--gradient-*`**, **`--shadow-*`**: gradientes de marca e elevação. `--shadow-gold` é ênfase rara.

### Regras

- Cor literal (`#fff`, `rgb()`) em componente é bug de revisão.
- Todo token novo nasce nos **dois** temas, no mesmo commit.
- `--radius` é `0.75rem`. Raio arbitrário por componente quebra a família.

---

## 5. Checklist de reprovação

Reprova se qualquer uma for verdadeira.

**Camada Simples**
- [ ] Precisa de tooltip, tour ou texto de ajuda para ser usada.
- [ ] Tem elemento que dá para remover sem quebrar a tarefa.
- [ ] Pergunta ao usuário algo que o sistema poderia decidir sozinho.
- [ ] Existe outro caminho no produto que faz a mesma coisa.

**Camada Intuitivo**
- [ ] Usa nome de tabela ou termo técnico na interface.
- [ ] Falta um dos quatro estados (vazio, carregando, erro, sem permissão).
- [ ] Alguma ação acontece sem confirmação visível.
- [ ] Mensagem de erro não diz o que fazer.
- [ ] Número sem unidade, sem alinhamento tabular, ou `0` no lugar de `—`.
- [ ] Ação destrutiva sem dizer quanto será perdido.

**Camada Bonito**
- [ ] Cor literal em vez de token.
- [ ] Ouro usado em decoração, e não em dinheiro ou ação.
- [ ] Numeral de dinheiro pintado de ouro em vez de usar a linha de dinheiro.
- [ ] Cor como sinal único, sem texto ou forma junto.
- [ ] Um dos temas ficou pior que o outro.
- [ ] Foco de teclado invisível.
- [ ] Animação acima de 200 ms, ou animação que não explica nada.
- [ ] Poderia pertencer a qualquer produto — não parece o Torque.

---

## 6. Como usar este documento

Antes de desenhar, leia a seção 1. A maioria das decisões morre ali e nunca chega às outras.

Ao revisar, percorra o checklist na ordem. Um item reprovado na camada Simples torna irrelevante qualquer acerto nas outras duas — não adianta discutir a paleta de uma tela que não deveria existir.

Ao discordar deste documento, discorde por escrito e mude o documento. Regra que se contorna em silêncio deixa de ser regra.

**Referência viva**: `src/index.css` (tokens), `tailwind.config.ts` (escala), `src/components/ui/` (primitivos shadcn). O código vence este texto quando divergirem — e aí este texto precisa ser corrigido.
