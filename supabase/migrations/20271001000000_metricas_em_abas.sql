-- ============================================================
-- Métricas em abas: o painel deixa de ser um por organização
-- ============================================================
--
-- Hoje `metrics_studio_panels` tem UNIQUE em `organization_id`
-- (`metrics_studio_panels_org_unico`): uma org, um painel. É essa trava que
-- impede o Estúdio de ter abas — e derrubá-la é a fatia de banco inteira.
--
-- Medido antes: 14 painéis em 14 orgs, exatamente 1:1. Nenhuma org perde nada
-- ao ganhar `nome` e `ordem`: o painel existente vira a primeira aba.
--
-- ── O que NÃO muda ──
--
-- A RLS já é o que o CTO decidiu (03/09): SELECT por
-- `get_my_organization_ids()`, e INSERT/UPDATE/DELETE por
-- `get_my_team_admin_organization_ids()`. Aba é da ORGANIZAÇÃO, admin edita,
-- todos veem — mesmo modelo que já está live nas 107 orgs. Trocar isso agora
-- faria os 14 painéis existentes virarem de alguém.
--
-- `team_member_id` continua nulável e sem uso pela política. Ele é o gancho
-- para abas pessoais, se um dia forem pedidas; deixar a coluna quieta é mais
-- barato que removê-la e recriá-la.

-- ── 1. Cai a trava de painel único ──────────────────────────────────────────

DROP INDEX IF EXISTS public.metrics_studio_panels_org_unico;

-- ── 2. A aba ganha identidade ───────────────────────────────────────────────

ALTER TABLE public.metrics_studio_panels
  ADD COLUMN IF NOT EXISTS nome TEXT NOT NULL DEFAULT 'Painel',
  ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0,
  -- Chave do template de fábrica que originou a aba (`visao-geral`,
  -- `performance`, `saude`, `analytics`). NULL = aba criada do zero pelo
  -- usuário. Serve para saber o que é semeado e o que é autoral — sem isso,
  -- resemear um template sobrescreveria trabalho de alguém.
  ADD COLUMN IF NOT EXISTS template_key TEXT;

ALTER TABLE public.metrics_studio_panels
  DROP CONSTRAINT IF EXISTS metrics_studio_panels_nome_check;
ALTER TABLE public.metrics_studio_panels
  ADD CONSTRAINT metrics_studio_panels_nome_check
    CHECK (btrim(nome) <> '' AND length(nome) <= 60);

COMMENT ON COLUMN public.metrics_studio_panels.nome IS
  'Rótulo da aba no Estúdio. Sem UNIQUE de propósito: duas abas com o mesmo '
  'nome são feias, não corrompem nada — e um UNIQUE aqui transformaria renomear '
  'em erro de banco no meio da digitação.';

COMMENT ON COLUMN public.metrics_studio_panels.ordem IS
  'Posição da aba. Sem UNIQUE: reordenar exigiria trocar duas linhas numa '
  'transação e o índice brigaria no meio. Empate desempata por created_at.';

COMMENT ON COLUMN public.metrics_studio_panels.template_key IS
  'Template de fábrica que originou a aba (visao-geral | performance | saude | '
  'analytics). NULL = criada do zero. Distingue o que pode ser resemeado do que '
  'é autoral.';

-- A leitura do Estúdio é sempre "as abas desta org, na ordem" — este índice é
-- exatamente essa consulta.
CREATE INDEX IF NOT EXISTS metrics_studio_panels_org_ordem_idx
  ON public.metrics_studio_panels (organization_id, ordem, created_at);

-- ── 3. O painel que já existe vira a primeira aba ───────────────────────────
--
-- `DEFAULT` só vale para linha nova; as 14 existentes precisam do UPDATE. Sem
-- ele elas ficariam com o default aplicado pelo ALTER (o Postgres preenche),
-- mas o nome 'Painel' não diz nada ao usuário — 'Meu painel' deixa claro que
-- aquilo é dele e não um template de fábrica.
UPDATE public.metrics_studio_panels
   SET nome = 'Meu painel'
 WHERE nome = 'Painel';

-- ── 4. Conferência (rodar DEPOIS, e ler o estado — não confiar no SQL) ──────
--
-- `ALTER DEFAULT PRIVILEGES` já entregou privilégio a mais três vezes nesta
-- base (erp_order_items 27/08, erp_owner_map 03/09). Aqui não nasce tabela, mas
-- a leitura abaixo é o que prova:
--
--   SELECT relname, array_to_string(relacl, E'\n') FROM pg_class
--    WHERE relname = 'metrics_studio_panels';
--   -- esperado: sem anon.
--
--   SELECT organization_id, nome, ordem, template_key
--     FROM public.metrics_studio_panels ORDER BY organization_id, ordem;
--   -- esperado: 14 linhas, todas 'Meu painel', ordem 0, template_key NULL.
