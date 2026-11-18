-- Rollback de 20280119030000_whatsapp_messages_autovacuum_por_insercao.sql
-- Volta às reloptions de prod lidas em 16/11/2026:
-- autovacuum_vacuum_scale_factor=0.10 (mantidas: analyze_scale_factor=0.10,
-- fillfactor=85, toast_tuple_target=1024 — esta migration não as toca).

ALTER TABLE public.whatsapp_messages RESET (
  autovacuum_vacuum_insert_threshold,
  autovacuum_vacuum_insert_scale_factor
);
ALTER TABLE public.whatsapp_messages SET (autovacuum_vacuum_scale_factor = 0.10);
