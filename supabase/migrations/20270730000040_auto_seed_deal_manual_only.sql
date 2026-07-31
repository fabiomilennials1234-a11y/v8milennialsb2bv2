-- ============================================================================
-- Fatia 2 — separação Lead ↔ Negócio | M2 do plano | Decisões D1 + D7 do CTO
-- O auto-seed de `whatsapp/novo` passa a respeitar uma flag POR ORG.
--
-- Todas as medições deste cabeçalho são leituras READ-ONLY de PROD
-- (`jsjsmuncfkbsbzqzqhfq`) feitas em 2026-07-31, ou greps do repo na branch
-- `feat/lead-negocio-fatia2`. O que não foi medido está marcado "NÃO MEDIDO".
--
-- ── POR QUÊ ────────────────────────────────────────────────────────────────
-- `fn_auto_assign_lead_default_pipe()` cria um card em
-- `pipeline_entries (whatsapp, novo)` para todo lead novo da org. A decisão D1
-- do CTO é "negócio nasce só de clique": o lead entra na base sem virar card.
-- A decisão D7 é rollout POR ORG, com piloto na Milennials
-- (`6030520a-2ca7-477d-be89-55758e2cd808`).
--
-- Esta migration só ENSINA a função a respeitar a flag. Ela NÃO liga a flag
-- para ninguém — ver a seção "ESTA MIGRATION NÃO ACENDE NADA" abaixo.
--
-- ── ESCALA (o que foi medido, e o que NÃO foi) ─────────────────────────────
-- Medido:  `pipeline_entries` = 36.709 linhas; `custom_pipe_entries` = 16.193.
--          8.077 cards estão HOJE em `whatsapp/novo`, em 50 orgs.
--          Milennials: 1.524 leads, 2.357 cards.
-- NÃO MEDIDO: quantos desses cards nasceram DESTE trigger. Não existe coluna
--          de proveniência em `pipeline_entries`, e `stage_key` muda com o
--          tempo — os 8.077 são piso frouxo, não atribuição de origem. Se
--          alguém precisar do número real, é reconstrução por `lead_history`
--          / `field_changes`, não uma contagem de `stage_key`.
--
-- ── 🔴 O QUE ESTA MIGRATION *NÃO* ENTREGA (leia antes de acender a flag) ───
-- Gatear ESTA função **não** realiza "negócio nasce só de clique", e a razão
-- principal não é a que o plano supunha. O trigger é provavelmente quem ESCREVE
-- o card hoje na maioria dos casos, mas não é o único que SABE escrevê-lo —
-- e essa distinção é tudo, porque tirá-lo de cena só passa a caneta adiante.
--
--   A. 🔴 A INGESTÃO SEMEIA EM CÓDIGO DE APLICAÇÃO, FORA DO ALCANCE DA FLAG.
--      Dois pontos medidos, ambos criando `whatsapp/novo` explicitamente:
--        - `supabase/functions/_shared/lead-service.ts:332-344` (`getOrCreateLead`)
--          chama `upsertPipeEntry(slug:"whatsapp")`. Consumidores medidos:
--          `lead-webhook`, `agent-message` (Copilot) e `sz-chat-webhook`.
--        - `supabase/functions/lead-webhook/index.ts:518-531`, no ramo
--          "sempre criar novo lead", idem.
--      Os dois são gateados SÓ por `isShadow` e por
--      `skipPipeSeed = (origin === 'cal')` (`lead-webhook/index.ts:389`).
--      Nenhum dos dois lê `feature_flags`.
--
--      E tem uma inversão que é fácil não enxergar: HOJE o trigger costuma
--      ganhar a corrida (o lead commita, o trigger deferido roda no commit,
--      o card nasce) e o `upsertPipeEntry` seguinte encontra a entry e vira um
--      UPDATE idempotente. Com a flag LIGADA, o trigger sai de cena e o
--      `upsertPipeEntry` deixa de encontrar entry — e passa a INSERIR.
--      Efeito líquido nesses caminhos: **ZERO**. O card continua nascendo
--      sozinho; muda só quem o escreve. Quem ligar a flag esperando que lead
--      de WhatsApp/Meta/Copilot pare de virar card vai ver o card aparecer do
--      mesmo jeito e concluir que a migration não funcionou.
--      → Fechar isso é mudança nas edge functions (fora do escopo desta
--        task, que é "sem DDL, só a função"). Sem ela, o piloto D7 não mede
--        o que quer medir.
--
--   B. `place_in_pipe` NÃO passa pelas views `pipe_*` — o plano errou a rota.
--      O handler chama `upsertPipeEntry()` (`_shared/pipeline-adapter.ts`),
--      que faz `.from("pipeline_entries").insert(...)` DIRETO na tabela;
--      chamada em `lead-webhook/index.ts:878`. Cito por nome de função, sem
--      linha: `pipeline-adapter.ts` está com edição em andamento nesta branch
--      (task #22, `git status` = ` M`) e qualquer número que eu escrevesse
--      envelheceria hoje mesmo. A decisão E (limpar `place_in_pipe` do n8n)
--      continua sendo pré-requisito — mas, pelo item A, ela sozinha também
--      não basta.
--
--   C. Os triggers `INSTEAD OF INSERT` das views existem e estão ativos —
--      medido: `trg_pipe_whatsapp_insert`, `trg_pipe_confirmacao_insert`,
--      `trg_pipe_propostas_insert`, os 3 com `tgenabled='O'`, cada um
--      inserindo em `pipeline_entries` via `pipe_<slug>_insert_fn()`.
--      Quem os alimenta é o FRONTEND (grep na branch, arquivos limpos):
--        src/modules/communication/hooks/useWhatsAppLeadIntegration.ts:180,190,199,270,285,297,408
--        src/modules/leads/hooks/useLeadAllPipelines.ts:270,280,291
--        src/modules/pipelines/hooks/custom/useCustomPipelines.ts:915,925,935
--      Parte disso É o clique que a D1 quer preservar; parte é automático
--      (o hook do WhatsApp). Separar os dois é trabalho de outra fatia.
--
--   D. `trg_sync_custom_pipe_to_entries` (AFTER INSERT OR DELETE OR UPDATE em
--      `custom_pipe_entries`, ativo) espelha todo card custom para
--      `pipeline_entries`. Escritores medidos:
--        src/modules/pipelines/lib/stageTransition.ts:37
--        src/modules/communication/hooks/useWhatsAppLeadIntegration.ts:225,330
--        supabase/functions/_shared/action-handlers/move-stage.ts:110,131
--        supabase/functions/disparo-planilha-create/index.ts:281
--        + a função `import_lead_into_custom_pipeline` (existe em prod).
--
-- ── ONDE A FLAG DE FATO MORDE ──────────────────────────────────────────────
-- Nos caminhos que inserem em `leads` e NÃO semeiam explicitamente — ou seja,
-- onde este trigger é o único semeador. Medido:
--   - Criação manual pela UI: `useCreateLead`
--     (src/modules/leads/hooks/useLeads.ts:157-161) faz `.from("leads")
--     .insert(...)` e não cria entry nenhuma.
--   - `import-leads` quando o import não escolhe funil de destino (o seed de
--     lá é condicional a `destination`, supabase/functions/import-leads/index.ts:866).
--   - Qualquer INSERT direto em `leads` (SQL, backfill, seed de QA).
--
-- Resumo honesto: esta migration entrega o INTERRUPTOR e fecha o caminho mais
-- silencioso. Ela NÃO entrega o resultado de produto "negócio nasce só de
-- clique" — falta o item A, que é código de edge function, e as decisões E/F.
--
-- ── ⚠️ A FLAG É LIDA NO COMMIT, NÃO NO INSERT ──────────────────────────────
-- Medido (`pg_get_triggerdef`):
--   CREATE CONSTRAINT TRIGGER trg_auto_assign_lead_default_pipe
--     AFTER INSERT ON public.leads DEFERRABLE INITIALLY DEFERRED ...
-- Constraint trigger `INITIALLY DEFERRED` executa no fim da transação. Logo o
-- `SELECT` da flag acontece no COMMIT, não na hora do `INSERT INTO leads`.
-- Consequências:
--
--   a) Numa MESMA transação, `INSERT INTO leads` PRIMEIRO e
--      `UPDATE organizations SET feature_flags = ...` DEPOIS ainda faz o
--      trigger enxergar o valor NOVO: ele só roda no commit, quando a
--      atualização (ainda não commitada, mas visível para a própria
--      transação) já está lá. A ordem das linhas no script não é a ordem da
--      decisão.
--   b) Import longo (uma transação que insere milhares de leads e commita
--      minutos depois) decide TUDO pelo valor lido no commit. Não existe
--      "metade semeada": ou todos os leads daquela transação ganham card, ou
--      nenhum. Se a intenção for congelar o comportamento, ligue/desligue a
--      flag ANTES de abrir a transação de import.
--   c) NÃO MEDIDO: o que exatamente o trigger enxerga quando OUTRA transação
--      commita a mudança da flag enquanto a transação de import está aberta.
--      Depende de regra de snapshot em READ COMMITTED e não testei. Não
--      confie nessa janela; trate flip de flag como operação de janela calma.
--
-- Não troquei o trigger por um `AFTER INSERT` normal para "consertar" isso: o
-- DEFERRED é o que dá à função a chance de ver entries criadas pela mesma
-- transação (guardas 1 e 2). Mexer nisso é mudança de semântica, não de flag.
--
-- ── POR QUE A EXPRESSÃO DA FLAG DIFERE DO SKETCH DO PLANO ──────────────────
-- O plano escrevia `coalesce((feature_flags->>'deal_manual_only')::boolean,
-- false)`. Não usei, por duas razões concretas:
--
--   1. `::boolean` sobre texto arbitrário de jsonb LEVANTA EXCEÇÃO. Testado:
--      `SELECT 'sim'::boolean` devolve `invalid input syntax for type boolean:
--      "sim"` (22P02). Se alguém gravar `{"deal_manual_only": "sim"}`, o cast
--      estoura — e estoura DENTRO do trigger, no COMMIT, derrubando o
--      `INSERT INTO leads` inteiro. Uma flag de rollout capaz de impedir a
--      criação de leads é armadilha, não interruptor.
--   2. A semântica documentada da coluna é estritamente booleano `true`:
--      `COMMENT ON COLUMN organizations.feature_flags` diz "Estritamente
--      `true` ativa (hook useFeatureFlag)", e o hook faz
--      `query.data?.[key] === true` (src/modules/platform/hooks/useFeatureFlag.ts:51).
--      O espelho SQL exato disso é `feature_flags -> 'k' = 'true'::jsonb` —
--      casa o booleano JSON `true` e recusa a string `"true"`, igual ao
--      frontend. `->>` seria mais frouxo que o hook e criaria divergência
--      banco↔UI.
-- Resultado: `coalesce(feature_flags -> 'deal_manual_only' = 'true'::jsonb,
-- false)`. Chave ausente → `->` devolve NULL → comparação NULL → `false`.
-- Nunca levanta exceção. Se o CTO preferir a versão com cast, é uma linha —
-- mas o modo de falha acima é real, não hipotético.
--
-- ── DRIFT: O CORPO EM PROD ESTÁ ADIANTE DO REPO ────────────────────────────
-- A última versão desta função versionada no repo é
-- `20260622180000_cal_leads_skip_whatsapp_default_pipe.sql`. O corpo VIVO em
-- prod tem um passo a mais que NENHUM arquivo do repo contém — o guard
-- `app.skip_default_pipe` (grep por `skip_default_pipe` em `supabase/` e
-- `src/`: zero ocorrências). Ele é setado por `import_lead_into_custom_pipeline`
-- (medido: `strpos(prosrc, 'skip_default_pipe') > 0` casa exatamente 2 funções
-- em prod — essa e esta), função que também subiu direto pra prod sem
-- migration (drift já registrado em 20270729000010:226).
--
-- Por isso o corpo abaixo é cópia fiel de `pg_get_functiondef` LIDO EM PROD em
-- 2026-07-31, não do arquivo de 20260622180000. Escrever a partir do repo
-- apagaria o guard `app.skip_default_pipe` e reintroduziria o bug de card
-- duplicado no import de funil custom. Efeito colateral desejado: o repo passa
-- a conter o corpo real, e o drift dessa função morre aqui.
--
-- §DIVERGÊNCIA — o corpo abaixo difere do de prod em EXATAMENTE dois pontos,
-- e nenhum outro. Se você está revisando com um diff ao lado, são estes:
--   1. O bloco `(F)` + a variável `v_manual_only`. É a mudança da task.
--   2. Um sufixo `-- metric-lint-allow: ...` na linha `AND type = 'system'`
--      do passo (3). NÃO é cosmético por capricho: `scripts/check-metric-
--      antipatterns.sh` (bloqueante no CI) reprova `type = 'system'` como
--      predicado em migration NOVA, regra R3 do ADR-0017. Verificado rodando o
--      script: sem o sufixo, este arquivo FALHA.
--      A regra existe para métrica que cega funil custom; aqui o predicado não
--      agrega nada — é o resolvedor do funil-padrão do próprio trigger, e
--      "parametrizar por pipeline_id" (a correção que a regra pede) não faz
--      sentido: é justamente ESTA consulta que descobre qual é o pipeline_id.
--      Trocá-la mudaria o comportamento do trigger dentro de uma migration que
--      promete não mudar comportamento nenhum para quem não tem a flag.
--      Suprimi a linha em vez de mexer nela, e registro aqui por quê.
--      (Não usei o baseline `scripts/metric-antipatterns-baseline.txt`: ele é
--      ratchet que só encolhe; acrescentar arquivo novo a ele afrouxa a trava
--      para sempre, enquanto o sufixo é local e auditável.)
--
-- ── ESTA MIGRATION NÃO ACENDE NADA ─────────────────────────────────────────
-- Zero `UPDATE organizations`. Medido em prod: 96 orgs, 0 com a chave
-- `deal_manual_only`, 0 com `feature_flags` NULL (coluna é NOT NULL DEFAULT
-- '{}'::jsonb). Portanto, aplicada sozinha, esta migration é COMPORTAMENTALMENTE
-- INERTE: as 96 orgs caem no `coalesce(..., false)` e seguem exatamente como
-- hoje. Ligar é ato separado do CTO e depende de auditar os workflows n8n
-- (decisão E) E de gatear as edge functions do item A — sem isso, acender a
-- flag na Milennials não produz o efeito que o piloto quer medir.
--
-- Comando para o piloto, quando o CTO decidir (NÃO executar aqui):
--   UPDATE public.organizations
--      SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
--                          || '{"deal_manual_only": true}'::jsonb
--    WHERE id = '6030520a-2ca7-477d-be89-55758e2cd808';
--
-- ── O QUE MUDA NA ORG QUE LIGAR (custo operacional, não só técnico) ────────
-- Restrito aos caminhos da seção "ONDE A FLAG DE FATO MORDE" — lead vindo de
-- WhatsApp/Meta/Copilot continua ganhando card pelo item A, e para esses nada
-- disso vale.
--
-- Nos caminhos que a flag alcança, o lead novo passa a existir SÓ na tela de
-- Leads: não aparece em funil nenhum até alguém clicar. E os sete triggers de
-- `pipeline_entries` que hoje disparam no INSERT do card deixam de disparar
-- para esse lead (medidos): trg_pe_snapshot_responsibles, trg_enforce_closed_at,
-- trg_apply_stage_checklist_pipeline, trg_meeting_events_capture,
-- trg_pipeline_entries_dispatch, trg_pipeline_entries_stage_event_insert,
-- trg_sync_whatsapp_stage_to_lead.
-- Em prosa: time que trabalha só pelo kanban para de ver o lead criado na mão,
-- e automação pendurada no card `whatsapp/novo` para de rodar para ele. É
-- exatamente o que a D1 pede — mas é mudança de rotina do vendedor, não só de
-- banco. Por isso o rollout é por org e começa na casa.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Duas alavancas, do mais barato para o mais caro:
--
--   1. OPERACIONAL (segundos, sem deploy, é o caminho normal): desligar a flag
--      da org. O código gateado volta a semear no próximo COMMIT.
--        UPDATE public.organizations
--           SET feature_flags = feature_flags - 'deal_manual_only'
--         WHERE id = '<org>';
--      Isso NÃO recria cards que deixaram de nascer enquanto a flag esteve
--      ligada — a migration não guarda o que não criou. Recuperar exige
--      backfill a partir de `leads` sem card, decidido caso a caso.
--
--   2. ESTRUTURAL (desfaz esta migration): recriar a função sem o bloco `(F)`,
--      isto é, o corpo de prod lido em 2026-07-31 — que é ESTE arquivo menos o
--      bloco `(F)` e menos a variável `v_manual_only` (o sufixo
--      `metric-lint-allow` pode ficar; é comentário). Atenção: NÃO reaplicar
--      `20260622180000_cal_leads_skip_whatsapp_default_pipe.sql` como rollback;
--      aquele arquivo não tem o guard `app.skip_default_pipe` e o rollback
--      viraria uma regressão (ver seção DRIFT).
--
-- Não criei arquivo em `supabase/migrations/rollback/` — dos três irmãos desta
-- fatia (…000010, …000020, …000030) só o …000020 tem um; a convenção não é
-- uniforme e o rollback aqui é o texto acima. Se o orquestrador quiser o
-- arquivo, é copiar este corpo sem o bloco `(F)`.
-- ============================================================================

-- ── 1. A função ────────────────────────────────────────────────────────────
-- Cópia fiel de pg_get_functiondef (prod, 2026-07-31) + o bloco (F).
-- SECURITY DEFINER e `SET search_path` preservados: a função é dona `postgres`
-- (medido `rolbypassrls = true`) e `organizations` tem RLS ligado mas
-- `relforcerowsecurity = false` — ou seja, a leitura da flag NÃO passa por RLS
-- e devolve a linha independentemente de quem inseriu o lead (webhook com
-- service_role, usuário logado, ou cron). Perder o SECURITY DEFINER faria a
-- flag ser lida por um papel sujeito às policies de `organizations`, a linha
-- sumir, o `coalesce` cair em `false` — e a flag seria silenciosamente
-- ignorada. Falha silenciosa, o pior tipo. NÃO REMOVER.
CREATE OR REPLACE FUNCTION public.fn_auto_assign_lead_default_pipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_stage_exists boolean;
  v_manual_only boolean;
BEGIN
  -- (-1) Chamador declarou que já vai colocar o lead num funil nesta mesma
  -- transação (ver import_lead_into_custom_pipeline). O guard (2) abaixo não
  -- cobre esse caso: quando o trigger roda, a entry custom ainda não existe.
  IF coalesce(current_setting('app.skip_default_pipe', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  -- (F) Org optou por "negócio nasce só de clique" (decisões D1 + D7).
  -- Fica ANTES de todo o resto porque é o gate mais largo: org que desligou o
  -- auto-seed não deveria nem consultar pipelines/pipeline_stages. Colocado
  -- DEPOIS de (-1) só porque (-1) é de graça (lê GUC de sessão, não o banco).
  --
  -- Comparação jsonb estrita (`= 'true'::jsonb`), NÃO cast `::boolean`:
  -- espelha `useFeatureFlag` (`=== true`) e não pode levantar 22P02 dentro do
  -- COMMIT — ver cabeçalho, seção "POR QUE A EXPRESSÃO DIFERE DO SKETCH".
  --
  -- Chave ausente → NULL → coalesce → false → semeia como sempre semeou.
  -- Org inexistente (não deveria acontecer: `leads.organization_id` tem FK)
  -- → SELECT INTO não acha linha → v_manual_only fica NULL → coalesce externo
  -- → false. Fail-open deliberado: uma flag de rollout jamais deve ser o
  -- motivo de um lead não entrar na base.
  SELECT coalesce(o.feature_flags -> 'deal_manual_only' = 'true'::jsonb, false)
    INTO v_manual_only
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF coalesce(v_manual_only, false) THEN
    RETURN NULL;
  END IF;

  -- (0) Cal.com: lead já entra em confirmacao (reunião agendada) — nunca semear whatsapp/novo.
  IF NEW.origin = 'cal' THEN
    RETURN NULL;
  END IF;

  -- (1) já está em pipeline_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (2) já está em custom_pipe_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.custom_pipe_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (3) org tem pipeline system whatsapp ativo?
  SELECT id
    INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND type = 'system' -- metric-lint-allow: não é métrica; é o resolvedor do funil-padrão preservado de prod (ver cabeçalho §DIVERGÊNCIA)
    AND slug = 'whatsapp'
    AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (4) stage 'novo' existe e está ativo nesse pipeline?
  SELECT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = NEW.organization_id
      AND pipeline_type = 'whatsapp'
      AND stage_key = 'novo'
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RETURN NULL;
  END IF;

  -- (5) cria entry whatsapp/novo
  INSERT INTO public.pipeline_entries (
    organization_id,
    pipeline_id,
    lead_id,
    stage_key,
    entered_at,
    stage_changed_at
  ) VALUES (
    NEW.organization_id,
    v_pipeline_id,
    NEW.id,
    'novo',
    NOW(),
    NOW()
  );

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'Semeia pipeline_entries(whatsapp/novo) no INSERT de lead. Respeita a flag '
  'por org organizations.feature_flags.deal_manual_only (decisões D1/D7 — '
  '"negócio nasce só de clique"). Roda como CONSTRAINT TRIGGER DEFERRABLE '
  'INITIALLY DEFERRED: a flag é lida no COMMIT, não no INSERT. ⚠️ Gatear esta '
  'função NÃO impede a criação automática de card na ingestão: lead-service '
  '(getOrCreateLead) e lead-webhook semeiam whatsapp/novo em código de edge '
  'function, sem ler feature_flags — com a flag ON eles deixam de encontrar a '
  'entry e passam a criá-la, efeito líquido zero nesses caminhos. A flag morde '
  'em criação manual/import sem funil/INSERT direto. Ver migration '
  '20270730000040.';

-- ── 2. ACL ─────────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE` preserva o proacl existente — medido em prod:
-- {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}.
-- `anon` já está fora. Os REVOKEs abaixo não mudam nada em prod HOJE; existem
-- para o replay em ambiente novo, onde a função pode ser criada do zero e este
-- projeto concede `anon` NOMINALMENTE via ALTER DEFAULT PRIVILEGES — caso em
-- que `REVOKE ... FROM PUBLIC` sozinho é no-op sobre o grant nominal
-- (gotcha já pago em Tier A / PR #1015).
-- `authenticated` mantém EXECUTE porque é o estado medido e trocá-lo não é
-- escopo desta task. Não é superfície: é função `RETURNS trigger`, chamada
-- direta devolve "trigger functions can only be called as triggers", e o
-- EXECUTE nem é consultado quando o trigger dispara.
REVOKE ALL     ON FUNCTION public.fn_auto_assign_lead_default_pipe() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auto_assign_lead_default_pipe() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_auto_assign_lead_default_pipe() TO authenticated, service_role;

-- ── 3. Verificação — aborta a transação se qualquer peça faltar ────────────
-- Verificação ESTRUTURAL, e digo isso explicitamente: ela prova que o corpo
-- novo contém a flag e não perdeu nenhum passo antigo. Ela NÃO prova o
-- comportamento com a flag ligada — isso exigiria INSERT de lead real, que
-- dispara 20+ triggers (webhooks, workflows, calendar) e violaria a regra
-- "migration só mexe em schema". O teste de comportamento é de QA, na branch.
DO $$
DECLARE
  v_src        text;
  v_secdef     boolean;
  v_cfg        text[];
  v_returns    int;
  v_deferred   boolean;
  v_enabled    "char";
  v_flag_orgs  int;
  v_anon_exec  boolean;
  v_missing    text := '';
BEGIN
  SELECT p.prosrc, p.prosecdef, p.proconfig
    INTO v_src, v_secdef, v_cfg
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_auto_assign_lead_default_pipe';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.fn_auto_assign_lead_default_pipe() não existe após o replace.';
  END IF;

  -- 3a. A flag entrou. Sem isto, a migration não fez nada do que promete.
  IF strpos(v_src, 'deal_manual_only') = 0 THEN
    RAISE EXCEPTION 'FAIL: a função não referencia deal_manual_only — o gate por org não foi aplicado.';
  END IF;
  IF strpos(v_src, '''true''::jsonb') = 0 THEN
    RAISE EXCEPTION 'FAIL: comparação da flag não é jsonb estrita — ver cabeçalho (cast ::boolean pode levantar 22P02 no COMMIT).';
  END IF;

  -- 3b. Nenhum passo anterior sumiu. Cada string abaixo é a assinatura de um
  -- guard que já existia em prod; perder qualquer uma é regressão silenciosa
  -- (card duplicado, lead do Cal.com em dois funis, seed em org sem stage).
  IF strpos(v_src, 'app.skip_default_pipe')              = 0 THEN v_missing := v_missing || ' (-1)skip_default_pipe'; END IF;
  IF strpos(v_src, 'NEW.origin = ''cal''')               = 0 THEN v_missing := v_missing || ' (0)cal'; END IF;
  IF strpos(v_src, 'FROM public.pipeline_entries')       = 0 THEN v_missing := v_missing || ' (1)ja-em-pipeline_entries'; END IF;
  IF strpos(v_src, 'FROM public.custom_pipe_entries')    = 0 THEN v_missing := v_missing || ' (2)ja-em-custom_pipe_entries'; END IF;
  IF strpos(v_src, 'FROM public.pipelines')              = 0 THEN v_missing := v_missing || ' (3)resolve-pipeline'; END IF;
  IF strpos(v_src, 'slug = ''whatsapp''')                = 0 THEN v_missing := v_missing || ' (3)slug-whatsapp'; END IF;
  IF strpos(v_src, 'type = ''system''')                  = 0 THEN v_missing := v_missing || ' (3)type-system'; END IF;
  IF strpos(v_src, 'FROM public.pipeline_stages')        = 0 THEN v_missing := v_missing || ' (4)resolve-stage'; END IF;
  IF strpos(v_src, 'stage_key = ''novo''')               = 0 THEN v_missing := v_missing || ' (4)stage-novo'; END IF;
  IF strpos(v_src, 'INSERT INTO public.pipeline_entries')= 0 THEN v_missing := v_missing || ' (5)insert'; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'FAIL: passo(s) perdido(s) no replace:%. O corpo tem que ser o de prod + o bloco (F), nada a menos.', v_missing;
  END IF;

  -- 3c. Contagem de saídas. Pega o caso em que a string do guard sobreviveu
  -- num comentário mas o `RETURN NULL` correspondente sumiu. Eram 7 em prod;
  -- com o bloco (F) são 8.
  SELECT count(*) INTO v_returns FROM regexp_matches(v_src, 'RETURN NULL;', 'g');
  IF v_returns <> 8 THEN
    RAISE EXCEPTION 'FAIL: esperava 8 saídas RETURN NULL (7 de prod + a da flag), encontrei %. Algum guard virou comentário sem corpo.', v_returns;
  END IF;

  -- 3d. Blindagem preservada. Perder qualquer um dos dois faz a leitura da
  -- flag passar por RLS de organizations e a flag ser ignorada em silêncio.
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'FAIL: função perdeu SECURITY DEFINER — a flag seria lida sob RLS e ignorada silenciosamente.';
  END IF;
  IF v_cfg IS NULL OR NOT (v_cfg @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'FAIL: função perdeu SET search_path=public, pg_temp (proconfig=%).', v_cfg;
  END IF;

  -- 3e. O trigger continua sendo constraint trigger DEFERRED e ligado. Toda a
  -- seção "a flag é lida no COMMIT" do cabeçalho depende disto ser verdade.
  SELECT (t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0), t.tgenabled
    INTO v_deferred, v_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc  p ON p.oid = t.tgfoid
  WHERE c.relname = 'leads'
    AND t.tgname  = 'trg_auto_assign_lead_default_pipe'
    AND p.proname = 'fn_auto_assign_lead_default_pipe'
    AND NOT t.tgisinternal;
  IF v_deferred IS NULL THEN
    RAISE EXCEPTION 'FAIL: trigger trg_auto_assign_lead_default_pipe não existe em leads apontando para esta função.';
  END IF;
  IF NOT v_deferred THEN
    RAISE EXCEPTION 'FAIL: trg_auto_assign_lead_default_pipe deixou de ser CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED — o cabeçalho desta migration passa a mentir.';
  END IF;
  IF v_enabled <> 'O' THEN
    RAISE EXCEPTION 'FAIL: trg_auto_assign_lead_default_pipe está desabilitado (tgenabled=%).', v_enabled;
  END IF;

  -- 3f. ACL: anon não executa.
  SELECT has_function_privilege('anon', 'public.fn_auto_assign_lead_default_pipe()', 'EXECUTE')
    INTO v_anon_exec;
  IF v_anon_exec THEN
    RAISE EXCEPTION 'FAIL: anon ainda tem EXECUTE na função (grant nominal via ALTER DEFAULT PRIVILEGES).';
  END IF;

  -- 3g. AUDITORIA, NÃO ASSERÇÃO. Esta migration não liga a flag pra ninguém, e
  -- 0 orgs a tinham em prod em 2026-07-31. Mas isto é NOTICE e não EXCEPTION
  -- de propósito: no dia em que o CTO ligar o piloto, um replay do repo numa
  -- branch nova encontraria a org acesa, e um RAISE aqui derrubaria o replay
  -- por um fato correto. Asserção sobre estado que outro ator legitimamente
  -- muda é armadilha, não guarda.
  SELECT count(*) INTO v_flag_orgs
  FROM public.organizations
  WHERE feature_flags -> 'deal_manual_only' = 'true'::jsonb;

  RAISE NOTICE 'OK: auto-seed gateado por organizations.feature_flags.deal_manual_only. Orgs com a flag ligada agora: % (esta migration não ligou nenhuma).', v_flag_orgs;
END;
$$;
