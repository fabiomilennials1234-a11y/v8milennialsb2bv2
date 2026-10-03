# V5 — onda "mais perto do mockup" (02/10): decisões

Depois de ver o app em produção, o CTO pediu para seguir a **estrutura, hierarquia e composição do mockup** (não só o estilo), sem inventar funcionalidade, sem trazer de volta o que o produto tirou (score, estrelas, temperatura) e mantendo **só o cartão do kanban dos Funis** como estava. A comparação tela a tela foi feita em três frentes (shell/Comando/Leads/Funis/Carteira · Chat/Disparos/Copilot/Automações/Oráculo · Métricas/Agenda/Pitstop/Configurações/Master) e cada diferença foi classificada como ADOTAR, SUPERFÍCIE NOVA (dado que já existe em lugar novo, com evidência), FUNCIONALIDADE NOVA (fora) ou PRODUTO TIROU (fora).

## Travas (sempre)
- Nenhuma funcionalidade nova. Nada de número que nenhum código calcula.
- Score/rating/temperatura fora.
- **Cartão do kanban do funil (`LeadCardCompact`) intocado** (P1). O painel do Negócio e a ficha do
  lead seguem o mockup.
- Contratos de teste (`data-testid`, papéis, nomes acessíveis) valem; se uma mudança de forma exigir
  mudar um teste, o teste muda junto e o motivo vai numa linha no relatório.
- Nada de RPC/migration/edge function nova. Se a forma exigir dado agregado que não existe, a forma cede.

## Decididas pelo líder (não perguntar de novo)

Shell (feito pelo líder, depois de P2): Agenda e Oráculo viram páginas; Pitstop vira página-hub só com
títulos e ícones (sem números); selo do Chat = "aguardando resposta"; barra inferior do celular
continua 5 abas + "Mais"; "Voltar" só onde há tela-pai.

Comando: alternar "Central da equipe / Minha central" para admin (escopo já aceito pelos hooks) — entra;
filtro Todas/Minhas/Sem responsável e "Quem está esperando o quê" — **fora** (só veriam 10 itens);
tiles Etapa/Qualificação/Copilot no cartão de ouro — entram **só leitura**; Metas = gráfico realizado ×
esperado + top 3 + link "Ver tudo" para Performance.

Leads: pílula de relação só para **Cliente** e **Perdido** (Lead é o padrão, não marca); Lixeira de
negócios fora; Duplicatas com comparação campo a campo entra.

Funis: rail abre o funil padrão e "Todos os funis" vira a 5ª aba; título fixo "Funis" + faixa de chips
por funil (rola com a affordance da pílula); soma em R$ por coluna e "Pipeline ativo" **fora** (colunas
paginadas dariam número parcial) — use só contagens que existem; Timeline continua a agenda de reuniões
do funil (forma nova); Motivos de perda seguem da organização, rotulados assim; hub sem mini-barras;
celular continua seletor de etapa + lista.

Carteira: cartão de ouro sempre visível (1º do radar) entra; Pedidos com os 3 estados reais
(pendente/aprovado/recusado) no formato de esteira; Cliente 360 continua **página** (link direto) e a
"Sugestão Copilot" fica no 360.

Chat (onda 2, depois de P8): abas por canal viram **atalhos** que marcam as caixas daquele canal no
seletor (nada muda na caixa unificada); sem `PageHeader` — cabeçalho compacto dentro da coluna do
inbox, rota segue tela cheia; faixa de estado da IA com **só as transições que existem hoje** por estado
(o resto num ⋯) e o switch "IA" do lead mantido à direita; funis no contexto continuam lista; estado da
IA por linha e "1ª resposta hoje" fora; raciocínio do Copilot fora (é tela de master).

Disparos: saúde do número fora; aceite LGPD fora; templates oficiais continuam em Configurações › WhatsApp
— a rota Templates ganha um link para lá, não duplica.

Copilot: KPIs por 30 dias (custo de 1 consulta por agente é aceitável, o teto é 10 agentes); switch de
ativar **só no cartão de ouro** — a linha mostra o estado em selo; troca rápida de agente no editor fora
(sai pelo voltar); custo/tokens fora.

Automações: Execuções por workflow com seletor (sem RPC nova); ordenar só por "Editados recentemente".

Oráculo: o briefing (manchete) passa a abrir a página do Oráculo, já que o slot da lateral sai.

Métricas: tudo **dentro das janelas** que existem (layout salvo por org é protegido por migration);
os 8 indicadores viram `KpiTile` (não cortar para 4); filtros de funil/responsável fora; Mapa colore por
**receita** (o RPC já traz) com leads no tooltip.

Ranking: período das Movimentações unificado com o mês/ano do cabeçalho; "Modo TV" no cabeçalho.
Equipe: "online" continua só do master; isolamento por responsável vai para a aba Permissões.
Assinatura: grade de planos só para comparar, sem cobrança. Master: shell normal com abas agrupadas; sem
aba "Gestor" inventada; `/insights` só forma. Ajuda: página com abas Artigos (CMS, com vídeo e
feedback) · Perguntas frequentes (FAQ estático) · Meus chamados. Revisão: 4º KPI "Sugestões do dia";
"Minhas | Todas" convive com o seletor de pessoa.

## Respostas do CTO (02/10, 17h)
- **P1** — fica igual **somente o cartão do kanban nos Funis** (`LeadCardCompact`, anatomia DataCrazy).
  O painel do Negócio e a ficha do lead (`DealCardPanel`/`LeadCardPanel`) **passam a seguir o mockup**.
- **P2** — sim: lateral só ícones (tooltip no lugar do rótulo, sem expandir) + barra superior nova.
- **P3** — Comando: no computador a linha **seleciona** (detalhe no ouro, botão abre a conversa); no
  celular a linha **abre direto**.
- **P4** — Leads › Clientes **mantém** a `ClientPortfolioSection` com a prévia.
- **P5** — Agenda abre em **Semana**; **Dia continua lista** (decisão de 24/08).
- **P6** — Configurações: **7 grupos**, sai a aba Checklists (duplicada) e saem os 3 cartões de status fixos.
- **P7** — **não neste PR**: Revisar com IA, Modelos de agente, Produtividade no Ranking, aprovar/marcar paga.
- **P8** — Chat: (a) **sim**, etapa + valor do Negócio no bloco do lead (só leitura); (b) **esconder** o Coach.
