-- Fecha EXECUTE de anon/authenticated em import_lead_into_custom_pipeline.
--
-- A migration 20270729000000 fez `REVOKE ALL ... FROM PUBLIC` achando que isso
-- bastava. Não bastou: neste projeto, `ALTER DEFAULT PRIVILEGES` concede EXECUTE
-- a `anon` e `authenticated` EXPLICITAMENTE em toda função nova do schema
-- public. Revogar de PUBLIC remove só o grant implícito — os explícitos
-- sobrevivem intactos.
--
-- Verificado em prod logo após o apply: `has_function_privilege('anon', …)`
-- devolvia `true` para uma função SECURITY DEFINER que insere em `leads`.
--
-- A regra completa, então, é: para função nova, revogar de PUBLIC **e** de anon
-- **e** de authenticated, e depois CONFERIR com `has_function_privilege`. O
-- REVOKE FROM PUBLIC sozinho é insuficiente aqui, do mesmo jeito que o REVOKE
-- FROM anon sozinho é insuficiente em funções que só têm o grant via PUBLIC.
REVOKE EXECUTE ON FUNCTION public.import_lead_into_custom_pipeline(uuid, jsonb, uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.import_lead_into_custom_pipeline(uuid, jsonb, uuid, uuid, uuid) FROM authenticated;
