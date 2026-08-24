-- ============================================================================
-- Procedência obrigatória — o passo *contract*. (#1765, ADR-0030 §4)
--
-- Fecha o expand–contract aberto em `20270824000010`. A partir daqui a pergunta
-- "esse Negócio nasceu de gente ou de automação?" tem resposta em 100% dos
-- casos, para sempre — e não em alguns.
--
-- ── POR QUE SÓ AGORA ──────────────────────────────────────────────────────
-- O contract só pode entrar depois que TODOS os caminhos de criação gravem.
-- Conferido, um a um, antes de escrever esta migration:
--
--   • `abrir_negocio` recebe e grava `p_source` desde 20270824000040;
--   • a tela passa 'human' — VERIFICADO NO BUNDLE SERVIDO em produção:
--     `p_title:null,p_source:"human"` em torquecrm.com.br;
--   • `api_create_deal` grava 'api', fixo no handler — o chamador não escolhe;
--   • as 34.966 linhas da virada estão marcadas 'backfill'.
--
-- Medido em produção imediatamente antes: **0 Negócios sem Procedência**.
-- Ligar isto com o front antigo ainda no ar teria quebrado o botão "Criar
-- negócio" para todo mundo — o INSERT falharia por violação de NOT NULL.
--
-- ── A GUARDA NA FUNÇÃO, E POR QUE ELA NÃO É REDUNDANTE ────────────────────
-- Sem ela, chamar `abrir_negocio` sem `p_source` falharia com "null value in
-- column source violates not-null constraint" — mensagem que fala de coluna e
-- de constraint. Quem lê é quem está integrando, e precisa saber QUAL valor
-- informar. A guarda diz.
--
-- `CREATE OR REPLACE` com a MESMA assinatura: não cria overload, não zera
-- grants, não precisa de DROP. O `p_source` continua com DEFAULT NULL na
-- assinatura de propósito — quem omite recebe a mensagem boa, em vez de um erro
-- de aridade do PostgREST.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_nulos bigint;
BEGIN
  SELECT count(*) INTO v_nulos FROM public.deals WHERE source IS NULL;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % Negócio(s) sem Procedência. O contract exige cobertura total — encontre a porta que não está gravando ANTES de ligar o NOT NULL.', v_nulos;
  END IF;
END$$;

ALTER TABLE public.deals
  ALTER COLUMN source SET NOT NULL;

COMMENT ON COLUMN public.deals.source IS
  'Procedência: a porta por onde este Negócio nasceu (ADR-0030 §4). '
  'human | workflow | api | import | backfill. OBRIGATÓRIA desde 20270824000090 — '
  'todo caminho de criação informa. Escrita uma vez no nascimento e nunca '
  'reescrita: é trilha, não estado. NÃO deduzir origem de created_by, que nomeia '
  'uma pessoa e é nulo para toda porta que não é uma.';

-- ── A mensagem que quem integra lê ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_deals_exige_procedencia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source IS NULL THEN
    RAISE EXCEPTION
      'Procedência é obrigatória ao abrir um Negócio. Informe uma de: human, workflow, api, import, backfill.'
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Nome em 'a' para rodar ANTES dos outros BEFORE INSERT: a recusa boa tem de
-- chegar antes de qualquer efeito colateral de outro gatilho.
DROP TRIGGER IF EXISTS a_deals_exige_procedencia ON public.deals;
CREATE TRIGGER a_deals_exige_procedencia
  BEFORE INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_deals_exige_procedencia();

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_nullable text; v_trg int;
BEGIN
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='deals' AND column_name='source';
  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'FAIL: deals.source continua anulável.';
  END IF;

  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgname = 'a_deals_exige_procedencia' AND NOT tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'FAIL: gatilho de mensagem ausente.';
  END IF;

  RAISE NOTICE
    'VALIDATION PASSED: Procedência obrigatória em % Negócio(s). O expand-contract fechou.',
    (SELECT count(*) FROM public.deals);
END$$;

COMMIT;
