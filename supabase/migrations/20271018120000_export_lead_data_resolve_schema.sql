-- The captured definition treated "public, extensions" as ONE schema name.
-- Authenticated admin export failed at its first unqualified relation access.
-- ALTER preserves the existing body, ownership, tenant authorization and ACL.
ALTER FUNCTION public.export_lead_data(uuid)
  SET search_path TO public, extensions, pg_temp;
