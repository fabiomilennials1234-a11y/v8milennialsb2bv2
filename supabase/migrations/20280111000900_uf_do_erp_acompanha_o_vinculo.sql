-- 20280111000900_uf_do_erp_acompanha_o_vinculo.sql
--
-- A UF que o ERP deu ao lead sai dele quando deixa de valer.
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- 20280111000600 leva a UF do ERP (upsell_clients.erp_uf) ao lead, mas só na
-- ida. Três caminhos deixavam o lead preso a uma UF que nenhum cadastro
-- sustenta mais, marcada 'erp' — e trg_leads_derive_uf só devolve o DDD para
-- UF vazia ou vinda de 'ddd', então ela ficava para sempre:
--   • o ERP limpa a UF: a sync do Toth grava erp_uf NULL quando o campo vem
--     vazio e 'EX' quando o cliente é do exterior (sanitizeUf aceita quaisquer
--     duas letras; uf_brasileira descarta as duas);
--   • o cliente muda de lead: merge_leads move a carteira do lead mesclado
--     para o mantido (UPDATE ... SET lead_id dinâmico, por FK);
--   • o cliente é apagado: Carteira (ClientDetailModal), purge_lead,
--     merge_leads (colisão na UNIQUE) e a cascata do lead.
-- Em 11/11, 15h UTC: 0 leads presos (396 com uf_source = 'erp', todos com
-- cliente válido). O backfill da noite de 11/11 leva a UF do ERP a mais
-- 10.731 leads da Café Jurerê; daí em diante a sync de hora em hora pode
-- prendê-los.
--
-- ── A regra ──────────────────────────────────────────────────────────────
-- A UF do ERP sai do lead quando o vínculo que a deu deixa de dar UF válida,
-- e só quando:
--   • ainda é a do ERP (uf_source = 'erp'): o que alguém digitou depois
--     (manual, webhook, ai) nunca é apagado;
--   • ainda é A MESMA que esse cliente deu (uf = UF antiga): o trigger só
--     desfaz o que ele mesmo escreveu;
--   • nenhum cliente da mesma org ainda sustenta UF válida para o lead.
--     A UNIQUE (organization_id, lead_id) torna isso impossível fora de um
--     comando que apaga e recria o cliente; a guarda custa uma sonda em
--     idx_upsell_clients_lead, e só roda quando o lead já qualificou.
-- Sair = uf e uf_source NULL. No mesmo UPDATE, trg_leads_derive_uf
-- (BEFORE UPDATE OF uf) devolve o palpite do DDD quando o telefone tem um.
--
-- Lixeira inclusa, como no "dar": restore_lead só limpa deleted_at, e nenhum
-- evento futuro de upsell_clients soltaria um lead que ficou preso enquanto
-- estava lá. No purge_lead isso custa um UPDATE no lead logo antes do DELETE
-- dele — o mesmo que merge_leads já faz.
--
-- Mesmo vínculo, UF válida → outra válida (SC → PR): UM update, direto para a
-- nova. Zerar e regravar dispararia duas vezes os gatilhos do lead.
--
-- O vínculo é (organization_id, lead_id): mudar a org do cliente também solta.
--
-- ── Guardas ──────────────────────────────────────────────────────────────
-- Org: cada UPDATE amarra o lead à org da linha (OLD para soltar, NEW para
-- dar). Cliente de uma org apontando para lead de outra nunca o toca.
-- Recursão: nenhum gatilho de leads escreve em upsell_clients (conferido em
-- prod 11/11), e os dois UPDATEs só escrevem quando algo muda.
-- SECURITY INVOKER: a sync (service_role) e merge_leads/purge_lead (DEFINER)
-- passam. A exclusão pela Carteira roda com o RLS de quem exclui: membro sem
-- UPDATE no lead — e qualquer um, para lead na lixeira, que a policy de UPDATE
-- exclui — não solta a UF (o RLS filtra em silêncio: 0 linhas, sem erro). Em
-- 11/11 os 8 membros ativos da Café Jurerê têm leads.view_all.
--
-- CREATE OR REPLACE TRIGGER (PG 14+, prod 17.6) troca o trigger no lugar com
-- SHARE ROW EXCLUSIVE; DROP TRIGGER pediria ACCESS EXCLUSIVE e travaria até a
-- leitura da Carteira.
--
-- Só schema (guarda F4): nenhuma linha existente é reescrita aqui.
--
-- ROLLBACK: supabase/migrations/rollback/20280111000900_uf_do_erp_acompanha_o_vinculo.sql

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsell_clients_uf_para_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_uf_antiga     char(2);
  v_uf_nova       char(2);
  v_mesmo_vinculo boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_uf_antiga := public.uf_brasileira(OLD.erp_uf);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_uf_nova := public.uf_brasileira(NEW.erp_uf);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_mesmo_vinculo := NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id
                   AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id;
  END IF;

  -- 1. Soltar: o vínculo antigo deixou de dar UF válida — cliente apagado,
  --    trocou de lead/org, ou o ERP limpou a UF (NULL, 'EX', lixo).
  IF v_uf_antiga IS NOT NULL AND (NOT v_mesmo_vinculo OR v_uf_nova IS NULL) THEN
    UPDATE public.leads l
       SET uf = NULL,
           uf_source = NULL
     WHERE l.id = OLD.lead_id
       AND l.organization_id = OLD.organization_id
       -- Só a UF que este cliente deu, e só enquanto ela ainda é do ERP.
       AND l.uf_source = 'erp'
       AND l.uf = v_uf_antiga
       -- E só se nenhum cliente da org ainda a sustenta.
       AND NOT EXISTS (
             SELECT 1
               FROM public.upsell_clients o
              WHERE o.lead_id = l.id
                AND o.organization_id = l.organization_id
                AND public.uf_brasileira(o.erp_uf) IS NOT NULL
           );
  END IF;

  -- 2. Dar: o vínculo novo tem UF válida (INSERT, ou UPDATE da UF ou do vínculo).
  IF v_uf_nova IS NOT NULL THEN
    UPDATE public.leads l
       SET uf = v_uf_nova,
           uf_source = 'erp'
     WHERE l.id = NEW.lead_id
       AND l.organization_id = NEW.organization_id
       -- Só palpite (DDD), vazio ou o próprio ERP; nunca o que alguém disse.
       AND (l.uf IS NULL OR l.uf_source IN ('ddd', 'erp'))
       -- E só quando muda algo: o lead tem 37 triggers, 9 entram num UPDATE de UF.
       AND (l.uf IS DISTINCT FROM v_uf_nova OR l.uf_source IS DISTINCT FROM 'erp');
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.upsell_clients_uf_para_lead() IS
  'Trigger de upsell_clients: a UF do ERP (erp_uf) vai para o lead vinculado da mesma org quando a UF dele está vazia ou veio de DDD/ERP, e sai dele (volta ao DDD) quando o ERP a limpa, o cliente muda de lead/org ou é apagado — só se ainda for a UF que esse cliente deu e nenhum cliente da org a sustentar (lixeira inclusa). Nunca toca manual/webhook/ai. Ver 20280111000600 e 20280111000900.';

REVOKE ALL ON FUNCTION public.upsell_clients_uf_para_lead() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_upsell_clients_uf_para_lead
  AFTER INSERT OR DELETE OR UPDATE OF erp_uf, lead_id, organization_id ON public.upsell_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.upsell_clients_uf_para_lead();

-- Prova: o trigger cobre os três caminhos, a função segue INVOKER com
-- search_path vazio, e a regra "um cliente por lead na org" — que o trigger
-- pressupõe — continua lá.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.upsell_clients'::regclass
     AND t.tgname = 'trg_upsell_clients_uf_para_lead'
     AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR position('AFTER INSERT OR DELETE OR UPDATE OF erp_uf, lead_id, organization_id ON public.upsell_clients FOR EACH ROW' IN v_def) = 0 THEN
    RAISE EXCEPTION 'trg_upsell_clients_uf_para_lead não ficou como esperado: %', coalesce(v_def, '(ausente)');
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.upsell_clients_uf_para_lead()'::regprocedure) THEN
    RAISE EXCEPTION 'upsell_clients_uf_para_lead precisa ser SECURITY INVOKER';
  END IF;
  IF NOT coalesce((SELECT proconfig @> ARRAY['search_path=""']
                     FROM pg_proc WHERE oid = 'public.upsell_clients_uf_para_lead()'::regprocedure), false) THEN
    RAISE EXCEPTION 'upsell_clients_uf_para_lead precisa de search_path vazio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.upsell_clients'::regclass
       AND c.contype = 'u'
       AND NOT c.condeferrable
       AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.upsell_clients'::regclass AND attname = 'organization_id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.upsell_clients'::regclass AND attname = 'lead_id')
           ]::int2[]
  ) THEN
    RAISE EXCEPTION 'upsell_clients sem a UNIQUE (organization_id, lead_id) imediata que o trigger pressupõe';
  END IF;
END
$verify$;
