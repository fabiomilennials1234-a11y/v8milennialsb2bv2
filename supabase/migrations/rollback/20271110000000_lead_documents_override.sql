-- Rollback de 20271110000000_lead_documents_override.sql
--
-- ANTES de rodar: volte o frontend para uma versão que não lê `lead_documents`
-- nem chama `set_lead_document` — sem a tabela a ficha do lead recebe 404 do
-- PostgREST na consulta do documento.
--
-- PERDE DADO: todo CPF/CNPJ editado no Torque e a trilha inteira das
-- alterações. Exporte `lead_documents` e `lead_document_events` antes.
-- `upsell_clients.cnpj` (espelho do ERP) não é tocado pela migration nem por
-- este rollback.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.set_lead_document(uuid, text);
DROP FUNCTION IF EXISTS public.can_update_lead(uuid);
DROP TABLE IF EXISTS public.lead_document_events;
DROP FUNCTION IF EXISTS public.fn_lead_document_events_append_only();
DROP TABLE IF EXISTS public.lead_documents;
DROP FUNCTION IF EXISTS public.is_valid_br_document(text);

DELETE FROM public.member_feature_permissions WHERE feature_key = 'leads.edit_document';
DELETE FROM public.organization_feature_defaults WHERE feature_key = 'leads.edit_document';
DELETE FROM public.feature_permissions WHERE key = 'leads.edit_document';

COMMIT;
