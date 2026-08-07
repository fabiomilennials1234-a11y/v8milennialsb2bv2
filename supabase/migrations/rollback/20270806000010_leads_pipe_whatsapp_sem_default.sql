-- ROLLBACK de 20270806000010_leads_pipe_whatsapp_sem_default.sql
--
-- SCRUM-248. A migration faz uma coisa só, e ela é pequena no diff e grande no
-- efeito: `ALTER TABLE public.leads ALTER COLUMN pipe_whatsapp DROP DEFAULT`.
--
-- O `DEFAULT 'novo'::text` vinha do baseline (`baseline_prod_schema.sql:24875`) e
-- era **o maior escritor da coluna** — todo `INSERT INTO leads` que não cita
-- `pipe_whatsapp` gravava `'novo'`. Ficou invisível por anos porque o código de
-- ingest semeava o mesmo valor: dois escritores concordando. Quando o SCRUM-195
-- tirou o código, o default ficou sozinho e passou a decidir.
--
-- ── O QUE VOLTAR AQUI RE-INTRODUZ ──────────────────────────────────────────
-- 🟠 O furo do SCRUM-195. A promessa de `deal_manual_only` é que o Lead entra na
-- base e NÃO nasce Negócio. Com o default de volta, o lead entra com
-- `pipe_whatsapp = 'novo'` — o espelho afirmando uma etapa de um funil em que a
-- org decidiu não ter card. Todo leitor da coluna passa a ler um funil que não
-- existe, e a flag continua parecendo ligada.
--
-- É um defeito silencioso: não há erro, não há linha a mais em
-- `pipeline_entries`, só uma coluna dizendo algo que o modelo nega.
--
-- ── QUANDO PRECISA MESMO ASSIM ─────────────────────────────────────────────
-- Se algum leitor legado quebrar com `pipe_whatsapp IS NULL` de um jeito que não
-- dê para corrigir a tempo. Os três nominados no comentário da coluna são
-- `get_leads_no_response_from_lead`, `get_leads_team_no_response`,
-- `get_pending_meta_conversion_signals`, mais a view `leads_compat`. Se um deles
-- estiver produzindo resultado errado em produção por causa do NULL, repor o
-- default é o remendo rápido — e a correção certa é repontar o leitor para a
-- entry, que é o que a fatia 3 faz de qualquer forma.
--
-- ⚠️ O QUE ESTE ROLLBACK **NÃO** DESFAZ: os leads que já entraram com a coluna
-- NULL depois do apply. Repor o default muda o futuro, não o passado — e é o
-- comportamento certo, porque preencher aquelas linhas com `'novo'` seria
-- inventar etapa para lead que nunca teve card. Se algum leitor precisar deles,
-- a fonte é a entry (`pipeline_entries.stage_key` do funil `whatsapp`), nunca a
-- coluna. A seção 2 conta quantos estão nesse estado.
--
-- ── SOBRE OS COMENTÁRIOS ───────────────────────────────────────────────────
-- A migration também reescreveu o COMMENT da coluna e o de
-- `fn_auto_assign_lead_default_pipe()`. Este rollback **não repõe os textos
-- antigos**, e isso é deliberado: o comentário anterior da função descrevia o
-- furo que o SCRUM-195 fechou, e repô-lo faria a documentação mentir sobre o
-- código que continua no lugar. Comentário é para quem lê depois; restaurar um
-- texto errado por simetria de rollback serve à simetria, não ao leitor. O que
-- este arquivo faz é ATUALIZAR o comentário da coluna para dizer a verdade nova:
-- que o default voltou, e por quê.

BEGIN;

-- ── 1. O default ────────────────────────────────────────────────────────────
ALTER TABLE public.leads
  ALTER COLUMN pipe_whatsapp SET DEFAULT 'novo'::text;

COMMENT ON COLUMN public.leads.pipe_whatsapp IS
  'ESPELHO LEGADO da etapa do Negócio no funil WhatsApp. NÃO é fonte de '
  'verdade: quem tem etapa é o Negócio, em pipeline_entries.stage_key '
  '(ADR-0023 decisão 1). ⚠️ O DEFAULT ''novo'' foi REPOSTO pelo rollback de '
  '20270806000010 — com ele, todo lead novo grava ''novo'' aqui mesmo em org com '
  'feature_flags.deal_manual_only ligada, o que faz a coluna afirmar um funil '
  'em que a org decidiu não ter card (furo do SCRUM-195). Estado transitório: '
  'ou o leitor legado que motivou o rollback é repontado para a entry, ou a '
  'fatia 3 dropa a coluna.';

-- ── 2. Verificação + o tamanho do que não é desfeito ────────────────────────
DO $$
DECLARE v_default text; v_nulos bigint; v_flag bigint;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'pipe_whatsapp';

  IF v_default IS NULL THEN
    RAISE EXCEPTION 'FAIL: o DEFAULT não foi reposto — column_default segue NULL.';
  END IF;

  -- Leads sem espelho: entraram com a coluna NULL enquanto o default esteve fora,
  -- ou tiveram o negócio movido para fora do funil WhatsApp. Repor o default não
  -- os toca, e não deve tocar.
  SELECT count(*) INTO v_nulos FROM public.leads WHERE pipe_whatsapp IS NULL;

  -- Orgs que pediram para o Negócio não nascer sozinho. São exatamente aquelas em
  -- que o default reposto volta a mentir.
  SELECT count(*) INTO v_flag
    FROM public.organizations
   WHERE COALESCE((feature_flags ->> 'deal_manual_only')::boolean, false) IS TRUE;

  RAISE NOTICE
    'ROLLBACK OK: DEFAULT de leads.pipe_whatsapp reposto (%). % lead(s) seguem com a coluna NULL e NÃO foram preenchidos — a fonte deles é a entry, nunca esta coluna.',
    v_default, v_nulos;

  IF v_flag > 0 THEN
    RAISE WARNING
      '% organização(ões) com deal_manual_only ligada. Nelas o default reposto passa a gravar ''novo'' em lead que não tem Negócio nenhum — o furo do SCRUM-195 está de volta e é silencioso. Trate isto como estado transitório, não como configuração.',
      v_flag;
  END IF;
END$$;

COMMIT;
