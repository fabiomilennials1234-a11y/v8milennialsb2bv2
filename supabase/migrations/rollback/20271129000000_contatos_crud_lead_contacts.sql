-- Rollback de 20271129000000_contatos_crud_lead_contacts.sql
-- (Chamado 33c5fd52 · PR6)
--
-- ANTES de rodar: volte o frontend para uma versão sem a tela /contatos
-- (ela chama contact_list/contact_create/... e lê lead_contacts/contact_phones),
-- senão o PostgREST devolve 404/PGRST202.
--
-- PERDE DADO: tudo em lead_contacts e contact_phones, e a identidade dos
-- contatos criados pela tela (as linhas de `contacts` ficam, mas contacts.phone
-- continua com o número principal espelhado).
-- Exporte antes:  COPY (SELECT * FROM public.lead_contacts) TO ...
--
-- O índice ÚNICO (organization_id, normalized_phone) só volta se não houver
-- duplicata (o mesmo número em 2 contatos da org é permitido pela migration).
-- Se houver, o CREATE UNIQUE INDEX falha e a transação inteira aborta: apague
-- ou mescle as duplicatas, ou pule o índice.
--
-- As policies de `contacts` voltam ao texto LITERAL de prod (19/10): TO public,
-- get_user_organization_id() singular, e os GRANTs nominais de antes.
-- Isso REABRE os achados da auditoria (escrita direta por authenticated, anon
-- com SELECT, policies singulares) e devolve EXECUTE de
-- migrate_leads_to_contacts_companies a authenticated — só rode este rollback
-- se for imprescindível.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- RPCs e helpers
DROP FUNCTION IF EXISTS public.contact_list(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.lead_contact_unlink(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_contact_link(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.contact_delete(uuid);
DROP FUNCTION IF EXISTS public.contact_update(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.contact_create(uuid, text, text, jsonb, text, uuid[]);
DROP FUNCTION IF EXISTS public.contact_link_lead_internal(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.contact_set_phones(uuid, uuid, jsonb);

-- A policy de contacts depende de contact_has_links: sai antes da função.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
DROP FUNCTION IF EXISTS public.contact_has_links(uuid);

DROP TABLE IF EXISTS public.contact_phones;
DROP TABLE IF EXISTS public.lead_contacts;
DROP FUNCTION IF EXISTS public.fn_contact_phones_guard();
DROP FUNCTION IF EXISTS public.fn_lead_contacts_guard();

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_name_not_blank;

DROP INDEX IF EXISTS public.idx_contacts_org_normalized_phone;
CREATE UNIQUE INDEX idx_contacts_org_phone_unique
  ON public.contacts (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL;

-- Policies de prod (pg_policies, 19/10)
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT TO public
  USING (
    organization_id = (SELECT public.get_user_organization_id())
    AND deleted_at IS NULL
  );
CREATE POLICY contacts_insert ON public.contacts
  FOR INSERT TO public
  WITH CHECK (organization_id = (SELECT public.get_user_organization_id()));
CREATE POLICY contacts_update ON public.contacts
  FOR UPDATE TO public
  USING (organization_id = (SELECT public.get_user_organization_id()));
CREATE POLICY contacts_delete ON public.contacts
  FOR DELETE TO public
  USING (organization_id = (SELECT public.get_user_organization_id()));

-- ACL de prod: anon=rxtm, authenticated=arwdDxtm
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.contacts TO anon;
GRANT ALL ON public.contacts TO authenticated;

GRANT EXECUTE ON FUNCTION public.migrate_leads_to_contacts_companies(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
