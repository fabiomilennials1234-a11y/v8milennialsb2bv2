-- 20271122000000_feature_suggestions_first_run.sql
--
-- Widget de sugestões de funcionalidade, mostrado UMA vez por usuário ao abrir
-- o Torque (cross-device: o "já vi" mora no servidor, não no localStorage).
--
-- Duas tabelas, zero função nova:
--  1. user_prompt_impressions — "este usuário já viu este prompt". A linha nasce
--     ANTES do render: o front faz um INSERT simples e só abre o diálogo se ele
--     passar. 23505 (PK) = outra aba/device já viu → não mostra. É o claim
--     atômico; upsert não serve (ON CONFLICT engoliria a corrida).
--     `outcome` é write-once: NULL → dismissed|submitted, uma vez.
--  2. feature_suggestions — o texto da sugestão (PII livre). Uma por usuário e
--     origem (UNIQUE (user_id, source)); `source` reserva espaço para outras
--     portas no futuro sem afrouxar a deste.
--
-- Segurança:
--  - RLS INVOKER pura. `user_id` vem de DEFAULT auth.uid() e o cliente NÃO tem
--    grant na coluna: não dá para forjar dono nem no payload. A policy repete
--    `user_id = auth.uid()` como segunda trava.
--  - Grants por coluna depois de REVOKE ALL de PUBLIC/anon/authenticated: o
--    projeto Supabase tem ALTER DEFAULT PRIVILEGES que dá ALL a anon e
--    authenticated em tabela nova. Sem o REVOKE, anon nasceria com DELETE.
--  - Sem UPDATE/DELETE em feature_suggestions pelo cliente. Sem DELETE em
--    impressions: apagar a linha reabriria o prompt.
--  - Master lê tudo (suporte/produto), não escreve.

-- ============================================================================
-- 1. user_prompt_impressions
-- ============================================================================
CREATE TABLE public.user_prompt_impressions (
  user_id    uuid        NOT NULL DEFAULT auth.uid()
                         REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt_key text        NOT NULL
                         -- Allowlist: prompt novo = migration nova. Chave livre deixaria
                         -- qualquer usuário criar linhas sem limite pela API.
                         CONSTRAINT user_prompt_impressions_prompt_key_known
                         CHECK (prompt_key IN ('feature_suggestions_2026_10')),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  outcome    text
                         CONSTRAINT user_prompt_impressions_outcome_valid
                         CHECK (outcome IN ('dismissed', 'submitted')),
  CONSTRAINT user_prompt_impressions_pkey PRIMARY KEY (user_id, prompt_key)
);

COMMENT ON TABLE public.user_prompt_impressions IS
  'Prompts de primeira abertura já exibidos por usuário (cross-device). A linha nasce antes do render; 23505 = já visto. outcome é write-once.';

ALTER TABLE public.user_prompt_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY upi_select_own ON public.user_prompt_impressions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY upi_insert_own ON public.user_prompt_impressions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Write-once: só linha própria ainda sem desfecho, e só para um desfecho.
CREATE POLICY upi_update_outcome_once ON public.user_prompt_impressions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND outcome IS NULL)
  WITH CHECK (user_id = (SELECT auth.uid()) AND outcome IS NOT NULL);

CREATE POLICY upi_select_master ON public.user_prompt_impressions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

REVOKE ALL ON TABLE public.user_prompt_impressions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_prompt_impressions TO authenticated;
GRANT INSERT (prompt_key) ON TABLE public.user_prompt_impressions TO authenticated;
GRANT UPDATE (outcome) ON TABLE public.user_prompt_impressions TO authenticated;
GRANT ALL ON TABLE public.user_prompt_impressions TO service_role;

-- ============================================================================
-- 2. feature_suggestions
-- ============================================================================
CREATE TABLE public.feature_suggestions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL
                              REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL DEFAULT auth.uid()
                              REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text        NOT NULL
                              CONSTRAINT feature_suggestions_kind_valid
                              CHECK (kind IN ('feature', 'improvement', 'integration', 'other')),
  body            text        NOT NULL
                              -- Mede o texto CRU: medir só btrim(body) deixava passar
                              -- 'abc' + 10 milhões de espaços pela API. E btrim apara só
                              -- ' ': "\n\n\n" passava. Por classe [:space:] (espaço, \t,
                              -- \n, \r, \f, \v), o texto começa e termina em caractere
                              -- visível. O front é mais estrito (String#trim, Unicode).
                              CONSTRAINT feature_suggestions_body_valid
                              CHECK (
                                body ~ '^[^[:space:]]'
                                AND body ~ '[^[:space:]]$'
                                AND char_length(body) BETWEEN 3 AND 1000
                              ),
  source          text        NOT NULL DEFAULT 'first_run_prompt'
                              CONSTRAINT feature_suggestions_source_valid
                              CHECK (source IN ('first_run_prompt')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Anti-spam: uma sugestão por usuário e origem (hoje, só o prompt de primeira
  -- abertura). Começa por user_id, então também serve ao ON DELETE CASCADE de
  -- auth.users.
  CONSTRAINT feature_suggestions_one_per_user_source UNIQUE (user_id, source)
);

COMMENT ON TABLE public.feature_suggestions IS
  'Sugestões de funcionalidade enviadas pelos usuários. body é texto livre (PII possível): nunca em log, Sentry ou toast.';

CREATE INDEX feature_suggestions_organization_id_idx
  ON public.feature_suggestions (organization_id);

CREATE INDEX feature_suggestions_created_at_idx
  ON public.feature_suggestions (created_at DESC);

ALTER TABLE public.feature_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY fs_insert_own ON public.feature_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

CREATE POLICY fs_select_own ON public.feature_suggestions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY fs_select_master ON public.feature_suggestions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

-- Sem policy de UPDATE/DELETE: sugestão enviada é registro, não rascunho.

REVOKE ALL ON TABLE public.feature_suggestions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.feature_suggestions TO authenticated;
GRANT INSERT (organization_id, kind, body) ON TABLE public.feature_suggestions TO authenticated;
GRANT ALL ON TABLE public.feature_suggestions TO service_role;
