-- Conversa do Oráculo com memória — SCRUM-594, ADR-0032.
--
-- O produto atual manda `[system, user]` a cada pergunta e nada persiste: quem
-- faz a segunda pergunta descobre que ele esqueceu a primeira. Foram 81
-- perguntas em cinco meses, e ninguém percebeu porque nada mede o Oráculo.
--
-- A memória tem duas camadas: os últimos turnos na íntegra (`oraculo_turns`) e
-- um resumo acumulado do que saiu da janela (`oraculo_conversations.summary`).
--
-- ── QUEM LÊ O QUÊ ─────────────────────────────────────────────────────────
-- Conversa do Oráculo é pessoal. Um `admin` NÃO lê a conversa de um `member`
-- e vice-versa: o que o Escopo recorta é o DADO que a ferramenta alcança, não
-- o direito de ler a conversa alheia. Por isso a policy é por `user_id`, e não
-- por papel.
--
-- Escrita não é do usuário: os turnos nascem na edge function, com
-- `service_role`. `authenticated` recebe SELECT e mais nada — sem isso o front
-- fabricaria turno de assistente e a procedência viraria ficção.

CREATE TABLE IF NOT EXISTS public.oraculo_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_member_id    uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  title             text,
  -- Resumo acumulado dos turnos que já saíram da janela.
  summary           text,
  last_message_at   timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oraculo_conversations_dono
  ON public.oraculo_conversations (user_id, last_message_at DESC NULLS LAST)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oraculo_conversations_organization_id
  ON public.oraculo_conversations (organization_id);

CREATE TABLE IF NOT EXISTS public.oraculo_turns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.oraculo_conversations(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Desnormalizado de propósito: a quota diária é uma contagem por usuário e
  -- por dia, e ela não pode custar um join a cada pergunta.
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('user', 'assistant')),
  content           text NOT NULL,
  -- Procedência: o que foi consultado para redigir esta resposta.
  tools_used        text[] NOT NULL DEFAULT '{}',
  -- Ferramentas pedidas e recusadas — inclusive tentativa de escrita, que o
  -- laço somente-leitura nunca executa (ADR-0032 §2). Registrado, não engolido.
  rejected_tools    text[] NOT NULL DEFAULT '{}',
  hit_tool_ceiling  boolean NOT NULL DEFAULT false,
  model             text,
  input_tokens      integer,
  output_tokens     integer,
  latency_ms        integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oraculo_turns_conversa
  ON public.oraculo_turns (conversation_id, created_at);

-- Índice da quota: turnos do usuário no dia.
CREATE INDEX IF NOT EXISTS idx_oraculo_turns_quota
  ON public.oraculo_turns (user_id, created_at DESC)
  WHERE role = 'user';

-- ── Teto diário ajustável por organização, sem deploy ─────────────────────
-- O teto atual são 3 perguntas por dia, gravadas em `check_oraculo_limit`, e
-- é ele que impede o uso exploratório de que o produto depende. NULL = padrão
-- da aplicação (25 turnos do usuário por dia).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS oraculo_daily_turn_limit integer
    CHECK (oraculo_daily_turn_limit IS NULL OR oraculo_daily_turn_limit > 0);

COMMENT ON COLUMN public.organizations.oraculo_daily_turn_limit IS
  'Teto de turnos do usuário por dia no Oráculo. NULL = padrão da aplicação (25). Conta pergunta feita por gente, não chamada ao modelo: um turno que consultou seis ferramentas continua sendo uma pergunta.';

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.oraculo_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oraculo_turns         ENABLE ROW LEVEL SECURITY;

-- `get_my_organization_ids()` é SECURITY DEFINER e bypassa RLS. Subquery
-- inline em `team_members` aqui causaria recursão quando o Realtime avalia
-- `apply_rls()` — regra da casa, não preferência.
CREATE POLICY "oraculo_conversations_dono_le"
  ON public.oraculo_conversations
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

CREATE POLICY "oraculo_turns_dono_le"
  ON public.oraculo_turns
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

-- ── GRANTS ────────────────────────────────────────────────────────────────
-- 🚨 Tabela nova em `public` NÃO nasce fechada. O DEFAULT PRIVILEGES do
-- `supabase_admin` concede `arwdDxtm` a `anon` E a `authenticated` em tudo que
-- é criado aqui — medido nesta própria migration antes do REVOKE abaixo:
-- `authenticated` tinha INSERT, UPDATE, DELETE e TRUNCATE em `oraculo_turns`,
-- e `anon` tinha SELECT.
--
-- A RLS barraria o efeito (não há policy de escrita), mas grant e policy são
-- duas paredes, e esta base já perdeu uma delas antes — uma tabela de backup
-- em `public` nasceu legível por `anon` exatamente assim. Revogar é o que
-- torna a segunda parede real, e não uma nota de rodapé.
REVOKE ALL ON public.oraculo_conversations FROM anon, authenticated;
REVOKE ALL ON public.oraculo_turns         FROM anon, authenticated;

-- Leitura: só o dono, e a policy acima é quem diz quem é o dono.
-- Escrita: nenhuma. Os turnos nascem na edge function com `service_role`, que
-- não passa por RLS. Se o usuário pudesse escrever turno, a procedência
-- exibida na tela ("consultei métricas") seria ficção.
GRANT SELECT ON public.oraculo_conversations TO authenticated;
GRANT SELECT ON public.oraculo_turns         TO authenticated;
