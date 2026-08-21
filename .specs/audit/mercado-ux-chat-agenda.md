# Auditoria de mercado — Usabilidade, Chat e Agenda

**Autor**: Vitral (design) · **Data**: 2026-07-27 · **Base**: `main @c934cc3c`
**Escopo**: frase do CTO — *"nossa usabilidade muitas vezes foge muito do mercado tanto para o lado bom quanto para o lado ruim"*.
**Não implementa nada.** Todo achado cita `arquivo:linha` do código real.

---

## 0. Correção de premissa (leia antes do resto)

O brief desta frente partia de **"~40 rotas de org no menu, contra ~8 do Pipedrive"**. Isso está errado, e o erro inverte a conclusão.

**40 é o número de ROTAS, não de itens de menu.** O menu real está em `src/modules/platform/components/layout/TopNavigation.tsx:130-184`:

| Camada | Itens | Fonte |
|---|---|---|
| Primário (barra sempre visível) | **8** — Comando, Chat, Disparos, Funis▾, Carteira, Turbo▾, Agenda, Ranking | `TopNavigation.tsx:130-141` |
| Overflow "Mais" | 7 — Revisão, Combustível, Comissões, Checklists, Templates, Duplicatas, Lixeira | `TopNavigation.tsx:144-153` |
| Admin (dentro de "Mais") | 3 — Pilotos, Produtos, TV Dashboard | `TopNavigation.tsx:176-180` |
| Rodapé | 1 — Pitstop (configurações) | `TopNavigation.tsx:182-184` |
| Mobile bottom nav | 5 — Chat, Funis, Leads, Agenda, Mais | `MobileBottomNav.tsx:18-27` |

**8 primários = exatamente a largura do Pipedrive.** Não temos problema de largura de menu.

E mais: **os 3 pipes fixos NÃO são 3 itens de menu separados.** São filhos do dropdown "Funis", montados dinamicamente a partir de `usePipelineDisplayConfig` — `TopNavigation.tsx:263-274`, com `PIPE_PATH_MAP` em `:117-122`. Custom pipelines entram no mesmo dropdown (`:490-527`), incluindo funis temporários com deadline (`:510-527`) e um "Criar Funil" no fim da lista (`:528-539`).

Ou seja: **o padrão de mercado "um lugar Negócios/Funil com seletor de funil" já é literalmente o que fazemos.** As rotas `/pipe-*` são só URLs; o usuário nunca vê três entradas paralelas. Isso está mais próximo do Pipedrive do que o brief supunha, e é *melhor* que o Pipedrive num ponto: nosso seletor mistura pipes fixos, custom permanentes e campanhas temporárias na mesma gaveta, ordenados por `position` e filtráveis por `is_visible` — configuração por org, não hard-coded.

**O problema do Torque não é quantidade de menu. É nomenclatura e altitude.** É o que o resto deste documento ataca.

---

## 1. Camada A — Arquitetura de informação

### 1.1 O achado que resolve a frase do CTO

O CTO disse "não usam muito **a revisão**". A auditoria do Pauta apontou `/master/stage-roles` como candidata. **Está errado.**

**"Revisão" é a rota `/follow-ups`** — `TopNavigation.tsx:146` (`{ label: "Revisão", icon: Wrench, path: "/follow-ups" }`) e `:159`. Página: `src/modules/engagement/pages/Revisao.tsx`. Montada em `src/App.tsx:411-416`, atrás de `<FeatureRoute feature="review">`.

É a **lista de tarefas do vendedor**: follow-ups pendentes, prioridades diárias (`useDailyPriorities`), mensagens agendadas, filtro "minhas/do time", sugestões de IA — `Revisao.tsx:17-27,32-40`.

**Dado real (Lanterna, prod, 2026-07-27 — denominador 93 orgs, 66 ativas em 30d):** 23 orgs usaram em 90d, 17 em 30d. 272 follow-ups criados em 90d, 95 em 30d, **38% automáticos**. E o número que decide tudo: **415 follow-ups vencidos-e-abertos em 23 orgs.**

Leia esse último de novo. Não é uma tela ignorada — é uma tela **usada por 25% das orgs que acumula dívida e não avisa ninguém**. Quem entra, cria tarefa; quem cria tarefa, não volta. 415 compromissos vencidos parados numa tela que ninguém abre é a definição de feature que existe sem existir. **Isso não é argumento para esconder — é o substrato pronto para a badge de "Hoje".**

Três causas mecânicas para "não usam", em ordem de força:

1. **Não é item de primeiro nível.** Vive dentro do overflow "Mais" (`TopNavigation.tsx:144-153`), ao lado de Lixeira e Duplicatas. Está enterrada com o refugo. Com 415 vencidos, é a única tela do produto com um número gritando para ser exibido — e ela não tem badge.
2. **Chama-se "Revisão", com ícone de chave inglesa** (`Wrench`). Nenhum vendedor procura sua lista de tarefas do dia numa coisa chamada "Revisão" com ícone de oficina mecânica.
3. **Está atrás de uma feature flag** (`feature="review"`, `App.tsx:416`). 4 orgs têm override `review=ON` em `organization_features`. **Cuidado**: essa tabela é de *override*, não de estado efetivo — o default vem do plano via registry no front. Então 4 é **piso, não total**, e não dá para concluir provisionamento a partir dele. Como 23 orgs efetivamente criaram follow-ups, o estado efetivo é ≥23 — ou seja, **a flag não é a causa principal**. Descartada como explicação dominante.

**Veredito: MUDAR — e é a mudança de maior retorno deste documento.** Detalhe em 1.3.

### 1.2 A divergência real: metáfora de corrida sobre substantivos de trabalho

O menu não usa os nomes das coisas. Usa uma metáfora automotiva:

| Rótulo no menu | O que realmente é | Nome de mercado |
|---|---|---|
| **Comando** | Dashboard | Dashboard / Painel |
| **Combustível** (`/leads`) | Base de leads | Contatos / Leads |
| **Revisão** (`/follow-ups`) | Minhas tarefas e follow-ups | Atividades / Tarefas |
| **Pilotos** (`/equipe`) | Time de vendas | Equipe / Usuários |
| **Pitstop** (`/configuracoes`) | Configurações | Configurações |
| **Turbo** | Copilot + Automações | IA / Automações |
| **Ranking** (`/performance`) | Performance | Relatórios / Performance |

Isso é a divergência de usabilidade mais forte do produto, e é uma **faca de dois gumes real** — exatamente o que o CTO descreveu.

**Para o lado bom**: é identidade. Nenhum concorrente tem isso. Passa o teste "se trocar o logo poderia ser qualquer produto?" — não poderia. Vercel e Linear ganham diferenciação por restrição tipográfica; nós ganhamos por vocabulário. É defensável e é o que se vende numa demo.

**Para o lado ruim**: a metáfora cobra pedágio em toda tela **onde o usuário está procurando alguma coisa**. "Comando" e "Turbo" não têm custo — são destinos que o usuário aprende uma vez e nunca mais procura. "Revisão" e "Combustível" têm custo alto — são coisas que o usuário procura **pelo nome do trabalho** ("cadê minhas tarefas de hoje?", "cadê meus leads?"). Metáfora funciona em destino; falha em busca.

**Regra que proponho, e que é a espinha da IA nova:**

> **A metáfora fica onde o usuário chega. Some onde o usuário procura.**

Não é "tirar a personalidade". É colocá-la onde ela encanta em vez de onde ela atrapalha. Apple faz exatamente isso: "Finder" (destino, metafórico) convive com "Arquivo > Salvar" (ação, literal). Linear chama a tela de "Inbox" e o produto inteiro de "Linear" — a poesia está na marca, não no verbo.

Aplicação concreta, custo P:

| Hoje | Proposto | Racional |
|---|---|---|
| Comando | **Comando** (mantém) | Destino, não busca. Identidade pura. |
| Turbo | **Turbo** (mantém) | Idem. Guarda-chuva de IA, aprende-se uma vez. |
| Pitstop | **Pitstop** (mantém) | Destino terminal, ícone de engrenagem já desambigua. |
| Ranking | **Ranking** (mantém) | Já é o nome do trabalho. |
| **Revisão** | **Hoje** | É a lista do dia. Nome do trabalho. |
| **Combustível** | **Leads** | Substantivo do domínio. Nada a ganhar em ofuscar. |
| **Pilotos** | **Time** | Admin procura por "time"/"usuários". |

Ganho: metáfora preservada em 4 de 7 pontos, e removida exatamente nos 3 onde ela custa busca. Isso é mais afiado que "tirar tudo" *ou* "manter tudo".

### 1.3 Menu proposto — antes e depois

**A mudança central não é remover itens. É promover "Hoje" e rebaixar o que é administrativo.**

Hoje o vendedor loga e cai em `/dashboard` (`App.tsx:284` → `RootRedirect` → `resolveBootRedirect`, `App.tsx:207-223`). Ou seja: **a primeira tela do vendedor é um painel de métricas.** Pipedrive abre em *Activities*. HubSpot abre em *Tasks*. Métrica é tela de gestor; o vendedor precisa de uma fila de trabalho. Nós temos essa fila pronta (`Revisao.tsx`) e a escondemos no overflow.

```
ANTES  (TopNavigation.tsx:130-184)

┌──────────────────────────────────────────────────────────────────────────┐
│ ◈  Comando  Chat  Disparos  Funis▾  Carteira  Turbo▾  Agenda  Ranking  ⋯Mais │
└──────────────────────────────────────────────────────────────────────────┘
                                                                     └─ Revisão
                                                                        Combustível
                                                                        Comissões
                                                                        Checklists
                                                                        Templates
                                                                        Duplicatas
                                                                        Lixeira
                                                                        ── Admin ──
                                                                        Pilotos
                                                                        Produtos
                                                                        TV Dashboard
                                                                        ── ──
                                                                        Pitstop

DEPOIS

┌──────────────────────────────────────────────────────────────────────────┐
│ ◈  Hoje  Chat  Funis▾  Agenda  Comando  Turbo▾  Ranking  ⋯Mais            │
└──────────────────────────────────────────────────────────────────────────┘
    │                  │                                          └─ Leads
    │                  ├─ WhatsApp                                   Carteira
    │                  ├─ Agendamentos                               Disparos
    │                  ├─ Propostas                                  Duplicatas ⑦²⁸
    │                  ├─ Carteira ⇢ (atalho)                        Checklists
    │                  ├─ <custom pipelines>                         Templates
    │                  ├─ <campanhas temporárias>                    ── Admin ──
    │                  └─ ＋ Criar Funil                              Time
    │                                                                Produtos
    └─ badge numérica: 415 vencidos hoje em 23 orgs                  TV Dashboard
       (o número já existe, ninguém o vê)                            ── ──
                                                                     Manutenção ▸
                                                                       Lixeira
                                                                     Pitstop

  ✂ Comissões — REMOVIDO do menu (0 linhas, 0 orgs, desde sempre)
```

**Movimentos, um por um:**

| # | Movimento | Por quê | Esforço |
|---|---|---|---|
| A1 | **"Revisão" → "Hoje", promovido a 1º item primário, com badge de contagem** | É a fila de trabalho do vendedor. Pipedrive/HubSpot abrem aqui. Está pronta e escondida. Badge é o que faz o item ser clicado sem ser procurado. **O que a badge conta importa** — ver A1b. | **P** (a tela existe; é label + posição + `badge?: number` que já está no tipo `NavItem`, `TopNavigation.tsx:98`) |
| A1b | **A badge conta o que é do usuário e é de hoje — não o backlog inteiro** | Alerta da Lanterna que evita um erro caro: **38% dos follow-ups são automáticos** (425 de 1.122). Uma badge somando os 415 vencidos brutos nasce com um número intimidante, gerado em parte pelo próprio sistema — e badge intimidante não é chamado à ação, é ansiedade que o usuário aprende a ignorar (o padrão "9+ e-mails não lidos para sempre"). **Regra**: contar `vencidos + vence hoje`, do usuário logado, e **separar visualmente o automático do manual dentro da tela**. Se o número passar de ~2 dígitos, a badge vira ponto, não contagem. Linear faz exatamente isso — badge numérica só onde a ação é individualmente fechável. | **P** |
| A2 | **Home do vendedor passa a ser `/follow-ups`; "Comando" continua a home do admin** | `resolveBootRedirect` já ramifica por papel (master/gestor, `App.tsx:210-217`). Estender para `role`. Vendedor não abre o dia num gráfico. | **P** |
| A3 | **"Disparos" sai do primário para "Mais"** | **Confirmado pelo dado, e é pior do que eu supunha.** 47 orgs visitaram em 90d (45 em 30d, 820 visitas — page-view real), mas **só 2 orgs geraram disparo**: 3 planos, 54 destinatários. Funil 47→2. Um item primário que produz 820 visitas e 3 ações não tem demanda — tem **posição**. A visibilidade dada em #904 gerou curiosidade, não uso. Descer para "Mais" custa nada e libera o slot. **E abre um achado separado, fora do meu escopo: 45 orgs abrem a tela todo mês e desistem. Alguém precisa descobrir onde o fluxo trava.** | **P** |
| A4 | **"Carteira" sai do primário e vira filho de Funis** | Hoje é item primário *e* aponta para `/upsell`, e foi explicitamente removido do dropdown de Funis (`TopNavigation.tsx:266`). Carteira é um funil pós-venda; pertence à mesma gaveta mental. | **P** |
| A5 | **"Combustível" → "Leads", desce para "Mais"** | Base de leads é tela de importação/limpeza, não de rotina — a rotina acontece no funil e no chat. Renomear é obrigatório mesmo se não descer. | **P** |
| A6 | **"Comando" recua para depois de Agenda** | Continua no primário (admin usa muito), mas perde a primeira posição para "Hoje". Posição na barra é hierarquia. | **P** |
| A7 | **~~Duplicatas + Lixeira sob "Manutenção ▸"~~ → REVISADO: Lixeira sob "Manutenção"; Duplicatas fica visível e ganha badge** | **O dado inverteu metade deste movimento.** Duplicatas tem 0 merges na história — mas a tela ficou **quebrada de 26/05 a 22/07** (commit `0d3cc421`, #1192). Nunca funcionou; o zero não mede desinteresse. E há **728 duplicatas reais por e-mail esperando em 22 orgs**. Esconder agora seria enterrar uma tela recém-consertada com 728 itens de trabalho pendente. Ela merece o tratamento oposto: **badge com a contagem**, igual "Hoje". Lixeira (8 orgs, 392 exclusões) sim é higiene e pode descer. | **P** |
| A8 | **"Pilotos" → "Time"** | Ver 1.2. | **P** |
| A9 | **Corrigir atalhos `g w` / `g c` / `g p`** | `useGlobalShortcuts.ts:28-31` navega para `/qualificacao`, `/confirmacao`, `/propostas` — rotas **que não existem**. As reais são `/pipe-*`. Caem em `NotFound` (`App.tsx:766`). Bug real, silencioso: quem usa atalho leva 404. | **P** |
| A10 | **`Cmd+K` visível na barra** | O palette existe (`CommandPaletteProvider.tsx:50`) e resolve o problema de descoberta *sem* mexer no menu — mas nada na interface diz que ele existe. Linear e Stripe expõem `⌘K` como affordance persistente. Um chip discreto `⌘K` no canto da topnav converte um atalho invisível na porta principal de navegação. | **P** |
| A11 | **"Comissões" sai do menu** | **Único REMOVER que o dado sustenta sozinho.** `commissions` = **0 linhas, 0 orgs, desde sempre**. Não é baixa adoção — é adoção nula desde a origem, sem tela quebrada para explicar (ao contrário de Duplicatas). Ocupa uma linha permanente do overflow. Tirar do menu não apaga a rota: quem tiver o link continua entrando. **Não arraste Prêmiações junto** — 6 orgs têm competição real (11 competições); o que está morto lá é `awards` (1 linha com org NULL), não `competitions`. São coisas diferentes no mesmo menu. | **P** |
| A12 | **Badge de contagem em Duplicatas** | 728 duplicatas por e-mail em 22 orgs (+2.122 por nome), tela recém-consertada (#1192), 0 merges na história. Sem badge, o conserto é invisível. Mesmo mecanismo de A1: o número já existe, falta exibi-lo. **Nota técnica da Lanterna**: o ramo `phone` da RPC nunca retorna nada — há UNIQUE parcial em `(org, normalized_phone)` para leads vivos, então duplicata por telefone é impossível por construção. A badge conta e-mail + nome, e virá **maior** que o piso de 728 porque a RPC casa nome por similaridade 0.6, não igualdade. Isso é correto, mas exige que a tela deixe claro que "nome parecido" é sugestão, não fato — senão o merge vira destrutivo. | **P** |

**Um único item sai do menu (Comissões, com 0 uso absoluto e histórico).** O resto: oito rotas mudam de altitude, três mudam de nome, duas ganham badge, dois bugs de navegação são corrigidos, e o vendedor passa a abrir o dia numa fila em vez de num gráfico. Todos os movimentos são P. **Isso vale mais que qualquer feature nova neste documento.**

**Princípio que segurei em toda decisão de corte**: só removo com **zero absoluto + histórico + sem tela quebrada que explique o zero**. Só Comissões passa nos três. Duplicatas falhou no terceiro (esteve quebrada 2 meses) e por isso foi promovida em vez de escondida. Templates e Prêmiações têm uso baixíssimo mas não-nulo — ver §5.

---

## 2. Camada B — Telas de uso diário

### 2.1 Chat WhatsApp (`/chat-whatsapp`)

Referências: WhatsApp Web, Intercom, Front, Chatwoot, RD Conversas.

**Escala real** (page-view, `usage_events.module_visited`, 90d / 30d):

| Rota | Orgs 90d | Orgs 30d | Visitas 90d | Visitas 30d |
|---|---|---|---|---|
| `pipe_whatsapp` | **77** | **65** | **20.312** | **8.411** |
| `chat_whatsapp` | 71 | 56 | 11.901 | 4.541 |
| `pipe_propostas` | 64 | 47 | 2.103 | 776 |
| `leads` | 60 | 37 | 1.275 | 747 |
| `pipe_confirmacao` | 50 | 23 | 1.300 | 250 |
| `disparos` | 47 | 45 | 820 | 737 |
| `funis` | 30 | 25 | 563 | 287 |

**Correção ao brief**: ele afirma que o chat é "a tela mais usada do produto". **Não é — o kanban de qualificação é** (77 orgs / 20.312 visitas contra 71 / 11.901). O chat é a segunda. Isso não muda nenhum veredito abaixo, mas muda onde uma melhoria de densidade ou de teclado rende mais: **as duas telas juntas são 32 mil visitas em 90 dias, uma ordem de grandeza acima de tudo o mais.** Qualquer ganho de velocidade aqui se multiplica por um volume que nenhuma outra tela chega perto.

**Esta é a tela mais forte do produto e a que mais foge do mercado para o lado bom.** É um inbox de vendas nativo de WhatsApp, não um inbox de e-mail com WhatsApp enxertado — que é o que Pipedrive e HubSpot entregam via integração de terceiro.

| Item | O que temos hoje | Mercado | Veredito | Por quê | Esf. |
|---|---|---|---|---|---|
| **Filtro do inbox** | 9 dimensões (Funil, Etapa, Vendedor, Tag, Qualificação, Aguardando resposta, Pediu atendente, Fonte IA/humano, Com/sem lead) — `InboxFilterBar.tsx:51-60`; chips tipo Linear, épico #1234 | Intercom filtra por assignee/estado; Front por tag/assignee; RD Conversas quase nada | **MANTER+VENDER** | Nenhum concorrente cruza *etapa de funil* × *qualificação* × *quem respondeu (IA vs humano)* no inbox. `source: IA (copilot/workflow) vs Humano` (`:197`) é um filtro que só existe porque temos IA no loop. Vender explicitamente. | — |
| **Qualificação visível no inbox** | Tiers Diamante/Ouro/Prata/Bronze/Desqualificado com swatch de cor — `InboxFilterBar.tsx:39-44` | Ninguém tem tier de lead no inbox de mensagens | **MANTER+VENDER** | Vendedor prioriza fila por valor do lead sem sair da tela. É diferenciação real para B2B de ticket alto. | — |
| **Ações rápidas no chat** | Mover etapa, add funil, Pré-venda/Vendas, Qualificação — épico #1273, `chat/actions/` | Pipedrive: abrir o negócio noutra tela. HubSpot: painel lateral | **MANTER+VENDER** | Qualificar e mover funil sem trocar de tela é o loop central do nosso ICP. Está feito. | — |
| **Templates via slash command** | `/comando` com autocomplete — `SlashCommandPopover.tsx:28,99`. **Adoção: 2 orgs, 3 templates no total** | Intercom e Front têm macros com `/`; RD não tem | **MUDAR — problema de conteúdo, não de UI** | A mecânica está no nível do Front. O que não existe é **conteúdo**: 91 de 93 orgs têm o popover vazio. Um autocomplete que abre sem nada dentro ensina o usuário a nunca mais digitar `/`. Isso não se conserta com design de componente — conserta-se com **templates semeados na criação da org** (3–5 padrões de B2B: primeiro contato, follow-up sem resposta, envio de proposta, reativação) e com o passo correspondente no checklist de ativação. É o mesmo padrão do Notion e do Linear: o produto chega com conteúdo dentro, não vazio esperando disciplina do cliente. | **M** |
| **Painel de contexto do lead** | 4 abas — Info, Pipe, Histórico, IA — `context-panel/ContextPanelTab*.tsx` | Intercom mostra atributos; Front mostra CRM via plugin | **MANTER** | A aba **IA** (`ContextPanelTabAI.tsx`) não tem equivalente no mercado. | — |
| **Controle de takeover humano/IA** | `takeover/TakeoverControls.tsx` + `AITimeline.tsx` + `HumanPauseBadge.tsx` | Intercom tem handoff bot→humano. Pipedrive/RD: nada | **MANTER+VENDER** | Timeline do raciocínio da IA na conversa é craft raro. Melhor que Intercom, que só mostra o handoff, não o porquê. | — |
| **Navegação por teclado entre conversas** | **Não existe.** `ChatShell.tsx` não registra nenhum `keydown` (só `aria-label` em `:142`); os atalhos globais em `useGlobalShortcuts.ts:26-33` são só de navegação de rota | Front: `j/k` sobe/desce conversa, `e` arquiva, `Cmd+K` pula conversa. Intercom: `j/k`. Linear inteiro é teclado | **MUDAR** | O operador de inbox vive de teclado. Sem `j/k` e sem "ir para conversa", quem atende 100 conversas/dia usa mouse em 100% das trocas. É o maior gap de velocidade da tela mais usada do produto. | **M** |
| **Busca dentro do inbox** | Existe destaque de resultado (`search/HighlightedText.tsx`) e busca no `ChatBubbleSearch.tsx` | Todos têm busca full-text de mensagem | **ADICIONAR** — verificar cobertura | Precisa confirmar se a busca varre *conteúdo de mensagem* ou só nome de contato, e se está sujeita ao truncamento de 500 registrado em `inbox-filter-truncation-1277`. Não consegui provar pelo código nesta janela. | **M** |
| **Indicador de SLA / tempo sem resposta** | `useSlaConfigs.ts` existe em `platform/hooks/` mas é do support desk. `ConversationListItem.tsx` **não tem nenhuma referência a SLA** | Intercom e Front mostram "aguardando há Xh" e ordenam por isso | **ADICIONAR** | Temos `waiting: "Aguardando resposta"` como *filtro* (`InboxFilterBar.tsx:57`) mas não como *sinal visual na linha*. Um lead esperando há 4h parece igual a um esperando há 4min. Para WhatsApp, onde a janela de resposta é a métrica que fecha venda, é o gap de maior impacto comercial da tela. | **M** |
| **Densidade da lista** | `px-3 py-3` na linha da conversa — `ConversationListItem.tsx:273` (≈68px de altura com avatar 40px + 2 linhas) | Front ≈56px, Linear ≈40px por linha, WhatsApp Web ≈72px | **MUDAR** | Estamos na densidade do WhatsApp Web (consumidor), não na do Front (operador). Descer para `py-2` (≈56px) coloca ~4 conversas a mais na dobra em tela de 1080p. Densidade não é economia de pixel — é quantas decisões cabem num olhar. | **P** |
| **Transferência de conversa** | Filtro por vendedor e "Não atribuídas" (`InboxFilterBar.tsx:161-169`); atribuição a vendedor existe | Intercom/Front: atribuir + nota interna + @menção | **MUDAR** | Temos `ConversationNotes.tsx`, mas não achei @menção de colega nem notificação de transferência. Sem isso a transferência é silenciosa: o novo dono não sabe que recebeu. | **M** |

**Veredito da tela**: MANTER+VENDER na inteligência (filtros, qualificação, IA no loop, ações de funil) — estamos à frente do mercado. MUDAR em velocidade de operação: teclado, densidade e SLA visual. É o padrão clássico de produto que ganhou em capacidade e não voltou para afiar o loop.

### 2.2 Agenda (`/agenda`)

Referências: Pipedrive Activities, HubSpot Meetings.

### O diagnóstico que quase saiu errado

A primeira leitura do dado dizia: `/agenda` = 11 orgs de 93, 32 reuniões em 90d, **1 org com Google Calendar**. Conclusão óbvia: agenda fracassou, não investir.

**Está errado, e o número que prova é este:**

| Sinal | Valor | O que mede |
|---|---|---|
| `pipe_confirmacao` (page-view) | **50 orgs / 1.300 visitas em 90d** | Quantas orgs *operam* reunião |
| `meeting_events` | **1.245 eventos em 31 orgs (90d)** | Quantas orgs *geram evento de reunião de verdade* |
| `meetings` (linha criada) | 11 orgs / 32 registros | Quantas usam o registro formal |
| Google Calendar conectado | **1 org** | Quantas ligaram o sync |

**31 orgs geram evento de reunião. 11 têm registro em `meetings`. 1 conectou calendário.**

A reunião **é** operada, em escala, por metade da base — só que **no kanban, não no calendário**. `/agenda` não fracassou por falta de demanda. **É a visualização errada para o jeito como o cliente trabalha.**

Essa distinção decide dinheiro. "Agenda fracassou" leva a cortar investimento e deixar como está. "A visualização está errada" leva a uma pergunta muito melhor: *por que 31 orgs conduzem reunião sem nunca abrir um calendário?* A resposta provável — e que casa com o ICP — é que **para venda B2B por WhatsApp, a reunião não é um bloco de tempo, é um estágio de um negócio.** Nosso `pipe_confirmacao` com cadência D-5/D-3/D-1 já modela isso, e é por isso que ele tem 50 orgs enquanto o calendário tem 11.

**O que muda na recomendação:**

- **Não construir Calendly.** Confirmado, agora por motivo forte: não é falta de captação, é que o calendário não é o lugar onde a reunião vive aqui.
- **Não construir mais agenda.** A tabela abaixo é mapa de estado, não fila de trabalho.
- **A pergunta certa vira**: o que falta no `pipe_confirmacao` para ele ser a agenda? (Ex.: uma visão "reuniões de hoje" *dentro* do funil, em vez de uma rota de calendário separada.) **Não desenho isso aqui** — precisa de dado de como as 50 orgs usam o kanban, e é trabalho de outra rodada. Registrado como recomendação, não como spec.
- **`meeting_events` × `meetings` (31 vs 11 orgs)** é uma discrepância de modelo, não de UI. Passa para o Cais.

**Caveat da Lanterna, repassado**: `pipe_confirmacao` cai de 50 orgs/1.300 visitas em 90d para 23 orgs/250 em 30d. **Não afirmo tendência com isso** — pode ser sazonal.

| Item | O que temos hoje | Mercado | Veredito | Por quê | Esf. |
|---|---|---|---|---|---|
| **Google Calendar bidirecional** | Overlay + dedup por `google_event_id` — `Agenda.tsx:140-173`; 7 edge functions incl. **webhook** (push do Google). **Adoção: 1 org (4 tokens)** | Pipedrive e HubSpot têm sync bidirecional | **MANTER — e investigar a conexão, não o produto** | Paridade técnica completa e não usada. Com 1 org conectada de 93, o gargalo não é a feature: é o **fluxo de conectar**. Ninguém liga o Google Calendar porque ninguém encontra ou conclui o OAuth. Antes de tocar em qualquer coisa de agenda, medir onde o `google-calendar-connect` é oferecido na interface e quantos abandonam. Zero código de calendário novo até isso estar respondido. | — |
| **Calendário compartilhado do time** | `useGoogleCalendarSharing` + cores por usuário — `Agenda.tsx:31,51-54,97` | Pipedrive tem visão de time no plano superior | **MANTER** | Paridade, e a dedup entre evento interno e overlay do Google (`:160-168`) é craft que o Pipedrive erra. Mas depende do Google conectado — hoje serve 1 org. | — |
| **No-show tracking** | `no_show` em `useMeetings.ts`, `useSDRPerformance.ts`, `usePipeMetrics.ts`, `MergedFunnelCardActions.tsx`, `ConfirmacaoStats.tsx` | HubSpot: campo manual. Pipedrive: não tem nativo | **MANTER+VENDER** | Não é só um campo: alimenta métrica de SDR e stats do funil. Para B2B onde a reunião *é* o gargalo, isso é diferenciação forte. | — |
| **Funil de confirmação com cadência D-5/D-3/D-1** | `pipe_confirmacao` com estágios marcada→d5→d3→d1→compareceu | **Ninguém tem isso.** Pipedrive/HubSpot tratam reunião como evento, não como pipeline com estágios de risco | **MANTER+VENDER** | É a nossa invenção mais defensável em agenda. Modela "reunião marcada não é reunião realizada" como processo, não como esperança. Vender como método, não como feature. | — |
| **Link público de agendamento** | **Não existe nativo.** Só `webhook-calcom` (recebe de Cal.com) e `capability-manifest.ts` mencionando booking como capability de copilot | HubSpot Meetings e Pipedrive Scheduler: link público, disponibilidade, buffer, fuso, formulário de qualificação | **ADICIONAR** | Gap mais claro deste documento. **Porém**: no ICP (B2B WhatsApp), o agendamento nasce na conversa, não num link enviado por e-mail. A prioridade certa não é copiar o Calendly — é o copilot propor 3 horários dentro do WhatsApp e gravar a reunião ao confirmar. A capability já está mapeada em `capability-manifest.ts`. **Link público entra como escape hatch, não como caminho principal.** | **G** (link público) / **M** (proposta de horário no chat) |
| **Lembrete automático de reunião** | Não achei job de lembrete pré-reunião. Existe `process-followup-automations` / `process-followup-situations` (follow-up de lead, não de compromisso) | Padrão em todos: e-mail/SMS 24h e 1h antes | **ADICIONAR** | Com WhatsApp como canal e no-show já rastreado, o lembrete é o fechamento óbvio do laço: temos o número, o canal e a métrica que ele melhora. Provavelmente o item de melhor retorno/esforço da agenda inteira. | **M** |
| **Criar atividade a partir do negócio em 1 clique** | Existe, mas **escondido** — "Agendar" está dentro do dropdown `⋯` do `LeadModalToolbar.tsx:111`. Só WhatsApp (`:56`) e E-mail (`:69`) são botões diretos | Pipedrive: "Schedule activity" é botão primário do detalhe do negócio | **MUDAR** | Pipedrive construiu o produto inteiro sobre "todo negócio tem próxima atividade". Enterrar "Agendar" num overflow contradiz a própria existência do `pipe_confirmacao`. Promover a botão de 1º nível: **P**. | **P** |
| **"Minhas atividades de hoje" como tela inicial** | A tela existe (`Revisao.tsx` — follow-ups + prioridades + agendadas) mas **não é a home** (`App.tsx:284` → `/dashboard`) e está no overflow | Pipedrive abre em Activities; HubSpot em Tasks | **MUDAR** | Ver A1/A2. A tela está construída; falta altitude. | **P** |

**Veredito da tela**: forte em *método* (confirmação como funil, no-show como métrica), com sync de calendário em paridade. Fraca em *automação de captura* (sem link público, sem lembrete). O caminho certo não é clonar o Calendly — é fechar o laço dentro do WhatsApp, que é onde nosso ICP vive.

### 2.3 Onboarding e primeiro uso

| Item | O que temos hoje | Mercado | Veredito | Por quê | Esf. |
|---|---|---|---|---|---|
| **Wizard de setup do admin** | 9 steps — `onboarding/steps/Step*.tsx` (Perfil da operação, Estrutura comercial, Processo de vendas, WhatsApp, Equipe, Primeiro lead, Automações, Revisão, Ativação) | HubSpot tem wizard longo; Pipedrive é mais curto | **MANTER** | Cobertura correta para produto que precisa de WhatsApp conectado antes de servir para alguma coisa. | — |
| **Checklist de ativação pós-login** | 6 itens com progresso, deep link, dismiss, `role="list"`, `aria-expanded` — `OnboardingChecklist.tsx:8-11,65-108` | HubSpot e Linear usam exatamente este padrão | **MANTER** | Bem executado e com acessibilidade declarada no próprio arquivo. | — |
| **Membro não-admin durante o onboarding** | **Bloqueado numa tela de espera**: "Configuração em andamento — O administrador está configurando o sistema. Aguarde a conclusão para acessar." — `OnboardingGate.tsx:23-30` | Pipedrive/HubSpot deixam entrar com dados de exemplo | **MUDAR** | Pior primeira impressão possível: o vendedor foi convidado, logou, e a primeira coisa que o produto faz é **negar acesso e mandar esperar**. Não há ação, não há previsão, não há saída. Isso é uma porta trancada com um bilhete. Mínimo: deixar entrar em modo leitura com estado vazio explicativo. Bom: mostrar o que já está pronto e o que falta, com nome de quem está configurando. | **M** |
| **Estados vazios** | `EmptyState.tsx` genérico — ícone em pill `bg-muted` + título + descrição + `action` **opcional**; usado em ~56 arquivos | HubSpot/Pipedrive: ilustração + CTA + link de doc em toda tela vazia | **MUDAR** | O componente é honesto e neutro — mas `action` ser opcional significa que uma parte dos ~56 usos é beco sem saída: o produto informa que está vazio e não diz o que fazer. **Tornar `action` obrigatório no tipo** é uma mudança de uma linha que força a correção de todos os call sites e impede regressão. É o tipo de restrição estrutural que o design deveria impor via tipo, não via revisão. Visualmente: pill `bg-muted` com ícone a 50% de opacidade é o estado vazio padrão de qualquer SaaS — reprova no teste "poderia pertencer a qualquer produto". | **P** (tipo) / **M** (call sites + tratamento visual) |

### 2.4 Detalhe do lead

| Item | O que temos hoje | Mercado | Veredito | Por quê | Esf. |
|---|---|---|---|---|---|
| **Estrutura** | 3 abas no mobile — Info / Pipes / Atividade (`LeadDetailDialogV2.tsx:244-264`), com aba default por contexto de abertura (`:44-46`, PRD #284/#314) | Pipedrive/HubSpot: painel único com seções coláveis | **MANTER+VENDER** | **Aba default por contexto de abertura** é craft de nível Linear: abrir pelo chat leva à Atividade, abrir pelo kanban leva ao Pipe. Ninguém no mercado faz isso. É a coisa mais sofisticada desta tela e provavelmente ninguém sabe que existe. | — |
| **Multi-funil no mesmo lead** | `cross-pipe/` + `CrossPipePanel.tsx` + `pipes/` | Pipedrive: um negócio por pipeline, múltiplos negócios por contato | **MANTER+VENDER** | Nosso modelo (um lead, presente em vários pipes ao mesmo tempo) reflete melhor a venda B2B real, onde o mesmo cliente está em qualificação e upsell simultaneamente. | — |
| **Timeline unificada** | `LeadDetailTimeline.tsx` + `activity/` | Padrão em todos | **MANTER** | Paridade. | — |
| **Ações de 1 clique** | Diretos: WhatsApp (`:56`), E-mail (`:69`). Em overflow `⋯`: Ligar (`:101`), IA escreve e-mail (`:104`), **Agendar** (`:111`), Abrir no chat (`:115`), SMS (`:119`), Excluir (`:127`) | Pipedrive: Activity / Note / Email como abas de ação primárias | **MUDAR** | Duas coisas erradas na mesma barra: **"Agendar" enterrado** (ver 2.2) e **"Excluir" no mesmo menu que ações rotineiras** — destrutivo não convive com cotidiano, mesmo em vermelho. Promover Agendar; separar Excluir por divisor ou movê-lo para fora. | **P** |
| **Campos visíveis vs escondidos** | `LeadDetailProperties.tsx` + `PropertyGroup.tsx` + `InlineField.tsx` (edição inline) + `LeadVisibilityState.tsx` | HubSpot: "highlights" fixos + o resto colapsado | **MANTER** | Edição inline + agrupamento + estado de visibilidade é a estrutura certa. | — |

---

## 3. Onde somos melhores que o mercado — lista honesta

Ordenada por quanto é defensável, não por quanto é bonito. Tudo aqui tem `arquivo:linha`.

1. **Filtro de inbox por dimensão de CRM.** 9 dimensões cruzando etapa de funil, qualificação e origem IA-vs-humano dentro do inbox de mensagens — `InboxFilterBar.tsx:51-60`. Intercom filtra por assignee e estado; RD Conversas quase nada. **Ninguém cruza funil × tier × autor no inbox.**
2. **Confirmação de reunião como funil com cadência D-5/D-3/D-1.** Pipedrive e HubSpot tratam reunião como evento no calendário; nós tratamos como pipeline com estágios de risco, alimentando no-show e métrica de SDR (`useSDRPerformance.ts`, `usePipeMetrics.ts`). **É método embutido em produto** — o mais vendável desta lista.
3. **IA no loop com controle visível.** Takeover humano↔IA (`TakeoverControls.tsx`), timeline do raciocínio (`AITimeline.tsx`), pausa humana explícita (`HumanPauseBadge.tsx`), aba de IA no painel de contexto (`ContextPanelTabAI.tsx`), e filtro "Fonte: IA vs Humano" no inbox. Intercom mostra o handoff; **nós mostramos o porquê.**
4. **Um lead em múltiplos funis simultâneos.** `cross-pipe/`, `CrossPipePanel.tsx`. Modela a realidade B2B (mesmo cliente em qualificação e upsell) melhor que o modelo "um negócio por pipeline" do Pipedrive.
5. **Aba default por contexto de abertura no detalhe do lead.** `LeadDetailDialogV2.tsx:44-46`. Craft de nível Linear. Nenhum concorrente faz. Provavelmente invisível para o cliente — **candidato a virar argumento de demo.**
6. **Dropdown de Funis que mistura fixos, custom e campanhas temporárias com deadline.** `TopNavigation.tsx:490-527`, ordenação por `position`, visibilidade por org (`usePipelineDisplayConfig`). Pipedrive tem seletor de funil; não tem funil temporário com prazo na mesma gaveta.
7. **Qualificação em tier com cor, visível na fila de atendimento.** `InboxFilterBar.tsx:39-44`. O vendedor prioriza por valor sem sair do inbox.
8. **Identidade de vocabulário.** Comando / Turbo / Pitstop. Passa o teste "poderia ser qualquer produto?" — não poderia. Vale manter **onde é destino** (ver 1.2); é diferenciação real numa categoria onde todo mundo se chama "Deals / Contacts / Reports".

---

## 4. Matriz consolidada — por esforço

**P — fazer primeiro (nenhum exige código novo relevante):**

| # | Item | Onde |
|---|---|---|
| A1 | "Revisão" → **"Hoje"**, 1º item primário, com badge de contagem | `TopNavigation.tsx:146,159,98` |
| A2 | Home do vendedor = `/follow-ups`; Comando continua home do admin | `App.tsx:207-223,284` |
| A9 | Corrigir atalhos `g w` / `g c` / `g p` — apontam para rotas inexistentes → 404 | `useGlobalShortcuts.ts:28-31` |
| A10 | Expor `⌘K` como chip persistente na topnav | `CommandPaletteProvider.tsx:50` + `TopNavigation.tsx` |
| B1 | Promover "Agendar" a botão primário no detalhe do lead; separar "Excluir" | `LeadModalToolbar.tsx:111,127` |
| B2 | Densidade da lista de conversas: `py-3` → `py-2` | `ConversationListItem.tsx:273` |
| B3 | `action` obrigatório no tipo de `EmptyState` | `EmptyState.tsx:3-8` |
| A5/A8 | "Combustível" → "Leads"; "Pilotos" → "Time" | `TopNavigation.tsx:147,166,177` |
| A3/A4/A6/A7 | Reordenar barra: Disparos e Carteira saem do primário; Lixeira sob "Manutenção" | `TopNavigation.tsx:130-153` |
| A11 | **Remover "Comissões" do menu** (0 linhas, 0 orgs, desde sempre) | `TopNavigation.tsx:148,168` |
| A12 | Badge de contagem em Duplicatas (728 pendentes em 22 orgs) | `TopNavigation.tsx:151` |

**M — próxima rodada:**

| # | Item |
|---|---|
| C1 | Navegação por teclado no chat (`j`/`k`, `Esc`, ir-para-conversa) — maior gap de velocidade da tela mais usada |
| C2 | SLA visual na linha da conversa ("aguardando há Xh") + ordenação por espera |
| C9 | **Semear 3–5 templates de mensagem na criação da org** + passo no checklist de ativação. Hoje 91 de 93 orgs abrem o `/` no vazio. Melhor retorno/esforço de todo o chat. |
| C4 | Membro não-admin entra em modo leitura durante o onboarding, em vez de tela de espera |
| C6 | Nota interna com @menção + notificação na transferência de conversa |
| C7 | Confirmar cobertura da busca de mensagens (conteúdo vs contato; truncamento de 500) |
| C8 | Passar os ~56 call sites de `EmptyState` para ter CTA + tratamento visual próprio |
| ~~C3~~ | ~~Lembrete automático de reunião~~ — **rebaixado**: 11 orgs usam agenda, 32 reuniões/90d. Não investir antes de entender por que a agenda não é usada. |
| ~~C5~~ | ~~Copilot propõe horários no WhatsApp~~ — **rebaixado pelo mesmo motivo.** |

**G — decidir, não fazer agora:**

| # | Item |
|---|---|
| D1 | Link público de agendamento (Calendly-like). **Recomendação: adiar, agora com dado.** Não é só que o ICP agenda pela conversa — é que a agenda inteira tem 11 orgs e o Google Calendar tem 1. Construir captação de reunião aqui é decorar um andar vazio. |

**Investigações que o dado abriu e que não são minhas** (registro para o Pauta rotear):

| # | Pergunta | Dono provável |
|---|---|---|
| E1 | **45 orgs/mês abrem `/disparos` e 2 disparam.** Onde o fluxo trava? Funil 47→2 com 820 visitas é o maior desperdício de intenção medido no produto. | Bancada (dirigir o fluxo) + Cais |
| E2 | **1 org de 93 conectou o Google Calendar.** O gargalo é o fluxo de OAuth, não o calendário. Onde a conexão é oferecida e quantos abandonam? | Bancada |
| E3 | **20 orgs criaram funil custom que nunca recebeu lead** (37 criaram, 17 com entrada em 90d). Criar é fácil, alimentar não — falta o passo "como o lead entra aqui" no momento da criação. | Cais |
| E4 | **Motivo de perda = 0 das 93 orgs.** Campo existe, ninguém preenche. Sem isso não há análise de perda nenhuma. | Cais |
| E5 | `saved_views=0`, `reports=0`, `report_schedules=0`, `dashboards` legado=0, webhooks de saída=0 orgs. Cinco subsistemas com zero absoluto. | Cais / Lanterna |

---

## 5. Adoção real e limites da leitura

Dado da Lanterna, prod, 2026-07-27. **Denominador = 93 orgs** (66 ativas em 30d, 87 em 90d) — não ~30 como diz o `CLAUDE.md`. Doc completo: `.specs/audit/uso-real-prod.md`.

**Aviso metodológico que herdo dela e repasso**: só 7 rotas têm page-view instrumentado (`pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`). Todo o resto foi medido por **pegada de dado** — linhas criadas na tabela que a feature escreve. Isso prova ação e é cego para "abriu e desistiu". **Zero de rota não-instrumentada não é zero de uso**, e nenhum veredito deste documento trata assim.

> ### ⛔ Guarda de uso desta tabela
>
> **Esta tabela não autoriza cortes que não estejam escritos aqui.** A Lanterna foi explícita e eu subscrevo: em telas de **leitura pura** — que consultam e não escrevem — o zero é **artefato da medição, não desuso**. `/insights` é o caso exemplar: não tem escrita, não tem evento, e por isso aparece como nada. Não aparecer não é não ser usado.
>
> Três regras para quem for usar estes números depois:
> 1. **Nenhum corte por zero de tela de leitura pura.** Se a feature não escreve, o instrumento não a enxerga.
> 2. **Nenhum corte por zero de tela que esteve quebrada.** Foi o que salvou `/duplicatas` — 0 merges em tela morta por 2 meses não mede desinteresse.
> 3. **Nenhum corte por baixa adoção sem checar partida a frio.** Foi o que salvou `/templates` — 2 orgs com o popover cheio contra 91 com ele vazio é problema de semente, não de feature.
>
> Só **um** item deste documento passou nos três filtros e foi assinado como remoção: `/comissoes`.

| Rota | Adoção (90d) | Efeito no meu veredito |
|---|---|---|
| `/disparos` | 47 orgs, 820 visitas, **2 orgs disparando** | Confirma A3 e abre E1 |
| `/funis` custom | 30 orgs visitam; 37 criaram, **20 sem lead entrando** | Abre E3 (não é meu escopo) |
| `/follow-ups` | 23 orgs, 272 criados, **415 vencidos-em-aberto** | **Reforça A1/A2 — é o substrato da badge** |
| `/produtos` | 17 orgs, 2.023 produtos, 100% manual | Neutro aqui |
| `/metas` | 12 orgs, 9 com meta do mês corrente | Neutro aqui |
| `/agenda` | 11 orgs, 32 reuniões, 1 org com Google — **mas `pipe_confirmacao` = 50 orgs e `meeting_events` = 31 orgs** | **Inverte o diagnóstico da §2.2**: reunião é operada no kanban, a agenda é a visualização errada. Mata C3/C5/D1 por motivo melhor. |
| `/checklists` | 9 orgs, 923 checklists (concentrado) | Fica no menu — uso real, ainda que concentrado |
| `/lixeira` | 8 orgs, 392 exclusões | Desce para "Manutenção" |
| `/premiacoes` | 6 orgs com competição; `awards` = 0 orgs | Baixo mas não-nulo → **não removo** |
| `/templates` | **2 orgs, 3 templates** | Vira C9 (semear conteúdo), não REMOVER |
| `/tv` | proxy: 4 orgs com override | Fica em Admin |
| `/comissoes` | **0 linhas, 0 orgs, desde sempre** | **Único REMOVER (A11)** |
| `/duplicatas` | 0 merges — **mas tela quebrada 26/05–22/07**; 728 duplicatas em 22 orgs | **Inverte A7: promove com badge (A12)** |
| `/insights` | **não mensurável** (leitura pura, sem escrita, sem evento) | **Nenhuma conclusão. Fica como está.** |

**Sobre a flag `review`**: 4 orgs com override `review=ON`. `organization_features` é tabela de *override* (118 linhas / 38 keys), não de estado efetivo — o default vem do plano via registry no front. 4 é **piso**. Como 23 orgs criaram follow-ups de fato, o efetivo é ≥23, e a flag **não explica** o baixo uso. Descartada como causa dominante.

**Page-views (2ª rodada da Lanterna) — pendência #1 RESOLVIDA:** `pipe_whatsapp` 77 orgs/20.312 visitas · `chat_whatsapp` 71/11.901 · `pipe_propostas` 64/2.103 · `leads` 60/1.275 · `pipe_confirmacao` **50/1.300** · `disparos` 47/820 · `funis` 30/563 (90d). Mais `meeting_events` = **1.245 eventos em 31 orgs**. Isso inverteu o diagnóstico da agenda (§2.2) e corrigiu o brief sobre qual é a tela mais usada (§2.1).

**Caveat repassado**: `pipe_confirmacao` cai de 50 orgs/1.300 (90d) para 23/250 (30d). Pode ser sazonal — **nenhuma tendência afirmada com isso**.

**O que continua sem prova:**

- **Estado efetivo da flag `review` por org** — só sai executando o registry no front. Pedir à Bancada pelo Palco, se alguém precisar decidir provisionamento.
- **Por que 31 orgs conduzem reunião sem abrir calendário.** Sei *que* acontece; não sei o suficiente sobre como as 50 orgs usam o kanban para desenhar a alternativa. É a próxima pergunta da agenda, e não a respondo aqui.
- **Cobertura da busca de mensagens** (conteúdo vs contato; truncamento de 500 — ver `inbox-filter-truncation-1277`).
- **Screenshots.** Não dirigi o Palco (é da Bancada). Toda evidência de interface aqui é de código.

---

## CONTEXT PACKET — CP-v2

**Mapa verificado** (lido por Vitral em `main @c934cc3c`, 2026-07-27):
- Menu = `src/modules/platform/components/layout/TopNavigation.tsx`. Primários `:130-141` (8 itens), overflow "Mais" `:144-153` (7), admin `:176-180` (3), rodapé `:182-184` (1). Mobile bottom nav = `MobileBottomNav.tsx:18-27` (5 itens).
- Pipes fixos são **filhos do dropdown "Funis"**, montados de `usePipelineDisplayConfig` — `TopNavigation.tsx:263-274`; `PIPE_PATH_MAP` `:117-122`; custom pipelines `:490-527`; "Criar Funil" `:528-539`.
- "Revisão" = `/follow-ups` → `src/modules/engagement/pages/Revisao.tsx`, montada em `src/App.tsx:411-416` atrás de `<FeatureRoute feature="review">`. Conteúdo: follow-ups + `useDailyPriorities` + mensagens agendadas + filtro mine/time (`Revisao.tsx:17-27,32-40`).
- Home = `App.tsx:284` → `RootRedirect` (`:207-223`) → `resolveBootRedirect`, ramifica por master/gestor. Vendedor cai em `/dashboard`.
- Chat: filtros 9 dimensões `InboxFilterBar.tsx:51-60`, tiers `:39-44`; linha da conversa `ConversationListItem.tsx:273` (`px-3 py-3`); takeover `chat/takeover/`; painel de contexto `chat/context-panel/` (4 abas); slash templates `SlashCommandPopover.tsx:28,99`.
- Agenda: overlay + dedup Google `Agenda.tsx:140-173`; sharing `:31,51-54,97`; 7 edge functions `google-calendar-*` + `meeting-calendar-sync`.
- Lead detail: abas mobile `LeadDetailDialogV2.tsx:244-264`, default por contexto `:44-46`; toolbar `LeadModalToolbar.tsx:56,69,101-127`.
- Onboarding: `OnboardingGate.tsx:23-30` (membro bloqueado), wizard `onboarding/steps/` (9), checklist `OnboardingChecklist.tsx:65-108` (6 itens).
- `EmptyState.tsx` — `action` opcional (`:3-8`), usado em ~56 arquivos.
- Tokens conferidos: `--primary: 47 100% 50%` (`src/index.css:33,158,255`), `--ring` idem, `--gradient-gold` `:126`. Classes de menu `.topnav-item` / `-active` / `-locked` em `src/index.css:561-651`. **Nenhum token novo é necessário para nada deste documento.**

**Achados**
- `useGlobalShortcuts.ts:28-31` navega para `/qualificacao`, `/confirmacao`, `/propostas` — **rotas inexistentes**; caem em `NotFound` (`App.tsx:766`). Atalhos `g w`/`g c`/`g p` quebrados.
- `⌘K` funciona (`CommandPaletteProvider.tsx:50`) mas **não tem affordance visível** em lugar nenhum.
- `ChatShell.tsx` **não registra `keydown`** — sem navegação por teclado entre conversas.
- **Sem SLA/tempo de espera na linha da conversa**; existe só como filtro (`InboxFilterBar.tsx:57`). `useSlaConfigs.ts` é do support desk, não do chat de vendas.
- **Sem link público de agendamento**; só `webhook-calcom` (inbound de terceiro) + booking como capability de copilot (`capability-manifest.ts`).
- **Sem job de lembrete pré-reunião**; `process-followup-*` é follow-up de lead, não de compromisso.
- No-show **existe e alimenta métrica** (`useMeetings.ts`, `useSDRPerformance.ts`, `usePipeMetrics.ts`).
- "Agendar" enterrado no overflow `⋯` do lead (`LeadModalToolbar.tsx:111`), ao lado de "Excluir" (`:127`).
- `OnboardingGate.tsx:23-30`: membro não-admin fica **bloqueado** em tela de espera durante o onboarding do admin.

**CONTESTADO**
- CP-v1 dizia *"~40 rotas de org no menu"* e sugeria fragmentação vs os ~8 do Pipedrive. **Falso.** 40 é o nº de rotas; o menu tem 8 primários. Prova: `TopNavigation.tsx:130-141`.
- CP-v1 dizia *"3 pipes fixos como 3 itens de menu separados"*. **Falso.** São filhos do dropdown "Funis". Prova: `TopNavigation.tsx:136,263-274`. → **item de cruzamento com o Cais muda de figura: não há fragmentação de menu a corrigir.**
- CP-v1 marcava `/master/stage-roles` como candidata a "a revisão que o CTO citou". **Descartado** — é `/follow-ups`.

**Descartado**
- Propor sistema de tokens ou paleta nova: nada neste documento precisa. Gold `47 100% 50%` já é único e consistente nos 3 temas.
- Propor "remover a metáfora de corrida" por inteiro: joga fora diferenciação real. Regra adotada: **metáfora fica no destino, some na busca** (§1.2).
- Propor clonar Calendly como prioridade: contraria o ICP (agendamento nasce na conversa). Rebaixado a D1.
- Propor "reduzir o menu de 40 para 8": o menu **já tem 8**. O problema é altitude e nome, não largura.

**Comandos que valem**
- Menu: `src/modules/platform/components/layout/TopNavigation.tsx` (desktop+mobile na mesma fonte); bottom nav mobile: `MobileBottomNav.tsx`.
- Rotas para QA visual: `/chat-whatsapp`, `/agenda`, `/follow-ups` (**exige feature `review` ligada na org**), `/leads`, `/dashboard`.
- Seletores estáveis já existentes: `[data-topnav]` (`TopNavigation.tsx:692`), `[data-testid=lead-modal-mobile-tabs]`, `[data-testid=tab-info|tab-pipes|tab-atividade]` (`LeadDetailDialogV2.tsx:245-248`).
- Atalhos hoje: `?` = ajuda, `g d/l/w/c/p/m` = navegação (**3 quebrados**), `⌘K` = palette.

**Dado de adoção incorporado** (Lanterna, prod 2026-07-27, `.specs/audit/uso-real-prod.md`) — **RESOLVIDO** o item Aberto do CP-v1:
- Denominador real = **93 orgs** (66 ativas 30d, 87 em 90d). O `CLAUDE.md` diz "~30 orgs ativas" — **desatualizado**.
- Só 7 rotas com page-view; o resto medido por pegada de dado (cego para "abriu e desistiu").
- `/follow-ups`: 23 orgs, **415 vencidos-em-aberto** → substrato da badge de "Hoje".
- `/disparos`: 47 orgs visitam, **2 disparam** → confirma A3, abre E1.
- `/agenda`: 11 orgs, **1 org com Google Calendar** → rebaixa §2.2, mata C3/C5/D1.
- `/comissoes`: **0 absoluto e histórico** → único REMOVER (A11).
- `/duplicatas`: 0 merges **mas tela quebrada 26/05–22/07** (`0d3cc421`, #1192) + 728 pendentes em 22 orgs → **inverte A7**, vira A12 (badge).
- `/templates`: 2 orgs, 3 templates → C9 (semear conteúdo), não remover.
- Flag `review`: 4 overrides = **piso, não total**; `organization_features` é override, não estado efetivo. ≥23 orgs usam de fato → flag não é a causa.

**Page-views incorporados (2ª rodada Lanterna) — pendência #1 RESOLVIDA:**
- `pipe_whatsapp` 77 orgs/20.312 · `chat_whatsapp` 71/11.901 · `pipe_propostas` 64/2.103 · `leads` 60/1.275 · `pipe_confirmacao` **50/1.300** · `disparos` 47/820 · `funis` 30/563 (90d, `usage_events.module_visited`).
- `meeting_events` = **1.245 eventos em 31 orgs (90d)** contra `meetings` = 11 orgs e Google Calendar = 1 org. → **reunião é operada no kanban; `/agenda` é a visualização errada.** Diagnóstico invertido na §2.2.
- **CONTESTADO no brief**: "chat é a tela mais usada do produto". É a **segunda** — `pipe_whatsapp` tem 77 orgs/20.312 visitas contra 71/11.901.
- Caveat: `pipe_confirmacao` cai 50→23 orgs de 90d para 30d. **Nenhuma tendência afirmada.**
- 38% dos follow-ups são automáticos (425/1.122) → **A1b**: badge conta vencidos+hoje do usuário, não backlog bruto.
- `awards` morto (1 linha, org NULL) mas `competitions` vivo (6 orgs, 11 competições) → **não juntar Prêmiações no corte de Comissões**.
- Duplicata por telefone é **impossível por construção** (UNIQUE parcial em `(org, normalized_phone)` p/ leads vivos); a RPC casa nome por similaridade 0.6 → badge virá acima do piso de 728, e a tela precisa marcar "nome parecido" como sugestão, não fato.

**Aberto**
- **Bancada**: screenshots de `/chat-whatsapp`, `/follow-ups` e estados vazios reais — não dirigi o Palco. E o estado efetivo da flag `review` por org, que só sai executando o registry no front.
- **Cais**: o cruzamento "3 pipes vs um funil com seletor" está resolvido a favor do que já existe. Ficam para ele E3 (20 funis custom órfãos), E4 (motivo de perda = 0 das 93), E5 (saved_views/reports/webhooks = 0) e **E6 (novo): `meeting_events` em 31 orgs vs `meetings` em 11 — discrepância de modelo, não de UI**.
- **Agenda, próxima rodada**: o que falta no `pipe_confirmacao` para ele *ser* a agenda (ex.: visão "reuniões de hoje" dentro do funil). Não desenhado aqui — precisa de dado de como as 50 orgs usam o kanban.
- Cobertura da busca de mensagens no inbox (conteúdo vs contato; truncamento de 500 — ver memória `inbox-filter-truncation-1277`).
