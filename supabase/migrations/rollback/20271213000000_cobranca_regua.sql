-- Rollback de 20271213000000_cobranca_regua.sql
--
-- ORDEM: volte ANTES as edge functions que leem whatsapp_instances.reserved_for
-- (whatsapp-webhook, agent-message, cobranca-regua e quem usa
-- _shared/whatsapp-dispatch.ts). Sem a coluna, o PostgREST recusa o filtro
-- `reserved_for=is.null` e o fallback de instância para de achar número.
--
-- PERDE DADO, de propósito e só o da régua: configuração, passos, fila e os
-- eventos de mensagem/falha de envio (o CHECK antigo não os aceita). Mensagens
-- com sent_source 'cobranca' passam a 'workflow' — o CHECK antigo volta NOT
-- VALID para não reler 6,4 GB (as linhas antigas cabem nele por construção).

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cobranca-regua')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobranca-regua');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.invoke_cobranca_regua();

DROP TRIGGER IF EXISTS trg_cobranca_registrar_mensagem ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS trg_cobranca_proteger_numero ON public.whatsapp_instances;
DROP TRIGGER IF EXISTS trg_cobranca_proteger_numero ON public.copilot_agents;
DROP TRIGGER IF EXISTS trg_resolve_message_lead_id_zz_cobranca ON public.whatsapp_messages;

DROP FUNCTION IF EXISTS public.cobranca_regua_previa(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.cobranca_regua_cancelar_envio(uuid);
DROP FUNCTION IF EXISTS public.cobranca_regua_passo_remover(uuid);
DROP FUNCTION IF EXISTS public.cobranca_regua_passo_salvar(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.cobranca_regua_definir_numero(uuid, uuid);
DROP FUNCTION IF EXISTS public.cobranca_regua_ativar(uuid, boolean);
DROP FUNCTION IF EXISTS public.cobranca_regua_salvar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.cobranca_regua_garantir(uuid);
DROP FUNCTION IF EXISTS public.cobranca_regua_concluir(uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.cobranca_regua_reservar(integer, timestamptz);
DROP FUNCTION IF EXISTS public.cobranca_regua_planejar(timestamptz);
DROP FUNCTION IF EXISTS private.cobranca_registrar_mensagem();
DROP FUNCTION IF EXISTS private.cobranca_isolar_mensagem();
DROP FUNCTION IF EXISTS private.cobranca_proteger_numero();
DROP FUNCTION IF EXISTS private.cobranca_regua_quebrar_compromissos(uuid, date);
DROP FUNCTION IF EXISTS private.cobranca_regua_mover(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS private.cobranca_regua_instancia(uuid);
DROP FUNCTION IF EXISTS private.cobranca_regua_variaveis(uuid, text, date, timestamptz);
DROP FUNCTION IF EXISTS private.cobranca_regua_candidatos(uuid, timestamptz);
DROP FUNCTION IF EXISTS private.cobranca_regua_semear(uuid);
DROP FUNCTION IF EXISTS private.cobranca_na_janela(jsonb, text, timestamptz);
DROP FUNCTION IF EXISTS private.cobranca_proxima_janela(jsonb, text, timestamptz);
DROP FUNCTION IF EXISTS private.cobranca_janela_valida(jsonb);

-- RPC do webhook volta ao retorno sem reserved_for (corpo de 20271107100000).
DROP FUNCTION IF EXISTS public.resolve_uazapi_instance(text, text);
CREATE FUNCTION public.resolve_uazapi_instance(
  p_instance_ref text,
  p_token text
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  instance_name text,
  phone_number text,
  provider text,
  via text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_via text;
BEGIN
  -- Guarda: só service_role (mesmo padrão de get_uazapi_credentials).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_instance_ref IS NOT NULL AND p_instance_ref <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_instance_id = p_instance_ref;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'instance_id';
    END IF;
  END IF;

  IF v_id IS NULL AND p_token IS NOT NULL AND p_token <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_token = p_token;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'token';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT i.id, i.organization_id, i.instance_name, i.phone_number, i.provider, v_via
    FROM public.whatsapp_instances i
   WHERE i.id = v_id;
END;
$function$;

COMMENT ON FUNCTION public.resolve_uazapi_instance(text, text) IS
  'Webhook Uazapi: resolve a instância por uazapi_instance_id (preferido) ou token. '
  'Só service_role. Existe para o token viajar no corpo do POST, nunca na URL.';

REVOKE ALL ON FUNCTION public.resolve_uazapi_instance(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_uazapi_instance(text, text) TO service_role;

DROP TABLE IF EXISTS public.cobranca_regua_envios;
DROP TABLE IF EXISTS public.cobranca_regua_passos;
DROP TABLE IF EXISTS public.cobranca_regua;

-- View e eventos voltam ao contrato da entrega 1.
CREATE OR REPLACE VIEW public.cobranca_inadimplentes_resumo
WITH (security_invoker = true) AS
SELECT i.id,
       i.organization_id,
       i.nome,
       i.documento,
       i.telefone,
       i.email,
       i.contato_nome,
       i.cidade,
       i.origem,
       i.nao_contatar,
       i.created_at,
       c.id              AS caso_id,
       c.etapa_id,
       e.nome            AS etapa_nome,
       e.papel           AS etapa_papel,
       e.cor             AS etapa_cor,
       c.responsavel_id,
       tm.name           AS responsavel_nome,
       c.posicao,
       c.aberto_em,
       c.etapa_desde,
       COALESCE(s.titulos_abertos, 0)::integer        AS titulos_abertos,
       COALESCE(s.saldo_aberto, 0)::numeric(14, 2)    AS saldo_aberto,
       s.vencimento_mais_antigo,
       cp.tipo                                        AS compromisso_tipo,
       cp.proxima_vencimento                          AS compromisso_proxima_vencimento,
       cp.proxima_valor                               AS compromisso_proxima_valor,
       cp.parcelas_total                              AS compromisso_parcelas,
       uc.ultimo_contato_em,
       uc.ultimo_contato_canal,
       ud.desfecho       AS ultimo_desfecho,
       ud.encerrado_em   AS ultimo_encerramento
  FROM public.cobranca_inadimplentes i
  LEFT JOIN public.cobranca_casos c
         ON c.inadimplente_id = i.id AND c.encerrado_em IS NULL
  LEFT JOIN public.cobranca_etapas e ON e.id = c.etapa_id
  LEFT JOIN public.team_members tm ON tm.id = c.responsavel_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ts.saldo > 0) AS titulos_abertos,
           sum(ts.saldo)                        AS saldo_aberto,
           min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS vencimento_mais_antigo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = i.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT co.tipo,
           (SELECT count(*) FROM public.cobranca_compromisso_parcelas pa
             WHERE pa.compromisso_id = co.id)::integer AS parcelas_total,
           nx.vencimento AS proxima_vencimento,
           nx.valor      AS proxima_valor
      FROM public.cobranca_compromissos co
      LEFT JOIN LATERAL (
        SELECT pa.vencimento, pa.valor
          FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id
           AND pa.vencimento >= CURRENT_DATE - 1
         ORDER BY pa.vencimento
         LIMIT 1
      ) nx ON true
     WHERE co.caso_id = c.id AND co.status = 'ativo'
  ) cp ON true
  LEFT JOIN LATERAL (
    SELECT ev.created_at AS ultimo_contato_em,
           ev.dados ->> 'canal' AS ultimo_contato_canal
      FROM public.cobranca_eventos ev
     WHERE ev.caso_id = c.id AND ev.tipo = 'contato_registrado'
     ORDER BY ev.created_at DESC
     LIMIT 1
  ) uc ON true
  LEFT JOIN LATERAL (
    SELECT cf.desfecho, cf.encerrado_em
      FROM public.cobranca_casos cf
     WHERE cf.inadimplente_id = i.id AND cf.encerrado_em IS NOT NULL AND c.id IS NULL
     ORDER BY cf.encerrado_em DESC
     LIMIT 1
  ) ud ON true
 WHERE i.arquivado_em IS NULL;

DROP INDEX IF EXISTS public.cobranca_eventos_contato_real;

DELETE FROM public.cobranca_eventos WHERE tipo IN ('mensagem_enviada', 'mensagem_recebida', 'envio_falhou');
ALTER TABLE public.cobranca_eventos DROP CONSTRAINT cobranca_eventos_tipo_check;
ALTER TABLE public.cobranca_eventos ADD CONSTRAINT cobranca_eventos_tipo_check CHECK (tipo IN (
  'inadimplente_criado', 'inadimplente_editado', 'inadimplente_arquivado',
  'titulo_incluido', 'titulo_cancelado', 'importado',
  'caso_aberto', 'etapa_alterada', 'responsavel_alterado', 'caso_encerrado',
  'promessa_registrada', 'acordo_registrado', 'compromisso_encerrado',
  'pagamento_registrado', 'contato_registrado', 'nao_contatar_alterado'));

-- Só as instâncias das orgs com a área: sent_source não tem índice, e varrer a
-- tabela inteira para achar meia dúzia de linhas seria o custo do rollback.
UPDATE public.whatsapp_messages SET sent_source = 'workflow'
 WHERE sent_source = 'cobranca'
   AND instance_id IN (SELECT w.id FROM public.whatsapp_instances w
                         JOIN public.organizations o ON o.id = w.organization_id
                        WHERE o.feature_flags ? 'cobranca');
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT whatsapp_messages_sent_source_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_sent_source_check
  CHECK (sent_source = ANY (ARRAY['manual'::text, 'copilot'::text, 'workflow'::text])) NOT VALID;

DROP INDEX IF EXISTS public.whatsapp_instances_um_numero_de_cobranca;
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS reserved_for;

COMMIT;
