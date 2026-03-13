-- Habilitar Realtime para a tabela whatsapp_messages
-- Isso permite que o frontend receba atualizações em tempo real

-- Adicionar tabela à publicação do Realtime (ignorar erro se já existe)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
