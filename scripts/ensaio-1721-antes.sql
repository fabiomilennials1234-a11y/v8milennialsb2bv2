-- ============================================================================
-- ensaio-1721-antes.sql — ABRE a transação e NÃO a fecha.
--
-- NÃO rode este arquivo sozinho. Ele é a primeira das cinco partes que
-- scripts/ensaio-1721.sh concatena, nesta ordem:
--
--   1. scripts/ensaio-1721-antes.sql                                  (este)
--   2. supabase/migrations/20270823000000_blast_recipient_delivery_state.sql
--   3. scripts/ensaio-1721-verde.sql
--   4. supabase/migrations/rollback/20270823000000_blast_recipient_delivery_state.sql
--   5. scripts/ensaio-1721-depois.sql                       (ROLLBACK no fim)
--
-- As partes 2 e 4 entram por concatenação dos ARQUIVOS DE VERDADE, não de
-- cópias, para que o ensaio prove exatamente o que vai ser aplicado e
-- exatamente o que vai reverter.
--
-- GUARDA DE ESCRITA: este ensaio não faz UPDATE, DELETE, TRUNCATE nem COPY em
-- lugar nenhum. Os únicos INSERT são sondas, e cada sonda roda dentro de um
-- subbloco plpgsql que é abortado de propósito — a linha some antes da
-- instrução seguinte, sem precisar de DELETE. Por cima disso, a transação
-- inteira termina em ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout      = '5s';

-- ─── A SONDA ────────────────────────────────────────────────────────────────
-- Devolve o SQLSTATE que a tabela opõe a um status, ou 'ACEITO'. A linha
-- inserida nunca sobrevive: quando o INSERT passa, o subbloco é abortado de
-- propósito com '__reverter__', o que desfaz a subtransação e leva a linha
-- junto. É o que permite sondar o CHECK sem escrever nada.
CREATE FUNCTION pg_temp.e_sonda_status(p_plan uuid, p_status text)
RETURNS text LANGUAGE plpgsql AS $sonda$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status) VALUES (p_plan, p_status);
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__reverter__';
  EXCEPTION
    WHEN check_violation THEN RETURN '23514';
    WHEN raise_exception THEN
      IF SQLERRM = '__reverter__' THEN RETURN 'ACEITO'; END IF;
      RAISE;
  END;
  RETURN 'INESPERADO';
END
$sonda$;

-- Sonda do índice único: insere DUAS linhas com o mesmo provider_message_id e
-- devolve o que a segunda encontrou. Mesmo truque de reversão.
CREATE FUNCTION pg_temp.e_sonda_unico(p_plan uuid, p_pmid text)
RETURNS text LANGUAGE plpgsql AS $sonda$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status, provider_message_id)
      VALUES (p_plan, 'sent', p_pmid), (p_plan, 'sent', p_pmid);
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__reverter__';
  EXCEPTION
    WHEN unique_violation THEN RETURN '23505';
    WHEN undefined_column THEN RETURN '42703';
    WHEN raise_exception THEN
      IF SQLERRM = '__reverter__' THEN RETURN 'ACEITO'; END IF;
      RAISE;
  END;
  RETURN 'INESPERADO';
END
$sonda$;

-- Sonda dos NULLs: um índice único parcial tem de deixar vários NULL conviverem,
-- senão ele quebraria toda linha que ainda não recebeu callback.
CREATE FUNCTION pg_temp.e_sonda_nulos(p_plan uuid)
RETURNS text LANGUAGE plpgsql AS $sonda$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status, provider_message_id)
      VALUES (p_plan, 'sent', NULL), (p_plan, 'sent', NULL), (p_plan, 'sent', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__reverter__';
  EXCEPTION
    WHEN unique_violation THEN RETURN '23505';
    WHEN raise_exception THEN
      IF SQLERRM = '__reverter__' THEN RETURN 'ACEITO'; END IF;
      RAISE;
  END;
  RETURN 'INESPERADO';
END
$sonda$;

-- ─── MEDIÇÃO ANTES ──────────────────────────────────────────────────────────

-- Um plano real para pendurar as sondas (plan_id é NOT NULL com FK).
CREATE TEMP TABLE e_param AS
SELECT (SELECT id FROM public.blast_plans ORDER BY created_at LIMIT 1) AS plan_id;

CREATE TEMP TABLE e_antes_total AS
SELECT count(*)::bigint AS n FROM public.blast_plan_recipients;

-- LEFT JOIN de propósito: se existisse destinatário órfão de plano, ele tem de
-- aparecer na distribuição em vez de sumir da prova.
CREATE TEMP TABLE e_antes_dist AS
SELECT p.organization_id, r.status, count(*)::bigint AS n
FROM public.blast_plan_recipients r
LEFT JOIN public.blast_plans p ON p.id = r.plan_id
GROUP BY 1, 2;

CREATE TEMP TABLE e_antes_idx AS
SELECT c.relname::text AS nome, pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_antes_con AS
SELECT conname::text AS nome, pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_antes_pol AS
SELECT policyname::text AS nome, cmd::text AS cmd,
       coalesce(qual, '')::text AS qual, coalesce(with_check, '')::text AS wcheck,
       roles::text AS papeis
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'blast_plan_recipients';

CREATE TEMP TABLE e_antes_acl AS
SELECT r.rolname::text AS papel, pr.priv::text AS priv,
       has_table_privilege(r.rolname, 'public.blast_plan_recipients', pr.priv) AS tem
FROM pg_roles r,
     (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv) pr
WHERE r.rolname IN ('anon','authenticated','service_role','mcp_readonly');

CREATE TEMP TABLE e_antes_col AS
SELECT a.attname::text AS coluna, format_type(a.atttypid, a.atttypmod) AS tipo,
       a.attnotnull AS notnulo, coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS padrao
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.blast_plan_recipients'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped;

CREATE TEMP TABLE e_antes_trg AS
SELECT tgname::text AS nome FROM pg_trigger
WHERE tgrelid = 'public.blast_plan_recipients'::regclass AND NOT tgisinternal;

-- ─── VERMELHO ───────────────────────────────────────────────────────────────
DO $ensaio$
DECLARE
  v_total bigint;
  v_plan  uuid;
  v_r     text;
  v_check text;
BEGIN
  SELECT n INTO v_total FROM e_antes_total;
  SELECT plan_id INTO v_plan FROM e_param;

  -- CONTROLE POSITIVO. Provar "nada mudou" numa tabela vazia é verde por
  -- ausência: sem linha e sem plano, toda asserção de inércia passa sozinha.
  IF v_total = 0 OR v_plan IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CONTROLE VAZIO: % destinatarios, plano=%. A prova de inercia nao teria sujeito.', v_total, v_plan;
  END IF;

  -- A MEDIÇÃO QUE RESPONDE AO ITEM A DO CTO: o CHECK vivo, literal, lido do
  -- catálogo de produção — não do arquivo.
  SELECT def INTO v_check FROM e_antes_con WHERE nome = 'blast_plan_recipients_status_check';
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / SEM CHECK: blast_plan_recipients_status_check nao existe em producao. Todo o desenho deste ticket assume que existe.';
  END IF;
  RAISE NOTICE 'ENSAIO 1721 / CHECK VIVO MEDIDO: %', v_check;

  IF v_check NOT LIKE '%failed%' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / PREMISSA MORTA: o CHECK vivo nao tem failed. Medido: %. O ticket e o plano assumem os quatro estados.', v_check;
  END IF;

  -- O vermelho propriamente dito: hoje a tabela recusa os dois estados novos.
  v_r := pg_temp.e_sonda_status(v_plan, 'delivered');
  IF v_r <> '23514' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / VERMELHO NAO REPRODUZIDO: delivered devolveu % hoje, esperado 23514. Se ja passa, a migration nao tem o que provar.', v_r;
  END IF;

  v_r := pg_temp.e_sonda_status(v_plan, 'unconfirmed');
  IF v_r <> '23514' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / VERMELHO NAO REPRODUZIDO: unconfirmed devolveu % hoje, esperado 23514.', v_r;
  END IF;

  -- CONTROLE DA SONDA: se ela recusasse tudo, o vermelho acima seria artefato
  -- do instrumento e não fato da tabela.
  v_r := pg_temp.e_sonda_status(v_plan, 'pending');
  IF v_r <> 'ACEITO' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / SONDA QUEBRADA: pending devolveu %, esperado ACEITO. O instrumento esta recusando tudo.', v_r;
  END IF;

  -- E as colunas novas ainda não existem — 42703 prova que a sonda de unicidade
  -- do DEPOIS vai medir um índice recém-criado, não um pré-existente.
  v_r := pg_temp.e_sonda_unico(v_plan, 'ensaio-1721-pmid');
  IF v_r <> '42703' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / COLUNA JA EXISTE: provider_message_id devolveu % antes da migration, esperado 42703.', v_r;
  END IF;
END
$ensaio$;
