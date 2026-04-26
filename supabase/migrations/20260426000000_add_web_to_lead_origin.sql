-- Onda 1 / T1.0.1 — Adiciona 'web' ao enum lead_origin
--
-- Telemetria 30d (2026-04-26): 24.440 retries + 33 dead_letter por
-- "invalid input value for enum lead_origin: \"web\"" — cliente externo
-- (n8n/webhook) envia origin='web' que enum não aceita desde redução em
-- 20260229000000_lead_origin_reduce.sql.
--
-- ALTER TYPE ADD VALUE não pode rodar dentro de transação multi-statement
-- em algumas versões do Postgres. Em Supabase está OK (executa cada
-- migration em transação própria, ALTER TYPE separado).
--
-- Idempotente via IF NOT EXISTS.

ALTER TYPE public.lead_origin ADD VALUE IF NOT EXISTS 'web';
