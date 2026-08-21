-- Rollback de 20270813154600_notificame_channel_foundation.sql
--
-- ORDEM ENTRE OS DOIS ROLLBACKS: este é o PRIMEIRO. O apply foi cofre (…154500) →
-- fundação (…154600); desfazer é o inverso. Rodar `rollback/…154500` antes deste
-- deixaria a flag ligada e o canal insertável sobre um cofre inexistente.
-- (O caminho preferível segue sendo não rodar o do cofre — ver o cabeçalho dele.)
--
-- ATENÇÃO — A ORDEM AQUI É LOAD-BEARING E O PRIMEIRO PASSO DESTRÓI DADO.
--
-- O CHECK só volta a três valores se NÃO existir nenhuma linha
-- provider='notificame'. Por isso o passo 1 APAGA essas linhas. O que se perde:
-- o vínculo org↔canal (organization_id, channel_id, company_uuid, telefone).
-- O canal em si CONTINUA VIVO no NotificaMe — este arquivo não fala com o
-- fornecedor, e o `whatsapp-instance-reaper` desiste para provider != 'uazapi'.
-- Resultado: canal órfão do lado deles, exatamente o padrão que gerou as 87
-- órfãs na Uazapi. Quem rodar isto precisa remover o canal no painel do
-- NotificaMe À MÃO, e anotar o channel_id ANTES de apagar:
--
--   SELECT organization_id, phone_number, provider_config
--     FROM public.whatsapp_instances WHERE provider = 'notificame';
--
-- O DELETE também derruba, por FK ON DELETE CASCADE, o que pendurar na
-- instância (health checks e afins) e dispara o trigger BEFORE DELETE que grava
-- a lápide em `whatsapp_instance_reap_queue` — lápide que ninguém vai consumir,
-- porque o reaper ignora este provider. É ruído conhecido, não erro.
--
-- Se a fatia estiver INERTE (nenhum canal conectado — o estado em que ela é
-- mergeada), o passo 1 apaga zero linhas e este rollback é limpo.
--
-- CAMINHO PREFERÍVEL a rodar isto com canal vivo: desligar a flag (passo 4
-- isolado) e deixar CHECK e índice de pé. Eles são inertes sem quem insira.

-- 1. Linhas do canal. SEM ISTO o passo 3 falha (violação do CHECK novo).
DELETE FROM public.whatsapp_instances
 WHERE provider = 'notificame';

-- 2. Guarda de double-binding.
DROP INDEX IF EXISTS public.uq_whatsapp_instances_notificame_channel;

-- 3. CHECK de volta aos três valores anteriores (estado pré-fatia,
--    idêntico ao que archive/20261217000001 deixou).
ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;

ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_check
  CHECK (provider IN ('evolution', 'uazapi', 'meta_cloud'));

-- 4. COMMENT volta ao texto anterior, senão o rollback deixa a coluna
--    anunciando um provider que o CHECK acabou de proibir.
COMMENT ON COLUMN public.whatsapp_instances.provider IS
  'Provedor da instância WhatsApp: evolution (legado), uazapi (atual) ou '
  'meta_cloud (API oficial Meta, conexão via Embedded Signup).';

-- 5. Porta de entrada. `-` remove a chave; as demais flags da org sobrevivem.
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) - 'notificame'
 WHERE feature_flags ? 'notificame';
