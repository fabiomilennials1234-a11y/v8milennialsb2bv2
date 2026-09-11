-- Minimal caller-RLS catalogue with authoritative master exclusion.
BEGIN;
CREATE VIEW public.guided_responsible_members
WITH (security_invoker = true, security_barrier = true) AS
SELECT m.id, m.organization_id, m.name, m.is_active
FROM public.org_visible_members m
WHERE NOT public.is_master_user(m.user_id);
REVOKE ALL ON TABLE public.guided_responsible_members FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guided_responsible_members TO authenticated;
COMMENT ON VIEW public.guided_responsible_members IS 'Responsible selector catalogue. Inactive real members remain valid historical references. Caller RLS and authoritative master exclusion apply.';
NOTIFY pgrst, 'reload schema';
COMMIT;
