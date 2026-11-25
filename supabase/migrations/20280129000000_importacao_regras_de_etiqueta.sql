-- Importação de leads: etiqueta pela coluna da planilha, lembrada por organização.
--
-- ── Por que ───────────────────────────────────────────────────────────────
-- As etiquetas escolhidas no modal valem para o arquivo inteiro. A Café Jurerê
-- importou uma lista com três segmentos (Cafeteria, Empório, Hotel e Pousada) e
-- escolheu as três etiquetas: os 78 leads ficaram com as três (25/11/2026).
-- Com a flag `importacao_previa`, a pessoa liga cada valor de uma coluna a uma
-- etiqueta ("Cafeteria" → "Leads-Cafeterias/Padarias"). Esta tabela guarda o mapa
-- para a próxima planilha já vir preenchida.
--
-- ── Desenho ───────────────────────────────────────────────────────────────
-- Uma linha por (org, coluna, valor) → etiqueta. Coluna e valor são guardados
-- dobrados (minúsculos, sem acento, sem espaço nas pontas) — o front dobra antes de
-- gravar e de procurar. "Sem etiqueta" = ausência de linha.
-- A etiqueta precisa ser da mesma org: a policy confere, e a FK some com a etiqueta.
-- Escrita: qualquer membro da org (o mapa é conveniência de quem importa, não
-- permissão). A edge NÃO lê esta tabela: as etiquetas de cada linha chegam no corpo
-- do import e passam pela mesma validação de etiqueta da org (resolveImportTagIds).
--
-- Rollback: rollback/20280129000000_importacao_regras_de_etiqueta.sql

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.import_tag_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_column   text NOT NULL CHECK (length(source_column) BETWEEN 1 AND 120),
  source_value    text NOT NULL CHECK (length(source_value) BETWEEN 1 AND 200),
  tag_id          uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_tag_rules_unica UNIQUE (organization_id, source_column, source_value)
);

COMMENT ON TABLE public.import_tag_rules IS
  'Importação de leads: valor de uma coluna da planilha → etiqueta, lembrado por org (flag importacao_previa).';

CREATE INDEX IF NOT EXISTS import_tag_rules_tag_idx ON public.import_tag_rules (tag_id);

ALTER TABLE public.import_tag_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_tag_rules_select ON public.import_tag_rules
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

CREATE POLICY import_tag_rules_insert ON public.import_tag_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids()) OR (SELECT public.is_master_user()))
    AND EXISTS (
      SELECT 1 FROM public.tags t
       WHERE t.id = import_tag_rules.tag_id
         AND t.organization_id = import_tag_rules.organization_id
    )
  );

CREATE POLICY import_tag_rules_update ON public.import_tag_rules
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  )
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids()) OR (SELECT public.is_master_user()))
    AND EXISTS (
      SELECT 1 FROM public.tags t
       WHERE t.id = import_tag_rules.tag_id
         AND t.organization_id = import_tag_rules.organization_id
    )
  );

CREATE POLICY import_tag_rules_delete ON public.import_tag_rules
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

REVOKE ALL ON public.import_tag_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_tag_rules TO authenticated;
GRANT ALL ON public.import_tag_rules TO service_role;

COMMIT;
