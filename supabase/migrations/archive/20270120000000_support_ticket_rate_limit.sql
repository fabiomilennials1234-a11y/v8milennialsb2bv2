-- ============================================================
-- Chamado: cinco por hora, por usuário.
--
-- Sem captcha, sem fila de moderação, sem verificação de email. Um usuário
-- autenticado de um tenant pagante não é spammer — é gente com problema. O
-- limite existe para conter loop acidental (um `useEffect` sem dependência) e
-- abuso grosseiro, não para desconfiar do cliente (ADR-0018).
--
-- Enforce no banco, não no frontend: contornar o React não contorna o limite.
-- E num trigger, não numa policy — uma policy que nega devolve zero linhas sem
-- erro, e o usuário veria o chamado sumir em silêncio.
--
-- O staff nunca é limitado: ele não abre chamados por aqui.
--
-- Comentar num chamado existente nunca é limitado. É exatamente o que se quer
-- que a pessoa faça em vez de abrir o sexto chamado, e a mensagem de erro diz
-- isso.
--
-- O marcador `rate_limit_chamados:<HH:MM>` existe para o cliente não ter que
-- casar a mensagem inteira. Ver `src/modules/platform/lib/support-rate-limit.ts`.
--
-- Verificado em produção por sonda em transação revertida: as cinco primeiras
-- aberturas passam, a sexta é recusada com marcador e horário, dez comentários
-- no mesmo chamado passam, e sete chamados abertos pelo staff passam.
-- ============================================================

-- A contagem é por (autor, janela). O índice de autor existente não cobre o
-- filtro de tempo.
CREATE INDEX IF NOT EXISTS idx_support_tickets_author_created
  ON public.support_tickets (author_user_id, created_at DESC)
  WHERE author_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limite   CONSTANT INTEGER := 5;
  abertos  INTEGER;
  mais_antigo TIMESTAMPTZ;
  tz       TEXT;
BEGIN
  IF NEW.author_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;  -- o staff não abre chamados por aqui
  END IF;

  SELECT count(*), min(created_at)
    INTO abertos, mais_antigo
    FROM public.support_tickets
   WHERE author_user_id = NEW.author_user_id
     AND created_at > now() - interval '1 hour';

  IF abertos >= limite THEN
    -- O horário é o do fuso da Organização: "às 15:04" em São Paulo mentiria
    -- para uma fábrica em Manaus.
    SELECT coalesce(o.timezone, 'America/Sao_Paulo') INTO tz
      FROM public.organizations o WHERE o.id = NEW.organization_id;

    -- Quando o mais antigo da janela sair dela, uma vaga abre.
    RAISE EXCEPTION 'rate_limit_chamados:%',
      to_char((mais_antigo + interval '1 hour') AT TIME ZONE tz, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_support_ticket_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_ticket_rate_limit ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_rate_limit
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_rate_limit();
