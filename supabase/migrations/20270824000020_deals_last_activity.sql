-- ============================================================================
-- Última atividade do Negócio — a chave do cursor de sincronização. (#1766)
--
-- ── O FURO QUE ISTO FECHA ──────────────────────────────────────────────────
-- Mover um Negócio escreve SÓ em `pipeline_entries`. Verificado no corpo de
-- `mover_negocio` em produção: dois UPDATE na posição, nenhum em `deals`.
-- Consequência: um conector perguntando "o que mudou nos Negócios desde ontem?"
-- pelo campo de atualização comum enxerga título, valor e dono — e fica CEGO
-- justamente para a mudança de Stage, que é o evento que interessa.
--
-- ── POR QUE COLUNA NOVA, E NÃO CARIMBAR updated_at ────────────────────────
-- `updated_at` responde "os dados deste Negócio mudaram". A coluna nova responde
-- "aconteceu algo com ele". São perguntas diferentes, e as duas vão ser feitas
-- quando existir sincronização de mão dupla e alguém precisar decidir quem ganha
-- num conflito. Carimbar `updated_at` no move destruiria a distinção.
--
-- Precedente: o Pipedrive entrega `update_time` e `last_activity_date` como
-- campos separados, pelo mesmo motivo.
--
-- ── POR QUE NÃO CALCULAR NA LEITURA ───────────────────────────────────────
-- `greatest(deals.updated_at, entry.updated_at)` seria correto e inútil: vira
-- expressão sobre join, difícil de indexar, e cursor com chave instável é onde
-- nasce "página 3 pula registro". Cursor precisa de coluna simples, monotônica
-- e indexada.
--
-- Só schema, função e um UPDATE de inicialização na própria `deals`.
-- ============================================================================
BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

COMMENT ON COLUMN public.deals.last_activity_at IS
  'Quando algo aconteceu com este Negócio — edição da própria linha OU mudança '
  'da sua posição no funil. É a chave do cursor de sincronização incremental da '
  'API pública. Distinta de updated_at, que responde apenas "os dados desta '
  'linha mudaram": mover o Negócio NÃO altera updated_at, e a distinção é '
  'deliberada (ADR-0030 / #1766).';

-- ── Fonte 1: a própria linha ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_deal_touch_activity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Só preenche quando o chamador NÃO informou. Escrita explícita vence: é o que
  -- permite backfill, correção pontual, e teste estabelecer uma linha de base.
  -- Atropelar sempre transformaria a coluna em "agora", inútil como cursor.
  IF TG_OP = 'INSERT' THEN
    NEW.last_activity_at := coalesce(NEW.last_activity_at, now());
  ELSIF NEW.last_activity_at IS NOT DISTINCT FROM OLD.last_activity_at THEN
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_deal_touch_activity ON public.deals;
CREATE TRIGGER trg_deal_touch_activity
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deal_touch_activity();

-- ── Fonte 2: a posição no funil ────────────────────────────────────────────
--
-- ⚠️ O UPDATE abaixo dispara `update_deals_updated_at`, que faz
-- `NEW.updated_at = now()` incondicionalmente — e dispara DEPOIS deste gatilho,
-- porque o Postgres ordena BEFORE por NOME e 'u' vem depois de 't'. Sem guarda,
-- mover o Negócio carimbaria `updated_at` em cascata e destruiria a distinção
-- que esta coluna existe para criar.
--
-- A guarda é um sinalizador local à transação, lido por um terceiro gatilho que
-- roda por último (nome em 'zz'). Explícito de propósito: comparar linha inteira
-- para deduzir "só a atividade mudou" seria frágil e silencioso.
CREATE OR REPLACE FUNCTION public.fn_entry_touch_deal_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Posição órfã é o caso comum, não o de canto: 11.655 delas existem em
  -- produção. Sair calado é o certo — derrubar o UPDATE da posição por causa do
  -- espelho seria trocar um defeito por outro.
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('torque.activity_only', '1', true);
  UPDATE public.deals
     SET last_activity_at = now()
   WHERE id = NEW.deal_id;
  PERFORM set_config('torque.activity_only', '0', true);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_entry_touch_deal_activity ON public.pipeline_entries;
CREATE TRIGGER trg_entry_touch_deal_activity
  AFTER INSERT OR UPDATE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_entry_touch_deal_activity();

-- ── A guarda: roda por ÚLTIMO e desfaz o carimbo em cascata ────────────────
CREATE OR REPLACE FUNCTION public.fn_deals_preserve_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF coalesce(current_setting('torque.activity_only', true), '0') = '1' THEN
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- Nome em 'zz' NÃO é estilo: é o que garante que esta guarda rode depois de
-- `update_deals_updated_at`. Renomear quebra a distinção, e a suíte pega.
DROP TRIGGER IF EXISTS zz_deals_preserve_updated_at ON public.deals;
CREATE TRIGGER zz_deals_preserve_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deals_preserve_updated_at();

-- ── Índice: é a chave do cursor ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_org_last_activity
  ON public.deals (organization_id, last_activity_at DESC, id DESC);

-- ── Inicialização, uma vez ─────────────────────────────────────────────────
-- O maior entre a atualização da linha e a da posição mais recente. Depois disto
-- os gatilhos mantêm.
UPDATE public.deals d
   SET last_activity_at = greatest(
         d.updated_at,
         coalesce((SELECT max(pe.updated_at) FROM public.pipeline_entries pe -- metric-lint-allow: `last_activity_at` é recência de atividade, não âncora de métrica. A R4 barra `updated_at` como data DA VENDA (qualquer toque moveria o número); aqui "quando esta linha foi tocada pela última vez" é exatamente o que a coluna significa, e este UPDATE roda UMA vez para semeá-la — daí em diante quem mantém são os gatilhos acima.
                    WHERE pe.deal_id = d.id), d.updated_at))
 WHERE d.last_activity_at IS NULL;

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_nulos bigint; v_trg int;
BEGIN
  SELECT count(*) INTO v_nulos FROM public.deals WHERE last_activity_at IS NULL;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION 'FAIL: % Negócio(s) sem last_activity_at após a inicialização.', v_nulos;
  END IF;

  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgname IN ('trg_deal_touch_activity','trg_entry_touch_deal_activity','zz_deals_preserve_updated_at')
     AND NOT tgisinternal;
  IF v_trg <> 3 THEN
    RAISE EXCEPTION 'FAIL: esperados 3 gatilhos de atividade, encontrados %.', v_trg;
  END IF;

  RAISE NOTICE
    'VALIDATION PASSED: last_activity_at criada e inicializada em % Negócio(s); 3 gatilhos ativos; índice de cursor no lugar.',
    (SELECT count(*) FROM public.deals);
END$$;

COMMIT;
