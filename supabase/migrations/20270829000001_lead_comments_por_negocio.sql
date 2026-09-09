-- Comentário passa a saber em QUAL negócio foi escrito.
--
-- ── O problema ────────────────────────────────────────────────────────────
-- `lead_comments` só tem `lead_id`. Enquanto a única tela de comentário era a
-- ficha do lead isso bastava. O painel do Negócio (`deal-card/`) mudou a
-- pergunta: 4.948 dos 40.903 leads de prod têm MAIS DE UMA entrada de funil, e
-- sem vínculo um comentário escrito na negociação de setembro aparece idêntico
-- dentro do upsell de dezembro, sem dizer de onde veio.
--
-- ── Por que `pipeline_entries` e não `deals` ──────────────────────────────
-- O painel é chaveado por `pipeline_entries.id` — é o que `useDealSheet` guarda
-- e o que existe para 100% dos cards. `deals` não serve como alvo de FK por
-- `pipeline_entries.deal_id`: esse índice é PARCIAL e NÃO-ÚNICO
-- (`idx_pipeline_entries_deal`), e FK exige unicidade no alvo. Apontar direto
-- para `deals(id)` seria possível, mas deixaria de fora as 11.808 entradas que
-- não têm linha em `deals` — justamente as antigas.
--
-- ── A semântica de NULL, decidida antes de escrever esta linha ────────────
-- NULL = **comentário do LEAD**: nasceu fora de um negócio (é o caso dos 2.885
-- que já existem) ou o negócio foi removido do funil. Ele aparece em TODOS os
-- negócios daquele lead, sem selo — porque é verdade que ele é sobre a pessoa,
-- não sobre uma venda. Preenchido = nasceu naquele negócio; o painel de OUTRO
-- negócio do mesmo lead o mostra com um selo dizendo em qual foi escrito.
-- Nada é escondido: a decisão do dono do produto em 24/08 foi "vincular ao
-- negócio, mostrar tudo".
--
-- ── Sem backfill, de propósito ────────────────────────────────────────────
-- Comentário antigo não tem negócio recuperável — quem escreveu não estava
-- olhando um. Adivinhar pelo funil mais próximo inventaria vínculo, e vínculo
-- inventado é pior que vínculo ausente: o selo passaria a mentir.
--
-- Aditiva e reversível: nenhuma linha existente muda, nenhuma policy é tocada.

BEGIN;

ALTER TABLE public.lead_comments
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid;

-- ON DELETE SET NULL, não CASCADE: tirar o card do funil não pode apagar o que
-- a equipe escreveu. O comentário sobrevive rebaixado a comentário do lead —
-- que é exatamente o que ele passa a ser quando o negócio deixa de existir.
DO $$
BEGIN
  ALTER TABLE public.lead_comments
    ADD CONSTRAINT lead_comments_pipeline_entry_id_fkey
    FOREIGN KEY (pipeline_entry_id)
    REFERENCES public.pipeline_entries(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Índice parcial. Não é para a leitura do painel — essa continua indo por
-- `idx_lead_comments_active (lead_id, created_at DESC)`, porque a tela mostra
-- o histórico inteiro do lead. É para o LADO PAI da FK: sem ele, todo DELETE
-- em `pipeline_entries` faria seq scan em `lead_comments` para resolver o
-- SET NULL, e "Remover do funil" é operação de rotina.
CREATE INDEX IF NOT EXISTS idx_lead_comments_pipeline_entry
  ON public.lead_comments (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

COMMENT ON COLUMN public.lead_comments.pipeline_entry_id IS
  'Negócio (pipeline_entries.id) em que o comentário foi escrito. NULL = comentário do LEAD: nasceu fora de um negócio, ou o negócio saiu do funil (FK ON DELETE SET NULL). NULL aparece em todos os negócios do lead, sem selo.';

-- ── Guarda de coerência ───────────────────────────────────────────────────
-- As 3 policies de `lead_comments` já garantem a ORG do comentário, mas não
-- sabem nada da coluna nova: nada impediria um request forjado de carimbar o
-- comentário com a entrada de outra org, ou com um negócio de outro lead — e
-- aí o selo passaria a afirmar coisa falsa.
--
-- É trigger e não `WITH CHECK` na policy por dois motivos. (1) Recriar a
-- policy de INSERT é o caminho que já quebrou esta tabela uma vez (#1069,
-- 2026-07-13): mexer nela arrisca a regressão "não consigo comentar", que é
-- justamente o defeito que esta entrega conserta. (2) Subquery dentro de
-- policy roda SOB a RLS de `pipeline_entries`; SECURITY DEFINER aqui lê o
-- estado real e responde a mesma pergunta sem depender de quem pergunta.
--
-- Sai pela porta em O(1) quando a coluna é NULL — que é o caso de todo escritor
-- que existia antes desta migration. Nenhum caminho atual paga por isto.
CREATE OR REPLACE FUNCTION public.fn_lead_comment_entry_coerente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead uuid;
  v_org  uuid;
BEGIN
  IF NEW.pipeline_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pe.lead_id, pe.organization_id
    INTO v_lead, v_org
    FROM public.pipeline_entries pe
   WHERE pe.id = NEW.pipeline_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_comments.pipeline_entry_id % nao existe', NEW.pipeline_entry_id
      USING ERRCODE = '23503';
  END IF;

  IF v_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'lead_comments: o negocio % pertence a outra organizacao', NEW.pipeline_entry_id
      USING ERRCODE = '42501';
  END IF;

  -- `pipeline_entries.lead_id` é nullable. Entrada órfã de lead não pode
  -- receber comentário: o comentário é do lead por construção (`lead_id` é
  -- NOT NULL aqui), e carimbá-lo com um negócio sem dono criaria um vínculo
  -- que nenhuma tela sabe ler de volta.
  IF v_lead IS DISTINCT FROM NEW.lead_id THEN
    RAISE EXCEPTION 'lead_comments: o negocio % nao e deste lead', NEW.pipeline_entry_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_lead_comment_entry_coerente() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_lead_comment_entry_coerente() IS
  'Recusa lead_comments.pipeline_entry_id que aponte para entrada de outra org ou de outro lead. Sai em O(1) quando a coluna e NULL.';

REVOKE ALL ON FUNCTION public.fn_lead_comment_entry_coerente() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_lead_comment_entry_coerente() TO authenticated;
GRANT ALL ON FUNCTION public.fn_lead_comment_entry_coerente() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_comment_entry_coerente ON public.lead_comments;
CREATE TRIGGER trg_lead_comment_entry_coerente
  BEFORE INSERT OR UPDATE OF pipeline_entry_id, lead_id, organization_id
  ON public.lead_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_lead_comment_entry_coerente();

COMMIT;
