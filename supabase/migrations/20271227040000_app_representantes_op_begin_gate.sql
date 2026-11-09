-- App Representantes — portão de mobile_op_begin legível pelo INV-6.
--
-- 20271227010000 criou mobile_op_begin com o ator em variável (v_actor := auth.uid()) e checou
-- `v_actor IS NULL`. O comportamento já era restrito ao próprio ator, mas o detector INV-6
-- (supabase/tests/_rls_invariants_detectors.sql) só reconhece auth.uid() onde ele DECIDE
-- (IF/WHERE/AND/EXISTS/RAISE), e a orientação do detector é passar auth.uid() direto no ponto de
-- decisão em vez de por variável. Mesmo molde de mobile_op_finish.
--
-- Migration nova (e não edição da 20271227010000): ainda não foi confirmado no ledger de prod que
-- a 20271227010000 não foi aplicada; CREATE OR REPLACE é correto nos dois estados e preserva os
-- GRANTs existentes (REVOKE de PUBLIC/anon/service_role, EXECUTE só para authenticated).
-- Comportamento inalterado: mesma assinatura, mesmo retorno, mesmos erros.

CREATE OR REPLACE FUNCTION public.mobile_op_begin(p_op_id uuid, p_kind text, p_hash text)
RETURNS TABLE (is_new boolean, entity_id uuid)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor text := auth.uid()::text;
  v_row   record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_op_id IS NULL OR p_kind IS NULL OR p_hash IS NULL THEN
    RAISE EXCEPTION 'operação sem identificação' USING ERRCODE = 'PT422';
  END IF;

  -- Serializa as chamadas com a mesma chave, inclusive quando a linha ainda não existe: a segunda espera a primeira
  -- confirmar e então enxerga a linha (READ COMMITTED lê o que foi confirmado entre os dois comandos).
  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_op:' || v_actor || ':' || p_op_id::text, 0));

  SELECT l.kind, l.request_hash, l.entity_id INTO v_row
    FROM public.mobile_op_log l
   WHERE l.actor = auth.uid()::text AND l.op_id = p_op_id;

  IF FOUND THEN
    IF v_row.kind IS DISTINCT FROM p_kind OR v_row.request_hash IS DISTINCT FROM p_hash THEN
      RAISE EXCEPTION 'op_id reutilizado com outro conteúdo' USING ERRCODE = 'PT409';
    END IF;
    IF v_row.entity_id IS NULL THEN
      RAISE EXCEPTION 'operação reservada sem resultado' USING ERRCODE = 'XX000';  -- não deve existir após o commit
    END IF;
    RETURN QUERY SELECT false, v_row.entity_id;
    RETURN;
  END IF;

  INSERT INTO public.mobile_op_log (actor, op_id, entity_id, kind, request_hash)
  VALUES (v_actor, p_op_id, NULL, p_kind, p_hash);
  RETURN QUERY SELECT true, NULL::uuid;
END;
$fn$;
