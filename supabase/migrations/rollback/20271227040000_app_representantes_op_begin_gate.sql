-- Rollback de 20271227040000_app_representantes_op_begin_gate.sql: volta mobile_op_begin ao corpo de
-- 20271227010000 (ator por variável). Sem efeito em dados. GRANTs preservados pelo CREATE OR REPLACE.
BEGIN;
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
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_op_id IS NULL OR p_kind IS NULL OR p_hash IS NULL THEN
    RAISE EXCEPTION 'operação sem identificação' USING ERRCODE = 'PT422';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_op:' || v_actor || ':' || p_op_id::text, 0));

  SELECT l.kind, l.request_hash, l.entity_id INTO v_row
    FROM public.mobile_op_log l
   WHERE l.actor = v_actor AND l.op_id = p_op_id;

  IF FOUND THEN
    IF v_row.kind IS DISTINCT FROM p_kind OR v_row.request_hash IS DISTINCT FROM p_hash THEN
      RAISE EXCEPTION 'op_id reutilizado com outro conteúdo' USING ERRCODE = 'PT409';
    END IF;
    IF v_row.entity_id IS NULL THEN
      RAISE EXCEPTION 'operação reservada sem resultado' USING ERRCODE = 'XX000';
    END IF;
    RETURN QUERY SELECT false, v_row.entity_id;
    RETURN;
  END IF;

  INSERT INTO public.mobile_op_log (actor, op_id, entity_id, kind, request_hash)
  VALUES (v_actor, p_op_id, NULL, p_kind, p_hash);
  RETURN QUERY SELECT true, NULL::uuid;
END;
$fn$;
COMMIT;
