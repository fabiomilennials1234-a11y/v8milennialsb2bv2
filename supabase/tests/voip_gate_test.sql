BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

SELECT has_column('public', 'organizations', 'voice_sessions_cap',
  'organizations tem a coluna do teto de números de voz');

SELECT col_not_null('public', 'organizations', 'voice_sessions_cap',
  'o teto nunca é nulo — ausência de teto se escreve com 0, não com NULL');

SELECT col_default_is('public', 'organizations', 'voice_sessions_cap', '10',
  'o padrão é 10, que cobre 55 das 56 organizações');

SELECT is(
  (SELECT count(*)::int FROM public.subscription_plans
    WHERE NOT (features ? 'voice_calls')),
  0,
  'todo plano declara voice_calls — chave ausente vira false silencioso'
);

-- O CHECK é o mecanismo por trás da semântica "0 = organização sem direito a
-- número de voz". As duas asserções abaixo travam as duas pontas: negativo
-- não entra, zero entra. Sem elas, trocar o CHECK por `> 0` (o padrão que
-- daily_call_cap usa, mas que aqui apagaria zero) passaria em silêncio.
SELECT throws_ok(
  $$UPDATE public.organizations SET voice_sessions_cap = -1
      WHERE id = (SELECT id FROM public.organizations LIMIT 1)$$,
  23514,
  NULL,
  'o CHECK rejeita voice_sessions_cap negativo'
);

SELECT lives_ok(
  $$UPDATE public.organizations SET voice_sessions_cap = 0
      WHERE id = (SELECT id FROM public.organizations LIMIT 1)$$,
  'o CHECK aceita voice_sessions_cap = 0 — organização sem número de voz, não erro'
);

-- ─── A feature tem que existir no CATÁLOGO, não só nos planos ────────────────
--
-- `20270730000004` semeia `subscription_plans.features`, e só. Isso liga a voz
-- para um PLANO INTEIRO — nunca para uma organização só.
--
-- Quem concede por organização é `organization_features`, e ela tem FK para
-- `feature_flags(key)`: sem a linha no catálogo, o INSERT do piloto viola a FK,
-- e a tela do Master (`BillingOverrideModal`, que enumera `feature_flags`) nem
-- oferece a opção. Sem isto o CTO não consegue ligar a voz na organização
-- piloto sem ligar para todo mundo do mesmo plano.

SELECT is(
  (SELECT count(*)::int FROM public.feature_flags WHERE key = 'voice_calls'),
  1,
  'voice_calls existe no catálogo de feature_flags — é o que a FK de organization_features exige e o que a tela do Master enumera'
);

SELECT is(
  (SELECT default_enabled FROM public.feature_flags WHERE key = 'voice_calls'),
  false,
  'a feature nasce desligada para todas as organizações'
);

-- `requires_plan` não-vazio faria a voz ser concedida por plano pelas telas que
-- leem essa coluna — o oposto de "liga só na piloto".
SELECT is(
  (SELECT COALESCE(array_length(requires_plan, 1), 0) FROM public.feature_flags WHERE key = 'voice_calls'),
  0,
  'a voz não é concedida por plano: quem concede é o override por organização'
);

-- A linha do catálogo não é enfeite: é ela que faz a chave MATERIALIZAR como
-- `false` explícito na RPC que o gate do servidor lê (`org_get_features_and_limits`
-- preenche as ausentes com `default_enabled`). Sem a linha, a chave some do
-- JSON e o teste de ponta a ponta abaixo não teria como distinguir
-- "desligada" de "não existe".
SELECT is(
  public.org_get_features_and_limits(
    (SELECT id FROM public.organizations ORDER BY id LIMIT 1)
  ) -> 'features' ->> 'voice_calls',
  'false',
  'organização sem override lê voice_calls = false na RPC do gate'
);

-- Este é o INSERT que hoje estoura na FK, e é literalmente o gesto do piloto.
SELECT lives_ok(
  $$INSERT INTO public.organization_features (organization_id, feature_key, enabled, override_reason)
    VALUES (
      (SELECT id FROM public.organizations ORDER BY id LIMIT 1),
      'voice_calls',
      true,
      'piloto de voz'
    )$$,
  'dá para conceder voice_calls a UMA organização via organization_features'
);

-- E a concessão tem que CHEGAR no gate do servidor, que lê esta RPC — não
-- basta a linha existir. `org_get_features_and_limits` aplica os overrides de
-- `organization_features` por cima das features do plano.
SELECT is(
  public.org_get_features_and_limits(
    (SELECT id FROM public.organizations ORDER BY id LIMIT 1)
  ) -> 'features' ->> 'voice_calls',
  'true',
  'o override por organização chega ao gate do servidor, e não só à tela'
);

SELECT * FROM finish();
ROLLBACK;
