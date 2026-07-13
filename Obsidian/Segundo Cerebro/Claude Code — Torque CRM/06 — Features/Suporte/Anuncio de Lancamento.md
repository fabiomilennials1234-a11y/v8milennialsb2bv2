---
type: feature
title: Central de Suporte — Anúncio de lançamento (in-app)
status: active
created: 2026-07-13
updated: 2026-07-13
tags: [suporte, onboarding, announcement]
related: []
owner: claude-agent
---

# Central de Suporte — Anúncio de lançamento (in-app)

## O que é

Aviso in-app em duas peças para os clientes (~30 orgs) descobrirem a Central de Suporte já shippada (FAB "?" no dock + painel de chamados):

- **Modal A** — modal de lançamento na entrada do sistema (header ilustrado dourado, 3 bullets, CTA "Conhecer o Suporte" + "Agora não").
- **Coach-mark C** — spotlight circular sobre o FAB "?" com anel pulsante e balão explicativo, exibido após fechar o modal.

## Como funciona

- Lógica de gating pura + persistência: `src/modules/platform/lib/support-announcement.ts` (testes em `support-announcement.test.ts`).
- Componente (modal + coach-mark): `src/modules/platform/components/support/SupportAnnouncement.tsx`.
- Montagem: `src/App.tsx`, logo após `<SupportPanel />`, dentro do `SupportPanelProvider`.
- Âncora do coach-mark: atributo `data-support-fab` no `<button>` de `SupportFab.tsx`. O coach-mark mede o FAB via `getBoundingClientRect` (re-mede em resize) e desmonta se o FAB sumir.
- Persistência por usuário: localStorage `torque:support-announcement:v1:<userId>` com `{ shownCount, engaged, coachDone }`. Guard de sessão: sessionStorage `torque:support-announcement:session-shown`. Parse defensivo — JSON corrompido ou storage bloqueado (Safari private mode) nunca lança.

## Regras de negócio (exibição)

1. Modal A elegível se: usuário autenticado, `shownCount < 2`, `!engaged`, sessão ainda não mostrou, e `[data-support-fab]` existe no DOM (telas fullbleed/TV/login não têm FAB → nada renderiza).
2. Ao exibir A: incrementa `shownCount` e trava a sessão (refresh na mesma aba não conta segunda exibição).
3. Fechar A por qualquer via ("Agora não", Esc, clique fora) → coach-mark C em seguida, se `!coachDone`.
4. CTA "Conhecer o Suporte": marca `engaged` + `coachDone`, fecha sem mostrar C e abre o painel de suporte.
5. C "Entendi": `coachDone` — nunca mais aparece.
6. C "Pular" (ou Esc): fecha só nesta sessão; se A reaparecer na 2ª sessão, C volta depois dele.
7. Abrir o Suporte por qualquer via (a qualquer momento) marca `engaged` + `coachDone`; anúncio ativo some na hora. O FAB continua clicável através do furo do spotlight (scrim `pointer-events-none`).
8. Esgotadas as 2 exibições de A, nada mais aparece (mesmo com `coachDone: false`) — sem nag infinito.
9. Delay de entrada: A só aparece depois do app "assentar" — `[data-support-fab]` presente no DOM E nenhum `[data-torque-loader]` na tela (`isAppSettled` em `support-announcement.ts`) — mais 800ms de folga, com re-checagem de tudo (assentado, elegibilidade, suporte fechado) antes de exibir. O componente faz polling leve (250ms) até assentar; se um loader remontar durante a folga, volta a esperar. O polling encerra em definitivo quando o modal exibe ou a elegibilidade morre. Marcador: atributo `data-torque-loader` no root do `TorqueLoader` (ambas as variants).

## Edge cases

- Storage indisponível (Safari private mode): funções viram no-op silencioso; o anúncio pode reaparecer, mas o app nunca quebra.
- Multiusuário no mesmo browser: estado escopado por `userId` — cada usuário vê o próprio ciclo de anúncio.
- Reduced motion: anel do spotlight fica estático (opacity 50%) em vez de pulsar.
- Mobile (`max-sm`): balão do coach-mark aparece acima do FAB (não à esquerda), sem furar a viewport.
- O 3º bullet aponta pro badge no próprio FAB ("Aviso no ? dourado") — o sininho de alertas não cobre respostas de suporte (`useSupportUnread` alimenta só o FAB e o painel).

## Histórico

- 2026-07-13 — Criado: modal A + coach-mark C, state machine testada, montagem no App shell.
- 2026-07-13 — Fix pós-deploy: entrada por espera de condição (`isAppSettled`) em vez de timer fixo — o modal abria por cima do `TorqueLoader` e morria pra sessão se o FAB não existisse aos 800ms.
