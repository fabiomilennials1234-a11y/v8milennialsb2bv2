# Oráculo · Onda 2 — preparo (SCRUM-589)

Worktree: `~/Dev/wt-oraculo-o2`, branch `feat/oraculo-onda-2`, base `origin/main` @ `1b2b8726`.
Onda 1 (SCRUM-588/593/594) fechada em produção em 31/08/2026 e marcada Feito no Jira.

## Estado herdado da Onda 1, conferido em produção

| Item | Estado |
|---|---|
| Migrations `20270905000000/10/20` | aplicadas e no ledger |
| `oraculo_conversations`, `oraculo_turns`, `oraculo_usage` | existem; `anon` não lê |
| RPC `oraculo_metricas` | existe |
| `feature_permissions` → `metrics.view_org` | `default=false`, `is_admin_only=false` |
| Edge functions | `oraculo-turno` v1, `send-meta-message` v84, `whatsapp-api-proxy` v107, `whatsapp-webhook` v96 |
| `oraculo_turns` / `oraculo_conversations` | **0 linhas** — nunca exercitado |
| `sent_by_team_member_id` não-nulo | **0** nas duas tabelas |

## Premissas medidas antes de planejar

Duas caíram. Nenhuma delas é defeito da Onda 1; as duas mudam o que a Onda 2 entrega.

### 1. O Oráculo não tem porta de entrada

`/oraculo` existe em `src/App.tsx:609` e **não é linkada de lugar nenhum** no frontend — nem lateral,
nem paleta de comandos. Verificado por grep sobre `origin/main` inteiro. Por isso `oraculo_turns` = 0.

Consequência: **SCRUM-595 é pré-requisito prático das outras cinco fatias.** Até ela subir, nada da
Onda 2 é alcançável por usuário real.

### 2. O briefing que alimentaria o slot não existe

SCRUM-595 pede três degraus por sobra de altura, e o degrau do meio mostra "o gargalo do dia".
O critério de aceite diz: *"Sem briefing novo, o slot some e a navegação recupera a altura."*

O único produtor de briefing no código é `useNextBestActions` → RPC `get_next_best_actions` →
tabela `next_best_actions`. Medido em produção:

| Medição | Valor |
|---|---|
| Linhas em `next_best_actions` | **0** |
| Organizações distintas | 0 |
| Criadas nos últimos 7 dias | 0 |
| Registro mais recente | nenhum |
| Chamadas de `INSERT`/`UPSERT` na tabela, em todo o repositório | **nenhuma** |

A tabela e a RPC existem (nasceram no baseline), mas **ninguém escreve nelas**. O hook usa
`(supabase.rpc as any)` e `(supabase.from as any)`, o que esconde a ausência do type-check.

Não há tabela de gargalo ou de briefing em produção (`%gargalo%`, `%briefing%`, `%bottleneck%` → vazio).
O Gargalo é escopo da Onda 4 — SCRUM-601 (receita vazada) e SCRUM-604 (dimensão pessoa), ambos com
`SCRUM-591 — Onda 4` como pai.

**Consequência: se o slot depender de briefing, ele nasce invisível para 100% das organizações**, e o
critério "sem briefing o slot some" passa a ser o estado permanente. A fatia entregaria uma lateral
idêntica à de hoje. Decisão de recorte pendente com o CTO.

O gate de plano não é o problema: **69 de 108 organizações** têm a feature `oraculo` ligada
(`feature_catalog.oraculo` tem `default_enabled = true`; `org_subscriptions` está vazia, então o plano
resolve pelo fallback `organizations.subscription_plan`).

## Anatomia da lateral (onde o slot encaixa)

`src/modules/platform/components/layout/Sidebar.tsx`, 358 linhas:

- **topo**, linhas 121–150 — `SidebarBrand` + `OrgSwitcher`, altura fixa;
- **meio**, linhas 152–195 — `<ScrollArea className="flex-1">` com o `<nav>`;
- **rodapé**, linhas 197–272 — `border-t`, com Pitstop, Notificações, links de Master, Ajuda e
  `SidebarUserMenu`.

Largura por `collapsed`: `SIDEBAR_WIDTH` ou `SIDEBAR_WIDTH_COLLAPSED` (64px).

O painel que abre por cima já tem precedente na própria lateral: a Agenda (`agendaOpen` /
`agendaJaAberta`, linhas 71–73 e 291–293), carregada com `lazy` por caminho fundo — o comentário nas
linhas 37–43 explica que o barril de `engagement` puxaria a árvore inteira.

## Seams propostos para SCRUM-595 — a confirmar antes do primeiro teste

| # | Seam | O que prova | Onde |
|---|---|---|---|
| S1 | Função pura do degrau: `(alturaDaLateral, alturaDoTopo, alturaDoRodape, pisoDaNavegacao, colapsada, temBriefing) → 'card' \| 'linha' \| 'icone' \| 'ausente'` | piso da navegação nunca violado; degrau certo por sobra; colapsada vira ícone; sem briefing some | novo módulo, teste unitário |
| S2 | Hook que observa **a própria lateral** (`ResizeObserver` sobre o `<aside>`, não `window`) | a medição não vem da janela — falha se alguém trocar por `innerHeight` | teste com observador dublado |
| S3 | Slot montado dentro da `Sidebar` real, em três alturas (900, 700, 560) | o piso vale na parede montada, não só no renderizador isolado | RTL sobre `Sidebar` |
| S4 | Truncamento do conteúdo longo | texto não cresce o card | RTL |
| S5 | Painel abre por cima sem navegar, no padrão da Agenda | a página continua à mostra por baixo | RTL |

**S3 é o que impede o falso verde.** Testar só S1 provaria a aritmética do degrau sem provar que a
entrada dela é a lateral. O controle positivo natural: montar com a lateral menor que a janela e
verificar que o degrau muda — se a medição vier de `window`, esse teste fica verde por engano.

## Regras desta base que valem para a onda

- Worktree limpo a partir de `origin/main`. Nunca `git stash` — é do repositório inteiro.
- Docker e Supabase local banidos. Teste que precisa de banco → pedir branch do Supabase, e derrubar
  depois. A branch não tem DNS: rodar SQL pela Management API (`scripts/prod-sql.mjs`).
- Antes do PR: `npm run lint:ratchet`, `npm run typecheck:ratchet` e `deno check` em `_shared/`.
- CI vermelho por herança em `origin/main` (14 erros no ratchet de TSC, 207 no lint do vault).
  Medir o delta contra um worktree de `origin/main`, nunca assumir que é da onda.
- Toda migration que cria tabela em `public` precisa de `REVOKE ALL ... FROM anon, authenticated`
  antes do `GRANT` desejado, e guarda com `has_table_privilege` no pgTAP.
- Controle positivo em toda guarda que passar de primeira.

## Ordem proposta das seis fatias

1. **SCRUM-595** — porta de entrada; destrava as outras cinco.
2. **SCRUM-596** — catálogo `funil`, `ranking`, `perdas`, `leads`, no molde de `tools/metricas.ts`.
3. **SCRUM-597** — cron do resumo + ferramentas de conversa. Medir antes o recorte por dono: a caixa
   de Instagram já ignorou o `chat_restrict_to_owner` de duas organizações.
4. **SCRUM-598** — Proposta de Ação, com caminho de escrita separado do laço.
5. **SCRUM-599** — Perfil da Operação.
6. **SCRUM-600** — feedback e canal do Master.

---

## Estado da execução — S1 fechado

Recorte decidido pelo CTO: **(a)**. Sem briefing o slot não some; ele degrada. O card exige conteúdo,
a linha e o ícone não. A porta de entrada existe desde o primeiro dia, e o card ganha vida quando o
produtor de briefing aparecer numa onda posterior.

`src/modules/platform/lib/slot-do-oraculo.ts` + `.test.ts` — **11 casos verdes**, um ciclo
red→green por vez, nenhum teste escrito em lote.

| Ciclo | Caso | O que fixou |
|---|---|---|
| 1 | sobra ampla com briefing → `card` | a conta de `disponivel` e `sobra` |
| 2 | sobra sem card → `linha` | segundo degrau |
| 3 | recolhida com sobra de card → `icone` | a preferência de layout não tira o acesso |
| 4 | sobra apertada → `icone` | terceiro degrau |
| 5 | menu longo, folga acima do piso → `icone` | o degrau mínimo é garantido; a navegação rola por baixo |
| 6 | nem o ícone cabe sem furar o piso → `ausente` | **controle positivo executado** |
| 7 | recolhida sem espaço → `ausente` | pegou um defeito real: `colapsada` dava passe livre e furava o piso |
| 8 | sem briefing → `linha`, não `card` | codifica o recorte (a) |
| 9 | piso a 900, 700 e 560 | **controle positivo executado**; assere `alturaDaNavegacao`, não infere o piso pelo degrau |

Decisão de modelo tomada no ciclo 5, porque o ticket tem duas frases em tensão — *"não negocia
espaço com o menu"* e *"o acesso não se perde"*: **card e linha vivem só da sobra; o ícone é a única
exceção**, garantido mesmo com o menu comprido, desde que a navegação siga acima do piso. É o que dá
função ao piso — sem essa exceção o piso nunca morderia e o critério de aceite seria decorativo.

Constantes a validar contra o mockup: `ALTURA_DO_CARD = 150`, `ALTURA_DA_LINHA = 44`,
`ALTURA_DO_ICONE = 36`, `PISO_DA_NAVEGACAO = 200`. As três primeiras vêm do texto do ticket; o piso
foi escolhido aqui e é o único número sem origem no ticket.

**Gates:** `eslint` limpo nos dois arquivos; `typecheck:ratchet` com 0 erros introduzidos.
Suíte de `src/modules/platform/` tem 26 falhas — **as mesmas 26 com e sem estes arquivos**, medido
removendo-os e rodando de novo. Herança de `origin/main`, delta zero.

### Próximo: S2 e S3

- **S2** — hook com `ResizeObserver` sobre o `<aside>`, nunca sobre `window`. O teste tem que falhar
  se alguém trocar por `innerHeight`: montar com a lateral menor que a janela e ver o degrau mudar.
- **S3** — o slot dentro da `Sidebar` montada, nas três alturas. Sem isto, S1 prova a aritmética do
  degrau sem provar que a entrada dela é a lateral.

## Estado da execução — S2 fechado

`src/modules/platform/hooks/useDegrauDoSlot.ts` + `.test.tsx` — **4 casos verdes**.

| Ciclo | Caso | O que fixou |
|---|---|---|
| S2-1 | mede a lateral, não a janela | **controle positivo**: trocar por `window.innerHeight` dá `expected 'linha' to be 'icone'` |
| S2-2 | re-mede quando a lateral encolhe | observador ligado; a primeira medição é síncrona para o slot não piscar |
| S2-3 | recolher re-mede sem esperar o observador | **controle positivo**: tirar `colapsada` das dependências deixa vermelho |
| S2-4 | observa a lateral, não outro elemento | **controle positivo**: observar `document.body` deixa vermelho |

**O dublê global de `ResizeObserver` é no-op.** `src/test/setup.ts` instala um stub que nunca chama de
volta — existe para os primitivos do Radix não estourarem no mount. Um hook que só medisse dentro do
retorno de chamada do observador teria teste verde sem nunca medir. Duas defesas:

1. A medição inicial é síncrona, em `useLayoutEffect`, e não depende do observador.
2. Os casos que precisam de re-medição instalam um observador controlável próprio, que guarda o
   retorno de chamada e os alvos, e o restauram no `finally`.

O ciclo S2-4 nasceu de um furo encontrado no próprio S2-2: como o dublê dispara todos os retornos de
chamada seja qual for o alvo, um observador apontado para o elemento errado passaria. O alvo virou
asserção.

**Gates:** `eslint` sem erro nos quatro arquivos (só avisos de configuração do plugin `boundaries`,
herdados). `typecheck:ratchet` com 0 erros introduzidos. Suíte de `src/modules/platform/`:
**26 falhas com e sem estes arquivos** — herança de `origin/main`, delta zero. Verdes: 348 → 363.

### Próximo: S3

O slot dentro da `Sidebar` montada, nas três alturas. S1 prova a aritmética e S2 prova que a entrada
vem da lateral, mas nenhum dos dois prova que os elementos medidos são de fato o topo, o rodapé e a
navegação reais da `Sidebar` — as referências ainda são passadas à mão nos testes.

## Estado da execução — S3 fechado

`src/modules/platform/components/layout/Sidebar.slot.test.tsx` — **4 casos verdes** sobre a lateral
montada. `Sidebar.tsx` ganhou quatro referências (`lateral`, `topo`, `rodape`, `nav`), a chamada do
hook e o slot entre a navegação e o rodapé.

| Ciclo | Caso | Controle positivo |
|---|---|---|
| S3-1 | a 900px a porta existe, como linha | — |
| S3-2 | a 560px com menu comprido degrada para ícone | trocar `data-medida="rodape"` deixa vermelho |
| S3-3 | em tela baixa demais o slot some e o rodapé continua montado | — |
| S3-4 | recolher a lateral deixa o ícone | fixar `colapsada: false` deixa vermelho |

**jsdom não faz layout**, então `offsetHeight` nasce 0 em tudo e a lateral montada mediria zero. O
harness redefine `offsetHeight` no protótipo de `HTMLElement` e devolve altura só para quem tem
`data-medida` — os mesmos elementos que o hook lê. Quem não está marcado vale 0 de propósito: se a
referência for pendurada no elemento errado, a conta desanda e o teste acusa. É o que o controle
positivo do S3-2 comprova.

**O primeiro caso nasceu com a expectativa errada e foi a expectativa que mudou, não o código.**
Ele esperava `card` a 900px; o slot apareceu como `linha`, porque `temBriefing` é `false` na
`Sidebar` — não há produtor de briefing. O comportamento estava certo e o teste é que ainda assumia
o mundo antes do recorte (a).

### Alcance do que a fatia entrega hoje

O slot é, por enquanto, um elemento sem conteúdo visual: ele prova posição, degrau e presença, não
aparência. O visual (rótulo, gargalo truncado, marcador, e o painel que abre por cima no padrão da
Agenda) é o que falta — S4 e S5 da tabela de seams.

**Constante ainda sem origem no ticket:** `PISO_DA_NAVEGACAO = 200`. As outras três vêm do texto da
issue. O mockup dos três degraus está num artifact que não foi aberto.

### Verificação acumulada da fatia

- 19 casos novos: 11 (S1) + 4 (S2) + 4 (S3). Seis controles positivos executados.
- `eslint` sem erro nos cinco arquivos novos e em `Sidebar.tsx`.
- `typecheck:ratchet`: 0 erros introduzidos.
- `src/modules/platform/components/layout/`: 26 de 26 verdes — nenhuma regressão nos testes que já
  existiam da lateral, apesar de `Sidebar.tsx` ter mudado.
- `src/modules/platform/`: 26 falhas com e sem esta branch, todas em `SupportPanel.test.tsx`.
  Delta zero. Verdes 348 → 367.

## Estado da execução — S4 e S5 fechados

**S4 — a forma do slot.** `SlotDoOraculo.tsx` + `.test.tsx`, 3 casos.

| Ciclo | Caso | Controle positivo |
|---|---|---|
| S4-1 | texto longo não cresce o card | tirar a altura do degrau deixa vermelho |
| S4-2 | no ícone o alvo continua nomeado e o gargalo não é desenhado | — |
| S4-3 | o marcador aparece com gargalo e some sem | as duas metades no mesmo caso |

A altura sai de `ALTURA_POR_DEGRAU`, nunca do conteúdo — é isso que impede o gargalo do dia de
empurrar a navegação. O corte do texto é por CSS (`truncate` na linha, `line-clamp-3` no card), e não
por contagem de caracteres. No degrau `icone` o rótulo sai da tela mas não da árvore de
acessibilidade, e o gargalo vai para a dica flutuante.

O caso S4-3 junta presença e ausência de propósito: só a metade da ausência passaria também com um
`data-testid` escrito errado.

**S5 — o painel.** `OraculoPanel.tsx`, no contrato da Agenda (`open`, `onClose`, `sidebarWidth`).

| Ciclo | Caso | Controle positivo |
|---|---|---|
| S5-1 | clicar abre por cima e não navega | — |
| S5-2 | o capturador começa depois da lateral e acompanha o recolhimento | `left: 0` deixa vermelho |
| S5-3 | fecha pelo Esc e pelo botão | anular o Esc deixa vermelho |

O S5-2 existe porque o S5-1 não prova o que parece provar: **jsdom não faz layout**, então um link
continuar no documento não significa que dá para clicar nele — uma camada por cima não removeria
elemento nenhum. O que prova é a borda esquerda do capturador, e é isso que o caso assere.

### O que o painel ainda NÃO tem

Ele é a camada, com cabeçalho, fechamento por Esc e por botão, e um atalho para `/oraculo`.
**A conversa não está embutida** — hoje o painel manda para a tela cheia. Os hooks existem desde a
Onda 1 (`useOraculoTurno`, `useOraculoConversas`), então embutir é possível; não foi feito porque o
ticket descreve o painel pelo comportamento de camada e não pelo conteúdo. Decisão do CTO.

### Verificação acumulada da fatia SCRUM-595

- **25 casos novos**: 11 (S1) + 4 (S2) + 7 (S3 e S5) + 3 (S4). **Dez controles positivos**.
- `src/modules/platform/components/layout/`: **32 de 32 verdes** — nenhuma regressão na lateral,
  apesar de `Sidebar.tsx` ter mudado três vezes.
- `eslint` sem erro nos arquivos novos e em `Sidebar.tsx`.
- `typecheck:ratchet`: 0 erros introduzidos.
- `src/modules/platform/`: 26 falhas com e sem esta branch, todas em `SupportPanel.test.tsx`.
  Delta zero. Verdes 348 → 373.

### Ainda em aberto na fatia

- `PISO_DA_NAVEGACAO = 200` continua sem origem no ticket; o mockup dos três degraus não foi aberto.
- O degrau `card` não é alcançável em produção enquanto não houver produtor de briefing — está
  construído e testado, mas nasce inativo. É a consequência aceita do recorte (a).

## A conversa embutida no painel

Decisão do CTO: o painel deixa de ser atalho e passa a trazer a conversa dentro.

`src/modules/copilot/components/oraculo/OraculoConversa.tsx` + `.test.tsx` — a conversa em coluna
estreita, 2 casos.

| Ciclo | Caso | Controle positivo |
|---|---|---|
| 1 | manda a pergunta digitada | — |
| 2 | mostra a procedência e não a inventa quando não veio | trocar o guarda por `m.procedencia &&` deixa vermelho |
| 3 | o painel monta a conversa dentro | — |

**Onde o componente mora e por quê.** Ele fica em `copilot`, junto dos hooks que consome
(`useOraculoTurno`), e o painel — que é de `platform` — o monta por **caminho fundo com `lazy`**, e
não pelo barril. Mesmo motivo documentado na Agenda: o barril de um módulo puxa a árvore inteira dele
para dentro do pedaço da lateral. Quem nunca abre o Oráculo não paga por ele. O `eslint boundaries`
aceita o arranjo. O componente também é exportado pelo barril, para quem quiser consumi-lo sem
`lazy`.

As duas superfícies (`/oraculo` em tela cheia e o painel) compartilham o mesmo `useOraculoTurno`,
então teto diário, procedência e histórico valem igual nas duas. O cabeçalho do painel manteve um
atalho discreto para a tela cheia, que é onde vive a lista de conversas.

**Risco verificado antes de exportar:** export novo em barril já derrubou 53 casos nesta base. Aqui
não há consumidor — `grep 'from "@/modules/copilot"'` em `src/` não devolve nada — então não existe
dublê para quebrar. A suíte de `copilot` segue 4 de 4 verde.

### Medição na suíte inteira, contra a baseline

Rodada `vitest run tests/unit/ src/` nos dois estados, no mesmo worktree, revertendo os dois arquivos
modificados e removendo os dez novos:

| | `origin/main` puro | com a fatia |
|---|---|---|
| Testes falhando | 147 | **147** |
| Arquivos falhando | 40 | **40** |
| Testes passando | 11.156 | **11.184** |

Delta zero em vermelho, +28 em verde — exatamente os 28 casos da fatia (11 + 4 + 8 + 3 + 2).

**Armadilha encontrada no caminho:** a primeira tentativa usou `--reporter=basic`, que não existe
nesta versão do vitest. O comando saiu com código 0 e log de erro do carregador — **zero testes
rodaram**. É a quarta roupa do verde por ausência: suíte não-invocada. Só a contagem total distingue.
