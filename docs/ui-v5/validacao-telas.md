# V5 — validação tela a tela (o que a main mostra hoje × o que o mockup propôs)

Base: `origin/main` em `1b3524727` (2026-10-01). Lido do código, com condições de
rota, plano, papel e flag. Regra que governa a implementação:

> **Estilo do mockup V5, conteúdo da main de hoje.** Nada que não existe na tela real
> entra; nada que a decisão de produto já tirou volta.

Decisões de produto já tomadas e respeitadas aqui:

- **Rating (estrelas) e calor do lead saíram** — 73b8b0dc4, 03/09: "fica só qualificação e pré-qualificação".
- **Score do lead não é mais usado** — CTO, 01/10, neste pedido.
- **A coluna do funil não decide ganho/perda** — desfecho vive no Negócio (03/09).

Legenda: ✅ entra como está (só forma) · 🔁 entra re-hierarquizado (mesmo dado) ·
⛔ ideia do mockup que NÃO entra · ⚠️ resíduo/decisão pendente.

---

## Shell (lateral, mobile, sobreposições)

| | |
|---|---|
| ✅ | Lateral 248/64 px com Comando, Métricas, Chat, Disparos, Funis (filhos por funil), Leads, Turbo (Copilot, Automações), slot do Oráculo, rodapé Agenda · Notificações · Master/Gestor · Ajuda · Pitstop · menu do usuário. **V5:** tinta flutuante (12 px de margem, raio 28 px), ativo = superfície clara + ícone ouro + trilho dourado com brilho. |
| ✅ | Pitstop, Oráculo e Agenda abrem ao lado — passam a flutuar com o mesmo respiro. |
| ✅ | Barra inferior mobile (Chat, Funis, Leads, Agenda, Mais) — vira tinta flutuante. |
| ⛔ | Barra superior com pílula de navegação global, busca e avatar (mockup). O produto já trocou a top bar pela lateral; a pílula de navegação vai para **dentro da página** (`PageHeader` + `TabsList variant="pill"`). |
| ⛔ | Item "Oráculo" e "Master" como ícones do rail — no real são slot próprio e link de rodapé. |
| ⚠️ | Atalho `?` abre dois diálogos (dois `useGlobalShortcuts`); paleta lista "Dashboard"/"Analytics" e filtra só por plano. Herdado — fora do diff. |

## Comando (`/dashboard`)

Real: **uma página, quatro blocos** — Aguardando resposta, Metas do mês, Próximas agendas, Tarefas do dia — e um resumo "N clientes esperando · N tarefas abertas · N atrasadas". Membro outbound vê `DashboardOutbound` (4 KPIs + Marcos + Badges).

| | |
|---|---|
| 🔁 | Resumo vira **3 KPIs** (mesmos números, mesmo cache). |
| 🔁 | Aguardando resposta vira **painel de tinta**; a linha continua abrindo a conversa direto; o cartão de ouro é o **primeiro da fila** ("Próximo a responder", com a mensagem inteira). |
| ✅ | Metas, Agendas e Tarefas em cartões de bento. "Ver métricas" vai para o cabeçalho. |
| ⛔ | Abas "Minha central/Outbound/TV", "Fila do dia" com Coach IA e "resposta sugerida", "Copilot hoje", ranking, conversão do funil, atividade recente — nada disso está no Comando real. |

## Leads (`/leads`)

Real: abas Todos · Leads · Clientes · Inativos (ou "Indefinido" em org com lei do ERP); 3 KPIs (Total, Este mês, Com responsável); filtros Origem · Qualificação · Dono · visões salvas; tabela **Nome · Contatos · Tags · Situação · Negócios · Recompra · Dono · Criado · ⋯**; barra em massa; aba Clientes troca para a carteira (Cliente 360).

| | |
|---|---|
| 🔁 | Abas de classificação viram pílula escura; KPIs viram `KpiTile`. |
| ✅ | Tabela, filtros, barra em massa, ficha do lead (abas Histórico · Negócios · Dados) e cartão do Negócio (Ganhou/Perdeu no Negócio). |
| ⛔ | Colunas Etapa/Score/Rating, anel de score, estrelas, temperatura, "Assumir lead" — mockup. |
| ⚠️ | Botões "Enviar e-mail" e "Agendar mensagem" do cabeçalho da ficha sem `onClick` (herdado). Acentos faltando em Lixeira/Duplicatas/barra em massa — corrigidos no restyle. |

## Funis (`/funis`, `/funil/:slug`)

Real: hub em cartões + modal "Criar Funil" com templates e "Definir prazo e metas"; página do funil com vistas **Kanban · Lista · Timeline (só com etapa de reunião) · Analytics**, painel "Filtros" lateral, cartão do quadro = `LeadCardCompact` (símbolo de qualificação dividido, responsáveis, telefone, valor, atividades, origem, urgência, etiquetas, menu ⊕).

| | |
|---|---|
| 🔁 | Seletor de vistas vira pílula escura; colunas e cartões no vocabulário V5. |
| ⛔ | Switch de IA no cartão, "Copilot qualificando…", anel de score, previsão por mês e "Motivos de perda" como abas (mockup). |
| ⚠️ | Pontos onde a COLUNA ainda decide ganho/perda (fallback em `funil-card-outcome.ts:25`, `useFunilMoveFlow.tsx:496-520`, `useMergedFunnelActions.ts:64-65`) — contradiz 03/09. Comportamento, não forma: fica para decisão. "Excluir negócio(s)" da barra em massa sem gate de permissão (herdado). Mojibake "urg��ncias" no filtro — corrigido no restyle. |

## Chat (`/chat-whatsapp`)

Real: três colunas redimensionáveis — Inbox (seletor de caixas multi = caixa unificada, busca, "+ Filtro", abas Ativas/Arquivadas/Grupos), conversa (cabeçalho com Ao vivo, Ligar, Ver/Criar lead, controles de IA e densidade; bolhas por origem; compositor com recursos por provedor) e painel de contexto (Infos · Histórico · I.A).

| | |
|---|---|
| ✅ | Tudo acima, em forma V5 (inbox em tinta, painel de contexto com bloco de ouro do lead). |
| ⚠️→✅ | **Score + "Quente/Morno/Frio" no cabeçalho do painel de contexto** (`ContextPanel.tsx:52-72,128-167`) e **"Score IA: N%"** na ficha aberta pelo chat (`LeadQualification.tsx:20-22`) — **saem** (decisões de 03/09 e 01/10). |
| ⛔ | Coach IA com sugestões, "Usar sugestão", popover de `#tag`/`@time` — o real tem o Coach montado mas sempre vazio (`conversationId=null`), e `#tag`/`@time` como "em breve". |
| ⚠️ | Bolha de automação sem fundo (`bubble-workflow` não está no Tailwind) — corrigido no restyle. |

## Disparos e Templates

Real: painel Ativos/Pausados/Concluídos com `BlastPlanCard`; assistente de 6 passos; Templates = respostas rápidas do `/`. Templates oficiais vivem dentro de Configurações › WhatsApp.

| | |
|---|---|
| ✅ | Tudo, em forma V5. |
| ⛔ | KPIs mensais de disparo e "saúde do número" (mockup). |

## Copilot, Oráculo, Automações

| | |
|---|---|
| ✅ | Copilot: grade de agentes, editor com 7 abas + prévia ao vivo, Métricas LLM. |
| ✅ | Oráculo: conversas, sugestões, respostas em **texto**, cartões de proposta e de pergunta de perfil, avaliação por resposta. |
| ⛔ | Oráculo com gráficos e tabelas na resposta, "Briefing de hoje" com 3 insights (mockup). |
| ✅ | Automações: lista Ativos/Inativos + templates, editor (xyflow) com paleta Básico · Controle de Fluxo · Equipe · Integrações · Código, execuções. |
| ⚠️ | Score ainda configurável em automação: gatilho "Score Atingido", ações "Atualizar Rating"/"Calcular Lead Score (IA)", condição "Pontuação de qualificação", variáveis `{{score}}`/`{{rating}}`/`{{ai_temperatura}}`. Executor nas edge functions — mesma situação do rating na etapa 1. **Decisão do CTO.** |
| ⚠️ | Métricas LLM: KPI "Taxa de Qualificação" calculado com `qualification_score >= 70`. **Decisão do CTO.** |

## Métricas (`/metricas`)

Real: Estúdio com abas por painel (orgs novas nascem com Visão Geral · Performance · Saúde · Mapa), período, exportar, modo edição (admin), composer, Analytics avançado (master), 16 cartões fixos.

| | |
|---|---|
| ✅ | Tudo em forma V5; o Mapa real é o **coroplético SVG** existente. |
| ⛔ | Cartograma em blocos de UF (mockup). |

## Agenda, Revisão, Ranking, Comissões, Checklists

| | |
|---|---|
| ✅ | Agenda: "Atividades", filtros, **Mês/Dia** (a semana existe no código mas não é alcançável). |
| ⛔ | Visão semanal como padrão, sincronização Google como cartão (mockup). |
| ✅ | Revisão, Ranking (Movimentações, competição, pódio, Gestão de metas), Comissões (regras OTE, tiers, cartões por membro), Checklists. |
| ⚠️ | Revisão "Lead quente" (sugestão) vem de `qualification_score >= 70` na edge `get-daily-priorities`. **Decisão do CTO.** |

## Carteira, Produtos, Equipe, Configurações, Master, Ajuda

| | |
|---|---|
| ✅ | Carteira (layout portfólio e legado), Cliente 360, Produtos, Equipe/Permissões, Configurações (15 abas reais), Integrações, Assinatura, Master (com faixa vermelha), Gestor/Insights, Ajuda + painel de suporte. |
| ⚠️ | **Health score de CLIENTE** (Carteira) não é score de lead — fica, salvo decisão em contrário. |
| ⚠️ | Configurações: cartões "Banco de Dados Online / RLS Ativo / Latência <50ms" são **fixos no código** (não medem nada); "Nome da Empresa" e "Animações" não salvam. Herdado — sinalizado. |
| ⚠️ | Integrações: chip "Conectadas" não filtra (volta para Todos). Herdado. |

## TV Dashboard

Identidade própria (`data-surface="tv"`, tokens de parede) que o cliente aprovou — **não entra no V5**. O V5 só não pode vazar para lá (a grade da bancada mora em `[data-layout="main"]`, que a TV não usa).
