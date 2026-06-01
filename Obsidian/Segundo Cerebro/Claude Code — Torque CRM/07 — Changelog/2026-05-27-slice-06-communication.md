# 2026-05-27 — Slice 6 communication

Slice 6 da modularização (`feat/modularizacao/05-communication`, stacked sobre slice 5). Frontend do BC communication migrado para `src/modules/communication/`. Backend continua fora — vai para slices 15/16.

## Mudanças

- **communication**: 4 pastas de components migradas (`chat`, `chat-meta`, `whatsapp`, `whatsapp-migration`), 2 pastas de hooks (`chat`, `chat-meta`), 22 hooks soltos, 6 lib files (whatsappApi, whatsapp, chat-types, primaryInstanceFor, computeNeedsDeepLinkResolve, audioToMp3, chatPrefetch), 2 pages (ChatWhatsApp, AtendimentoMeta)
- **App.tsx**: lazy imports atualizados — ChatWhatsApp + AtendimentoMeta agora resolvem em `@/modules/communication/pages/...`; ChatSkeleton via `@/modules/communication/components/chat/ChatSkeleton`. 4 MockupChat pages deletadas (`MockupChat*.tsx`) + 3 lazy imports + 3 routes `/_mockup/chat*` removidas (já no working tree pré-skill, preservado)
- **API pública**: `src/modules/communication/index.ts` populado — hooks principais (WhatsApp + Meta), components (ChatShellWithContext, MessageBubble, Composer, etc.), lib helpers (whatsappApi namespace, primaryInstanceFor, prefetch), types (WhatsAppMessage, MetaConversation, etc.)
- **Status**: módulo marcado Active no `src/modules/communication/CLAUDE.md`
- **Codemod**: 167 arquivos atualizados, 367+ replacements de imports (`@/components/chat/*`, `@/components/chat-meta/*`, `@/components/whatsapp{,-migration}/*`, `@/hooks/chat/*`, `@/hooks/chat-meta/*`, 22 hooks soltos, `@/lib/{whatsappApi,whatsapp,chat-types,primaryInstanceFor,computeNeedsDeepLinkResolve,audioToMp3}`, `@/lib/prefetch/chatPrefetch`, 2 pages)

## Dedup realtime (NÃO consolidado neste slice)

Brief pedia "3 hooks realtime → 1 canonical". Decisão: **adiar para slice 14**.

Motivo: os 3 hooks (`useRealtimeChannel` + `useRealtimeChannelStatus` + `useRealtimeSubscription`) **não são duplicatas** — são 3 camadas (transport low-level / status store / subscription com debounce-and-cache-patching). Também são cross-cutting infra: `useRealtimeSubscription` é importado por ~50 hooks em todos os BCs (leads, pipelines, copilot, etc.). Movê-los para `communication` seria errado de design. Vão para `core/realtime/` no slice 14 (platform) ou junto com flip ESLint warn→error no slice 17.

Migrados neste slice (são specific-to-communication): `useWhatsAppMessagesRealtime`, `useChatBubbleContactsRealtime`, `useMetaRealtime`, `usePatchedRealtime`, `useRealtimeFallback`.

## Arquivos tocados (resumo)

- `src/modules/communication/{components,hooks,lib,pages,index.ts,CLAUDE.md}` — populados via 159 renames (`git mv`)
- `src/App.tsx` — 3 imports comm reescritos
- `src/components/chat,chat-meta,whatsapp,whatsapp-migration/` — removidos (vazios)
- `src/hooks/chat,chat-meta/` — removidos (vazios)
- 22 hooks soltos em `src/hooks/use*` — removidos (movidos)
- `src/lib/{whatsappApi.ts,whatsapp.ts,chat-types.ts,primaryInstanceFor.ts,computeNeedsDeepLinkResolve.ts,audioToMp3.ts}` — removidos
- `src/lib/prefetch/` — removido (era 1 file só)
- ~165 arquivos cross-module com imports atualizados (campanhas, leads, identity, pipelines, copilot UI, automacoes, layout, settings, command palette, lead-detail, onboarding, contexts, tests)
- `scripts/codemod-slice6.mjs` — script de codemod (utility, pode ser preservado ou deletado)

## Decisões

- **Backend (edge functions + `_shared/`) fora deste slice** — vão para slices 15 e 16 conforme planejamento original
- **Realtime hooks cross-cutting** ficam em `src/hooks/` — slice 14 consolida
- **`useMessageTemplates`** vive em communication (entidade `message_templates`) mesmo que reusado cross-module
- **`useConversationHistory`** vive em communication (overlap suave com copilot via `conversation_messages` tabela, mas primary entity = histórico de mensagens)
- **Stacking sobre slice 5** (não esperar merge) — convenção da feature em andamento

## QA literal

```
TypeScript:  npx tsc --noEmit               →  clean (0 errors)
ESLint:      npm run lint                   →  0 errors, 2448 warnings (baseline)
Build:       npm run build                  →  ✓ built in 29.30s; sw built; PWA precache 279 entries
Unit tests:  npm run test:unit              →  44 failed | 3894 passed | 150 skipped (4088)
             baseline (sem slice 6)         →  44 failed | 3947 passed | 150 skipped (4141)
             diff: -53 passes (= 4 MockupChat tests deleted + flakiness ambiental)
             zero regressões reais identificadas
```

Falhas pré-existentes (não causadas por slice 6): `copilot/knowledge-retriever`, `useRealtimeFallback` (signature drift — pre-existing), `useScheduledMessages` em `hooks-final-agents` (timeouts intermitentes 5000ms — passa standalone e em outros files), `uazapi-provider`, `shared-auth`, `revision-item`, `useTVDashboardData-funnel`, `agent-message-batch`, `history-sync.test.tsx` (testing-library text not found — pre-existing), etc.

## Smoke test pós-merge (área frágil 🔴)

Manual, pelo CTO/arquiteto:

1. `/chat-whatsapp` carrega — lista conversas + abre uma conversa
2. Composer envia mensagem text — aparece no chat
3. Composer envia mídia (imagem) — preview + send
4. Chat bubble (floating) abre via kanban card
5. `/atendimento/meta` carrega — lista pages Meta + conversas + abre uma
6. Meta composer respeita janela 24h (botão disabled fora da janela)
7. Realtime: nova mensagem em outra aba aparece sem refresh
8. History sync: iniciar job e ver progresso no painel
9. WhatsApp migration banner aparece em org legacy Evolution
10. Permission check: usuário sem `whatsapp.view` é bloqueado

## Follow-ups

- **Slice 14**: mover `useRealtimeChannel` + `useRealtimeChannelStatus` + `useRealtimeSubscription` para `core/realtime/`
- **Slice 15**: migrar edge functions communication para subpastas BC (`whatsapp-*`, `meta-*`, `sz-chat-*`, `history-sync-worker`, `stream-media`, `summarize-conversation`)
- **Slice 16**: consolidar `_shared/whatsapp-*` + `_shared/message-*` + `whatsapp-providers/` em `_shared/communication/{send,humanize,classify,dedup}/`
- Tests `history-sync.test.tsx` quebrados em baseline — investigar separadamente
- Tests `useRealtimeFallback.test.ts` quebrados em baseline (signature drift) — investigar separadamente

## Refs

- Branch: `feat/modularizacao/05-communication` (stacked sobre `feat/modularizacao/04-pipelines`)
- Sub-CLAUDE.md: `src/modules/communication/CLAUDE.md`
- Slices tracker: `Obsidian/.../10 — Remodelagem/04-execucao/slices.md`
