-- Rollback de 20280118000000_recorte_strict_em_plpgsql.sql
--
-- Desembrulha as quatro funções: `BEGIN RETURN (<SELECT original>); END` volta
-- a ser `LANGUAGE sql` com o SELECT original, byte a byte, e confere o md5
-- contra o corpo revisado em 16/11/2026. Função já em `sql` com o md5 certo =
-- nada a fazer. Qualquer outra forma = abortado (não reescreve corpo que não
-- foi gerado pela migration). Sem as funções (banco montado só do repo):
-- nada acontece.

DO $desembrulha$
DECLARE
  v_alvos constant text[][] := ARRAY[
    ARRAY['private.strict_lead_member_orgs()',                       '422ec5d40d1a0574efd6f2786e1a118e'],
    ARRAY['private.strict_lead_is_owned(uuid,uuid)',                 'd6e9b67bd2be794aa0cf130d515e5a1f'],
    ARRAY['private.strict_phone_visible(uuid,uuid,text)',            '6c5792c8e7cc8cbb6b6a7019a3cb6be1'],
    ARRAY['private.strict_channel_visible(uuid,uuid,text,text,text)','bb9688439b7d01049b7adfc4e95faee5']
  ];
  v_i    integer;
  v_oid  oid;
  v_src  text;
  v_lang text;
  v_orig text;
  v_def  text;
BEGIN
  FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
    v_oid := to_regprocedure(v_alvos[v_i][1]);
    CONTINUE WHEN v_oid IS NULL;

    SELECT p.prosrc, l.lanname INTO v_src, v_lang
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;

    IF v_lang = 'sql' AND md5(v_src) = v_alvos[v_i][2] THEN
      CONTINUE;
    END IF;
    IF v_lang <> 'plpgsql' OR left(v_src, 14) <> 'BEGIN RETURN (' OR right(v_src, 6) <> '); END' THEN
      RAISE EXCEPTION '% não está na forma gerada por 20280118000000 — abortado', v_alvos[v_i][1];
    END IF;

    v_orig := substr(v_src, 15, length(v_src) - 20);
    IF md5(v_orig) <> v_alvos[v_i][2] THEN
      RAISE EXCEPTION '% desembrulhada não bate com o corpo revisado (md5 % ≠ %) — abortado',
        v_alvos[v_i][1], md5(v_orig), v_alvos[v_i][2];
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_def := replace(left(v_def, position('AS $function$' IN v_def) - 1), ' LANGUAGE plpgsql', ' LANGUAGE sql')
          || 'AS ' || quote_literal(v_orig);
    EXECUTE v_def;
  END LOOP;
END
$desembrulha$;
