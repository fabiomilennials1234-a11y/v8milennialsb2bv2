-- Plan gating (cadeado + upgrade) — backfill de feature_flags e planos.
--
-- Contexto: o frontend passou a aplicar lock de plano à org inteira (admin
-- incluso; só master bypassa) e a guardar rotas por feature key. A RPC
-- org_get_features_and_limits resolve key ausente do JSONB do plano via
-- feature_flags.default_enabled; key sem row resolve para false (deny).
--
-- Sem este backfill:
--   1. Orgs em planos legados (free/basic/starter/pro/enterprise ou
--      subscription_plan NULL) perderiam Automações, Carteira, Oráculo e
--      Mensagens Agendadas — features que nunca foram gated para elas.
--   2. Comissões e TV Dashboard (default_enabled=false e ausentes dos JSONBs
--      torque) passariam a lockear para TODA org, admins inclusos — antes o
--      bypass de admin mascarava esses defaults.
--   3. Em ambiente fresco (CI/dev) o branch master da RPC, que monta o mapa a
--      partir de feature_flags, não teria as keys novas.
--
-- Planos torque-* têm valores EXPLÍCITOS no JSONB para as keys de gating
-- (automations/carteira/oraculo/etc.), então estes defaults não os afetam.
-- message_templates permanece default false (decisão do plano: só 2.0/v8).

-- 1) Seed idempotente + default_enabled=true para keys que nunca foram gated.
INSERT INTO public.feature_flags (key, name, description, category, default_enabled)
VALUES
  ('automations',        'Automações',          'Workflows de automação com triggers, condições e ações', 'modules',  true),
  ('carteira',           'Carteira',            'Gestão de carteira de clientes e upsell',                 'modules',  true),
  ('oraculo',            'Oráculo',             'Inteligência comercial por IA sobre conversas e pipeline','advanced', true),
  ('scheduled_messages', 'Mensagens Agendadas', 'Agendamento de mensagens no chat',                        'advanced', true)
ON CONFLICT (key) DO UPDATE SET default_enabled = EXCLUDED.default_enabled;

-- 2) Comissões e TV Dashboard: liberar por default. Controle por papel
--    continua na camada de feature permissions (commissions.view etc.).
UPDATE public.feature_flags
SET default_enabled = true
WHERE key IN ('commissions', 'tv_dashboard');

-- 3) Explicitar nos planos torque (belt-and-suspenders — sobrevive a flip
--    futuro dos defaults).
UPDATE public.subscription_plans
SET features = features || '{"commissions": true, "tv_dashboard": true}'::jsonb,
    updated_at = now()
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');
