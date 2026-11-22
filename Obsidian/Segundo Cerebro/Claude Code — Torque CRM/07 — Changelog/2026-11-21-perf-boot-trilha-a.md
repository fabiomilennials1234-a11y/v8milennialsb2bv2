---
type: changelog
title: "2026-11-21 — Perf do boot (pacote 1, Trilha A): gates em paralelo e aquecimento da tela"
status: active
created: 2026-11-21
updated: 2026-11-21
tags: [changelog, perf, boot, permissoes, billing]
related: []
owner: claude-agent
---

# 2026-11-21 — Perf do boot (pacote 1, Trilha A)

## Mudanças
- **Gate de rota (área frágil)**: `ProtectedRoute` lê `useMasterAuth` em vez de `useIdentity`. O que saiu do gate foi SÓ a espera pela edge `get-member-permissions`; sessão, MFA de master, vínculo, desativado e gestor continuam iguais. `PermissionProtectedRoute` intocado: rota que pede permissão segue esperando as features.
- **Gate de assinatura (billing)**: `SubscriptionProtectedRoute` consulta `org_get_subscription_status` por React Query, com a org do vínculo ATUAL (`useCurrentTeamMember`), assim que ela existe. Saíram `getUser()` (ida ao servidor de auth) e o `team_members … limit 1` próprio. Papel/permissão de Copilot só são esperados no caso trial + `requireActive`. Fail-closed mantido (erro/sem org → tela honesta; bloqueada → tela de bloqueio). Master mantém o bypass.
- **Mudança declarada (multi-org)**: antes a assinatura checada era a do primeiro vínculo que o banco devolvesse (`limit 1` sem ordem); agora é a da org selecionada no org switcher.
- **Copilot**: `useCopilotSubscription` usa a mesma chave `["subscription-status", org]` e as mesmas opções — uma RPC por org, não duas.
- **Boot**: `iniciarCargaDaRotaAtual()` baixa o chunk da rota atual no carregamento do App (respeita 2g/economia de dados). `<AquecerTelaAtual/>` dispara a 1ª consulta da tela quando o vínculo resolve: `/funil/:slug` → lista de funis + etapas; `/chat-whatsapp` e `/dashboard` → caixas do usuário. Mesmas chaves e queryFns dos hooks reais.

## Arquivos tocados
- `src/core/boot-prewarm.ts` — novo (aquecimento + carga do chunk).
- `src/App.tsx` — chama `iniciarCargaDaRotaAtual()` após `registrarRotas`; monta `<AquecerTelaAtual/>`.
- `src/modules/billing/lib/subscription.ts` — `checkSubscriptionForOrg`, `subscriptionStatusKey`, `subscriptionStatusQueryOptions`; `checkCurrentUserSubscription` sem `getUser()` (deprecated).
- `src/modules/identity/components/SubscriptionProtectedRoute.tsx` (+ `.test.tsx`).
- `src/modules/identity/auth/components/ProtectedRoute.tsx`.
- `src/modules/copilot/hooks/useCopilotSubscription.ts`.
- `src/modules/communication/hooks/chat/useWhatsAppInstances.ts` — exporta `whatsappInstancesForUserKey`/`buscarCaixasDoUsuario` (chave inalterada).
- `src/modules/pipelines/hooks/model/usePipelines.ts` — exporta `pipelinesQueryKey`/`buscarPipelinesDaOrg`/`PIPELINES_STALE_MS` (chave inalterada).
- Testes: `tests/unit/boot-prewarm.test.tsx` (novo), `tests/unit/protected-route.test.tsx`.

## Decisões
- O aquecimento é leitura sob RLS e nunca decide acesso; falha vira silêncio. Só sai com sessão + vínculo do próprio usuário, uma vez por org.
- Etapas do funil importadas estaticamente: `usePaginatedFunil` já está no chunk do shell via `usePrefetchPipes` (aviso do Vite provou que `import()` não moveria nada).

## Follow-ups
- Medir cascata real no Chrome (conta membro, carga fria) e p50 por tela em `src/core/perf`.
- Trilha B (board numa chamada) completa o funil: hoje o aquecimento para nas etapas.
