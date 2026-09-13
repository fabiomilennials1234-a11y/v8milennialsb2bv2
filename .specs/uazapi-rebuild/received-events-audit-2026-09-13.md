# Eventos recebidos — auditoria em andamento (2026-09-13)

Escopo autorizado: edição, exclusão, reações e presença recebidas, em produção, TorqueSDR e destinatários controlados. Bloqueio/desbloqueio e transcrição fora desta rodada.

- 26 testes passaram: uazapi-event, uazapi-payload-resolution, typing-presence e use-typing-presence.
- Presença: OpenAPI 2.1.1 documenta evento presence; KNOWN_EVENTS do webhook não inclui presence. Não existe indicador recebido no chat. Envio de presença possui fluxo próprio e não prova recepção.
- Edição: handleMessagesUpdateEvent marca edited=true, sem incorporar texto editado. Validar formato real antes de alterar a extração e evitar assumir que o fornecedor usa essa rota.
- Reações: messages/ReactionMessage usa ID da mensagem alvo, compare-and-swap e merge por remetente. Variante messages_update usa implementação diferente; homologação real ainda pendente.
- Exclusão: messages_update marca deleted_at; formato real do evento recebido ainda pendente.

Solicitados ao operador externo mensagem original/editada, outra apagada para todos, reação ao botão QA-R15 e digitação. Na consulta inicial, nenhuma mensagem QA EVENTOS no banco. Captura SSE temporária e restrita aos identificadores controlados iniciada para diagnóstico; não substitui prova de processamento via webhook. Payloads e credenciais permanecem somente no scratch privado.

Nenhum deploy ou alteração de configuração de webhook feito nesta auditoria inicial. Não declarar homologação concluída.
