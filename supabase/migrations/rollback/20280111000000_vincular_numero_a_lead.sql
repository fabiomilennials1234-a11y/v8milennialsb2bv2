-- Rollback de 20280111000000_vincular_numero_a_lead.sql
-- Remove só a função. Telefones já gravados em lead_phones e vínculos feitos
-- continuam (são dado do cliente, como se tivessem sido digitados na ficha).
DROP FUNCTION IF EXISTS public.vincular_numero_a_lead(uuid, text, uuid);
