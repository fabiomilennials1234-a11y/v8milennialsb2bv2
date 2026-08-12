-- ============================================================================
-- SCRUM-172 (`inv:H8-30`) — QA de RLS com admin, membro e master, em duas orgs.
--
-- Branch efêmera SOMENTE. Cria dado de teste; nunca rodar em produção.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A migration 20270730000010_deals_rls_org_scope traz uma verificação
-- ESTRUTURAL: conta policies e confere que cada uma cita
-- `get_my_organization_ids()` e `is_master_user()`. Isso prova que o texto da
-- policy está lá — não prova que ela isola. Isolamento é comportamento, e
-- comportamento precisa de duas organizações e de três sessões diferentes.
--
-- Os três papéis não são decoração: a correção de RLS desta migration é
-- exatamente sobre master (que atravessa org) e multi-org (o admin que
-- pertence a duas). Testar só com um usuário provaria o caso que nunca falha.
--
-- OS USUÁRIOS já existem, criados pela Auth Admin API:
--   admin  dee05255-199b-4cfb-bda3-89035f8473a5  → orgs A e B (multi-org)
--   membro a989b6b7-87f3-4c92-b0dc-1dd1349980a3  → org A apenas
--   master 24b706b1-da09-4192-836e-81eed0105806  → nenhuma org, mas master
-- ============================================================================

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Fixture: duas organizações ────────────────────────────────────────────
-- `limit_overrides.max_users` porque `subscription_plans` nasce VAZIA na branch
-- (o dump traz schema, não linhas) e `org_resolve_quota` cai no degrau 3c. Sem
-- isto, `enforce_seat_limit` recusa o primeiro membro ativo com
-- "Seats pagos: 0" — e membro inativo não serve, porque
-- `get_my_organization_ids()` filtra `is_active = true`.
INSERT INTO public.organizations (id, name, slug, subscription_plan, limit_overrides)
VALUES ('aaaa0000-0000-0000-0000-00000000000a', 'QA Org A', 'qa-org-a', 'torque-v8', '{"max_users": 10}'::jsonb),
       ('bbbb0000-0000-0000-0000-00000000000b', 'QA Org B', 'qa-org-b', 'torque-v8', '{"max_users": 10}'::jsonb)
ON CONFLICT (id) DO UPDATE SET limit_overrides = EXCLUDED.limit_overrides;

-- ── Vínculos ──────────────────────────────────────────────────────────────
-- `member` e não `membro`: o enum real é (admin, sdr, closer, agency, bdr,
-- cliente, member). A CLAUDE.md diz "admin/master/membro" e erra em dois dos
-- três — o m6-teste.sql já tinha tropeçado nisso.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('11110000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'dee05255-199b-4cfb-bda3-89035f8473a5', 'QA Admin (A)',  'admin',  true),
  ('11110000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-00000000000b', 'dee05255-199b-4cfb-bda3-89035f8473a5', 'QA Admin (B)',  'admin',  true),
  ('11110000-0000-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-00000000000a', 'a989b6b7-87f3-4c92-b0dc-1dd1349980a3', 'QA Membro (A)', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('24b706b1-da09-4192-836e-81eed0105806', true)
ON CONFLICT (user_id) DO NOTHING;

-- ── Leads e Negócios, um par por org ──────────────────────────────────────
INSERT INTO public.leads (id, organization_id, name, origin) VALUES
  ('1eaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a', 'Lead da Org A', 'outro'),
  ('1ebb0000-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-00000000000b', 'Lead da Org B', 'outro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deals (id, organization_id, source_lead_id, title) VALUES
  ('dea10000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a', '1eaa0000-0000-0000-0000-00000000000a', 'Negócio da Org A'),
  ('dea10000-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-00000000000b', '1ebb0000-0000-0000-0000-00000000000b', 'Negócio da Org B')
ON CONFLICT (id) DO NOTHING;

-- Um negócio na lixeira, para provar a guarda de soft-delete do USING.
INSERT INTO public.deals (id, organization_id, source_lead_id, title, deleted_at) VALUES
  ('dea1dead-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a', '1eaa0000-0000-0000-0000-00000000000a', 'Negócio apagado da Org A', now())
ON CONFLICT (id) DO NOTHING;

SELECT 'fixture pronta' AS etapa,
       (SELECT count(*) FROM public.deals WHERE organization_id IN
          ('aaaa0000-0000-0000-0000-00000000000a','bbbb0000-0000-0000-0000-00000000000b')) AS deals_criados;
