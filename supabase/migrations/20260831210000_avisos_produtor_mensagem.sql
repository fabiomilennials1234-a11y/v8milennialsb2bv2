-- Produtor: mensagem recebida vira Aviso de conversa. Issue #1885, ADR-0035.
--
-- Mora no banco, não na função de borda: a mensagem entra pelo webhook da
-- Uazapi, pela sincronização de histórico, pelo replay da fila morta e pelo
-- webhook da Meta. Um produtor por caminho seria quatro produtores, e o
-- terceiro esqueceria.
--
-- O Aviso é endereçado a uma conta de usuário, mas a atribuição do Lead nomeia
-- um Team Member — daí o salto por team_members.user_id. Member sem conta, ou
-- inativo, não é destinatário: o Aviso não nasce.
--
-- Atribuição canônica (CONTEXT.md): Closer = sale_responsible_id, Pré-vendas =
-- pre_sale_responsible_id. closer_id / sdr_id / responsible_id são apelidos
-- legados e entram só como fallback, na ordem em que o glossário os deprecia.

CREATE OR REPLACE FUNCTION public.fn_dono_do_lead(p_lead_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sale_responsible_id     AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.closer_id               AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.pre_sale_responsible_id AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sdr_id                  AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.responsible_id          AND tm.is_active AND tm.user_id IS NOT NULL)
  );
$$;

COMMENT ON FUNCTION public.fn_dono_do_lead IS
  'Conta de usuário do Dono do Aviso de um Lead: Closer, depois Pré-vendas, com os apelidos legados como fallback. NULL quando não há dono com conta ativa.';

REVOKE ALL ON FUNCTION public.fn_dono_do_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_dono_do_lead(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_dono_do_lead(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_aviso_de_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono  uuid;
  v_lead  record;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.direction <> 'incoming' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_group, false) OR COALESCE(NEW.sent_by_ai, false) THEN
    RETURN NEW;
  END IF;

  v_dono := public.fn_dono_do_lead(NEW.lead_id);
  IF v_dono IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name, company INTO v_lead FROM public.leads WHERE id = NEW.lead_id;

  PERFORM public.fn_emit_aviso(
    p_organization_id => NEW.organization_id,
    p_user_id         => v_dono,
    p_type            => 'lead_message',
    p_group_key       => 'msg:' || NEW.lead_id::text,
    p_title           => COALESCE(NULLIF(v_lead.name, ''), NEW.push_name, NEW.phone_number),
    p_description     => left(COALESCE(NEW.content, ''), 140),
    p_link            => '/chat',
    p_lead_id         => NEW.lead_id,
    p_entity_id       => NEW.lead_id,
    p_occurred_at     => COALESCE(NEW.timestamp, now())
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_aviso_de_mensagem IS
  'Mensagem recebida de Lead com dono vira Aviso de conversa (#1885). Grupo, saída e mensagem de IA não avisam.';

DROP TRIGGER IF EXISTS trg_aviso_de_mensagem ON public.whatsapp_messages;
CREATE TRIGGER trg_aviso_de_mensagem
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_aviso_de_mensagem();
