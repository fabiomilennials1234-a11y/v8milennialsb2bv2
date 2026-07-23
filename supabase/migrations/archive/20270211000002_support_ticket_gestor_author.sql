-- 20270211000002_support_ticket_gestor_author.sql
-- NÃO APLICADO — lote de prod pendente CTO.
--
-- S5 #1141 — Gestor de Portfólio: marcador de autor-gestor no Chamado (ADR-0021 §9).
--
-- Um Chamado aberto por um Gestor de Portfólio é SEMPRE ancorado a uma das orgs
-- vinculadas (organization_id continua NOT NULL — nunca org-less) e carrega um
-- marcador que diz ao staff da Torque: "o autor é um Gestor, não um Team Member
-- desta Organização". O marcador é `author_gestor_id`:
--   • NULL  → autor normal (Team Member da org, fluxo intocado).
--   • setado → autor é o Gestor daquela linha em `public.gestores`.
--
-- ADITIVA e não-destrutiva: 1 coluna + 1 índice parcial + 1 trigger de guarda
-- DEDICADO. NÃO redefine `enforce_support_ticket_write_rules` — o modelo de
-- Chamado (Severidade / Defeito / imutabilidade / cross-tenant) fica intacto.

-- 1. Marcador de autor-gestor. ON DELETE SET NULL espelha author_user_id: o
--    Chamado pertence à Organização e sobrevive ao ator que o abriu.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS author_gestor_id uuid
    REFERENCES public.gestores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.support_tickets.author_gestor_id IS
  'Marcador de autor-gestor (ADR-0021 §9). NULL = autor normal (Team Member). Setado = o Chamado foi aberto por este Gestor de Portfólio, sempre ancorado a uma org vinculada. Staff da Torque exibe selo "Gestor".';

-- Índice parcial: staff filtra/conta chamados de gestor; a maioria é NULL.
CREATE INDEX IF NOT EXISTS idx_support_tickets_author_gestor
  ON public.support_tickets (author_gestor_id)
  WHERE author_gestor_id IS NOT NULL;

-- 2. Guarda DEDICADA do marcador (trigger próprio, não toca o trigger existente).
--
--    Por que trigger e não policy: um marcador forjado passaria por uma policy
--    silenciosamente (UPDATE de 0 linhas → 200). A recusa precisa ser ruidosa.
--
--    INSERT: se o marcador vem setado, ele DEVE ser o gestor autenticado E esse
--    gestor DEVE estar vinculado à organization_id do chamado. Isso torna o
--    marcador honesto (um membro comum não consegue se pintar de gestor) e
--    reforça a ancoragem no vínculo — o frontend nunca inventa org fora dele.
--
--    UPDATE: o marcador é imutável, com uma única exceção — virar NULL (o FK
--    ON DELETE SET NULL executa um UPDATE quando o gestor é removido). Trocar o
--    marcador por OUTRO gestor continua proibido. Mesmo raciocínio do fix de
--    author_user_id em 20270118000001.
CREATE OR REPLACE FUNCTION public.enforce_support_ticket_gestor_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_gestor_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.gestores g
        JOIN public.gestor_organizations go ON go.gestor_id = g.id
        WHERE g.id = NEW.author_gestor_id
          AND g.user_id = auth.uid()
          AND g.is_active = true
          AND go.organization_id = NEW.organization_id
      ) THEN
        RAISE EXCEPTION 'author_gestor_id deve ser o gestor autenticado, vinculado a organization_id do chamado'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: imutável, salvo → NULL (remoção do gestor via FK).
  IF NEW.author_gestor_id IS DISTINCT FROM OLD.author_gestor_id
     AND NEW.author_gestor_id IS NOT NULL THEN
    RAISE EXCEPTION 'o gestor autor de um chamado nao muda'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Nome com prefixo 'g' garante disparo ANTES de trg_support_tickets_write_rules
-- (BEFORE triggers correm em ordem alfabética). Ambos só validam/ajustam NEW.
CREATE TRIGGER trg_support_tickets_gestor_author
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_gestor_author();

-- Função de trigger: ninguém a chama diretamente. Revogar EXECUTE evita virar
-- endpoint em /rest/v1/rpc (mesmo padrão de enforce_support_ticket_write_rules).
REVOKE ALL ON FUNCTION public.enforce_support_ticket_gestor_author() FROM PUBLIC, anon, authenticated;
