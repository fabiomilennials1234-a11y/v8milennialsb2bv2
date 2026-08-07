-- ROLLBACK de 20270730000050_deal_por_lead_destrava.sql (fatia 2 — Lead ↔ Negócio)
--
-- SCRUM-248. A migration original já trazia o roteiro deste rollback em prosa
-- (seção "ROLLBACK" no rodapé dela). Este arquivo é o roteiro virado SQL
-- executável: rollback que ninguém consegue rodar sem transcrever é rollback que
-- não existe, e o dia de rodar não é o dia de transcrever.
--
-- 🔴 ESTE ROLLBACK TEM JANELA, E A JANELA FECHA SOZINHA.
-- A migration derruba os três cadeados que garantiam 1 entry por (lead, funil).
-- Enquanto NENHUM lead tiver 2 entries no mesmo funil, recriar os cadeados é
-- reversível. Depois da primeira recompra, recriar exige APAGAR negócio de
-- cliente — e apagar negócio é apagar venda (`sale_events` é imutável por
-- `trg_sale_events_immutable`). A seção 0 abaixo mede a janela e ABORTA se ela
-- já fechou; ela é a parte mais importante do arquivo.
--
-- ORDEM OBRIGATÓRIA: funções ANTES dos índices.
-- Índice de volta + função ainda em UPDATE/INSERT é só menos eficiente. O
-- contrário — função com `ON CONFLICT` e o índice ainda fora — é 42P10 duro na
-- cara do usuário, no `BulkMoveDialog`, em 5 telas.
--
-- O QUE ESTE ROLLBACK **NÃO** DESFAZ, de propósito:
--   • Os REVOKE da seção 1b da migration. `anon` não volta a executar
--     `bulk_add_to_custom_pipe`: aquele grant era herdado do `ALTER DEFAULT
--     PRIVILEGES`, não é o que a migration quebrou, e reconcedê-lo reabriria uma
--     SECURITY DEFINER de tenant à anon key que vive no bundle do frontend.
--   • O `deal_id` das entries. Ele é de outra migration.
--
-- EFEITOS COLATERAIS DE VOLTAR, para ninguém se surpreender:
--   • `merge_leads` volta a pré-deletar colisões (mesclar dois duplicados no
--     mesmo funil volta a dar 1 card, não 2 negócios);
--   • `sync_custom_pipe_to_entries` volta a poder levantar 23505 quando uma org
--     tentar a segunda entry em funil custom.

BEGIN;

-- ── 0. A JANELA — aborta se recompra já existe ──────────────────────────────
--
-- As duas contagens têm que ser 0. Baseline medido em prod 2026-07-31,
-- imediatamente antes do apply: 0 e 0, sobre 36.727 e 16.195 linhas. Se você
-- está lendo isto depois do apply, o número de hoje é o que vale — esse é
-- justamente o ponto.
DO $$
DECLARE v_pe bigint; v_ce bigint;
BEGIN
  SELECT count(*) INTO v_pe FROM (
    SELECT pipeline_id, lead_id FROM public.pipeline_entries
     WHERE lead_id IS NOT NULL
     GROUP BY 1, 2 HAVING count(*) > 1
  ) x;

  SELECT count(*) INTO v_ce FROM (
    SELECT pipeline_id, lead_id FROM public.custom_pipe_entries
     GROUP BY 1, 2 HAVING count(*) > 1
  ) y;

  IF v_pe > 0 OR v_ce > 0 THEN
    RAISE EXCEPTION
      'JANELA FECHADA: % par(es) (funil, lead) com mais de uma entry em pipeline_entries e % em custom_pipe_entries. Recriar os cadeados agora exigiria APAGAR negócio de cliente — e apagar negócio apaga venda (sale_events é imutável). Este rollback não roda. Se a intenção é desligar recompra daqui para a frente sem destruir o passado, o caminho é código (esconder o botão / gatear a criação do segundo negócio), não schema.',
      v_pe, v_ce;
  END IF;

  RAISE NOTICE 'JANELA ABERTA: 0 duplicatas nas duas tabelas. Rollback pode prosseguir.';
END$$;


-- ── 1. As duas funções voltam à forma `ON CONFLICT` ─────────────────────────
--
-- FONTE: `supabase/migrations/20260101000000_baseline_prod_schema.sql`
-- (bulk_add_to_custom_pipe :1373-1440, bulk_move_stage :1531-1592) — copiadas
-- verbatim de lá, incluindo os comentários sem acento do original.
--
-- ⚠️ NÃO tente recuperar estes corpos com `pg_get_functiondef` contra prod ou
-- contra uma branch efêmera criada a partir dela: depois do apply as duas
-- devolvem o corpo NOVO. O baseline versionado é a única fonte que o apply não
-- destrói.
--
-- `CREATE OR REPLACE` (não DROP + CREATE): REPLACE preserva o ACL. DROP + CREATE
-- zeraria os grants e os recriaria pelo `ALTER DEFAULT PRIVILEGES` do projeto,
-- que concede a `anon` — ou seja, reabriria exatamente o que a seção 1b fechou.

CREATE OR REPLACE FUNCTION public.bulk_move_stage(
  p_lead_ids uuid[],
  p_target_pipe text,
  p_target_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master  boolean := public.is_master_user();
  v_member_org uuid;
  v_lead_id    uuid;
  v_lead_org   uuid;
  v_pipeline_id uuid;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Pipeline de sistema alvo, dentro da org do lead
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.slug = p_target_pipe
      AND p.organization_id = v_lead_org
      AND p.type = 'system' -- metric-lint-allow: predicado PRESERVADO verbatim do baseline; é roteamento entre as duas RPCs (funis de sistema por slug × funil custom por pipeline_id), não filtro de métrica.
    LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.pipeline_entries (
      organization_id, pipeline_id, lead_id, stage_key, stage_changed_at, entered_at
    ) VALUES (
      v_lead_org, v_pipeline_id, v_lead_id, p_target_stage, now(), now()
    )
    ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
      stage_key = EXCLUDED.stage_key,
      stage_changed_at = now(),
      updated_at = now();
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(
  p_lead_ids uuid[],
  p_pipeline_id uuid,
  p_stage_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master  boolean := public.is_master_user();
  v_member_org uuid;
  v_lead_id    uuid;
  v_lead_org   uuid;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Funil custom alvo deve pertencer a org do lead e estar ativo
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipelines cp
      WHERE cp.id = p_pipeline_id
        AND cp.organization_id = v_lead_org
        AND cp.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Etapa alvo deve pertencer ao funil
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipeline_stages cps
      WHERE cps.id = p_stage_id
        AND cps.pipeline_id = p_pipeline_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.custom_pipe_entries (
      organization_id, pipeline_id, lead_id, stage_id, entered_at, stage_changed_at
    ) VALUES (
      v_lead_org, p_pipeline_id, v_lead_id, p_stage_id, now(), now()
    )
    ON CONFLICT (pipeline_id, lead_id) DO UPDATE SET
      stage_id = EXCLUDED.stage_id,
      stage_changed_at = now(),
      updated_at = now();
  END LOOP;
END;
$function$;


-- ── 2. Os três cadeados de volta ────────────────────────────────────────────
--
-- `lock_timeout` pelo mesmo motivo da migration: `ALTER TABLE ... ADD CONSTRAINT`
-- e `CREATE UNIQUE INDEX` tomam ACCESS EXCLUSIVE em `pipeline_entries` (a tabela
-- mais quente do produto) e o push roda tudo numa transação — o lock fica retido
-- até o COMMIT. Falhar rápido e reaplicar em janela calma é estritamente melhor
-- do que enfileirar todo o tráfego de escrita atrás do ALTER.
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.pipeline_entries
  ADD CONSTRAINT uq_pipeline_entries_pipeline_lead UNIQUE (pipeline_id, lead_id);

ALTER TABLE public.custom_pipe_entries
  ADD CONSTRAINT custom_pipe_entries_pipeline_id_lead_id_key UNIQUE (pipeline_id, lead_id);

-- O terceiro é índice único PARCIAL — `ADD CONSTRAINT UNIQUE` não aceita
-- predicado, então tem que ser `CREATE UNIQUE INDEX`. SEM `CONCURRENTLY`, porque
-- CONCURRENTLY não roda dentro de transação e este arquivo é transacional.
--
-- Se em algum apply não se puder travar escrita na tabela, a variante manual é
-- rodar SÓ esta linha fora do push, com CONCURRENTLY:
--   CREATE UNIQUE INDEX CONCURRENTLY idx_pipeline_entries_pipeline_lead
--     ON public.pipeline_entries (pipeline_id, lead_id) WHERE (lead_id IS NOT NULL);
-- (CONCURRENTLY pode terminar INVALID se houver duplicata; o índice fica lá,
-- inválido e inútil, e precisa de DROP INDEX antes de nova tentativa. Confira
-- com `SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_...'::regclass`.)
CREATE UNIQUE INDEX idx_pipeline_entries_pipeline_lead
  ON public.pipeline_entries (pipeline_id, lead_id) WHERE (lead_id IS NOT NULL);


-- ── 3. Verificação (aborta) ─────────────────────────────────────────────────
DO $$
DECLARE v_n integer; r record;
BEGIN
  -- 3a. Os três, pelo nome, escopados por schema e tabela (`conname` não é
  -- único no banco — a unicidade de catálogo é por (conrelid, contypid, conname)).
  SELECT count(*) INTO v_n
  FROM pg_constraint c
  JOIN pg_class c2     ON c2.oid = c.conrelid
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
  WHERE c.conname IN ('uq_pipeline_entries_pipeline_lead',
                      'custom_pipe_entries_pipeline_id_lead_id_key')
    AND n2.nspname = 'public'
    AND c2.relname IN ('pipeline_entries', 'custom_pipe_entries');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperava as 2 constraints de volta, achei %.', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace
  WHERE n.nspname = 'public' AND i.relname = 'idx_pipeline_entries_pipeline_lead';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: idx_pipeline_entries_pipeline_lead não voltou.';
  END IF;

  -- 3b. As duas funções voltaram à forma ON CONFLICT — é isto que impede o
  -- 42P10 ao contrário (índice de volta, função ainda em UPDATE/INSERT não
  -- quebra; função com ON CONFLICT sem índice, sim).
  FOR r IN
    SELECT p.proname, p.prosrc, p.prosecdef, p.oid::regprocedure AS sig,
           COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('bulk_move_stage', 'bulk_add_to_custom_pipe')
  LOOP
    IF r.prosrc !~* 'on\s+conflict\s*\(\s*pipeline_id\s*,\s*lead_id\s*\)' THEN
      RAISE EXCEPTION 'FAIL: % não voltou para ON CONFLICT (pipeline_id, lead_id).', r.proname;
    END IF;
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'FAIL: % perdeu SECURITY DEFINER no rollback.', r.proname;
    END IF;
    IF r.cfg NOT LIKE '%search_path=public, pg_temp%' THEN
      RAISE EXCEPTION 'FAIL: % perdeu SET search_path no rollback (config = "%").', r.proname, r.cfg;
    END IF;
    IF r.prosrc NOT LIKE '%is_master_user()%'
       OR r.prosrc NOT LIKE '%No active organization membership%'
       OR r.prosrc NOT LIKE '%l.deleted_at IS NULL%' THEN
      RAISE EXCEPTION 'FAIL: % perdeu checagem de master/org/lead no rollback.', r.proname;
    END IF;

    -- O REVOKE da 1b NÃO é desfeito: `anon` continua fora, e isso é asserção,
    -- não sobra. `CREATE OR REPLACE` preserva ACL, então se `anon` aparecer aqui
    -- alguém trocou por DROP + CREATE em algum ponto e reabriu o buraco.
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION
        'FAIL: anon voltou a executar % — o rollback não deve reconceder esse grant (provavelmente virou DROP + CREATE em algum ponto).', r.sig;
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated perdeu EXECUTE em % — o bulk move quebraria.', r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'ROLLBACK OK: 3 cadeados de volta, bulk_* de volta ao ON CONFLICT com segurança e ACL intactos. Recompra está travada de novo.';
END$$;

COMMIT;
