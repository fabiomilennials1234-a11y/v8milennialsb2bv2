-- ============================================================================
-- SCRUM-55 — fixture para as três provas que faltavam no banco.
--
-- Branch efêmera SOMENTE.
--
--   `inv:H3-05` — o auto-seed respeita `deal_manual_only` POR ORG
--   `inv:H3-18` — `scripts/m6-limpeza-cross-org.sql` limpa e faz backup
--   `inv:H3-16` — o rollback de `20270730000020_leads_claim` roda
--
-- Duas orgs: A com a flag DESLIGADA (comportamento histórico) e B com a flag
-- LIGADA. Provar a flag exige as duas na mesma execução — uma org só provaria
-- que o código roda, não que ele decide por organização.
-- ============================================================================

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

INSERT INTO public.organizations (id, name, slug, subscription_plan, limit_overrides, feature_flags)
VALUES
  ('55a00000-0000-0000-0000-0000000000aa', 'QA Flag OFF', 'qa-flag-off', 'torque-v8',
   '{"max_users": 10}'::jsonb, '{}'::jsonb),
  ('55b00000-0000-0000-0000-0000000000bb', 'QA Flag ON',  'qa-flag-on',  'torque-v8',
   '{"max_users": 10}'::jsonb, '{"deal_manual_only": true}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET feature_flags = EXCLUDED.feature_flags,
      limit_overrides = EXCLUDED.limit_overrides;

-- Os funis do sistema das duas orgs: o gatilho de auto-seed precisa de destino.
SELECT public.create_default_pipeline_stages('55a00000-0000-0000-0000-0000000000aa');
SELECT public.create_default_pipeline_stages('55b00000-0000-0000-0000-0000000000bb');

INSERT INTO public.pipelines (organization_id, name, slug, type, is_active)
VALUES ('55a00000-0000-0000-0000-0000000000aa', 'Qualificação', 'whatsapp', 'system', true),
       ('55b00000-0000-0000-0000-0000000000bb', 'Qualificação', 'whatsapp', 'system', true)
ON CONFLICT DO NOTHING;

-- ── Membros: um em cada org. O de A é quem vai virar responsável CROSS-ORG
--    de um lead de B, que é a sujeira que a limpeza do M6 tem que achar.
INSERT INTO public.team_members (id, organization_id, name, role, is_active) VALUES
  ('55111111-0000-0000-0000-0000000000aa', '55a00000-0000-0000-0000-0000000000aa', 'Membro da A', 'member', true),
  ('55222222-0000-0000-0000-0000000000bb', '55b00000-0000-0000-0000-0000000000bb', 'Membro da B', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- ── Lead limpo na mesma org: a limpeza NÃO pode tocar nele. Sem este caso, um
--    script que zerasse a coluna inteira passaria no teste.
INSERT INTO public.leads (id, organization_id, name, origin, responsible_id)
VALUES ('55cc0000-0000-0000-0000-0000000000bb', '55b00000-0000-0000-0000-0000000000bb',
        'Lead limpo da B', 'outro', '55222222-0000-0000-0000-0000000000bb')
ON CONFLICT (id) DO NOTHING;

SELECT 'fixture pronta' AS etapa;
