---
type: backlog
title: Fix ciclos de dependência no domínio chat (13 ciclos pré-existentes)
status: backlog
created: 2026-05-26
tags: [backlog, modularizacao, dependency-cruiser, chat]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
owner: gabriel
---

# Fix ciclos de dependência no domínio chat (13 pré-existentes)

## Contexto

Slice 1 da modularização (`feat/modularizacao/00-tooling`) adicionou `dependency-cruiser` e detectou 13 ciclos pré-existentes, todos concentrados no domínio chat/WhatsApp.

`no-circular` está em **warn** temporariamente. Slice 17 (docs + flip warn→error) precisa estes ciclos fixados antes de virar gate.

## Ciclos detectados

Roda `npm run lint:deps` pra ver lista atualizada. Padrão dominante:

```
src/components/chat/ChatShellWithContext.tsx →
  src/components/chat/<algo>.tsx →
    src/hooks/useWhatsAppChat.ts →
      src/hooks/chat/useWhatsAppSend.ts →
        src/lib/whatsapp.ts →
          src/lib/prefetch/chatPrefetch.ts →
            src/pages/ChatWhatsApp.tsx →
              src/components/chat/ChatShellWithContext.tsx
```

Ponto de entrada do ciclo: `src/lib/prefetch/chatPrefetch.ts` importa `src/pages/ChatWhatsApp.tsx`. Page importa shell. Shell importa primitivos que importam hooks que importam o lib de prefetch. Loop.

## Causa raiz

`chatPrefetch.ts` importa de `pages/` — inversão de camadas. Lib não deve depender de page.

## Solução proposta

1. Extrair tipos/contratos compartilhados de `pages/ChatWhatsApp.tsx` para `src/lib/whatsapp/types.ts`
2. `chatPrefetch.ts` importa do novo arquivo de tipos
3. Page importa do mesmo tipo (deps unidirecionais: page → lib)
4. Validar com `npm run lint:deps`

## Estimativa

2-3h. Refactor cirúrgico em ~5 arquivos.

## Quando

- **Antes do slice 17** da modularização (que flipa `no-circular` para error)
- Pode ser feito em qualquer momento como slice paralelo `chore/fix-chat-circular-deps`

## Aceite

- [ ] `npm run lint:deps` retorna 0 ciclos
- [ ] Behavior não muda (smoke chat WhatsApp)
- [ ] Modularização sem `no-circular: warn` pendente

## Refs

- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
- SPEC: `.specs/features/modularizacao/SPEC.md`
- Config: `.dependency-cruiser.cjs`
