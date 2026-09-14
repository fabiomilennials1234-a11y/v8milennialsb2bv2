-- History restores stored conversations; it must not replay live business events.
-- Keep normalization, lead resolution, conversation summary and lead timeline.
SET lock_timeout = '2s';

CREATE OR REPLACE TRIGGER trg_aviso_de_mensagem
AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
WHEN (NEW.received_via IS DISTINCT FROM 'history_sync')
EXECUTE FUNCTION public.fn_aviso_de_mensagem();

CREATE OR REPLACE TRIGGER trg_enqueue_whatsapp_messages_webhooks
AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
WHEN (NEW.received_via IS DISTINCT FROM 'history_sync')
EXECUTE FUNCTION public.enqueue_whatsapp_messages_webhooks();

CREATE OR REPLACE TRIGGER trg_human_pause_on_manual_send
AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
WHEN (NEW.received_via IS DISTINCT FROM 'history_sync')
EXECUTE FUNCTION public.fn_human_pause_on_manual_send();

CREATE OR REPLACE TRIGGER trg_whatsapp_response_detection
AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
WHEN (NEW.direction = 'incoming' AND NEW.received_via IS DISTINCT FROM 'history_sync')
EXECUTE FUNCTION public.trigger_whatsapp_response_detection();

RESET lock_timeout;
