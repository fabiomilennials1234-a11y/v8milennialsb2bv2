-- Ensaio TRANSACIONAL da 20270907000000 contra PROD. Termina em ROLLBACK.
-- Nada é gravado. Mede antes → aplica → mede depois → desfaz.
BEGIN;

CREATE TEMP TABLE _r(ordem int, etapa text, medida text, valor text) ON COMMIT DROP;

-- ── ANTES ────────────────────────────────────────────────────────────────
INSERT INTO _r
SELECT 1, 'antes', o.name || ' — cards contando como PERDA no funil whatsapp',
       count(*) FILTER (WHERE s.stage_role::text = 'lost')::text
FROM public.pipeline_entries pe
JOIN public.pipeline_stages s
  ON s.organization_id = pe.organization_id
 AND s.pipeline_type = 'whatsapp' AND s.stage_key = pe.stage_key
JOIN public.organizations o ON o.id = pe.organization_id
GROUP BY o.name;

INSERT INTO _r
SELECT 2, 'antes', 'system_stage_role(whatsapp, nao_compareceu)',
       public.system_stage_role('whatsapp','nao_compareceu')::text;

INSERT INTO _r
SELECT 3, 'antes', 'etapas de falta marcadas como perda',
       count(*)::text
FROM public.pipeline_stages
WHERE pipeline_type='whatsapp' AND stage_key IN ('nao_compareceu','no_show')
  AND (stage_role='lost' OR is_final_negative);

-- Fotografia do estado ANTES — a guarda 7/8 compara contra isto, e não contra
-- um ideal calculado.
CREATE TEMP TABLE _papeis_antes ON COMMIT DROP AS
SELECT id, stage_role::text AS stage_role_antes, is_final_negative AS is_final_negative_antes
FROM public.pipeline_stages;

-- ── APLICA (corpo da migration) ──────────────────────────────────────────
\i supabase/migrations/20270907000000_no_show_nao_e_perda.sql

-- ── DEPOIS ───────────────────────────────────────────────────────────────
INSERT INTO _r
SELECT 4, 'depois', o.name || ' — cards contando como PERDA no funil whatsapp',
       count(*) FILTER (WHERE s.stage_role::text = 'lost')::text
FROM public.pipeline_entries pe
JOIN public.pipeline_stages s
  ON s.organization_id = pe.organization_id
 AND s.pipeline_type = 'whatsapp' AND s.stage_key = pe.stage_key
JOIN public.organizations o ON o.id = pe.organization_id
GROUP BY o.name;

INSERT INTO _r
SELECT 5, 'depois', 'system_stage_role(whatsapp, nao_compareceu)',
       public.system_stage_role('whatsapp','nao_compareceu')::text;

INSERT INTO _r
SELECT 6, 'depois', 'etapas de falta marcadas como perda',
       count(*)::text
FROM public.pipeline_stages
WHERE pipeline_type='whatsapp' AND stage_key IN ('nao_compareceu','no_show')
  AND (stage_role='lost' OR is_final_negative);

-- Nada além das etapas de falta pode ter mudado de papel.
--
-- 🚨 A primeira versão desta guarda comparava `stage_role` com
-- `system_stage_role(...)` e contava as divergências. Isso NÃO é um delta: é
-- uma condição parada, que dá o mesmo número antes e depois da migration —
-- devolveu 2 nas duas pontas e me fez procurar um estrago que não existia.
-- Guarda tem de comparar o depois com o ANTES, não com um ideal.
INSERT INTO _r
SELECT 7, 'guarda', 'etapas fora de (nao_compareceu,no_show) que mudaram de papel',
       count(*)::text
FROM _papeis_antes a
JOIN public.pipeline_stages s ON s.id = a.id
WHERE s.stage_key NOT IN ('nao_compareceu','no_show')
  AND s.stage_role::text IS DISTINCT FROM a.stage_role_antes;

-- Quantas mudaram tem de ser exatamente quantas casavam o predicado antes.
-- Número fixo aqui seria armadilha: eu escrevi "2" e o certo era 3, porque uma
-- terceira org tinha o papel certo e só a flag errada. A guarda passa a se
-- comparar com a medida 3, em vez de com a minha expectativa.
INSERT INTO _r
SELECT 8, 'guarda', 'faltas que mudaram = faltas que casavam antes',
       (
         SELECT count(*)::text FROM _papeis_antes a
         JOIN public.pipeline_stages s ON s.id = a.id
         WHERE s.stage_key IN ('nao_compareceu','no_show')
           AND (s.stage_role::text IS DISTINCT FROM a.stage_role_antes
                OR s.is_final_negative IS DISTINCT FROM a.is_final_negative_antes)
       ) || ' de ' || (
         SELECT count(*)::text FROM _papeis_antes a
         JOIN public.pipeline_stages s ON s.id = a.id
         WHERE s.stage_key IN ('nao_compareceu','no_show')
           AND (a.stage_role_antes = 'lost' OR a.is_final_negative_antes)
       );

SELECT ordem, etapa, medida, valor FROM _r ORDER BY ordem, medida;

ROLLBACK;
