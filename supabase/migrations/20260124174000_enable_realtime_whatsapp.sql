-- Habilitar Realtime para a tabela whatsapp_messages
-- Isso permite que o frontend receba atualizações em tempo real

-- Primeiro, remover se já existe (para garantir configuração limpa)
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS whatsapp_messages;

-- Adicionar tabela à publicação do Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;
