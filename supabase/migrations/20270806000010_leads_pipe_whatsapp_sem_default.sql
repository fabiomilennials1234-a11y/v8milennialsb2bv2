-- ============================================================================
-- `leads.pipe_whatsapp` perde o `DEFAULT 'novo'`.
--
-- Fecha o furo que sobrava do SCRUM-195 (ingest respeitar `deal_manual_only`) e
-- é o primeiro passo executável do SCRUM-202 (limpar os escritores da coluna
-- antes do `DROP COLUMN` da fatia 3).
--
-- ── O DEFAULT É O MAIOR ESCRITOR DA COLUNA, E NINGUÉM TINHA OLHADO ─────────
-- O inventário de escritores de `leads.pipe_whatsapp` procurou por `UPDATE`,
-- `NEW.x :=` e chaves em objeto de insert — e achou 12 sítios em edge functions
-- mais 3 ramos de gatilho. Todos removidos ou mapeados. Mas o escritor que
-- pega TODO lead novo não é nenhum deles: é a definição da coluna,
-- `baseline_prod_schema.sql:24875`:
--
--     "pipe_whatsapp" "text" DEFAULT 'novo'::"text",
--
-- Todo `INSERT INTO leads` que não cita a coluna grava `'novo'`. Enquanto o
-- código de edge function semeava o mesmo valor, o default era invisível — dois
-- escritores concordando. Tirado o código, ele fica sozinho e passa a decidir.
--
-- ── POR QUE ISSO QUEBRA O SCRUM-195 SE FICAR ──────────────────────────────
-- A promessa de `deal_manual_only` é: o Lead entra na base e NÃO existe Negócio
-- até alguém clicar (ADR-0023 decisão 3). Com o default no lugar, um lead que
-- chega por webhook numa org com a flag ligada termina assim:
--
--     pipeline_entries  → nenhuma linha  (correto: o gate funcionou)
--     leads.pipe_whatsapp → 'novo'       (mentira: diz que ele está no funil)
--
-- E a mentira é lida. Estes quatro leitores estão vivos em produção e tratam a
-- coluna como "o lead está no funil WhatsApp":
--
--   - `get_leads_no_response_from_lead()`  baseline:9308, 9324
--   - `get_leads_team_no_response()`       baseline:9406, 9423
--   - `get_pending_meta_conversion_signals()` baseline:10154
--       ← chamada viva por `supabase/functions/meta-conversion-dispatch/index.ts:55`
--   - VIEW `public.leads_compat`           baseline:24977 (expõe a coluna; zero
--       consumidores vivos medidos em `src/` e `supabase/functions/`)
--
-- Ou seja: sem esta migration, gatear as edge functions esconde o card do
-- kanban mas mantém o lead contado como se estivesse no funil. Meia verdade é
-- pior que nenhuma — foi exatamente esse o custo do `pipe_whatsapp` congelado
-- que o ADR-0023 §10 registrou como "correção de record".
--
-- ── O QUE ACONTECE COM A FLAG DESLIGADA (95 das 96 orgs) ──────────────────
-- Nada observável. A coluna nasce NULL, e antes do COMMIT ela é preenchida pelo
-- mesmo gatilho de sempre:
--
--   1. o caminho de ingest chama `upsertPipeEntry`, que INSERE em
--      `pipeline_entries` — ou, se ninguém inseriu, o CONSTRAINT TRIGGER
--      DEFERRABLE `trg_auto_assign_lead_default_pipe` insere no COMMIT;
--   2. o INSERT em `pipeline_entries` roda em `pg_trigger_depth() = 1` e dispara
--      `trg_sync_whatsapp_stage_to_lead`;
--   3. `sync_pipeline_entry_to_lead_pipe_whatsapp` (20270803000040:77) grava
--      `leads.pipe_whatsapp = NEW.stage_key`.
--
-- E grava melhor do que o default gravava: `stage_key` é a etapa ATIVA resolvida
-- para a org (guard de ghost-stage), não o literal `'novo'` — que em várias orgs
-- é uma etapa desativada. O default vinha, nesses casos, criando divergência
-- entre a coluna e o card desde o primeiro segundo de vida do lead.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ, E POR QUÊ ───────────────────────────────
-- NÃO derruba `trg_sync_whatsapp_stage_to_lead` nem
-- `sync_pipeline_entry_to_lead_pipe_whatsapp`, que são os últimos escritores da
-- coluna depois desta branch. O SCRUM-202 pede "limpar os sítios que escrevem —
-- código e gatilhos", e a resposta honesta é que o gatilho ainda não pode cair:
-- ele é a ÚNICA coisa que mantém a coluna verdadeira para os quatro leitores
-- listados acima. Matá-lo agora congelaria `pipe_whatsapp` no último valor e o
-- sinal de conversão offline da Meta passaria a ser calculado sobre um estado
-- que o negócio não ocupa mais — em silêncio, sem erro em lugar nenhum.
--
-- Pré-requisito nomeado para a fatia 3, nesta ordem:
--   1. repontar os 4 leitores para `pipeline_entries`;
--   2. então derrubar o gatilho e a função;
--   3. então `DROP COLUMN`, com `idx_leads_org_pipe_whatsapp` (baseline:31364) e
--      `idx_leads_pipe_whatsapp` (baseline:31384) caindo junto.
--
-- Fora de escopo desta branch, registrado: dois escritores de frontend
-- sobrevivem — `src/modules/communication/hooks/useWhatsAppFunnel.ts:58` e
-- `src/modules/pipelines/hooks/custom/useCustomPipelines.ts:968`.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--     ALTER TABLE public.leads ALTER COLUMN pipe_whatsapp SET DEFAULT 'novo'::text;
--
-- Reversível e barato: `DROP DEFAULT` não reescreve linha nenhuma e não toca
-- dado existente. Leads criados enquanto esta migration esteve no ar mantêm o
-- valor que o gatilho de sync gravou.
--
-- ── GUARDA F4 ─────────────────────────────────────────────────────────────
-- Só schema: um `ALTER COLUMN`, um `COMMENT ON COLUMN` e um `COMMENT ON
-- FUNCTION`. Nenhum `UPDATE`/`INSERT`/`DELETE` em dado de cliente, nenhum bloco
-- `DO` que escreva. URL errada aqui vira erro de schema recuperável, não
-- mudança de dado.
-- ============================================================================

BEGIN;

ALTER TABLE public.leads
  ALTER COLUMN pipe_whatsapp DROP DEFAULT;

COMMENT ON COLUMN public.leads.pipe_whatsapp IS
  'ESPELHO LEGADO da etapa do Negócio no funil WhatsApp. NÃO é fonte de '
  'verdade: quem tem etapa é o Negócio, em pipeline_entries.stage_key '
  '(ADR-0023 decisão 1). Mantida exclusivamente por '
  'sync_pipeline_entry_to_lead_pipe_whatsapp — NÃO escrever nesta coluna a '
  'partir de código. NULL significa "sem Negócio no funil WhatsApp", que é o '
  'estado normal de org com feature_flags.deal_manual_only ligada. O '
  'DEFAULT ''novo'' foi removido em 20270806000010 porque com a flag ligada ele '
  'afirmava um funil que não existia. Some no DROP COLUMN da fatia 3, depois de '
  'repontados get_leads_no_response_from_lead, get_leads_team_no_response, '
  'get_pending_meta_conversion_signals e a view leads_compat.';

-- O comentário anterior desta função (posto em 20270730000040) descrevia o furo
-- que o SCRUM-195 acabou de fechar, e a partir daqui estaria mentindo. Doc que
-- mente é pior que doc que falta.
COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'Semeia pipeline_entries(whatsapp/novo) no INSERT de lead. Respeita a flag '
  'por org organizations.feature_flags.deal_manual_only (ADR-0023 decisão 3 — '
  '"um Negócio nasce só por clique humano"). Roda como CONSTRAINT TRIGGER '
  'DEFERRABLE INITIALLY DEFERRED: a flag é lida no COMMIT, não no INSERT. '
  'Desde o SCRUM-195 o gate deixou de ser só deste gatilho: as edge functions '
  'de ingest leem a mesma flag por supabase/functions/_shared/deal-policy.ts, e '
  'o choke de criação de card é o ramo de INSERT de upsertPipeEntry em '
  '_shared/pipeline-adapter.ts. Os dois lados fazem fail-open pelo mesmo motivo '
  '(flag de rollout não pode ser o motivo de um lead não entrar na base). A '
  'porta humana, abrir_negocio (20270803000020), não passa por nenhum dos dois. '
  'Ver migrations 20270730000040 e 20270806000010.';

-- ── Verificação ───────────────────────────────────────────────────────────
-- Falha a transação inteira se o estado final não for o descrito acima.
DO $$
DECLARE
  v_default text;
  v_sync_ok boolean;
  v_autoseed_ok boolean;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.leads'::regclass
    AND a.attname  = 'pipe_whatsapp'
    AND a.attnum   > 0
    AND NOT a.attisdropped;

  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: leads.pipe_whatsapp ainda tem DEFAULT (%). O DROP DEFAULT não pegou.', v_default;
  END IF;

  -- A migration DEPENDE deste gatilho continuar de pé: sem ele, tirar o default
  -- deixaria a coluna NULL para sempre e os 4 leitores parariam de ver o funil.
  -- Se alguém o derrubar antes de repontar os leitores, é aqui que se descobre.
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc  p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.pipeline_entries'::regclass
      AND t.tgname  = 'trg_sync_whatsapp_stage_to_lead'
      AND p.proname = 'sync_pipeline_entry_to_lead_pipe_whatsapp'
      AND t.tgenabled <> 'D'
  ) INTO v_sync_ok;

  IF NOT v_sync_ok THEN
    RAISE EXCEPTION 'FAIL: trg_sync_whatsapp_stage_to_lead ausente ou desabilitado em pipeline_entries. Sem ele, remover o DEFAULT deixa leads.pipe_whatsapp permanentemente NULL e cega get_pending_meta_conversion_signals / get_leads_no_response_*. Reponte os leitores ANTES de derrubar o gatilho.';
  END IF;

  -- O gate por org do auto-seed também é pré-condição: é ele que garante que,
  -- com a flag ligada, nenhuma entry nasça — e portanto que a coluna fique NULL
  -- em vez de ser preenchida pelo gatilho de sync logo em seguida.
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_auto_assign_lead_default_pipe'
      AND strpos(pg_get_functiondef(p.oid), 'deal_manual_only') > 0
  ) INTO v_autoseed_ok;

  IF NOT v_autoseed_ok THEN
    RAISE EXCEPTION 'FAIL: fn_auto_assign_lead_default_pipe não referencia deal_manual_only — a migration 20270730000040 não está aplicada neste alvo. Aplicá-la primeiro.';
  END IF;

  RAISE NOTICE 'OK: leads.pipe_whatsapp sem DEFAULT. A coluna passa a ser escrita SÓ por sync_pipeline_entry_to_lead_pipe_whatsapp. Org com deal_manual_only ligada agora tem lead sem funil e coluna NULL, em vez de NULL no funil e ''novo'' na coluna.';
END $$;

COMMIT;
