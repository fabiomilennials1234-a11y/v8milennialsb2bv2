-- ============================================================
-- Canal de suporte: a credencial passa a ser resolvida do banco.
--
-- Duas quedas com a mesma forma motivaram isto:
--   14/07→07/08/2026 — `SUPPORT_UAZAPI_TOKEN` apontava para instância de token
--                      revogado. 24 dias, 37 avisos perdidos, 401 em todos.
--   02/09/2026       — o número reconectou sob OUTRA instância da Uazapi; a
--                      antiga virou `503 session is not reconnectable`. 3
--                      chamados nasceram sem aviso, dois deles com impacto
--                      "parado".
--
-- Nos dois casos o código estava certo; a credencial estática é que envelheceu
-- calada. `support-notify-staff` e `infra-watchdog` passam a resolver a
-- instância CONECTADA da organização apontada aqui, a cada disparo. Trocar o
-- número do canal vira um UPDATE nesta chave — não um release.
--
-- Organização da plataforma: TorqueCRM (instância "TorqueSDR", 554884334050).
-- Para travar numa linha específica em vez de "a conectada da org", inserir
-- `support_sender_instance_id` com o uuid de `whatsapp_instances` — o pin tem
-- precedência sobre a org.
-- ============================================================

INSERT INTO public.cron_config (key, value)
VALUES ('support_sender_org_id', 'b2ad1ffb-e136-4356-846b-9f210f902573')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMENT ON TABLE public.cron_config IS
  'Configuração de infraestrutura lida por triggers e edge functions. Chaves do canal de suporte: support_notify_staff_url, support_sender_org_id, support_sender_instance_id (pin opcional).';
