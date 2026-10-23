-- rollback/20271201000200_leads_org_br_mobile_idx.sql
-- Remove o índice. Nenhuma função depende dele: o passe 2 de
-- resolve_message_lead_id volta ao filtro por linha (comportamento idêntico,
-- só mais lento). CONCURRENTLY: psql autocommit, pooler session 5432.

DROP INDEX CONCURRENTLY IF EXISTS public.leads_org_br_mobile_idx;
