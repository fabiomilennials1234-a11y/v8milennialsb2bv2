# ADR — Meta Chat em rota separada (não omnichannel) — 2026-05-25

## Status
Aceita.

## Contexto
Backend Meta já entrega mensagens IG/Messenger em `channel_messages`, mas o chat existente é WhatsApp-only. Faltava UI para visualizar e responder.

## Decisão
Construir Meta chat como rota dedicada (`/atendimento/meta`) com hooks/componentes paralelos (`chat-meta/`). Não fundir com WhatsApp em interface omnichannel nesta fase.

## Alternativas consideradas
- **A) Omnichannel unificado**: 1 lead = 1 thread misturando canais. Reprovada para FASE 0 por refactor pesado em hooks WhatsApp + risco em prod.
- **C) Híbrido com tabs**: mesmo shell, filtro por canal. Reprovada por ainda exigir mexer no shell WhatsApp.

## Consequências
- Mesmo lead aparece em /chat (WA) e /atendimento/meta (IG/Msg). UX inferior à unificada.
- Zero risco de regressão no chat WhatsApp.
- Caminho de evolução: fase futura pode introduzir vista omnichannel sobre as duas fontes (`channel_messages` + `whatsapp_messages` agregadas por lead_id).
