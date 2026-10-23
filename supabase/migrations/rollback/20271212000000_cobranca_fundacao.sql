-- ROLLBACK de 20271212000000_cobranca_fundacao.sql
--
-- 🔴 DESTRUTIVO: apaga todos os dados da cobrança (inadimplentes, títulos,
-- casos, compromissos, pagamentos e histórico). Antes de rodar em prod,
-- exporte as tabelas cobranca_* se houver uso real.

BEGIN;

UPDATE public.organizations
   SET feature_flags = feature_flags - 'cobranca'
 WHERE feature_flags ? 'cobranca';

DELETE FROM public.member_feature_permissions WHERE feature_key IN ('cobranca.view', 'cobranca.edit');
DELETE FROM public.organization_feature_defaults WHERE feature_key IN ('cobranca.view', 'cobranca.edit');
DELETE FROM public.feature_permissions WHERE key IN ('cobranca.view', 'cobranca.edit');

DROP FUNCTION IF EXISTS public.cobranca_metricas(uuid, date);
DROP FUNCTION IF EXISTS public.cobranca_inadimplente_arquivar(uuid, text);
DROP FUNCTION IF EXISTS public.cobranca_nao_contatar(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.cobranca_contato_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.cobranca_pagamento_registrar(uuid, numeric, date, uuid);
DROP FUNCTION IF EXISTS public.cobranca_compromisso_encerrar(uuid, text);
DROP FUNCTION IF EXISTS public.cobranca_compromisso_registrar(uuid, text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.cobranca_casos_atribuir(uuid, uuid[], uuid);
DROP FUNCTION IF EXISTS public.cobranca_caso_mover(uuid, uuid, double precision);
DROP FUNCTION IF EXISTS public.cobranca_importar(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.cobranca_titulo_cancelar(uuid, text);
DROP FUNCTION IF EXISTS public.cobranca_inadimplente_salvar(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.cobranca_titulo_incluir(uuid, jsonb);
DROP FUNCTION IF EXISTS public.cobranca_etapas_garantir(uuid);

DROP VIEW IF EXISTS public.cobranca_inadimplentes_resumo;
DROP VIEW IF EXISTS public.cobranca_titulos_saldo;

DROP TABLE IF EXISTS public.cobranca_eventos;
DROP TABLE IF EXISTS public.cobranca_pagamentos;
DROP TABLE IF EXISTS public.cobranca_compromisso_parcelas;
DROP TABLE IF EXISTS public.cobranca_compromissos;
DROP TABLE IF EXISTS public.cobranca_casos;
DROP TABLE IF EXISTS public.cobranca_titulos;
DROP TABLE IF EXISTS public.cobranca_inadimplentes;
DROP TABLE IF EXISTS public.cobranca_etapas;

DROP FUNCTION IF EXISTS private.cobranca_so_digitos(text);
DROP FUNCTION IF EXISTS private.cobranca_encerrar_caso(uuid, text);
DROP FUNCTION IF EXISTS private.cobranca_garantir_caso(uuid, uuid);
DROP FUNCTION IF EXISTS private.cobranca_evento(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS private.cobranca_semear_etapas(uuid);
DROP FUNCTION IF EXISTS private.cobranca_exigir(uuid, text);
DROP FUNCTION IF EXISTS private.cobranca_orgs_visiveis();
DROP FUNCTION IF EXISTS private.cobranca_habilitada(uuid);

COMMIT;
