-- 20270906002000_cards_apontam_etapa_por_uuid.sql
--
-- SCRUM-617 · Funil é funil (Wave 2, F1/D3) — cards apontam a etapa por UUID:
-- `pipeline_entries.stage_id` FK real a `pipeline_stages(id)`; `stage_key` vira
-- espelho transitório mantido por trigger bidirecional. Rollback pareado em
-- supabase/migrations/rollback/20270906002000_cards_apontam_etapa_por_uuid.sql.
-- Ensaio transacional: scripts/ensaio-scrum617.sh (roda 20270906001000 + esta em
-- sequência — prod ainda não tem a 001000; NUNCA rodar sem janela do CTO).
--
-- PRÉ-REQUISITO: 20270906001000 (SCRUM-616) aplicada — esta migration resolve
-- por (pipeline_id, stage_key), que só existe (e só é UNIQUE) depois dela.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   1. `pipeline_entries.stage_id uuid REFERENCES pipeline_stages(id)
--      ON DELETE SET NULL` (NOT VALID → backfill → VALIDATE).
--   2. Backfill resolve por (pipeline_id, stage_key); reparo adicional dos
--      cards custom cujo stage_key guardou o UUID da etapa (bug vivo — ver
--      medição). Triggers de usuário desligados durante a carga (nenhum
--      workflow/dispatch retroativo).
--   3. Espelho bidirecional `trg_pe_stage_mirror` (BEFORE INSERT OR UPDATE):
--      escrita que muda stage_key resolve e grava stage_id; escrita que muda
--      stage_id grava stage_key. stage_id é o canônico (D3) quando os dois
--      mudam juntos.
--   4. Índice parcial em stage_id (WHERE stage_id IS NOT NULL).
--   5. Views pipe_* e custom_pipe_entries NÃO mudam de shape — os INSTEAD OF
--      seguem escrevendo stage_key na base; o espelho preenche stage_id.
--
-- ── MEDIDO EM PROD (2026-09-01, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · pipeline_entries: 47.741 linhas, 0 sem linha em pipelines.
--   · (pipeline_id, stage_key) resolve para 47.685 (99,88%). Órfãs: 56, todas
--     abertas (closed_at IS NULL) — duas causas distintas:
--     a) 40 em funis de SISTEMA — stage_key é rótulo cru que o lead-webhook
--        gravou sem validar ("Novo Lead", "Novo_Lead", "novo_lead" em org cujas
--        etapas usam outra key, "Lead Novo | Mensagem Inicial", "novo",
--        "reuniao_marcada", "ganho"). Orgs: Bertin 10 · Brasil Engrenagens 10 ·
--        Plinio 10 · TorqueCRM 5 · Three Therapy 3 · Forever Bella 1 ·
--        Dna de Almas 1. Etapa fantasma clássica (memória lead-webhook-ghost-
--        stage); o webhook só ganha 4xx na F3 (D6).
--     b) 16 em funis CUSTOM (Goletric Perdizes 8 · Goletric Pinheiros 8) —
--        stage_key guardou o UUID da etapa em vez da key. Em TODOS os 16 o
--        UUID aponta etapa VIVA do MESMO funil → recuperáveis por reparo
--        determinístico (stage_id = stage_key::uuid). Hoje esses cards são
--        invisíveis no kanban (agrupamento por stage_key não casa) — o reparo
--        também normaliza stage_key, corrigindo o bug.
--
-- ── DECISÕES DOCUMENTADAS ───────────────────────────────────────────────────
--
--   D-a stage_id NULLABLE até a demolição (F6): as 40 órfãs de sistema não têm
--       resolução determinística (a key não existe no funil — qualquer chute
--       moveria o card). NOT NULL só quando o webhook validar etapa (F3/D6) e
--       o resíduo for triado (SCRUM-618). Espelho stage_key preserva o dado.
--   D-b FK ON DELETE SET NULL — NUNCA CASCADE (deletaria Negócio). A deleção
--       de etapa hoje migra os cards antes (editor + RPC delete); SET NULL é a
--       rede para o resíduo que escapar, e o espelho stage_key preserva onde o
--       card estava. O diálogo definitivo "mover os N cards" é a D3 na F4.
--   D-c Reparo dos 16 uuid-keys normaliza TAMBÉM o stage_key (uuid → key real):
--       corrige bug vivo (cards fora do kanban) e mantém o invariante do
--       espelho limpo. Feito com triggers desligados — zero dispatch/workflow
--       retroativo. PERDA CONHECIDA E ACEITA no rollback: o stage_key desses
--       16 não volta ao uuid cru (é correção de dado, não regressão).
--   D-d Quando um UPDATE muda stage_id e stage_key juntos e eles divergem,
--       stage_id vence (D3: UUID é a identidade canônica) e o espelho reescreve
--       stage_key. Escritas só de stage_key (todos os escritores vivos hoje:
--       views pipe_*, sync de custom_pipe_entries, RPCs abrir/mover_negocio,
--       lead-webhook) resolvem stage_id; miss → stage_id NULL (fantasma
--       tolerado no W1 — comportamento de hoje, sem erro novo).
--   D-e SEM guarda pg_trigger_depth no espelho — DE PROPÓSITO: as escritas dos
--       INSTEAD OF (pipe_*) e do sync de custom_pipe_entries chegam com
--       pg_trigger_depth() >= 1 e PRECISAM ser espelhadas; uma guarda de depth
--       as pularia. Reentrância não existe: o trigger só muta NEW (zero DML),
--       não há como ele re-disparar a si mesmo.
--   D-f Nome `trg_pe_stage_mirror` ordena ANTES dos `trg_pipeline_*` (ordem
--       alfabética de BEFORE triggers): quando um escritor futuro mudar só
--       stage_id, o espelho já terá reescrito NEW.stage_key quando
--       trg_pipeline_entries_stage_changed_at avaliar o WHEN dele.
--   D-g LIMITAÇÃO documentada (fica para F2/F3): os AFTER UPDATE **OF
--       stage_key** (workflow stage_changed, dispatch, history, stage events)
--       disparam pela lista SET do statement — UPDATE que mude SÓ stage_id não
--       os aciona, mesmo com o espelho reescrevendo stage_key. Nenhum escritor
--       de stage_id existe no W1; o ticket que virar os escritores re-chaveia
--       esses triggers para stage_id.
--
-- metric-lint-allow: migração one-off de backfill de FK (SCRUM-617) — não é métrica

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Guarda de pré-requisito (SCRUM-616 aplicada) + snapshot pré-migração
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pipeline_stages'
                    AND column_name = 'pipeline_id') THEN
    RAISE EXCEPTION 'SCRUM617: pipeline_stages.pipeline_id não existe — aplicar 20270906001000 (SCRUM-616) antes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pipeline_stages'::regclass
                    AND conname = 'pipeline_stages_pipeline_id_stage_key_key') THEN
    RAISE EXCEPTION 'SCRUM617: UNIQUE (pipeline_id, stage_key) ausente — resolução seria ambígua; aplicar SCRUM-616 antes';
  END IF;
END;
$$;

CREATE TEMP TABLE _scrum617_pre ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.pipeline_entries)                             AS total,
  -- resolvíveis por (pipeline_id, stage_key) — o caminho normal
  (SELECT count(*) FROM public.pipeline_entries pe
    WHERE EXISTS (SELECT 1 FROM public.pipeline_stages ps
                   WHERE ps.pipeline_id = pe.pipeline_id
                     AND ps.stage_key   = pe.stage_key))                     AS resolviveis_key,  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-617)
  -- recuperáveis por uuid-key (stage_key guarda o uuid de etapa do MESMO funil)
  (SELECT count(*) FROM public.pipeline_entries pe
    WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                       WHERE ps.pipeline_id = pe.pipeline_id
                         AND ps.stage_key   = pe.stage_key)
      AND pe.stage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (SELECT 1 FROM public.pipeline_stages ps
                   WHERE ps.id          = pe.stage_key::uuid
                     AND ps.pipeline_id = pe.pipeline_id))                   AS recuperaveis_uuid;  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-617)

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Coluna + FK (NOT VALID → backfill → VALIDATE)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_entries
  ADD COLUMN stage_id uuid;

COMMENT ON COLUMN public.pipeline_entries.stage_id IS
  'FK real à etapa (pipeline_stages.id) — identidade canônica do card (D3). '
  'stage_key é espelho transitório mantido por trg_pe_stage_mirror até a F6. '
  'NULL somente em etapa fantasma (stage_key sem etapa correspondente — resíduo '
  'do lead-webhook pré-D6) e em resíduo de etapa deletada (FK SET NULL). SCRUM-617.';

ALTER TABLE public.pipeline_entries
  ADD CONSTRAINT pipeline_entries_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL
  NOT VALID;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Backfill com triggers de usuário desligados (nada de workflow/dispatch/
--    history retroativo; updated_at intocado — não é escrita de negócio)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_entries DISABLE TRIGGER USER;

-- 2a. Caminho normal: (pipeline_id, stage_key) → etapa. UNIQUE do SCRUM-616
--     garante resolução determinística.
UPDATE public.pipeline_entries pe
SET stage_id = ps.id
FROM public.pipeline_stages ps
WHERE pe.stage_id IS NULL
  AND ps.pipeline_id = pe.pipeline_id
  AND ps.stage_key   = pe.stage_key;  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-617)

-- 2b. Reparo uuid-key (D-c): stage_key guardou o UUID da etapa. Guarda dentro
--     da query (não confiar no plano): a etapa apontada tem de ser do MESMO
--     funil do card. Normaliza também o stage_key (corrige card invisível).
UPDATE public.pipeline_entries pe
SET stage_id  = ps.id,
    stage_key = ps.stage_key
FROM public.pipeline_stages ps
WHERE pe.stage_id IS NULL
  AND pe.stage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND ps.id          = pe.stage_key::uuid
  AND ps.pipeline_id = pe.pipeline_id;

ALTER TABLE public.pipeline_entries ENABLE TRIGGER USER;

ALTER TABLE public.pipeline_entries
  VALIDATE CONSTRAINT pipeline_entries_stage_id_fkey;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Índice parcial (joins por etapa + varredura da FK no DELETE de etapa)
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_pipeline_entries_stage_id
  ON public.pipeline_entries (stage_id)
  WHERE stage_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Espelho bidirecional (D-d/D-e/D-f)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pipeline_entries_stage_mirror()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
-- Espelho stage_id ↔ stage_key (SCRUM-617, D3). Só muta NEW — zero DML, logo
-- zero reentrância; guarda de pg_trigger_depth seria ERRADA aqui (as escritas
-- via INSTEAD OF das pipe_* e via sync de custom_pipe_entries chegam com
-- depth >= 1 e precisam ser espelhadas). Ver D-e no cabeçalho da migration.
DECLARE
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      -- stage_id é o canônico: valida e espelha a key (permite INSERT sem stage_key).
      SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
      END IF;
      IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
        RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
          NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
      END IF;
      NEW.stage_key := v_stage.stage_key;
    ELSE
      -- Escritores legados: resolve pela key; miss → NULL (fantasma tolerado, D-a).
      SELECT ps.id INTO NEW.stage_id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = NEW.pipeline_id
        AND ps.stage_key   = NEW.stage_key;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    -- Mudou o UUID (canônico, D-d — vence mesmo se stage_key mudou junto).
    SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
    END IF;
    IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
        NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
    END IF;
    NEW.stage_key := v_stage.stage_key;
  ELSIF NEW.stage_key    IS DISTINCT FROM OLD.stage_key
     OR NEW.pipeline_id  IS DISTINCT FROM OLD.pipeline_id
     OR (NEW.stage_id IS NULL AND OLD.stage_id IS NULL) THEN
    -- Mudou a key (ou o funil), ou o card é fantasma (stage_id NULL) sendo
    -- reescrito — re-resolve (cura oportunista quando a etapa passa a existir).
    -- No SET NULL da FK (etapa deletada) a resolução falha e o NULL fica,
    -- com stage_key preservado (D-b).
    SELECT ps.id INTO NEW.stage_id
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = NEW.pipeline_id
      AND ps.stage_key   = NEW.stage_key;
    IF NOT FOUND THEN
      NEW.stage_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- D-f: nome ordena antes dos trg_pipeline_* (BEFORE triggers disparam em ordem
-- alfabética) — o espelho roda primeiro e os WHEN deles veem o NEW já espelhado.
CREATE TRIGGER trg_pe_stage_mirror
  BEFORE INSERT OR UPDATE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_entries_stage_mirror();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Relatório das órfãs remanescentes (por org) — vai para o log da migration
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pe.organization_id, o.name AS org, pip.slug, pe.stage_key, count(*) AS n
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
    LEFT JOIN public.organizations o ON o.id = pe.organization_id
    WHERE pe.stage_id IS NULL
    GROUP BY 1, 2, 3, 4
    ORDER BY n DESC, org
  LOOP
    RAISE NOTICE 'SCRUM617 órfã: org=% (%) funil=% stage_key=% cards=%',
      r.org, r.organization_id, r.slug, r.stage_key, r.n;
  END LOOP;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Asserções — qualquer falha aborta a transação inteira
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pre          record;
  v_com        bigint;
  v_orfas      bigint;
  v_divergente bigint;
BEGIN
  SELECT * INTO pre FROM _scrum617_pre;

  -- 6.1 Cobertura exata: com stage_id = resolvíveis + recuperáveis do snapshot;
  --     órfãs = exatamente o resto (nada resolveu a mais nem a menos).
  SELECT count(*) FILTER (WHERE stage_id IS NOT NULL),
         count(*) FILTER (WHERE stage_id IS NULL)
    INTO v_com, v_orfas
  FROM public.pipeline_entries;
  IF v_com <> pre.resolviveis_key + pre.recuperaveis_uuid THEN
    RAISE EXCEPTION 'SCRUM617: % entries com stage_id, esperado % (% por key + % por uuid)',
      v_com, pre.resolviveis_key + pre.recuperaveis_uuid, pre.resolviveis_key, pre.recuperaveis_uuid;
  END IF;
  IF v_orfas <> pre.total - pre.resolviveis_key - pre.recuperaveis_uuid THEN
    RAISE EXCEPTION 'SCRUM617: % órfãs, esperado %', v_orfas,
      pre.total - pre.resolviveis_key - pre.recuperaveis_uuid;
  END IF;

  -- 6.2 Teto de sanidade: medido em prod 2026-09-01 = 40 órfãs pós-reparo
  --     (56 - 16 uuid-keys). Teto folgado para meia dúzia de fantasmas novos
  --     do webhook entre a medição e a janela; estouro = regressão sistêmica.
  IF v_orfas > 200 THEN
    RAISE EXCEPTION 'SCRUM617: % órfãs (>200) — muito acima das 40 medidas em 2026-09-01; investigar antes de aplicar', v_orfas;
  END IF;

  -- 6.3 Invariante do espelho: nenhum card com stage_id aponta etapa de outro
  --     funil nem carrega stage_key divergente.
  SELECT count(*) INTO v_divergente
  FROM public.pipeline_entries pe
  JOIN public.pipeline_stages ps ON ps.id = pe.stage_id
  WHERE ps.pipeline_id IS DISTINCT FROM pe.pipeline_id
     OR ps.stage_key   IS DISTINCT FROM pe.stage_key;
  IF v_divergente <> 0 THEN
    RAISE EXCEPTION 'SCRUM617: % cards com espelho divergente (funil ou key)', v_divergente;
  END IF;

  -- 6.4 FK validada, índice e trigger no lugar.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'pipeline_entries_stage_id_fkey' AND NOT convalidated) THEN
    RAISE EXCEPTION 'SCRUM617: FK pipeline_entries_stage_id_fkey não validada';
  END IF;
  IF to_regclass('public.idx_pipeline_entries_stage_id') IS NULL THEN
    RAISE EXCEPTION 'SCRUM617: índice idx_pipeline_entries_stage_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.pipeline_entries'::regclass
                    AND tgname = 'trg_pe_stage_mirror' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCRUM617: trigger trg_pe_stage_mirror ausente';
  END IF;

  -- 6.5 Shape intocado: as pipe_* seguem views com os 9 INSTEAD OF vivos
  --     (eles escrevem stage_key; o espelho preenche stage_id).
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid IN ('public.pipe_whatsapp'::regclass,
                           'public.pipe_confirmacao'::regclass,
                           'public.pipe_propostas'::regclass)
         AND NOT t.tgisinternal) <> 9 THEN
    RAISE EXCEPTION 'SCRUM617: INSTEAD OF das views pipe_* incompletos (esperado 9)';
  END IF;

  RAISE NOTICE 'SCRUM617 OK: %/% entries com stage_id (% pct) · % por key · % reparadas por uuid-key · % órfãs (stage_key preservado)',
    v_com, pre.total, round(100.0 * v_com / GREATEST(pre.total, 1), 2),
    pre.resolviveis_key, pre.recuperaveis_uuid, v_orfas;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Sonda do espelho nos DOIS sentidos — linha sintética em subtransação
--    abortada por sentinela (nada persiste, nem os efeitos dos AFTER triggers)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_pipe  uuid;
  v_org   uuid;
  v_lead  uuid;
  v_a     public.pipeline_stages%ROWTYPE;
  v_b     public.pipeline_stages%ROWTYPE;
  v_entry uuid := gen_random_uuid();
  v_check public.pipeline_entries%ROWTYPE;
BEGIN
  -- Candidatos: funil CUSTOM (dispatch/sync-whatsapp/workflow são no-op para
  -- custom) com 2+ etapas ativas 'open' fora de keys com semântica de gatilho,
  -- e um lead da org que ainda não está nesse funil (UNIQUE pipeline+lead).
  SELECT p.id, p.organization_id INTO v_pipe, v_org
  FROM public.pipelines p
  WHERE p.type = 'custom'
    AND (SELECT count(*) FROM public.pipeline_stages ps
          WHERE ps.pipeline_id = p.id AND ps.is_active
            AND ps.stage_role = 'open' AND ps.stage_key NOT IN ('agendado','compareceu')) >= 2
  LIMIT 1;

  IF v_pipe IS NULL THEN
    RAISE NOTICE 'SCRUM617 sonda: sem funil custom com 2+ etapas open — sonda pulada (ambiente sem massa)';
    RETURN;
  END IF;

  SELECT l.id INTO v_lead
  FROM public.leads l
  WHERE l.organization_id = v_org
    AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                     WHERE pe.pipeline_id = v_pipe AND pe.lead_id = l.id)
  LIMIT 1;

  IF v_lead IS NULL THEN
    RAISE NOTICE 'SCRUM617 sonda: sem lead disponível fora do funil % — sonda pulada', v_pipe;
    RETURN;
  END IF;

  SELECT * INTO v_a FROM public.pipeline_stages
  WHERE pipeline_id = v_pipe AND is_active AND stage_role = 'open' AND stage_key NOT IN ('agendado','compareceu')
  ORDER BY position LIMIT 1;
  SELECT * INTO v_b FROM public.pipeline_stages
  WHERE pipeline_id = v_pipe AND is_active AND stage_role = 'open' AND stage_key NOT IN ('agendado','compareceu')
    AND id <> v_a.id
  ORDER BY position LIMIT 1;

  BEGIN
    -- INSERT por stage_key → espelho resolve stage_id.
    INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
    VALUES (v_entry, v_org, v_pipe, v_lead, v_a.stage_key);
    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_entry;
    IF v_check.stage_id IS DISTINCT FROM v_a.id THEN
      RAISE EXCEPTION 'SCRUM617 SONDA FALHOU: INSERT por stage_key não resolveu stage_id (% vs %)',
        v_check.stage_id, v_a.id;
    END IF;

    -- UPDATE por stage_id → espelho grava stage_key.
    UPDATE public.pipeline_entries SET stage_id = v_b.id WHERE id = v_entry;
    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_entry;
    IF v_check.stage_key IS DISTINCT FROM v_b.stage_key THEN
      RAISE EXCEPTION 'SCRUM617 SONDA FALHOU: UPDATE por stage_id não espelhou stage_key (% vs %)',
        v_check.stage_key, v_b.stage_key;
    END IF;

    -- UPDATE por stage_key → espelho resolve stage_id de volta.
    UPDATE public.pipeline_entries SET stage_key = v_a.stage_key WHERE id = v_entry;
    SELECT * INTO v_check FROM public.pipeline_entries WHERE id = v_entry;
    IF v_check.stage_id IS DISTINCT FROM v_a.id THEN
      RAISE EXCEPTION 'SCRUM617 SONDA FALHOU: UPDATE por stage_key não resolveu stage_id (% vs %)',
        v_check.stage_id, v_a.id;
    END IF;

    -- Limpeza absoluta: aborta a subtransação de propósito (desfaz o card
    -- sintético E qualquer efeito de AFTER trigger — history, stage events).
    RAISE EXCEPTION 'SCRUM617_SONDA_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SCRUM617_SONDA_ROLLBACK' THEN
      RAISE;  -- falha real da sonda (ou de trigger a jusante) aborta a migration
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.pipeline_entries WHERE id = v_entry) THEN
    RAISE EXCEPTION 'SCRUM617 SONDA FALHOU: linha sintética sobreviveu à limpeza';
  END IF;

  RAISE NOTICE 'SCRUM617 sonda OK: espelho provado nos dois sentidos (funil %, etapas % ↔ %)',
    v_pipe, v_a.stage_key, v_b.stage_key;
END;
$$;
