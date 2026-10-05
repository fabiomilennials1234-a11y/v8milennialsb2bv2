-- rollback/20271107140003_whatsapp_messages_fillfactor_toast_target.sql
--
-- Volta fillfactor e toast_tuple_target ao padrão (100 / ~2 kB). Preserva os
-- autovacuum_*_scale_factor=0.10 que prod já tinha. Só catálogo: páginas e
-- tuplas gravadas sob os valores novos ficam como estão até VACUUM FULL.
-- Lock SHARE UPDATE EXCLUSIVE; aplicar com SET lock_timeout = '3s'.

ALTER TABLE public.whatsapp_messages RESET (fillfactor, toast_tuple_target);
