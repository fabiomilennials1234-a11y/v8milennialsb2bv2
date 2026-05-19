# 2026-05-19 — Chat: fallback "[Mensagem não suportada]" tratado por tipo

## Mudanças

- **Chat/UI**: bubble da conversa deixa de mostrar `[Mensagem não suportada]`
  para tipos legítimos do WhatsApp que o frontend não renderizava (interactive,
  template, sem `message_type` resolvido).
- **History sync**: `history-sync-worker` para de gravar `message_type="unknown"`
  literal quando o payload tem mídia mas falta `type` — deriva o tipo a partir
  de `mediaType` / `mimetype` / presença de `mediaUrl`.

## Por quê

Áreas frágeis 🔴 (WhatsApp/Uazapi). Bubble usa whitelist estrita em
`src/components/chat/WhatsAppChat.tsx`: só renderiza `audio/ptt/image/album/
video/document/sticker/location/contact/reaction/poll/system`. Qualquer outro
tipo, com `content` vazio, caía no fallback `[Mensagem não suportada]` —
indistinguível de erro.

Dois caminhos alimentavam isso:

1. **`whatsapp-webhook` normalizer** mapeia `NativeFlowMessage`, `ButtonsMessage`,
   `ListMessage` → `interactive`; `TemplateMessage` → `template`;
   `buttonsResponseMessage` → `buttonResponse`; `listResponseMessage` →
   `listResponse`. Nenhum desses 4 tipos tinha branch de render — fallback
   garantido se Uazapi não enviasse `selected*` para extrair content.

2. **`history-sync-worker:160`** usava literal `"unknown"` quando
   `msg.type` / `msg.wa_type` ausentes e sem `msg.text` — mensagens históricas
   com mídia mas sem campo `type` no shape `/chat/messages` viravam `"unknown"`.

## Como funciona agora

### UI (`src/components/chat/WhatsAppChat.tsx`)

Três branches dedicados antes do fallback final:

- `isInteractive` (`interactive`, `buttonResponse`, `listResponse` + variantes):
  renderiza "Mensagem interativa" quando `content` vazio.
- `isTemplate` (`template`, `TemplateMessage`): renderiza "Mensagem de template".
- `isUnknown` (`unknown` ou `message_type` ausente): renderiza
  "Conteúdo indisponível" em opacity reduzida.

Fallback `[Mensagem não suportada]` agora exige: sem content, sem media,
sem nenhuma das categorias acima. Só dispara em tipo realmente novo do
provider.

### Backend (`supabase/functions/history-sync-worker/index.ts`)

Cascata de fallback do `message_type`:

```ts
msg.type
  ?? msg.wa_type
  ?? (msg.text || msg.body || msg.caption ? "text"
     : msg.mediaUrl || msg.media_url ? (msg.mediaType ?? msg.mimetype?.split("/")[0] ?? "document")
     : "unknown")
```

Mensagens históricas com mídia agora ganham tipo derivado (`image`, `video`,
`audio`, etc) em vez de literal `"unknown"`.

## Arquivos tocados

- `src/components/chat/WhatsAppChat.tsx` — flags `isInteractive`, `isTemplate`,
  `isUnknown` + 3 branches de render + condição estendida do fallback final.
- `supabase/functions/history-sync-worker/index.ts:160` — cascata de derivação
  do `message_type` substituindo o literal `"unknown"`.

## Áreas frágeis tocadas

- 🔴 WhatsApp/Uazapi (`history-sync-worker`, render do chat).
  Contract tests Vitest pre-existentes em
  `tests/unit/uazapi-payload-resolution.test.ts` continuam verdes — não houve
  mudança no shape do que entra/sai do webhook normalizer.

## Critérios de aceite

- [x] Tipos `interactive`, `template`, `unknown` rendem placeholder específico
  em vez de `[Mensagem não suportada]`.
- [x] Fallback final ainda dispara apenas para tipo novo desconhecido.
- [x] History sync grava tipo derivado (`image`/`video`/...) para mídia sem
  `type` em vez de `"unknown"`.
- [x] `tsc --noEmit` clean. ESLint sem novos erros.

## Follow-ups

- Webhook normalizer também pode extrair `content` de `TemplateMessage` (campos
  `header`, `body`, `footer` do payload Uazapi). Fora de escopo deste fix.
- Considerar deprecar a aceitação de `unknown` como `message_type` no DB
  (constraint `message_type IN (...)`) depois de auditar mensagens antigas.
