-- ════════════════════════════════════════════════════════════════════════════
-- Recorte strict_lead_owner_access em plpgsql — o custo por LINHA das views
-- private.* cai de ~20–35 ms para ~1–3 ms
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA: em orgs com `strict_lead_owner_access` (JR Tex, Melhoramentos
-- Higiene) toda leitura pelas views private.* (whatsapp_messages,
-- whatsapp_conversation_summary, whatsapp_conversations, channel_messages…)
-- avalia `private.strict_phone_visible` / `private.strict_channel_visible` POR
-- LINHA. Medido em prod em 16/11/2026, membro da JR Tex, como `authenticated`
-- com claims, em transação com ROLLBACK:
--   get_conversations_awaiting_human_reply_multi ....... 9,1 s
--   strict_phone_visible(org, NULL, telefone), 300× .... 10,5 s  (35 ms/chamada)
--   strict_phone_visible(org, lead, NULL), 300× ........  6,2 s  (20 ms/chamada)
--   strict_lead_is_owned(org, lead) chamado DIRETO ......  0,6 ms/chamada
--
-- CAUSA (PostgreSQL 17.6): uma função `LANGUAGE sql` não-inlinável (toda
-- SECURITY DEFINER é) guarda o PLANO das próprias consultas, mas recria o
-- estado do executor a cada chamada. Uma função SQL chamada DE DENTRO dela
-- nasce com cache vazio a cada chamada externa e tem o corpo REPLANEJADO toda
-- vez. A cadeia strict_phone_visible → strict_lead_is_owned →
-- jrtex/riofix…, e strict_lead_member_orgs, replaneja corpos grandes por linha:
-- strict_lead_is_owned custa 0,6 ms chamado no topo e ~30 ms aninhado.
-- Medido isolando: o mesmo EXISTS sem a chamada aninhada custa 0,12 ms.
--
-- CORREÇÃO: as quatro funções passam a `LANGUAGE plpgsql`. plpgsql guarda os
-- planos das suas consultas no cache da SESSÃO (SPI), então a chamada
-- aninhada deixa de replanejar. Medido (protótipo, mesmo método):
--   strict_lead_is_owned aninhado ....................... 0,5 ms/chamada
--   strict_phone_visible ................................ ~3 ms → ver a medição
--                                                         final no PR.
--
-- SEMÂNTICA IDÊNTICA POR CONSTRUÇÃO: o corpo novo NÃO é reescrito à mão. O
-- bloco abaixo lê o `prosrc` VIVO de cada função, confere o md5 contra o corpo
-- lido e revisado em 16/11/2026 e gera
--     BEGIN RETURN (<o SELECT original, byte a byte>); END
-- Cada corpo original é um SELECT de exatamente UMA linha (sem FROM no nível
-- de fora, ou `SELECT ARRAY(...)`), então `RETURN (subconsulta escalar)`
-- devolve o mesmo valor, inclusive NULL. STABLE + SECURITY DEFINER +
-- `SET search_path TO ''` + dono + ACL ficam: CREATE OR REPLACE com a mesma
-- assinatura e o mesmo retorno preserva a ACL e as 270 dependências
-- (políticas e views que chamam essas funções por OID).
--
-- FALHA FECHADA: se o corpo vivo de qualquer uma das quatro divergir do md5
-- revisado (alguém mudou a função fora do ledger), o apply ABORTA — nunca
-- embrulha um corpo que ninguém revisou. Se as funções não existem (banco
-- montado só do repo: o recorte strict foi aplicado fora do ledger), nada
-- acontece.
--
-- Só schema: CREATE OR REPLACE FUNCTION via EXECUTE. Nenhum DML.
-- Rollback: supabase/migrations/rollback/20280119000000_recorte_strict_em_plpgsql.sql
-- NÃO APLICADA em nenhum banco remoto por esta entrega.

DO $plpgsql$
DECLARE
  -- assinatura → md5(prosrc) do corpo SQL vivo revisado em 16/11/2026.
  v_alvos constant text[][] := ARRAY[
    ARRAY['private.strict_lead_member_orgs()',                       '422ec5d40d1a0574efd6f2786e1a118e'],
    ARRAY['private.strict_lead_is_owned(uuid,uuid)',                 'cd65d7ad967b5ace6704eb948ada4cd3'],
    ARRAY['private.strict_phone_visible(uuid,uuid,text)',            '042c6dcd662f6e188868d0f62c031d35'],
    ARRAY['private.strict_channel_visible(uuid,uuid,text,text,text)','bb9688439b7d01049b7adfc4e95faee5']
  ];
  v_i       integer;
  v_oid     oid;
  v_src     text;
  v_lang    text;
  v_def     text;
  v_novo    text;
  v_ausente integer := 0;
BEGIN
  FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
    v_oid := to_regprocedure(v_alvos[v_i][1]);
    IF v_oid IS NULL THEN
      v_ausente := v_ausente + 1;
      CONTINUE;
    END IF;

    SELECT p.prosrc, l.lanname INTO v_src, v_lang
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;

    IF v_lang = 'plpgsql' THEN
      -- Reaplicação: já convertida; confere que é a forma gerada por aqui.
      IF left(v_src, 14) <> 'BEGIN RETURN (' OR right(v_src, 6) <> '); END' THEN
        RAISE EXCEPTION '% já é plpgsql, mas não na forma gerada por esta migration — abortado', v_alvos[v_i][1];
      END IF;
      CONTINUE;
    END IF;

    IF v_lang <> 'sql' OR md5(v_src) <> v_alvos[v_i][2] THEN
      RAISE EXCEPTION '% divergiu do corpo revisado (linguagem %, md5 % ≠ %) — abortado para não embrulhar corpo não revisado',
        v_alvos[v_i][1], v_lang, md5(v_src), v_alvos[v_i][2];
    END IF;

    -- Cabeçalho completo da função viva (assinatura, RETURNS, STABLE, SECURITY
    -- DEFINER, SET search_path), trocando só a linguagem e o corpo.
    v_def  := pg_get_functiondef(v_oid);
    v_novo := 'BEGIN RETURN (' || v_src || '); END';
    IF position(' LANGUAGE sql' IN v_def) = 0 THEN
      RAISE EXCEPTION '% sem " LANGUAGE sql" no cabeçalho — abortado', v_alvos[v_i][1];
    END IF;
    v_def := replace(left(v_def, position('AS $function$' IN v_def) - 1), ' LANGUAGE sql', ' LANGUAGE plpgsql')
          || 'AS ' || quote_literal(v_novo);
    EXECUTE v_def;

    -- Confere: mesma assinatura, plpgsql, corpo = original embrulhado.
    SELECT p.prosrc, l.lanname INTO v_src, v_lang
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid;
    IF v_lang <> 'plpgsql' OR v_src <> v_novo THEN
      RAISE EXCEPTION '% não ficou na forma esperada depois da troca', v_alvos[v_i][1];
    END IF;
  END LOOP;

  -- Ou as quatro existem (prod) ou nenhuma (repo). Parcial = forma divergente.
  IF v_ausente NOT IN (0, array_length(v_alvos, 1)) THEN
    RAISE EXCEPTION 'recorte strict parcial: % de % funções ausentes — abortado', v_ausente, array_length(v_alvos, 1);
  END IF;
END
$plpgsql$;
