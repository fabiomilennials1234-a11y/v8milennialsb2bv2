-- 20280111000600_uf_do_erp_chega_ao_lead.sql
--
-- O estado que o ERP cadastra passa a chegar ao lead — e, com ele, ao mapa de
-- clientes (get_uf_heatmap agrupa por leads.uf).
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- O ERP grava cidade e UF em upsell_clients (erp_city, erp_uf). O lead só
-- recebia a UF quando o sync o CRIAVA ou ADOTAVA um lead sem UF; enriquecer um
-- cliente existente gravava só na Carteira. O palpite do DDD ficava para
-- sempre. Café Jurerê em 11/11: 11.331 clientes com UF no ERP, mas 9.540 leads
-- seguiam com a UF do DDD — 611 deles num estado DIFERENTE — e 1.390 leads sem
-- UF nenhuma, com o ERP sabendo qual era.
--
-- ── A regra ──────────────────────────────────────────────────────────────
-- A mesma de 20270822130000_lead_uf_source_erp e do trigger trg_leads_derive_uf:
-- UF do DDD é palpite; a do ERP é informação.
--   • UF brasileira válida no ERP vai para o lead quando a UF dele está vazia,
--     veio do DDD, ou veio do próprio ERP (o cadastro mudou);
--   • nunca sobrescreve manual, webhook ou ai (alguém disse) nem UF sem
--     procedência conhecida;
--   • 'EX' (exterior) e qualquer coisa fora das 27 UFs: ignorado.
-- Depois disso, trg_leads_derive_uf não volta para o DDD: ele só age em UF
-- vazia ou vinda de 'ddd'.
--
-- ── Por que trigger, e não os 3 caminhos do sync ─────────────────────────
-- Criar, adotar e enriquecer moram em edge functions diferentes. No banco, a
-- regra vale para todo caminho que grava a Carteira — os de hoje e os que
-- vierem —, sem deploy de edge function. O sync só escreve erp_uf quando o
-- valor muda (upsert-client: "Escrita só quando algo muda de fato"), então o
-- trigger dispara só para o que é notícia.
--
-- SECURITY INVOKER: quem grava erp_uf é o sync (service_role). O WHERE amarra o
-- lead à MESMA org do cliente — um lead_id de outra org nunca é tocado.
--
-- Só schema (guarda F4): nenhuma linha existente é reescrita aqui. Os leads de
-- hoje recebem a UF do ERP por um backfill separado, com dry-run.
--
-- ROLLBACK: supabase/migrations/rollback/20280111000600_uf_do_erp_chega_ao_lead.sql

-- UF brasileira normalizada ('sc ' → 'SC'), ou NULL (inclui 'EX', vazio, lixo).
CREATE OR REPLACE FUNCTION public.uf_brasileira(p_valor text)
RETURNS char(2)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT v::char(2)
    FROM (SELECT upper(btrim(p_valor)) AS v) x
   WHERE v = ANY (ARRAY[
     'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
     'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
   ]);
$$;

COMMENT ON FUNCTION public.uf_brasileira(text) IS
  'UF brasileira normalizada (maiúscula, sem espaço) ou NULL — EX (exterior), vazio e qualquer valor fora das 27 UFs viram NULL.';

REVOKE ALL ON FUNCTION public.uf_brasileira(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.uf_brasileira(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsell_clients_uf_para_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_uf char(2);
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_uf := public.uf_brasileira(NEW.erp_uf);
  IF v_uf IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads l
     SET uf = v_uf,
         uf_source = 'erp'
   WHERE l.id = NEW.lead_id
     AND l.organization_id = NEW.organization_id
     -- Só palpite (DDD), vazio ou o próprio ERP; nunca o que alguém disse.
     AND (l.uf IS NULL OR l.uf_source IN ('ddd', 'erp'))
     -- E só quando muda algo: o lead tem 21 triggers.
     AND (l.uf IS DISTINCT FROM v_uf OR l.uf_source IS DISTINCT FROM 'erp');

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.upsell_clients_uf_para_lead() IS
  'Trigger de upsell_clients: a UF do ERP (erp_uf) vai para o lead vinculado da mesma org quando a UF dele está vazia ou veio de DDD/ERP. Nunca sobrescreve manual/webhook/ai. Ver 20280111000600.';

REVOKE ALL ON FUNCTION public.upsell_clients_uf_para_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_upsell_clients_uf_para_lead ON public.upsell_clients;
CREATE TRIGGER trg_upsell_clients_uf_para_lead
  AFTER INSERT OR UPDATE OF erp_uf, lead_id ON public.upsell_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.upsell_clients_uf_para_lead();

-- Prova: o trigger existe e a função não é SECURITY DEFINER.
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.upsell_clients'::regclass
       AND tgname = 'trg_upsell_clients_uf_para_lead'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_upsell_clients_uf_para_lead não foi criado';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.upsell_clients_uf_para_lead()'::regprocedure) THEN
    RAISE EXCEPTION 'upsell_clients_uf_para_lead precisa ser SECURITY INVOKER';
  END IF;
END
$verify$;
