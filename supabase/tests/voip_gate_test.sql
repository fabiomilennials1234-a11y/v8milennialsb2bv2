BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

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

SELECT * FROM finish();
ROLLBACK;
