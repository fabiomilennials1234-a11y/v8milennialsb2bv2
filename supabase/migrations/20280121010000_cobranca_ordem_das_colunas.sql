-- 20280121010000_cobranca_ordem_das_colunas.sql
--
-- Cobrança · reordenar colunas do Fluxo pela tela.
-- ROLLBACK pareado: rollback/20280121010000_cobranca_ordem_das_colunas.sql
--
-- A ordem do quadro é regida por private.cobranca_etapas_reordenar: entrada ·
-- colunas de dias (por trilha e dias — o motor só anda "para a frente") ·
-- colunas pausadas sem dias · pausadas com dias (Jurídico) · desfechos. Só o
-- terceiro grupo — a "zona livre": papel 'aberta', sem dias, que pausa a régua
-- (Em negociação, Promessa, colunas manuais) — tem ordem de escolha da equipe.
--
-- cobranca_coluna_mover_ordem(etapa, para): leva a coluna à posição `para`
-- (1 = primeira da zona livre) dentro da zona livre. Fora dela recusa: a ordem
-- das colunas de dias, da entrada e dos desfechos é automática.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION private.cobranca_coluna_mover_ordem(p_org uuid, p_etapa uuid, p_para integer)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ids   uuid[];
  v_novo  uuid[];
  v_para  integer;
BEGIN
  -- Duas pessoas reordenando ao mesmo tempo não se pisam.
  PERFORM pg_advisory_xact_lock(hashtextextended('cobranca_ordem:' || p_org::text, 0));

  SELECT array_agg(e.id ORDER BY e.posicao) INTO v_ids
    FROM public.cobranca_etapas e
   WHERE e.organization_id = p_org AND e.papel = 'aberta' AND e.entrada_dias IS NULL AND e.pausa_regua;

  IF v_ids IS NULL OR NOT (p_etapa = ANY (v_ids)) THEN
    RAISE EXCEPTION 'Essa coluna acompanha os dias de atraso e não muda de lugar.'
      USING ERRCODE = 'PT422', DETAIL = 'coluna_fixa';
  END IF;

  v_para := GREATEST(1, LEAST(COALESCE(p_para, 1), array_length(v_ids, 1)));
  v_novo := array_remove(v_ids, p_etapa);
  v_novo := v_novo[1:v_para - 1] || ARRAY[p_etapa] || v_novo[v_para:array_length(v_novo, 1)];

  -- Posições provisórias fora de qualquer faixa em uso (30000+dias, 40000+n); o
  -- reordenar renumera tudo de 1..N respeitando esta ordem.
  UPDATE public.cobranca_etapas e
     SET posicao = 60000 + t.ord
    FROM unnest(v_novo) WITH ORDINALITY AS t(id, ord)
   WHERE e.id = t.id;

  PERFORM private.cobranca_etapas_reordenar(p_org);
END
$fn$;

REVOKE ALL ON FUNCTION private.cobranca_coluna_mover_ordem(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_coluna_mover_ordem(uuid, uuid, integer) TO service_role;

CREATE FUNCTION public.cobranca_coluna_mover_ordem(p_etapa uuid, p_para integer)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_etapas WHERE id = p_etapa;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Coluna não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'coluna_inexistente';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');
  PERFORM private.cobranca_coluna_mover_ordem(v_org, p_etapa, p_para);
END
$fn$;

REVOKE ALL ON FUNCTION public.cobranca_coluna_mover_ordem(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_coluna_mover_ordem(uuid, integer) TO authenticated, service_role;

COMMIT;
