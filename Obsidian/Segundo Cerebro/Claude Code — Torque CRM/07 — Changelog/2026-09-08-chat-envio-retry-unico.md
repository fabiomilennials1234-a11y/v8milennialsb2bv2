---
type: changelog
title: Uma bolha por envio com recuperação limitada
status: draft
created: 2026-09-08
tags: [whatsapp, chat, fix]
owner: gabriel
---

# Uma bolha por envio com recuperação limitada

Envio manual de texto/mídia agora mantém a mesma bolha durante a recuperação,
com contador 1/10 a 10/10. Esgotamento deixa a bolha vermelha com “Falha no envio”.
Rollback não restaura mensagens antigas sobre realtime novo; IDs de falha são
estáveis e ecos conversation reconciliam otimistas text.

Chamadas de entrega incerta são confirmadas antes de qualquer novo envio.
Detalhes e limites em `.specs/fixes/chat-envio-retry-unico.md`.
Implementação em revisão, sem publicação em produção nesta etapa.
