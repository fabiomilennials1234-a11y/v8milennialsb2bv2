# Chat: marcar como não lido e responder

## Comportamento

- O menu da conversa permite marcar como não lida. A marcação pertence ao usuário e à conta de WhatsApp; persiste no banco e participa dos filtros e contadores, mesmo se a última mensagem for antiga ou enviada pelo vendedor.
- Reabrir a conversa limpa a marcação. Não se desfazem recibos de leitura enviados ao WhatsApp.
- A ação Responder seleciona uma mensagem estável, mostra a prévia no composer desktop/mobile e permite cancelar. Trocar de conversa limpa a seleção.
- Texto, imagem, vídeo, documento, figurinha e áudio usam o mesmo contexto de resposta. O envio passa `replyid` à Uazapi. A citação persistida reaparece na bolha após recarregar.
- Falhas mantêm o contexto, inclusive para recuperação/reenvio. Mensagens iguais citando alvos diferentes não são reconciliadas como uma só.
- O fluxo existente do WhatsApp oficial continua usando `channel_messages`; a validação nova se aplica à Uazapi.

## Dados e segurança

Migration `20271019000001_chat_unread_reply`: `conversation_read_state.marked_unread`, `whatsapp_messages.reply_context`, nova RPC de marcação e adaptação de listas/contadores. Mantém os gates de leitura existentes nas duas RPCs de listagem.

A RPC nova exige usuário autenticado e organização acessível. O proxy verifica organização, instância, conversa e mensagem não excluída antes de citar. A prévia persistida vem da mensagem original consultada no servidor. A gravação após envio aceito não transforma erro de persistência em novo envio; atualiza só a citação de uma linha já recebida pelo webhook.

## Ordem de publicação

1. Ensaiar a migration e os testes SQL em preview descartável e confirmar sua exclusão.
2. Aplicar somente esta migration, verificar grants e schema.
3. Publicar `whatsapp-api-proxy`.
4. Merge do frontend e verificar o bundle público.

## Validação

Testes direcionados cobrem menu da linha, seleção/cancelamento/troca de conversa, envio de texto/imagem/áudio com citação e contrato do adapter. O ensaio SQL usa schema mínimo explícito e executa as duas funções reais de listagem, contadores, marcação repetida, reabertura, isolamento por usuário/instância/organização e ACL. Não envia mensagens reais a clientes.

Validação em 2026-09-09: ensaio SQL aprovado em `bwcpllufjfklyktycbnu`, branch excluída e ausência confirmada. 61 testes direcionados aprovados; build, lint e typecheck sem regressões. A suíte geral encontrou falhas de ambiente em dois arquivos (bash/grep ausentes no PATH e timeout de varredura); os 12 testes passaram com Git Bash no PATH e timeout de 60s. Deno check dos módulos compartilhados aprovado; proxy tem erro de tipo herdado em `RuntimeLogModule` (linha anterior ao diff).

Segurança: queries de citação escopadas por org + instância + conversa; não revoga recibos do provider; ACL da nova RPC nega anon e exige auth.uid. A migration foi ensaiada com testes positivos e negativos. Publicação autorizada pelo CTO nesta sessão; em andamento.
