-- Authorized production initialization; idempotent. Run per organization.
-- No business records are changed; only the server-owned derived relation.
UPDATE public.leads l SET relacao_negocios=public.relacao_negocios(l)
WHERE l.organization_id=:'organization_id'::uuid
  AND l.relacao_negocios IS DISTINCT FROM public.relacao_negocios(l);
