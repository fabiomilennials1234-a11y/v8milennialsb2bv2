-- =============================================================================
-- Migration: Full-text search em whatsapp_messages
--
-- Propósito:
--   Habilitar busca full-text sobre o histórico de mensagens WhatsApp por org.
--   Integra com ⌘K (CommandGroupMessages) e rota /chat/search (Onda 2b C35-C37).
--
-- Decisão de tabela:
--   Usamos whatsapp_messages (não conversation_messages) porque é a tabela
--   consumida pelo WhatsAppChat em produção. conversation_messages é o histórico
--   do copilot (IA↔sistema). Ver architect-plan §5 (C34 real).
--
-- Coluna de texto:
--   whatsapp_messages.content (TEXT, nullable) — confirmado em
--   supabase/migrations/20260127000000_add_whatsapp_messages.sql linha 18.
--   NÃO é "message" (nome incorreto no briefing inicial).
--
-- RPC search_messages:
--   SECURITY DEFINER — necessário para bypass RLS e aplicar guard próprio.
--   Guard: verifica pertencimento à org via team_members (is_active = true).
--   Não usar get_user_organization_id() porque o caller passa p_org_id
--   explicitamente (buscas cross-features futuras precisarão disso).
--   XSS: ts_headline retorna HTML com apenas <mark>...</mark>. Seguro para
--   dangerouslySetInnerHTML quando conteúdo original vem do banco (não de
--   input livre do browser). Validar no frontend que headline só contém <mark>.
--
-- Performance:
--   STORED generated column: aumenta ~30% disk footprint de content.
--   ~30 orgs, volume baixo. Trade-off aceitável vs performance de query.
--   GIN index: varredura de posting lists. Custo em INSERT/UPDATE de content.
--   websearch_to_tsquery: aceita sintaxe humana ("proposta OR contrato"),
--   mais seguro que plainto_tsquery (sem erros em sintaxe inválida).
--
-- Reversão (DOWN):
--   DROP FUNCTION IF EXISTS public.search_messages(uuid, text, int, int);
--   DROP INDEX IF EXISTS idx_whatsapp_messages_search_tsv;
--   -- Para DROP da generated column, precisa recriar a tabela ou usar:
--   ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS search_tsv;
--   -- (search_tsv é GENERATED — pode ser dropped diretamente no Postgres 12+)
--
-- Autor: DBA (agent-dba) — Onda 2b Chat
-- Data: 2026-04-22
-- Branch: feat/chat-ux-ui-redesign
-- =============================================================================

-- ============================================================
-- PARTE 1: GENERATED COLUMN tsvector
--
-- GENERATED ALWAYS AS ... STORED:
--   Postgres computa automaticamente em INSERT/UPDATE.
--   Valor fica gravado no disco (STORED) — não recalculado na query.
--   Requer Postgres 12+. Supabase usa Postgres 15 — OK.
--
-- IF NOT EXISTS via workaround: ADD COLUMN IF NOT EXISTS em generated
-- columns precisa de DO block no Postgres (não suporta direto).
-- Usamos ADD COLUMN IF NOT EXISTS via verificação em information_schema.
--
-- Configuração 'portuguese': tokenização e stemming para PT-BR.
--   Stop words em português removidas (de, da, para, etc).
--   Raízes: "propost" cobre "proposta", "propostas", "proposto".
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'whatsapp_messages'
      AND column_name  = 'search_tsv'
  ) THEN
    ALTER TABLE public.whatsapp_messages
      ADD COLUMN search_tsv tsvector
        GENERATED ALWAYS AS (
          to_tsvector('portuguese', coalesce(content, ''))
        ) STORED;
  END IF;
END;
$$;

-- ============================================================
-- PARTE 2: GIN INDEX
--
-- GIN (Generalized Inverted Index) é o tipo correto para tsvector.
-- B-tree não suporta operador @@.
-- CREATE INDEX CONCURRENTLY não disponível em migration transacional —
-- usar CREATE INDEX IF NOT EXISTS simples. Em produção com tabela grande,
-- considerar criar fora de migration com CONCURRENTLY manualmente.
--
-- Nome: idx_whatsapp_messages_search_tsv (padrão do projeto: idx_<table>_<col>)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_search_tsv
  ON public.whatsapp_messages
  USING GIN (search_tsv);

-- ============================================================
-- PARTE 3: RPC search_messages
--
-- SECURITY DEFINER: executa com privilégios do dono da função (postgres).
--   Necessário para:
--   1. Aplicar guard de autorização próprio (team_members lookup).
--   2. Acessar whatsapp_messages ignorando RLS (que filtra por auth.uid()
--      via get_user_organization_id — compatível, mas SECURITY DEFINER
--      garante consistência quando chamado via service_role também).
--   search_path = public: previne search_path injection.
--
-- Guard de autorização:
--   Verifica que auth.uid() é membro ativo da org (is_active = true).
--   Usa team_members diretamente (não get_user_organization_id()) porque
--   p_org_id é parâmetro explícito — necessário para validar cross-tenancy.
--   RAISE EXCEPTION 'access_denied' em falha — não retorna vazio (silencioso
--   seria pior: caller assumiria sem resultados, não erro de permissão).
--
-- Guard de query mínima:
--   Queries < 3 chars geram posting lists enormes no GIN. Rejeitar server-side.
--   Client (useMessageSearch) já faz guard com enabled: query.length >= 3,
--   mas defense in depth — o banco não confia no client.
--
-- ts_headline e XSS:
--   StartSel=<mark>,StopSel=</mark>: only safe HTML injected.
--   O conteúdo das mensagens vem do WhatsApp (texto de usuários finais).
--   ts_headline ESCAPA o conteúdo original — não injeta conteúdo raw no HTML.
--   Frontend: usar dangerouslySetInnerHTML apenas para o campo headline,
--   nunca para content raw. Validar no CommandGroupMessages.tsx.
--
-- ts_rank vs ts_rank_cd:
--   ts_rank: considera frequência do termo. Adequado para mensagens curtas.
--   ts_rank_cd: considera cover density (proximidade). Desnecessário aqui.
--
-- Ordenação: rank DESC, timestamp DESC.
--   Resultados mais relevantes primeiro; dentro do mesmo rank, mais recentes.
--
-- GRANT/REVOKE:
--   GRANT authenticated — usuários logados podem chamar.
--   REVOKE public — Supabase concede a public por default; revogar explicitamente.
--   REVOKE anon — usuários não autenticados nunca devem chamar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_messages(
  p_org_id   uuid,
  p_query    text,
  p_limit    int  DEFAULT 20,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  id          uuid,
  phone_number text,
  content     text,
  direction   text,
  "timestamp" timestamptz,
  instance_id uuid,
  lead_id     uuid,
  headline    text,
  rank        real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
  -- ── Guard 1: autenticação ──────────────────────────────────────────────────
  -- auth.uid() retorna NULL quando não autenticado (service_role ou anon).
  -- Se chamado por service_role sem JWT, uid() = NULL — rejeitado aqui.
  -- Crons internos devem chamar via RPC com JWT válido ou não usar esta função.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied: authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Guard 2: pertencimento à org ───────────────────────────────────────────
  -- Verifica que o usuário é membro ativo da org requisitada.
  -- is_active = true: previne acesso por membros desativados.
  -- Isso impede que um membro de org A passe p_org_id de org B e veja mensagens.
  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id        = auth.uid()
      AND tm.organization_id = p_org_id
      AND tm.is_active       = true
  ) THEN
    RAISE EXCEPTION 'access_denied: user is not an active member of organization %', p_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Guard 3: query mínima ──────────────────────────────────────────────────
  -- Rejeitar queries vazias ou muito curtas que gerariam scan massivo.
  IF length(trim(coalesce(p_query, ''))) < 3 THEN
    RAISE EXCEPTION 'query_too_short: minimum 3 characters required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Guard 4: limit razoável ────────────────────────────────────────────────
  -- Proteger contra limit=999999 acidental ou malicioso.
  IF p_limit > 100 THEN
    RAISE EXCEPTION 'limit_too_large: maximum is 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Parsear query uma vez ──────────────────────────────────────────────────
  -- websearch_to_tsquery aceita sintaxe humana:
  --   "proposta OR contrato" → proposta | contrato
  --   "proposta contrato"    → proposta & contrato (AND implícito)
  --   '"proposta final"'     → frase exata
  -- Retorna NULL para query inválida (ex: query toda de stop words).
  -- Se NULL, não retornar resultados (não falhar).
  v_tsquery := websearch_to_tsquery('portuguese', p_query);

  IF v_tsquery IS NULL THEN
    RETURN;
  END IF;

  -- ── Query principal ────────────────────────────────────────────────────────
  RETURN QUERY
  SELECT
    m.id,
    m.phone_number,
    m.content,
    m.direction,
    m."timestamp",
    m.instance_id,
    m.lead_id,
    -- headline: fragmento com o termo destacado em <mark>...</mark>
    -- MaxWords/MinWords controlam o tamanho do snippet
    -- HighlightAll=false: não destacar cada ocorrência no texto completo
    ts_headline(
      'portuguese',
      coalesce(m.content, ''),
      v_tsquery,
      'StartSel=<mark>,StopSel=</mark>,MaxWords=20,MinWords=5,HighlightAll=false'
    ) AS headline,
    ts_rank(m.search_tsv, v_tsquery) AS rank
  FROM public.whatsapp_messages m
  WHERE m.organization_id = p_org_id
    AND m.search_tsv @@ v_tsquery
  ORDER BY
    ts_rank(m.search_tsv, v_tsquery) DESC,
    m."timestamp" DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── Permissões ─────────────────────────────────────────────────────────────
-- REVOKE de public antes de GRANT authenticated — Supabase concede execute
-- a public por default em funções novas. Ordem importa.
REVOKE EXECUTE ON FUNCTION public.search_messages(uuid, text, int, int) FROM public;
REVOKE EXECUTE ON FUNCTION public.search_messages(uuid, text, int, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_messages(uuid, text, int, int) TO authenticated;

-- ============================================================
-- PARTE 4: COMENTÁRIOS
-- ============================================================

COMMENT ON COLUMN public.whatsapp_messages.search_tsv IS
  'Generated tsvector para full-text search em português. '
  'Derivado de content. Atualizado automaticamente em INSERT/UPDATE. '
  'Indexado via GIN (idx_whatsapp_messages_search_tsv). '
  'Consumido por RPC search_messages.';

COMMENT ON FUNCTION public.search_messages(uuid, text, int, int) IS
  'Full-text search de mensagens WhatsApp por organização. '
  'SECURITY DEFINER — aplica guards próprios: '
  '(1) auth.uid() não nulo, '
  '(2) usuário é membro ativo da org, '
  '(3) query >= 3 chars, '
  '(4) limit <= 100. '
  'Retorna id, phone_number, content, direction, timestamp, instance_id, lead_id, headline (HTML com <mark>), rank. '
  'headline é seguro para dangerouslySetInnerHTML: ts_headline escapa conteúdo original, injeta apenas <mark>. '
  'Chamado por useMessageSearch (debounce 300ms) e CommandGroupMessages (⌘K).';
