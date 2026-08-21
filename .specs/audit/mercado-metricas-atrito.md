# Frente 6 — Métricas, relatórios e atrito real

**Papel**: Bancada (QA) · **Data**: 2026-07-27 · **Base**: `main @c934cc3c`
**Ambiente exercitado**: nenhum (ver §0) · **Evidência**: código (`arquivo:linha`) + SELECT read-only em prod `jsjsmuncfkbsbzqzqhfq`

---

## 0. AVISO DE MÉTODO — o que eu NÃO verifiquei em tela

**Não dirigi o app. Nenhuma tela foi aberta logada. Nenhum clique foi cronometrado.**

Motivo: o `.env` do checkout aponta pra `VITE_SUPABASE_PROJECT_ID=bcfadphgsibjzivtbjvc` — o projeto **dev aposentado** (CLAUDE.md §Ambientes, decisão CTO 2026-07-22). O ref responde HTTP 401 (existe), mas o Forja confirmou que o token de acesso não o enxerga e que **nenhuma credencial loga nele**. Testei o login do Palco com o fallback dos e2e (`tests/e2e/auth.setup.ts:1` → `admin@test.com` / `Test123!@#`): permaneceu em `/auth`, sem sessão.

Consequência direta: **qualquer um que rode `npm run dev` neste checkout bate num ambiente morto.** Isso é achado de infra por si só (reportado ao Pauta em separado).

O que segue está em dois níveis, sempre rotulado:
- 🟢 **MEDIDO** — SQL read-only contra prod. É fato.
- 🟡 **INFERIDO DO CÓDIGO** — li `arquivo:linha`, não vi renderizar.

A Parte 3 do brief (caminho do vendedor, contagem de cliques) **não foi entregue** — depende de sessão. Roteiro pronto pra executar em §6.

---

## 1. O ACHADO PRINCIPAL — duas contabilidades de "venda" convivem em prod

🟢 **MEDIDO.** Existem duas fontes de verdade de venda, e cada tela lê uma:

| RPC | Lê de | Quem chama no front |
|---|---|---|
| `get_dashboard_metrics` | **`pipe_propostas`** | `analytics/hooks/useDashboardMetrics.ts` → `/dashboard` ("Comando") |
| `get_ranking_data` (legado) | **`pipe_propostas`** | `analytics/hooks/useDashboardMetrics.ts` |
| `get_sales_metrics` | **`sale_events`** | `analytics/hooks/useCommandMetrics.ts` |
| `get_ranking` | **`sale_events`** | `/performance` |
| `_metric_leaf_sales` (motor novo #1194) | **`sale_events`** | `analytics/hooks/useMetricMeasure.ts` |
| `get_funnel_health` | `pipe_propostas` + `pipeline_entries` | `analytics/hooks/useFunnelHealth.ts` |

Verificado por `pg_get_functiondef` de cada uma em prod.

**A divergência, medida ao vivo** — org Milennials `6030520a-…`, mês corrente:

| Fonte | Vendas | Valor |
|---|---|---|
| `pipe_propostas` (alimenta `/dashboard`) | **5** | **R$ 88.728** |
| `sale_events` (alimenta `/performance` + ranking + TV) | **12** | **R$ 264.908** |

**3× de diferença no valor, na mesma org, no mesmo mês.** Não é bug pontual — é arquitetural. Decomposição: das 12 vendas em `sale_events`, só **9 têm par** com `status='vendido'` em `pipe_propostas`; 3 existem apenas no event-sourcing. Todas as 12 são `producer='funnel'`, `revenue_stream='novo_negocio'` — ou seja, nascem do trigger de funil (inclusive funis custom), enquanto o `/dashboard` só enxerga o funil de sistema `pipe_propostas`.

> Isto é exatamente a dor que o CTO citou. As "24 inconsistências" da auditoria 2026-07 são sintoma; **a causa é esta**. O motor novo (`fn_metric_measure`, #1194) escolheu `sale_events` — está certo — mas **não desligou a via velha**, então hoje há 3 gerações coexistindo em vez de 2.

**Ressalva honesta**: reconstruí os filtros de janela de data por fora das RPCs (as RPCs org-scoped recusam chamada via MCP — `assert_org_access` sem sessão). O *mecanismo* (fontes distintas) está provado pelo `functiondef`; o *número exato* que cada tela renderiza precisa da execução em tela (§6).

---

## 1b. O agravante — 118 vendas prováveis que não entram em NENHUMA das duas contabilidades

🟢 **MEDIDO.** Pedido cruzado da Lanterna, respondido aqui porque fecha o achado nº1.

A fila de revisão master (`/master/stage-roles`) classifica stages de funil como `won`/`lost`. Estado em prod:

- **26 stages sugeridas e pendentes** desde **2026-07-08**: 16 `open→won`, 10 `open→lost`.
- 🟢 **`stage_role_reviewed_at` preenchido em TODA a base: 0 linhas.** Ninguém nunca revisou nada desde que a fila existe.
- Nas 16 stages `open→won`: **131 entries / 131 leads / 7 orgs**. Apenas **13 têm `sale_event`**.
- → **118 vendas prováveis invisíveis** para toda métrica de venda do produto: não estão em `sale_events` (o funil não fecha, então o trigger não dispara) **nem** em `pipe_propostas`.
- `open→lost` pendente: 288 entries, 8 orgs.

**Quanto vale? Não existe o número — e esse é o achado.** Rastreei todos os lugares onde valor poderia estar:

| Candidato | Resultado |
|---|---|
| `pipeline_entries` | 🟢 **não tem coluna de valor** (`id, organization_id, pipeline_id, lead_id, deal_id, stage_key, assigned_to, notes, metadata, entered_at, stage_changed_at, closed_at, created_at, updated_at`) |
| `deals.value` | tabela existe, mas 🟢 **`deal_id` é NULO em 131 de 131** |
| `leads.faturamento` | 🟢 é `text` — faixa declarada pelo lead, não valor de venda |
| `pipe_propostas.sale_value` | cobre **13 dos 131** = R$ 11.869,72 — justamente as que **já** contam |

Ou seja: as 118 não são receita escondida esperando ser somada. São **receita irrecuperável** sem alguém reabrir lead por lead. O funil custom não carrega valor de venda em lugar nenhum.

> Encadeamento: `/dashboard` e `/performance` já divergem 3× entre si (§1) — e essas 118 não aparecem em **nenhum dos dois**.

### 1c. O lado `lost` — a perda é 100% invisível, o denominador infla 6,1%

🟢 **MEDIDO.** Hipótese levantada pela Lanterna, testada por mim. **Confirmada, com uma nuance que muda a leitura.**

As 288 entries paradas nas 10 stages `open→lost` não revisadas (8 orgs):

| Medida | Valor | Leitura |
|---|---|---|
| Entradas contadas como perda | 🟢 **0 de 288** | **numerador de perda: erro total.** Nenhuma vira `pipe_propostas.status='perdido'` |
| Ainda abertas (`closed_at is null`) | 🟢 **139** | negócios mortos inflando o **pipeline aberto** |
| Fechadas mas sem virar perda | 🟢 **149** | sumiram do funil ativo **sem entrar em métrica de perda** — exatamente o efeito previsto |
| Tempo parado | 🟢 média **68 dias**, máx **123** | não é ruído recente |
| Peso no denominador | 🟢 288 sobre **4.725** entries `open` nas mesmas 8 orgs = **6,1%** | — |

**A nuance**: o efeito no *denominador* da taxa de conversão é modesto (6,1%). O efeito no *numerador* de perda é **absoluto** — zero de 288. Então a distorção não é "conversão um pouco errada": é **taxa de perda que não existe** somada a **139 negócios mortos contando como pipeline vivo há 68 dias em média**. Para o gestor, o funil parece mais cheio e mais saudável do que é.

Isto reforça §2: a métrica de motivo de perda não falha só porque ninguém preenche o campo (0 de 93 orgs) — falha também porque **a perda nem chega a ser registrada como perda**.

Crédito: fila e contagem de stages levantadas pela Lanterna (`.specs/audit/uso-real-prod.md`); a quantificação de entries, cobertura de `sale_events` e busca de valor são minhas.

---

## 2. Métricas de CRM: o que temos, o que não temos, o que está escondido

🟡 INFERIDO DO CÓDIGO, exceto onde marcado.

| Métrica básica de CRM | Temos? | Onde | Veredito |
|---|---|---|---|
| Taxa de conversão etapa→etapa | ✅ | `get_funnel_flow`, `get_funnel_conversion`, `useFunnelHealth.ts` | MANTER |
| Tempo médio por etapa | ✅ | `_metric_leaf_stage_duration` | MANTER (escondido — só no motor novo, inerte) |
| Ciclo de venda médio | ⚠️ parcial | derivável de `stage_duration`, sem métrica de topo | MUDAR |
| Ticket médio | ✅ | `_metric_leaf_sales`, `useTVDashboardData.ts` | MANTER |
| Taxa de vitória (win rate) | ⚠️ | 3 ocorrências de `win_rate` no módulo, sem tela dedicada | MUDAR |
| **Motivo de perda agregado** | ❌ **na prática** | 🟢 MEDIDO: **39 perdidos na Milennials, 39 sem motivo. Em TODAS as 93 orgs de prod: ZERO com `loss_reason` preenchido.** ⚠️ **Não é desleixo do usuário** — ver §1c: a perda frequentemente nem é registrada como perda, então preencher o motivo é impossível por construção | **MUDAR (consertar o registro ANTES de cobrar o campo)** |
| Previsão de receita do mês | ❌ | 14 ocorrências de `forecast` no módulo, nenhuma RPC de forecast em prod | ADICIONAR |
| Atividades por vendedor | ✅ | `get_analytics_engagement_metrics`, `useProductivityActivity.ts` | MANTER |
| Origem de lead / ROI por canal | ✅ | `get_mkt_origin_metrics`, `get_analytics_utm_metrics` | MANTER+VENDER |
| **Exportar relatório (CSV/XLSX)** | ❌ | 🟢 MEDIDO: **zero** ocorrência de export/CSV/xlsx em todo `src/modules/analytics/` | **ADICIONAR** |
| **Salvar/compartilhar uma visão** | ❌ | `Dashboard.tsx:50-53` e `Performance.tsx` — filtro é `useState` local, **zero `useSearchParams`**. Recarregar perde o filtro; não existe link compartilhável | **ADICIONAR** |

**Comparação de mercado**: Pipedrive Insights e HubSpot Reports tratam *exportar* e *salvar visão* como higiene básica, não feature. É o gap mais barato de fechar e o mais visível pro gestor.

---

## 3. Matriz por tela

| Tela | O que temos (arquivo:linha) | Mercado | Veredito | Por quê | Esf. |
|---|---|---|---|---|---|
| `/dashboard` "Comando" | `analytics/pages/Dashboard.tsx:119-193` — 4 abas (visão geral, performance, saúde, mapa) + analytics master-only | Dashboard por papel (HubSpot) | **MUDAR** | Lê a fonte errada de venda (§1). Aba não vive na URL (`defaultValue="visao-geral"`, :119) | M |
| `/performance` "Ranking" | `analytics/pages/Performance.tsx:1170-1265` — 2 abas: `ranking_vendas`, `gestao` (1578 linhas num arquivo) | — | **MUDAR** | Nome no menu é "Ranking" (`TopNavigation.tsx:140`), então quem procura "relatórios/métricas" não acha | M |
| `/ranking` `/metas` `/premiacoes` `/gestao-metas` | 🟢 **não são telas** — `App.tsx:373-386` são `<Navigate replace>` pra `/performance` | — | **INFO** | O brief e o CP-v1 listam 10 rotas de métrica; são **~5 telas reais**. Corrige o mapa | — |
| `/comissoes` | `engagement/pages/Comissoes.tsx` (478 l.) | Nenhum dos 3 tem nativo | **MANTER+VENDER** | Diferencial real pro ICP B2B com time comissionado | — |
| Gamificação (ranking/premiações/metas) | dentro de `Performance.tsx:467-593` — tipos `meta_mensal`, `campeonato`, `bonus`, `especial` | Pipedrive/HubSpot **não têm** nativo | **MANTER+VENDER** | Honestamente acima do mercado. Risco: está *soterrado* dentro de uma tela de 1578 linhas | P (dar superfície) |
| `/tv` | `analytics/pages/TVDashboard.tsx` (565 l.) + `useTVKPIs.ts`, `useTVDashboardData.ts` | Ninguém tem | **MANTER+VENDER** | Diferencial genuíno pro chão de fábrica/distribuidora. Lê `sale_events` (fonte certa) | — |
| Composable widgets (#1194) | `useComposableDashboard.ts`, `useMetricCatalog.ts`, `fn_metric_measure` | Pipedrive Insights | **MUDAR (terminar)** | 🟢 MEDIDO: **2 `dashboard_pages`, 15 widgets, 1 org só** (Milennials). Inerte em prod | G |
| `/insights` | `App.tsx:756` | — | 🟡 não auditado (sem tela) | — | — |
| `/copilot/metricas` | `App.tsx:554` | — | 🟡 não auditado (sem tela) | — | — |

---

## 4. Lista bruta de atrito (com repro)

1. **`npm run dev` sobe contra ambiente morto.** Repro: `npm run dev` → `/auth` → qualquer credencial → não loga. Esperado: subir num backend válido. `.env:VITE_SUPABASE_PROJECT_ID=bcfadphgsibjzivtbjvc`. 🟢 MEDIDO.
2. **Filtro de período não persiste e não é compartilhável.** Repro (após login): `/dashboard` → trocar período pra "Trimestre" → F5 → volta pra "month" (`Dashboard.tsx:52`). Nenhum `useSearchParams`. 🟡
3. **Aba ativa não vive na URL.** Repro: `/dashboard` → aba "Saúde" → F5 → volta pra "Visão geral" (`Dashboard.tsx:119`). Gestor não consegue mandar link da aba. 🟡
4. **Motivo de perda nunca é preenchido.** 🟢 MEDIDO: 39/39 na Milennials, 0/93 orgs em prod. O campo existe (`pipe_propostas.loss_reason`, `loss_reason_id`) e o fechamento não obriga. Métrica de perda agregada é impossível hoje.
5. **`metrics_period_at` nulo em 100% das vendas** (🟢 84/84 na Milennials). O cálculo cai no fallback `closed_at` — que **está preenchido em todas** (0 nulos), então não quebra hoje; mas é uma coluna de intenção declarada e nunca escrita, esperando virar bug.
6. **Jargão de corrida esconde as métricas.** `TopNavigation.tsx:131,140,146,148,177,183`: "Comando"=dashboard, "Ranking"=/performance, "Combustível"=leads, "Pilotos"=equipe, "Pitstop"=configurações, "Turbo". Nenhum item se chama "Relatórios" ou "Métricas". Cruza com U1 da auditoria UX 2026-07-09. 🟡
7. **Quatro nomes pra mesma coisa ("Revisão").** rótulo "Revisão" (`TopNavigation.tsx:145,159`) → rota `/follow-ups` → permission `followups.view` → feature flag `review` → componente `engagement/pages/Revisao.tsx` (`App.tsx:411-416`). **Isto responde o item Aberto do CP-v1: a "revisão" que o CTO diz que não usam é esta, não `/master/stage-roles`.** 🟡
8. **Sem export em lugar nenhum de métricas.** 🟢 MEDIDO: zero ocorrência em `src/modules/analytics/`.
9. **`Performance.tsx` com 1578 linhas** concentra ranking + metas + premiações + gestão. Manutenção e descoberta sofrem. 🟡

---

## 5. Recomendação priorizada

1. **Unificar a fonte de venda em `sale_events`** e aposentar a leitura de `pipe_propostas` em `get_dashboard_metrics`/`get_ranking_data`. Sem isso, todo o resto mede coisa errada. (G, mas é o único que importa)
2. **Zerar a fila de revisão de stage e fechar o registro de perda/venda** — as 26 stages pendentes produzem 118 vendas e 288 perdas fora da métrica (§1b, §1c). É pré-requisito de 1: unificar a fonte não adianta se o evento nunca é gerado. (M)
3. **Obrigar motivo de perda no fechamento — mas só DEPOIS de 2.** ⚠️ Correção de ordem, apontada pela Lanterna: hoje 0 de 93 orgs preenchem, e a leitura ingênua é "treinar o time". Errado — **preencher motivo numa perda que o sistema não sabe que é perda é impossível por construção**. Cobrar o campo antes de consertar o registro joga a culpa no cliente por um defeito nosso. (P)
4. **Filtro + aba na URL** (`useSearchParams`) — destrava compartilhar e salvar visão de graça. (P)
5. **Export CSV nas telas de métrica.** (P)
6. **Dar superfície própria à gamificação** — é onde estamos acima do mercado e está escondida numa aba. (P)
7. **Terminar #1194** — só depois de 1–3; senão o Composer monta widget sobre número divergente.

---

## 6. Roteiro pronto pra executar assim que houver sessão (opção A)

**Regra**: LEITURA ESTRITA. Navegar, filtrar, ler. Zero clique em enviar/disparar/campanha/agente IA.

| # | Rota | O que olhar | Divergência esperada |
|---|---|---|---|
| 1 | `/dashboard` aba Visão Geral, período = mês | vendas e faturamento do mês | **espero ~5 / R$88.728** |
| 2 | `/performance` aba Ranking | soma de vendas do ranking, mesmo mês | **espero ~12 / R$264.908 — o print dos dois lado a lado é a prova** |
| 3 | `/tv` | KPI de venda/ticket | deve bater com (2), não com (1) |
| 4 | `/dashboard` aba Saúde | funil, drop-off por etapa | conferir se motivo de perda aparece vazio |
| 5 | `/dashboard` → trocar período → F5 | filtro persiste? | espero perder |
| 6 | `/dashboard` → aba Saúde → F5 | aba persiste? | espero voltar pra Visão Geral |
| 7 | `/insights`, `/copilot/metricas` | carrega? estado vazio orienta? | não auditado |
| 8 | `/follow-ups` ("Revisão") | o que é, estado vazio | a feature que "não usam" |
| 9 | `/comissoes` | carrega, número bate com (2)? | — |
| 10 | Caminho do vendedor | login → o que fazer hoje → chat → mover card → agendar → registrar. Contar cliques | Parte 3 do brief |

Console aberto o tempo todo; todo erro entra na lista bruta.

---

## CONTEXT PACKET — CP-v2

**Mapa verificado**
- `/ranking` `/metas` `/premiacoes` `/gestao-metas` são `<Navigate replace>` → `/performance` (`src/App.tsx:373-386`). **CONTESTADO** no CP-v1, que as listava como telas.
- "Revisão" do CTO = `TopNavigation.tsx:145,159` → `/follow-ups` → `App.tsx:411-416` → `engagement/pages/Revisao.tsx` (387 l.), feature flag `review`, permission `followups.view`. **RESOLVE** o Aberto do CP-v1 (não é `/master/stage-roles`).
- Telas de métrica reais: `analytics/pages/{Dashboard,Performance,TVDashboard,DashboardOutbound}.tsx`, `engagement/pages/Comissoes.tsx`.

**Achados** (🟢 = medido em prod)
- 🟢 Fila `/master/stage-roles`: 26 stages pendentes desde 2026-07-08, `stage_role_reviewed_at` = 0 linhas em toda a base. 16 `open→won` → 131 entries / 7 orgs, só 13 com `sale_event` ⇒ **118 vendas invisíveis**. 10 `open→lost` → 288 entries / 8 orgs.
- 🟢 Valor dessas 118 **não existe**: `pipeline_entries` sem coluna de valor, `deal_id` nulo em 131/131, `leads.faturamento` é `text`, `pipe_propostas.sale_value` cobre só as 13 que já contam (R$ 11.869,72).
- 🟢 `open→lost` pendente (288 entries, 8 orgs): **0 contadas como perda**; 139 ainda abertas inflando pipeline vivo; 149 fechadas sem virar perda; parada média 68d (máx 123d); peso no denominador = 6,1% de 4.725 entries `open`. Numerador de perda erra 100%, denominador erra 6,1%.
- 🟢 (Lanterna) denominador real: 93 orgs, 82 `subscription_status='active'`, 87 com evento em 90d, 66 em 30d. `/follow-ups`: 23 orgs ativas, **415 pendências vencidas não concluídas**, 38% geradas automaticamente ⇒ tela **usada que acumula entulho**, não tela morta. `/performance` e `/tv` **não são mensuráveis** (fora dos 7 módulos instrumentados em `usage_events`).
- 🟢 Duas fontes de venda: `get_dashboard_metrics`/`get_ranking_data` → `pipe_propostas`; `get_sales_metrics`/`get_ranking`/`_metric_leaf_sales` → `sale_events`.
- 🟢 Divergência viva Milennials mês corrente: 5 / R$88.728 vs 12 / R$264.908. 9 das 12 têm par; 3 só em `sale_events`; todas `producer='funnel'`.
- 🟢 `loss_reason`: 39/39 perdidos sem motivo na Milennials; **0 de 93 orgs** em prod já preencheu.
- 🟢 `metrics_period_at` nulo em 84/84 vendidos; `closed_at` preenchido em 100% (fallback segura hoje).
- 🟢 #1194 inerte em prod: 2 `dashboard_pages`, 15 `dashboard_widgets`, 1 org.
- 🟢 93 organizations em prod (não ~30); 26 com `sale_events`.
- 🟢 Zero export (CSV/XLSX) em `src/modules/analytics/`.
- 🟡 Filtro/aba fora da URL em `Dashboard.tsx:50-53,119`.

**Descartado**
- Opção (B) branch efêmera — descartada pelo Pauta pra esta frente: dado vazio não responde consistência de número.
- Credencial de teste: não existe caminho de login no ref aposentado (Forja confirmou).

**Comandos que valem**
- Portal: `maestri portal snapshot|fill|click|navigate "Palco"` funcionam. Login em `input#email`/`input#password`, botão "Entrar" (`@e7/@e10/@e12` na tela `/auth`).
- RPC org-scoped **não roda via MCP**: `assert_org_access` → `P0001 access_denied`. Medir por SELECT direto nas tabelas.
- Comparar fonte de RPC: `pg_get_functiondef(p.oid) ilike '%sale_events%'` sobre `pg_proc`.
- Org Milennials `6030520a-2ca7-477d-be89-55758e2cd808`; prod `jsjsmuncfkbsbzqzqhfq`.

**Aberto**
- **Nada foi verificado em tela.** `/insights`, `/copilot/metricas`, estados vazios, erros de console, e a Parte 3 (caminho do vendedor / contagem de cliques) seguem sem cobertura. Roteiro em §6, executo em ~15 min quando a sessão existir.
- Número exato renderizado por tela — reconstruí a janela de data por fora das RPCs; confirmar com (1) e (2) do roteiro.
- Cruzar com a Lanterna: adoção real de `/performance`, `/tv`, `/follow-ups` nas 93 orgs.
