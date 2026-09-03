#!/usr/bin/env bash
# ensaio-etapa2-calor.sh — ensaio ABORTÁVEL da 20270925000000 contra PROD.
#
# Roda a migration inteira dentro de UMA transação, prova que ela faz o que diz,
# e dá ROLLBACK. Nada é escrito em produção. Não substitui o apply: substitui a
# descoberta de que a migration não compila DEPOIS de já ter derrubado meia
# aplicação.
#
# O que o ensaio prova, nesta ordem:
#   1. As guardas G0..G3 passam contra o estado real de hoje.
#   2. O backup captura exatamente o que existe na origem (rating e calor).
#   3. As 13 cirurgias de corpo casam com o corpo VIVO — se alguma não casar,
#      `_cirurgia` levanta exceção em vez de virar no-op silencioso.
#   4. As 4 funções de assinatura recriada devolvem, para 3 ORGS REAIS, o MESMO
#      resultado de hoje, campo a campo, exceto o campo removido.
#   5. As asserções finais (8.1..8.7) passam, incluindo os grants do backup.
#   6. ROLLBACK.
#
# Uso:  bash scripts/ensaio-etapa2-calor.sh
# Saída esperada na última linha: ENSAIO_OK
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$RAIZ/supabase/migrations/20270925000000_aposenta_calor_e_rating.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$MIGRATION" ] || { echo "migration não encontrada: $MIGRATION" >&2; exit 1; }

# Três orgs reais, escolhidas por terem volume de rating e de entries:
ORG_A='76f57482-19b7-445f-9bc6-846ce66d3fc7'   # 369 leads,   85 com rating
ORG_B='163874dd-d05c-4ae2-811a-d6772b05dac5'   # 3067 leads, 465 com rating
ORG_C='6e5f6a20-04e2-4611-839c-6de15996af31'   # 885 leads,   40 com rating
PIPE_A='a22d13b4-75a3-4c55-8d0c-61328cd668af'
PIPE_B='2213999f-877b-48cf-bae2-0f66135db339'
PIPE_C='0d207c4a-4359-44cf-9d90-c1be962f9fc9'

{
  echo 'BEGIN;'
  echo "SET LOCAL statement_timeout = '600s';"

  # ---------------------------------------------------------------- ANTES ----
  # Gabarito: o resultado de HOJE das funções que vão ser recriadas, para as 3
  # orgs. Guardado em tabela temporária DENTRO da mesma transação — é o único
  # jeito de comparar antes/depois sem escrever nada permanente.
  cat <<'ANTES'
CREATE TEMP TABLE _antes_list AS
  SELECT 'A'::text AS org, id, name, company, email, phone, origin,
         qualification_score, tier_efetivo, tags, responsible_id, sdr_id, closer_id,
         sold, sale_value, created_at
  FROM public.api_list_leads(p_org := 'ORGA'::uuid, p_limit := 200)
  UNION ALL
  SELECT 'B', id, name, company, email, phone, origin, qualification_score, tier_efetivo,
         tags, responsible_id, sdr_id, closer_id, sold, sale_value, created_at
  FROM public.api_list_leads(p_org := 'ORGB'::uuid, p_limit := 200)
  UNION ALL
  SELECT 'C', id, name, company, email, phone, origin, qualification_score, tier_efetivo,
         tags, responsible_id, sdr_id, closer_id, sold, sale_value, created_at
  FROM public.api_list_leads(p_org := 'ORGC'::uuid, p_limit := 200);

CREATE TEMP TABLE _antes_counts AS
  SELECT 'A'::text AS org, * FROM public.get_pipeline_stage_counts_by_id('PIPEA'::uuid, 'ORGA'::uuid)
  UNION ALL
  SELECT 'B', * FROM public.get_pipeline_stage_counts_by_id('PIPEB'::uuid, 'ORGB'::uuid)
  UNION ALL
  SELECT 'C', * FROM public.get_pipeline_stage_counts_by_id('PIPEC'::uuid, 'ORGC'::uuid);

CREATE TEMP TABLE _antes_page AS
  SELECT 'A'::text AS org, id, pipeline_id, lead_id, stage_key, assigned_to, notes,
         metadata, entered_at, stage_changed_at, created_at, updated_at,
         (lead - 'rating') AS lead_sem_rating
  FROM public.get_pipeline_page(p_pipeline_id := 'PIPEA'::uuid, p_org_id := 'ORGA'::uuid, p_page_size := 100)
  UNION ALL
  SELECT 'B', id, pipeline_id, lead_id, stage_key, assigned_to, notes, metadata,
         entered_at, stage_changed_at, created_at, updated_at, (lead - 'rating')
  FROM public.get_pipeline_page(p_pipeline_id := 'PIPEB'::uuid, p_org_id := 'ORGB'::uuid, p_page_size := 100)
  UNION ALL
  SELECT 'C', id, pipeline_id, lead_id, stage_key, assigned_to, notes, metadata,
         entered_at, stage_changed_at, created_at, updated_at, (lead - 'rating')
  FROM public.get_pipeline_page(p_pipeline_id := 'PIPEC'::uuid, p_org_id := 'ORGC'::uuid, p_page_size := 100);

CREATE TEMP TABLE _antes_get AS
  SELECT l.id AS lead_id, (public.api_get_lead(l.organization_id, l.id) - 'rating') AS doc
  FROM public.leads l
  WHERE l.organization_id IN ('ORGA'::uuid,'ORGB'::uuid,'ORGC'::uuid)
    AND l.deleted_at IS NULL
  ORDER BY l.id LIMIT 60;

CREATE TEMP TABLE _antes_origem AS
  SELECT (SELECT count(*) FROM public.leads WHERE rating IS NOT NULL)            AS rating_total,
         (SELECT count(*) FROM public.leads WHERE rating IS NOT NULL AND rating <> 0) AS rating_opiniao,
         (SELECT count(*) FROM public.pipeline_entries WHERE metadata ? 'calor') AS calor_total,
         (SELECT count(*) FROM public.pipeline_entries
            WHERE metadata ? 'calor' AND NULLIF(metadata->>'calor','') IS NOT NULL) AS calor_valor;
ANTES

  # ------------------------------------------------------------ MIGRATION ----
  echo "-- === aplicando a migration (em transacao) ==="
  cat "$MIGRATION"

  # ---------------------------------------------------------------- DEPOIS ---
  cat <<'DEPOIS'
-- === provas pos-migration ===
DO $prova$
DECLARE
  v_a bigint; v_b bigint; v_dif bigint; v_org record;
BEGIN
  -- P1 — o backup bate com o que a origem tinha ANTES do drop.
  SELECT rating_total INTO v_a FROM _antes_origem;
  SELECT count(*) INTO v_b FROM backup.leads_rating_20270925;
  IF v_a <> v_b THEN RAISE EXCEPTION 'P1: backup de rating tem % linhas, origem tinha %.', v_b, v_a; END IF;
  SELECT rating_opiniao INTO v_a FROM _antes_origem;
  SELECT count(*) INTO v_b FROM backup.leads_rating_20270925 WHERE e_opiniao;
  IF v_a <> v_b THEN RAISE EXCEPTION 'P1: backup marcou % opiniões, origem tinha %.', v_b, v_a; END IF;
  RAISE NOTICE 'P1 OK — backup rating: % linhas, % com opinião real.',
    (SELECT count(*) FROM backup.leads_rating_20270925),
    (SELECT count(*) FROM backup.leads_rating_20270925 WHERE e_opiniao);

  -- P2 — idem para o calor.
  SELECT calor_total INTO v_a FROM _antes_origem;
  SELECT count(*) INTO v_b FROM backup.entry_calor_20270925;
  IF v_a <> v_b THEN RAISE EXCEPTION 'P2: backup de calor tem % linhas, origem tinha %.', v_b, v_a; END IF;
  SELECT calor_valor INTO v_a FROM _antes_origem;
  SELECT count(*) INTO v_b FROM backup.entry_calor_20270925 WHERE calor IS NOT NULL;
  IF v_a <> v_b THEN RAISE EXCEPTION 'P2: backup tem % calores com valor, origem tinha %.', v_b, v_a; END IF;
  RAISE NOTICE 'P2 OK — backup calor: % linhas, % com valor.',
    (SELECT count(*) FROM backup.entry_calor_20270925),
    (SELECT count(*) FROM backup.entry_calor_20270925 WHERE calor IS NOT NULL);

  -- P3 — o calor NÃO foi apagado da linha viva (Seção 7 é decisão, não descuido).
  SELECT calor_total INTO v_a FROM _antes_origem;
  SELECT count(*) INTO v_b FROM public.pipeline_entries WHERE metadata ? 'calor';
  IF v_a <> v_b THEN RAISE EXCEPTION 'P3: a migration mexeu no metadata (% -> %). Não devia.', v_a, v_b; END IF;
  RAISE NOTICE 'P3 OK — % entradas seguem com a chave calor, sem leitor.', v_b;
END
$prova$;

-- === paridade das funcoes recriadas ===
DO $par$
DECLARE v_dif bigint;
BEGIN
  -- P4 — api_list_leads: mesmas linhas, mesmos campos, menos `rating`.
  WITH depois AS (
    SELECT 'A'::text AS org, id, name, company, email, phone, origin, qualification_score,
           tier_efetivo, tags, responsible_id, sdr_id, closer_id, sold, sale_value, created_at
    FROM public.api_list_leads(p_org := 'ORGA'::uuid, p_limit := 200)
    UNION ALL
    SELECT 'B', id, name, company, email, phone, origin, qualification_score, tier_efetivo,
           tags, responsible_id, sdr_id, closer_id, sold, sale_value, created_at
    FROM public.api_list_leads(p_org := 'ORGB'::uuid, p_limit := 200)
    UNION ALL
    SELECT 'C', id, name, company, email, phone, origin, qualification_score, tier_efetivo,
           tags, responsible_id, sdr_id, closer_id, sold, sale_value, created_at
    FROM public.api_list_leads(p_org := 'ORGC'::uuid, p_limit := 200)
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT * FROM _antes_list EXCEPT ALL SELECT * FROM depois)
    UNION ALL
    (SELECT * FROM depois EXCEPT ALL SELECT * FROM _antes_list)
  ) d;
  IF v_dif > 0 THEN RAISE EXCEPTION 'P4: api_list_leads divergiu em % linha(s).', v_dif; END IF;
  RAISE NOTICE 'P4 OK — api_list_leads idêntica em 3 orgs (% linhas).', (SELECT count(*) FROM _antes_list);

  -- P5 — get_pipeline_stage_counts_by_id: contagens não podem mudar. Os 4
  --      parâmetros removidos eram todos DEFAULT NULL, ou seja, inertes quando
  --      não enviados: o resultado TEM que ser bit a bit o mesmo.
  WITH depois AS (
    SELECT 'A'::text AS org, * FROM public.get_pipeline_stage_counts_by_id('PIPEA'::uuid, 'ORGA'::uuid)
    UNION ALL SELECT 'B', * FROM public.get_pipeline_stage_counts_by_id('PIPEB'::uuid, 'ORGB'::uuid)
    UNION ALL SELECT 'C', * FROM public.get_pipeline_stage_counts_by_id('PIPEC'::uuid, 'ORGC'::uuid)
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT * FROM _antes_counts EXCEPT ALL SELECT * FROM depois)
    UNION ALL (SELECT * FROM depois EXCEPT ALL SELECT * FROM _antes_counts)
  ) d;
  IF v_dif > 0 THEN RAISE EXCEPTION 'P5: contagens de etapa divergiram em % linha(s).', v_dif; END IF;
  RAISE NOTICE 'P5 OK — contagens de etapa idênticas (% linhas).', (SELECT count(*) FROM _antes_counts);

  -- P6 — get_pipeline_page: tudo igual, e o jsonb do lead igual DEPOIS de tirar
  --      `rating` dos dois lados (o de antes tinha, o de depois não pode ter).
  WITH depois AS (
    SELECT 'A'::text AS org, id, pipeline_id, lead_id, stage_key, assigned_to, notes,
           metadata, entered_at, stage_changed_at, created_at, updated_at,
           (lead - 'rating') AS lead_sem_rating
    FROM public.get_pipeline_page(p_pipeline_id := 'PIPEA'::uuid, p_org_id := 'ORGA'::uuid, p_page_size := 100)
    UNION ALL
    SELECT 'B', id, pipeline_id, lead_id, stage_key, assigned_to, notes, metadata,
           entered_at, stage_changed_at, created_at, updated_at, (lead - 'rating')
    FROM public.get_pipeline_page(p_pipeline_id := 'PIPEB'::uuid, p_org_id := 'ORGB'::uuid, p_page_size := 100)
    UNION ALL
    SELECT 'C', id, pipeline_id, lead_id, stage_key, assigned_to, notes, metadata,
           entered_at, stage_changed_at, created_at, updated_at, (lead - 'rating')
    FROM public.get_pipeline_page(p_pipeline_id := 'PIPEC'::uuid, p_org_id := 'ORGC'::uuid, p_page_size := 100)
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT * FROM _antes_page EXCEPT ALL SELECT * FROM depois)
    UNION ALL (SELECT * FROM depois EXCEPT ALL SELECT * FROM _antes_page)
  ) d;
  IF v_dif > 0 THEN RAISE EXCEPTION 'P6: get_pipeline_page divergiu em % linha(s).', v_dif; END IF;
  RAISE NOTICE 'P6 OK — get_pipeline_page idêntica fora do campo removido (% linhas).',
    (SELECT count(*) FROM _antes_page);

  -- P7 — api_get_lead: o documento inteiro igual, menos a chave `rating`.
  WITH depois AS (
    SELECT a.lead_id, public.api_get_lead(l.organization_id, l.id) AS doc
    FROM _antes_get a JOIN public.leads l ON l.id = a.lead_id
  )
  SELECT count(*) INTO v_dif
  FROM _antes_get a JOIN depois d ON d.lead_id = a.lead_id
  WHERE a.doc IS DISTINCT FROM d.doc;
  IF v_dif > 0 THEN RAISE EXCEPTION 'P7: api_get_lead divergiu em % documento(s) fora do campo removido.', v_dif; END IF;

  -- P7b — e o campo removido REALMENTE saiu (senão P7 passaria por engano).
  SELECT count(*) INTO v_dif
  FROM _antes_get a JOIN public.leads l ON l.id = a.lead_id
  WHERE public.api_get_lead(l.organization_id, l.id) ? 'rating';
  IF v_dif > 0 THEN RAISE EXCEPTION 'P7b: % documento(s) ainda trazem a chave rating.', v_dif; END IF;
  RAISE NOTICE 'P7 OK — api_get_lead idêntica em % documentos, e sem a chave rating.',
    (SELECT count(*) FROM _antes_get);
END
$par$;

-- === o gatilho que quebraria todo UPDATE de lead ===
DO $trg$
DECLARE v_id uuid; v_org uuid;
BEGIN
  -- P8 — a prova que importa: um UPDATE real de lead, com a coluna já dropada e
  --      os dois gatilhos AFTER UPDATE armados. Se 'rating' tivesse ficado nos
  --      arrays de fn_track_lead_field_changes / trigger_workflow_field_changed,
  --      esta linha explodiria com «column "rating" not found in data type leads»
  --      — que é exatamente o que aconteceria em produção, no primeiro lead que
  --      alguém editasse.
  SELECT id, organization_id INTO v_id, v_org FROM public.leads
  WHERE organization_id = 'ORGA'::uuid AND deleted_at IS NULL LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'P8: não achei lead para o teste.'; END IF;
  UPDATE public.leads SET notes = COALESCE(notes,'') || ' [ensaio]' WHERE id = v_id;
  RAISE NOTICE 'P8 OK — UPDATE de lead passou pelos dois gatilhos sem erro.';
END
$trg$;

DO $ok$ BEGIN RAISE NOTICE 'ENSAIO_OK'; END $ok$;
SELECT 'ENSAIO_OK' AS veredito;
DEPOIS

  echo 'ROLLBACK;'
} > "$TMP/ensaio.sql"

# Substitui os placeholders pelas UUIDs reais.
sed -i '' -e "s/ORGA/$ORG_A/g"  -e "s/ORGB/$ORG_B/g"  -e "s/ORGC/$ORG_C/g" \
          -e "s/PIPEA/$PIPE_A/g" -e "s/PIPEB/$PIPE_B/g" -e "s/PIPEC/$PIPE_C/g" \
          "$TMP/ensaio.sql"

echo "ensaio montado: $(wc -l < "$TMP/ensaio.sql") linhas"
node "$RAIZ/scripts/prod-sql.mjs" --file "$TMP/ensaio.sql"
