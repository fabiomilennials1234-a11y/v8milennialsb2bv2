# Ranking de Vendas — Design Spec

**Data:** 2026-03-27

## Decisao Central
Unificar Ranking + Metas + Premiacoes em experiencia unica "Ranking de Vendas".
Competicao ativa do mes = experiencia principal. Gestao em tab separada.
Gamificacao forte com animacoes. Adaptacao para TV Dashboard.

## Estrutura de Tabs
- Antes: 4 tabs (Ranking | Metas | Premiacoes | Gestao)
- Depois: 2 tabs (Ranking de Vendas | Gestao)

## Logica Principal
- SE competicao ativa → podio gamificado + ranking unificado (meta + premio inline)
- SE NAO → empty state + CTA + ranking simples fallback

## Avatar Bug Fix
- Causa: UserAvatar renderiza AvatarImage condicionalmente `{avatarUrl && <AvatarImage>}`
- Radix nao re-tenta load quando src muda de undefined para URL
- Fix: sempre renderizar `<AvatarImage src={avatarUrl || ""} />`

## Componentes Novos
- CompetitionPodiumV2: podio escuro, pedestais 110/80/60px, premios dentro, animacoes spring, glow
- CompetitionRankingListV2: lista posicao+avatar+valor+barra meta+premio, fogo >=80%
- TVCompetitionBlockV2: bloco compacto TV, badge LIVE, auto-refresh
- EmptyCompetitionState: CTA criar competicao do mes

## Componentes Reaproveitados
- useCompetitions, competitions/prizes/participants tables — intactos
- CreateCompetitionModal — mantido na Gestao
- get_ranking_data RPC — intacto
- useRankingData, useAvatarMap — mantidos
- CelebrationEffect — reutilizado para meta batida
- ProgressRing — reutilizado pontualmente

## Renaming
- Sidebar/TopNav: "Podio" → "Ranking"
- Page title: "Ranking de Vendas"
- Path /performance mantido

## Animacoes
- Pagina carrega: podio sobe spring (1o mais alto, 2o/3o depois)
- Meta batida (>=100%): confetti + glow + badge "META BATIDA"
- Subida de posicao: slide up + flash dourado
- Lideranca: crown animation + shimmer
- >=80%: icone fogo pulsando
- Valores: counter animation (framer-motion)

## Fases
1. Avatar fix (UserAvatar.tsx)
2. Renaming (Sidebar, TopNav, Performance title)
3. Performance.tsx reestruturar 4→2 tabs
4. CompetitionPodiumV2
5. CompetitionRankingListV2
6. TVCompetitionBlockV2
7. Empty state

## Nenhuma mudanca no backend
- Tabelas competitions, competition_participants, competition_prizes — intactas
- get_ranking_data RPC — intacta
- goals, awards tables — intactas
