---
type: changelog
title: "Chat: cabeçalho — Ligar ▾ sem esmagar o contato"
status: shipped
created: 2026-09-03
updated: 2026-09-03
tags: [changelog, chat, torquecalls, voz, design]
related: ["[[layout-onda-2b]]", "[[2026-09-02-torquecalls-ligar-todo-lead-visivel]]"]
owner: gabriel
branch: fix/chat-header-ligar-layout
pr: pendente
---

# 2026-09-03 — Chat: cabeçalho "Ligar ▾" sem esmagar o contato

## TL;DR

Print do CTO (Milennials, 11:50): com **dois** números de voz o botão dividido "Ligar | Gabrielly-SDR ▾"
passava de 200 px, o contato colapsava até sobrar o avatar e o "Ao vivo" caía para baixo dele, por trás do
botão. Três causas: contato sem largura mínima, linha do nome com `flex-wrap`, e o nome do número no próprio
cabeçalho — tudo escondido por um `overflow-hidden` na raiz. Decisão fechada pelo CTO a partir do mockup
"Ligar no Cabeçalho do Chat": **o contato tem piso e é o último a perder espaço; o número sai do cabeçalho
e vai para o tooltip e o menu.**

## Mudanças
- **chat/cabeçalho** (`ChatHeader.tsx`): contato `flex-1 min-w-[11rem]` (era `min-w-0`); linha do nome `flex-nowrap`, `h3` truncado, badge `shrink-0`; telefone truncado. Ações num grupo `shrink-0` (Ligar ▾ · Ver lead · histórico) + separador antes do bloco IA/densidade. Rótulos "Ligar", "Ver lead"/"Criar Lead" `hidden lg:inline` (abaixo de `lg`: ícone + `title` + `aria-label`). Densidade: três ícones `hidden lg:flex`; entre `md` e `lg` entra um "⋯" (`DensityOverflowMenu`, `DropdownMenuRadioGroup` com as três densidades, mesmo `onDensityChange`). `overflow-hidden` removido da raiz.
- **voz/botão** (`VoiceCallButton.tsx`, variante `default`): um único botão "Ligar" (`variant="outline"` com um número; com 2+, grupo bordado `Ligar` + `ChevronDown`). O corpo disca pelo número lembrado; a seta abre o menu (para propagação, não disca). `title` = `Ligar por {instanceName}` nas duas variantes. O nome do número **saiu** do cabeçalho. Menu: rótulo "Ligar pelo número", nome da instância e telefone em mono/muted quando existe. Variante `icon`: só o `title` mudou.
- **voz/dados** (`useVoipSession.ts`, `useWhatsAppInstances.ts`, `chat/types.ts`): `CallableVoiceNumber.phoneNumber?` e `WhatsAppInstanceForUser.phone_number?`, vindos da mesma leitura de `whatsapp_instances` (coluna `phone_number` acrescentada ao `select`) — nenhuma consulta a mais.
- **preferência de número**: já persistia por org+vendedor via `usePersistedState` (chave `voice-call-number`, TTL 90 d) no `VoiceCallProvider`. Nada mudou.

## Arquivos tocados
- `src/modules/communication/components/chat/view/ChatHeader.tsx` (+ `ChatHeader.test.tsx`, novo)
- `src/modules/communication/components/voice/VoiceCallButton.tsx` (+ `.test.tsx`)
- `src/modules/communication/hooks/useVoipSession.ts` (+ `.test.ts`)
- `src/modules/communication/hooks/chat/useWhatsAppInstances.ts`, `src/modules/communication/hooks/chat/types.ts`
- `Obsidian/.../06 — Features/Chat/layout-onda-2b.md`

## Decisões
- O estado "por qual número sai" passa a viver no tooltip e no menu, não no cabeçalho: o cabeçalho não tem largura para carregá-lo sem apagar o nome do contato, que é o estado mais importante da tela. Sem ADR — decisão de layout, registrada no cabeçalho dos dois arquivos.
- "Ligar ▾" é UM botão aos olhos, feito de duas partes (um `<button>` não contém outro). Sem `overflow-hidden` no grupo; `focus-visible:z-10` nas duas partes — regra do DESIGN.md §5 (anel de foco).
- O "⋯" da densidade só existe entre `md` e `lg`: os três ícones sempre foram `md+`, e no celular o cabeçalho é outro (`MobileChatThreadHeader`).

## Verificação
- vitest direcionado (4 arquivos): 81/81. `npm run test:unit`: 41 arquivos vermelhos herdados na origin/main, 0 introduzidos (comparação no PR).
- `npm run lint`: 0 erros nos arquivos tocados (2 warnings `no-explicit-any` pré-existentes em `useVoipSession.ts`).
- `npm run typecheck:ratchet`: 0 erros introduzidos. `npm run build`: OK.

## Follow-ups
- Só front. Nenhuma migration, nenhuma edge function. Sem deploy até merge (EasyPanel sobe sozinho).
- O chip "padrão" ao lado do número lembrado, presente no mockup, ficou de fora: o indicador do `RadioItem` já marca o selecionado.
