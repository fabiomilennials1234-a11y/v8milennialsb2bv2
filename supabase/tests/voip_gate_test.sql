BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

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

SELECT * FROM finish();
ROLLBACK;
