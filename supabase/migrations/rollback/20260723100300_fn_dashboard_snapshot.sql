-- ROLLBACK de 20260723100300_fn_dashboard_snapshot.sql (#1194)
-- Ordem de reversão: 2ª (o snapshot depende do motor e do esquema; reverte antes
-- deles). Só cria uma função → rollback = DROP FUNCTION.

DROP FUNCTION IF EXISTS public.fn_dashboard_snapshot(uuid, uuid, text, date, date, date);
