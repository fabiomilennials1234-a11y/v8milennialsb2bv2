-- backfill-acoes-do-dia-org.sql
--
-- Preenche `acoes_do_dia.organization_id` nas linhas anteriores à migration
-- `20270825000030_acoes_do_dia_organization_id.sql`.
--
-- ⚠️ NÃO é migration, de propósito. A guarda F4 do repo (`scripts/db-push-branch.sh`)
-- recusa migration que toque dado de cliente sem `--allow-dml`, e o
-- `supabase/migrations/CLAUDE.md` fecha a questão: migration é só schema.
-- Rode este arquivo À MÃO, DEPOIS do apply da migration.
--
--   node scripts/prod-sql-win.mjs --file scripts/backfill-acoes-do-dia-org.sql
--
-- Enquanto não rodar, nada quebra: a policy nova exige
-- `organization_id IS NOT NULL`, então linha sem org continua visível só para o
-- dono. O sintoma é o admin ver a lista do time incompleta — nunca ver demais.
--
-- Medido no PROD em 2026-08-24: 63 linhas, 51 com `lead_id`, 20 usuários,
-- ZERO usuários em mais de uma org ativa (ou seja, o ramo 2 não é ambíguo hoje).

BEGIN;

-- 1) Pelo lead — o caminho preciso.
UPDATE public.acoes_do_dia a
   SET organization_id = l.organization_id
  FROM public.leads l
 WHERE a.organization_id IS NULL
   AND a.lead_id = l.id
   AND l.organization_id IS NOT NULL;

-- 2) Pelo assento ativo do usuário — só para o que sobrou sem lead.
--    O `LIMIT 1` seria arbitrário para usuário multi-org; a checagem logo
--    abaixo prova que hoje não existe nenhum, e ABORTA se passar a existir.
DO $$
DECLARE
  v_ambiguos integer;
BEGIN
  SELECT count(*) INTO v_ambiguos
  FROM (
    SELECT a.user_id
    FROM public.acoes_do_dia a
    WHERE a.organization_id IS NULL
    GROUP BY a.user_id
    HAVING (
      SELECT count(DISTINCT tm.organization_id)
      FROM public.team_members tm
      WHERE tm.user_id = a.user_id AND tm.is_active = true
    ) > 1
  ) x;

  IF v_ambiguos > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % usuario(s) com tarefa pendente estao em mais de uma org ativa. '
      'O fallback por assento escolheria a org arbitrariamente. Resolva a mao.',
      v_ambiguos;
  END IF;
END $$;

UPDATE public.acoes_do_dia a
   SET organization_id = (
         SELECT tm.organization_id
         FROM public.team_members tm
         WHERE tm.user_id = a.user_id
           AND tm.is_active = true
         LIMIT 1
       )
 WHERE a.organization_id IS NULL;

-- 3) Gabarito — o que sobrou sem org, e por quê.
SELECT
  count(*)                                          AS total,
  count(*) FILTER (WHERE organization_id IS NOT NULL) AS com_org,
  count(*) FILTER (WHERE organization_id IS NULL)     AS sem_org,
  count(*) FILTER (WHERE organization_id IS NULL AND lead_id IS NULL) AS sem_org_e_sem_lead
FROM public.acoes_do_dia;

COMMIT;
