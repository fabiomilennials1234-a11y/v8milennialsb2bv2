-- 20270826000020_revogar_sessao_ao_desativar_membro.sql
--
-- Desativar uma pessoa passa a derrubar a sessão dela.
--
-- Até aqui, `team_members.is_active = false` fechava os dados (a RLS filtra por
-- membro ativo) e trocava a tela — mas NÃO tocava em `auth`. A pessoa seguia
-- autenticada, com refresh token vivo, renovando sessão indefinidamente. Para
-- um desligamento, "não vê mais nada, mas continua logada" é uma meia-medida
-- que ninguém consegue explicar para o cliente.
--
-- O gatilho mora na coluna, não na tela: existem DOIS caminhos de desativação
-- (Master → Usuários, e Equipe → membro), e amanhã pode haver um terceiro.
-- Guardar na escrita cobre todos de uma vez.
--
-- LIMITE CONHECIDO, de propósito: o access token JWT é sem estado e continua
-- válido até expirar (1h no padrão do GoTrue). O que morre aqui é a sessão e o
-- refresh — ou seja, a renovação. Nessa janela residual a RLS já não entrega
-- dado nenhum, então o efeito prático é imediato; o que demora é o logout.

CREATE OR REPLACE FUNCTION public.revogar_sessoes_de_membro_desativado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_outros_vinculos int;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só derruba quem ficou sem NENHUM vínculo ativo. Uma pessoa pode ser membro
  -- de várias orgs; desativá-la numa não pode expulsá-la das outras.
  SELECT count(*) INTO v_outros_vinculos
  FROM public.team_members
  WHERE user_id = NEW.user_id
    AND is_active = true
    AND id <> NEW.id;

  IF v_outros_vinculos > 0 THEN
    RETURN NEW;
  END IF;

  -- Master e gestor de portfólio existem fora de team_members: derrubar a
  -- sessão deles por causa de um vínculo desativado seria expulsar o operador
  -- da própria ferramenta.
  IF EXISTS (SELECT 1 FROM public.master_users WHERE user_id = NEW.user_id AND is_active = true)
     OR EXISTS (SELECT 1 FROM public.gestores WHERE user_id = NEW.user_id AND is_active = true)
  THEN
    RETURN NEW;
  END IF;

  BEGIN
    DELETE FROM auth.refresh_tokens WHERE user_id = NEW.user_id::text;
    DELETE FROM auth.sessions WHERE user_id = NEW.user_id;
  EXCEPTION WHEN OTHERS THEN
    -- Fail-soft: desativar o membro é a operação principal e não pode falhar
    -- porque a limpeza de sessão deu errado. A RLS já cortou os dados.
    RAISE WARNING 'revogar_sessoes_de_membro_desativado: falha ao revogar sessões de % (%)',
      NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.revogar_sessoes_de_membro_desativado() IS
  'Ao desativar um team_member sem outros vínculos ativos (e que não seja master/gestor), apaga sessões e refresh tokens do usuário. Fail-soft.';

DROP TRIGGER IF EXISTS trg_revogar_sessoes_ao_desativar ON public.team_members;
CREATE TRIGGER trg_revogar_sessoes_ao_desativar
  AFTER UPDATE OF is_active ON public.team_members
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active AND NEW.is_active = false)
  EXECUTE FUNCTION public.revogar_sessoes_de_membro_desativado();
