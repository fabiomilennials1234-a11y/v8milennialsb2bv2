# Capacidades UAZAPI — documentação × código × validação

Fonte: https://docs.uazapi.com/openapi-bundled.json — OpenAPI 2.1.1.

Inventário das 139 operações. Referências literais no backend foram localizadas para 32 operações; 23 operações receberam sondas reais. Referência não prova interface ou uso em produção. Sonda não implica sucesso em todos os cenários; ver `.specs/uazapi-rebuild/live-verification-2026-09-11.json`.

Operações sem referência indicam capacidade ainda não integrada nesta base, sujeita a falsos negativos de análise estática. Não são expostas por um proxy administrativo genérico.

| Operação | Finalidade | Referência no backend | Sonda real |
|---|---|---|---|
| `POST /instance/create` | Criar Instancia | Sim | Não |
| `GET /instance/all` | Listar todas as instâncias | Sim | Não |
| `POST /instance/connect` | Conectar instância ao WhatsApp | Sim | Não |
| `POST /instance/disconnect` | Desconectar instância | Sim | Não |
| `POST /instance/reset` | Reiniciar runtime da instância | Não localizada | Não |
| `GET /instance/status` | Verificar status da instância | Sim | Executada; ver resultado |
| `GET /instance/wa_messages_limits` | Consultar limites atuais de novas conversas no WhatsApp | Sim | Executada; ver resultado |
| `POST /instance/updateFieldsMap` | Atualizar campos personalizados de leads | Não localizada | Não |
| `POST /instance/updateInstanceName` | Atualizar nome da instância | Não localizada | Não |
| `POST /instance/updateAdminFields` | Atualizar campos administrativos | Não localizada | Não |
| `GET /instance/proxy` | Obter configuração de proxy da instância | Não localizada | Não |
| `POST /instance/proxy` | Configurar ou alterar o proxy | Não localizada | Não |
| `GET /proxy-managed/cities` | Proxy Interno - Listar cidades disponíveis | Não localizada | Não |
| `POST /profile/name` | Altera o nome do perfil do WhatsApp | Não localizada | Não |
| `POST /profile/image` | Altera a imagem do perfil do WhatsApp | Não localizada | Não |
| `DELETE /instance` | Deletar instância | Sim | Não |
| `GET /instance/privacy` | Buscar configurações de privacidade | Não localizada | Não |
| `POST /instance/privacy` | Alterar configurações de privacidade | Não localizada | Não |
| `POST /instance/presence` | Atualizar status de presença da instância | Não localizada | Não |
| `POST /send/text` | Enviar mensagem de texto | Sim | Executada; ver resultado |
| `POST /send/media` | Enviar mídia (imagem, vídeo, áudio ou documento) | Sim | Executada; ver resultado |
| `POST /send/contact` | Enviar cartão de contato (vCard) | Sim | Executada; ver resultado |
| `POST /send/location` | Enviar localização geográfica | Sim | Executada; ver resultado |
| `POST /message/presence` | Enviar atualização de presença | Sim | Não |
| `POST /send/status` | Enviar status (stories) | Não localizada | Não |
| `POST /send/menu` | Enviar menu interativo (botões, carrosel, lista ou enquete) | Sim | Executada; ver resultado |
| `POST /send/carousel` | Enviar carrossel de mídia com botões | Não localizada | Não |
| `POST /send/location-button` | Solicitar localização do usuário | Não localizada | Não |
| `POST /send/request-payment` | Solicitar pagamento | Não localizada | Não |
| `POST /send/pix-button` | Enviar botão PIX | Sim | Não |
| `GET /message/async` | Consultar fila async de envio direto | Não localizada | Não |
| `DELETE /message/async` | Limpar fila async de envio direto | Não localizada | Não |
| `POST /instance/updateDelaySettings` | Configurar delay entre mensagens async | Não localizada | Não |
| `POST /message/download` | Baixar arquivo de uma mensagem | Sim | Executada; ver resultado |
| `POST /message/find` | Buscar mensagens em um chat | Sim | Executada; ver resultado |
| `POST /message/history-sync` | Solicitar histórico sob demanda de um chat | Sim | Executada; ver resultado |
| `POST /message/markread` | Marcar mensagens como lidas | Sim | Executada; ver resultado |
| `POST /message/react` | Enviar reação a uma mensagem | Sim | Executada; ver resultado |
| `POST /message/delete` | Apagar Mensagem Para Todos | Sim | Executada; ver resultado |
| `POST /message/edit` | Edita uma mensagem enviada | Sim | Executada; ver resultado |
| `POST /message/pin` | Fixa ou desafixa uma mensagem | Sim | Executada; ver resultado |
| `POST /group/create` | Criar um novo grupo | Não localizada | Não |
| `POST /group/info` | Obter informações detalhadas de um grupo | Não localizada | Não |
| `POST /group/inviteInfo` | Obter informações de um grupo pelo código de convite | Não localizada | Não |
| `POST /group/join` | Entrar em um grupo usando código de convite | Não localizada | Não |
| `POST /group/leave` | Sair de um grupo | Não localizada | Não |
| `GET /group/list` | Listar todos os grupos | Não localizada | Não |
| `POST /group/list` | Listar todos os grupos com filtros e paginacao | Não localizada | Não |
| `POST /group/resetInviteCode` | Resetar código de convite do grupo | Não localizada | Não |
| `POST /group/updateAnnounce` | Configurar permissões de envio de mensagens no grupo | Não localizada | Não |
| `POST /group/updateJoinApproval` | Configurar aprovação para entrada no grupo | Não localizada | Não |
| `POST /group/updateMemberAddMode` | Configurar quem pode adicionar novos membros ao grupo | Não localizada | Não |
| `POST /group/updateDescription` | Atualizar descrição do grupo | Não localizada | Não |
| `POST /group/ephemeral` | Configurar mensagens temporárias em grupo | Não localizada | Não |
| `POST /group/updateImage` | Atualizar imagem do grupo | Não localizada | Não |
| `POST /group/updateLocked` | Configurar permissão de edição do grupo | Não localizada | Não |
| `POST /group/updateName` | Atualizar nome do grupo | Não localizada | Não |
| `POST /group/updateParticipants` | Gerenciar participantes do grupo | Não localizada | Não |
| `POST /community/create` | Criar uma comunidade | Não localizada | Não |
| `POST /community/editgroups` | Gerenciar grupos em uma comunidade | Não localizada | Não |
| `POST /newsletter/create` | Criar canal | Não localizada | Não |
| `GET /newsletter/list` | Listar canais inscritos | Não localizada | Não |
| `POST /newsletter/info` | Buscar informações de um canal | Não localizada | Não |
| `POST /newsletter/link` | Buscar canal por link-chave de convite | Não localizada | Não |
| `POST /newsletter/subscribe` | Assinar live updates temporários de um canal | Não localizada | Não |
| `POST /newsletter/messages` | Buscar mensagens de um canal | Não localizada | Não |
| `POST /newsletter/messages/edit` | Editar mensagem recente de um canal | Não localizada | Não |
| `POST /newsletter/messages/delete` | Deletar mensagem recente de um canal | Não localizada | Não |
| `POST /newsletter/updates` | Buscar updates de mensagens de um canal | Não localizada | Não |
| `POST /newsletter/viewed` | Marcar posts do canal como visualizados | Não localizada | Não |
| `POST /newsletter/reaction` | Reagir a um post do canal | Não localizada | Não |
| `POST /newsletter/follow` | Seguir canal | Não localizada | Não |
| `POST /newsletter/unfollow` | Deixar de seguir canal | Não localizada | Não |
| `POST /newsletter/mute` | Silenciar canal | Não localizada | Não |
| `POST /newsletter/unmute` | Remover mute do canal | Não localizada | Não |
| `POST /newsletter/delete` | Deletar canal | Não localizada | Não |
| `POST /newsletter/picture` | Atualizar foto do canal | Não localizada | Não |
| `POST /newsletter/name` | Atualizar nome do canal | Não localizada | Não |
| `POST /newsletter/description` | Atualizar descrição do canal | Não localizada | Não |
| `POST /newsletter/settings` | Atualizar configurações do canal | Não localizada | Não |
| `POST /newsletter/search` | Pesquisar canais públicos | Não localizada | Não |
| `POST /newsletter/admin/invite` | Convidar admin do canal | Não localizada | Não |
| `POST /newsletter/admin/accept` | Aceitar convite de admin do canal | Não localizada | Não |
| `POST /newsletter/admin/remove` | Remover admin do canal | Não localizada | Não |
| `POST /newsletter/admin/revoke` | Revogar convite de admin do canal | Não localizada | Não |
| `POST /newsletter/owner/transfer` | Transferir dono do canal | Não localizada | Não |
| `GET /webhook` | Ver Webhook da Instância | Sim | Executada; ver resultado |
| `POST /webhook` | Configurar Webhook da Instância | Sim | Não |
| `GET /webhook/errors` | Ver últimos erros do webhook local | Não localizada | Não |
| `GET /globalwebhook` | Ver Webhook Global | Não localizada | Não |
| `POST /globalwebhook` | Configurar Webhook Global | Não localizada | Não |
| `GET /globalwebhook/errors` | Ver últimos erros do webhook global | Não localizada | Não |
| `GET /sse` | Server-Sent Events (SSE) | Não localizada | Executada; ver resultado |
| `POST /sender/simple` | Criar nova campanha (Simples) | Não localizada | Não |
| `POST /sender/advanced` | Criar envio em massa avançado | Sim | Executada; ver resultado |
| `POST /sender/edit` | Controlar campanha de envio em massa | Sim | Executada; ver resultado |
| `POST /sender/cleardone` | Limpar mensagens enviadas | Não localizada | Não |
| `DELETE /sender/clearall` | Limpar toda fila de mensagens | Não localizada | Não |
| `GET /sender/listfolders` | Listar campanhas de envio | Sim | Executada; ver resultado |
| `POST /sender/listmessages` | Listar mensagens de uma campanha | Sim | Executada; ver resultado |
| `POST /chat/block` | Bloqueia ou desbloqueia contato do WhatsApp | Sim | Não |
| `GET /chat/blocklist` | Lista contatos bloqueados | Sim | Não |
| `POST /chat/labels` | Gerencia labels de um chat | Não localizada | Não |
| `POST /chat/delete` | Deleta chat | Não localizada | Não |
| `POST /chat/archive` | Arquivar/desarquivar chat | Não localizada | Não |
| `POST /chat/ephemeral` | Configurar mensagens temporárias em chat privado | Não localizada | Não |
| `POST /chat/read` | Marcar chat como lido/não lido | Não localizada | Não |
| `POST /chat/mute` | Silenciar chat | Não localizada | Não |
| `POST /chat/pin` | Fixar/desafixar chat | Não localizada | Não |
| `POST /chat/find` | Busca chats com filtros | Sim | Executada; ver resultado |
| `POST /chat/notes` | Consultar notas internas do chat | Não localizada | Não |
| `POST /chat/notes/refresh` | Recarregar notas internas do chat no WhatsApp | Não localizada | Não |
| `POST /chat/notes/edit` | Editar notas internas do chat | Não localizada | Não |
| `POST /chat/editLead` | Edita informações de lead | Não localizada | Não |
| `GET /contacts` | Retorna lista de contatos do WhatsApp | Não localizada | Não |
| `POST /contacts/list` | Listar todos os contatos com paginacao | Não localizada | Não |
| `POST /contact/add` | Adiciona um contato à agenda | Não localizada | Não |
| `POST /contact/remove` | Remove um contato da agenda | Não localizada | Não |
| `POST /chat/details` | Obter Detalhes Completos | Não localizada | Não |
| `POST /chat/check` | Verificar Números no WhatsApp | Sim | Executada; ver resultado |
| `POST /label/edit` | Criar, editar ou deletar etiqueta | Não localizada | Não |
| `GET /labels` | Buscar todas as etiquetas | Não localizada | Não |
| `POST /labels/refresh` | Iniciar recarga de etiquetas do WhatsApp | Não localizada | Não |
| `POST /quickreply/edit` | Criar, atualizar ou excluir resposta rápida | Não localizada | Não |
| `GET /quickreply/showall` | Listar todas as respostas rápidas | Não localizada | Não |
| `POST /call/make` | Iniciar chamada de voz | Não localizada | Não |
| `POST /call/reject` | Rejeitar chamada recebida | Não localizada | Não |
| `GET /chatwoot/config` | Obter configuração do Chatwoot | Não localizada | Não |
| `PUT /chatwoot/config` | Atualizar configuração do Chatwoot | Não localizada | Não |
| `POST /business/get/profile` | Obter o perfil comercial | Não localizada | Não |
| `GET /business/get/categories` | Obter as categorias de negócios | Não localizada | Não |
| `POST /business/update/profile` | Atualizar o perfil comercial | Não localizada | Não |
| `POST /business/catalog/list` | Listar os produtos do catálogo | Não localizada | Não |
| `POST /business/catalog/info` | Obter informações de um produto do catálogo | Não localizada | Não |
| `POST /business/catalog/delete` | Deletar um produto do catálogo | Não localizada | Não |
| `POST /business/catalog/show` | Mostrar um produto do catálogo | Não localizada | Não |
| `POST /business/catalog/hide` | Ocultar um produto do catálogo | Não localizada | Não |
| `POST /admin/restart` | Reiniciar a aplicação | Não localizada | Não |
| `POST /admin/token/rotate` | Rotacionar admin token | Não localizada | Não |

## Incrementos úteis ao Torque CRM

| Prioridade | Capacidade | Uso e estado |
| --- | --- | --- |
| Implementado nesta reconstrução | Menus com rótulo de lista, tracking e seleção legível | Node e preview configuram o botão; parser/chat mostram título escolhido. Card completo das opções enviadas ainda pendente. |
| Implementado no backend | Localização, contato, bloquear/desbloquear, recuperação history | Contratos/guards presentes; controles dedicados e homologação por fluxo ainda necessários. |
| Próximo | Histórico com progresso e retomada | Permite recuperar conversas sem importação cega; history assíncrono e exact 404 precisam fechamento antes da UI. |
| Próximo | Card do menu enviado, contexto de resposta e resultado de enquetes | Atendente precisa ver opções apresentadas e escolhidas; seleção básica já corrigida com payload real. |
| Avaliar | Arquivar/silenciar/bloquear e etiquetas sincronizadas | Exige definir se a ação vale no CRM, no WhatsApp ou em ambos; não espelhar automaticamente tags comerciais. |
| Adiar | Chatbot nativo, Chatwoot, gestão de grupos/catálogos/perfil/admin | Sem necessidade comprovada no fluxo atual; chatbot paralelo pode disputar a conversa com Copilot. |

A existência de método no adapter não implica funcionalidade disponível na interface. Mass Send/Quick Blast compartilham contrato do sender; nodes usam envios individuais. Homologação de cada Edge Function consumidora continua necessária antes do rollout.
