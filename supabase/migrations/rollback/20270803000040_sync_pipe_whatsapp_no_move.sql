-- ROLLBACK de 20270803000040_sync_pipe_whatsapp_no_move.sql
--
-- SCRUM-248. A migration acrescenta ao gatilho-espelho
-- `sync_pipeline_entry_to_lead_pipe_whatsapp()` o ramo de SAÍDA POR MOVE: quando
-- o negócio troca de funil (`OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id`) e
-- o funil de origem era o `whatsapp`, `leads.pipe_whatsapp` é ESVAZIADA. Antes,
-- só o DELETE esvaziava, e o move deixava a coluna congelada na última etapa de
-- WhatsApp (ADR-0023 decisão 4).
--
-- 🟠 VOLTAR AQUI RE-INTRODUZ UM DEFEITO CONHECIDO, e é bom saber qual antes de
-- rodar: com o corpo antigo, um lead que sai de Qualificação para Proposta fica
-- com `leads.pipe_whatsapp` congelada em, digamos, `agendado`. Todo leitor da
-- coluna passa a ler uma etapa que o negócio não ocupa mais. O pior sintoma é o
-- de template: `{{estagio}}` montado a partir dela sai plausível e errado — o
-- cliente lê "você está em Agendado" estando em Proposta enviada, e ninguém vê
-- campo vazio para desconfiar.
--
-- MESMO ASSIM O ROLLBACK EXISTE, porque o ramo novo ESCREVE em `leads` num
-- caminho que antes não escrevia. Se ele acordar `enqueue_lead_webhooks` (que não
-- compara OLD/NEW: todo UPDATE vira entrega) em volume inesperado, ou se algum
-- consumidor legado depender da coluna congelada, voltar rápido vale mais que
-- discutir. É a única razão legítima; "a coluna está NULL demais" não é uma.
--
-- ⚠️ O ROLLBACK NÃO REPÕE O VALOR CONGELADO. Ele volta o COMPORTAMENTO daqui
-- para a frente. Os leads que já foram esvaziados por move continuam com a coluna
-- NULL — e isso é irrecuperável a partir da própria coluna. Se precisar
-- reconstruir, a fonte é a entry: `pipeline_entries.stage_key` do card do funil
-- `whatsapp` daquele lead. A seção 3 imprime quantos estão nesse estado.
--
-- 🔴 NÃO RODE ESTE ROLLBACK DEPOIS DE 20270803000010 (DROP das colunas de
-- posição) TER RODADO JUNTO COM O DROP DA PRÓPRIA `leads.pipe_whatsapp` na fatia
-- 3. Sem a coluna, os dois corpos — o novo e o antigo — falham igual. A seção 0
-- checa isso e aborta com mensagem clara em vez de estourar no meio do CREATE.
--
-- FONTE do corpo antigo: `supabase/migrations/20260101000000_baseline_prod_schema.sql`
-- (a definição de `sync_pipeline_entry_to_lead_pipe_whatsapp`, ~:18790-18830),
-- copiado verbatim incluindo os comentários em inglês do original. NÃO use
-- `pg_get_functiondef` contra prod: depois do apply ela devolve o corpo NOVO.

BEGIN;

-- ── 0. A coluna espelho ainda existe? ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.leads'::regclass
       AND attname = 'pipe_whatsapp' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION
      'ABORTADO: `leads.pipe_whatsapp` não existe mais (dropada na fatia 3). Este gatilho inteiro é sobre essa coluna — nem o corpo novo nem o antigo funcionam sem ela. O rollback correto neste ponto é o da migration que dropou a coluna, não este.';
  END IF;
END$$;


-- ── 1. Corpo antigo de volta (sem o ramo de saída por move) ─────────────────
--
-- `CREATE OR REPLACE` preserva o ACL (DROP + CREATE zeraria e o
-- `ALTER DEFAULT PRIVILEGES` do projeto reconcederia a `anon`).
CREATE OR REPLACE FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug TEXT;
BEGIN
  -- Prevent circular trigger execution
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Resolve slug for the deleted entry
    SELECT pip.slug INTO v_slug
    FROM public.pipelines pip
    WHERE pip.id = OLD.pipeline_id AND pip.type = 'system'; -- metric-lint-allow: PRESERVADO verbatim do baseline. Não é métrica — é o gatilho-espelho: `leads.pipe_whatsapp` reflete só funil de SISTEMA, e um funil custom com slug "whatsapp" não pode escrever nessa coluna. A função resolve o slug A PARTIR do pipeline_id que o gatilho já recebe.

    IF v_slug = 'whatsapp' THEN
      UPDATE public.leads SET pipe_whatsapp = NULL WHERE id = OLD.lead_id;
    END IF;

    RETURN OLD;
  END IF;

  -- INSERT or UPDATE
  SELECT pip.slug INTO v_slug
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system'; -- metric-lint-allow: idem acima — roteamento do espelho por tipo de funil, não filtro de métrica.

  IF v_slug = 'whatsapp' THEN
    UPDATE public.leads SET pipe_whatsapp = NEW.stage_key WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp() IS
  'Espelha a etapa do funil WhatsApp em `leads.pipe_whatsapp` (coluna legada). ⚠️ ROLLBACK ATIVO de 20270803000040: só o DELETE esvazia. Sair do funil por MOVE deixa a coluna CONGELADA na última etapa de whatsapp — todo leitor da coluna passa a ler uma etapa que o negócio não ocupa mais.';


-- ── 2. O gatilho ────────────────────────────────────────────────────────────
-- Não é recriado: a migration usa `CREATE OR REPLACE FUNCTION` e não mexe no
-- `CREATE TRIGGER`, então `trg_sync_whatsapp_stage_to_lead` continua o mesmo
-- objeto, apontando para a mesma função. Trocar o corpo é tudo que há para
-- desfazer. A seção 3 confirma que ele segue vivo.


-- ── 3. Verificação (aborta) + quanto ficou irrecuperável ────────────────────
DO $$
DECLARE v_src text; v_orfaos bigint;
BEGIN
  SELECT prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sync_pipeline_entry_to_lead_pipe_whatsapp';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: a função de sync sumiu depois do CREATE OR REPLACE.';
  END IF;

  -- A asserção que importa: o ramo de saída por move NÃO pode estar no corpo.
  IF v_src LIKE '%OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id%' THEN
    RAISE EXCEPTION
      'FAIL: o corpo instalado AINDA tem o ramo de saída por move — o rollback não pegou.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_whatsapp_stage_to_lead' AND NOT tgisinternal
       AND tgrelid = 'public.pipeline_entries'::regclass
  ) THEN
    RAISE EXCEPTION
      'FAIL: trg_sync_whatsapp_stage_to_lead não está em pipeline_entries — o espelho não roda para ninguém.';
  END IF;

  -- Leads cujo card de whatsapp existe e tem etapa, mas a coluna espelho está
  -- NULL. É o rastro de quem foi esvaziado pelo ramo que acabou de sair. O
  -- rollback NÃO os repõe; reconstituir é
  --   UPDATE leads l SET pipe_whatsapp = pe.stage_key
  --     FROM pipeline_entries pe JOIN pipelines p ON p.id = pe.pipeline_id
  --    WHERE pe.lead_id = l.id AND p.slug = 'whatsapp' AND p.type = 'system'
  --      AND l.pipe_whatsapp IS NULL;
  -- ...que é ESCRITA EM DADO DE CLIENTE e por isso não roda aqui dentro.
  SELECT count(*) INTO v_orfaos
    FROM public.leads l
    JOIN public.pipeline_entries pe ON pe.lead_id = l.id
    JOIN public.pipelines p ON p.id = pe.pipeline_id
   WHERE p.slug = 'whatsapp' AND p.type = 'system' -- metric-lint-allow: contagem de diagnóstico do espelho, não métrica de negócio.
     AND pe.stage_key IS NOT NULL
     AND l.pipe_whatsapp IS NULL;

  RAISE NOTICE
    'ROLLBACK OK: o espelho voltou a esvaziar SÓ no DELETE. ⚠️ Sair do funil por move volta a CONGELAR a coluna. % lead(s) estão com a coluna NULL tendo card de whatsapp com etapa — este rollback não os repõe (a query de reconstituição está comentada acima; é escrita em dado de cliente e não roda aqui).',
    v_orfaos;
END$$;

COMMIT;
