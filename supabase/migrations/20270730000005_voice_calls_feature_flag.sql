-- `voice_calls` no CATÁLOGO de features, e não só nos planos.
--
-- `20270730000004` semeia `subscription_plans.features` — o que liga a voz para
-- um PLANO INTEIRO. Não existe caminho para ligar numa organização só, que é
-- exatamente o que um piloto precisa.
--
-- Quem concede por organização é `organization_features`, e ela tem FK para
-- `feature_flags(key)`:
--
--   organization_features_feature_key_fkey
--     FOREIGN KEY (feature_key) REFERENCES feature_flags(key) ON DELETE CASCADE
--
-- Sem a linha aqui, duas coisas quebram ao mesmo tempo: o INSERT do piloto
-- viola a FK (23503), e a tela do Master que concede feature por organização
-- (`BillingOverrideModal`, que enumera `feature_flags`) nem oferece a opção.
--
-- A linha também tem efeito no gate do servidor: `org_get_features_and_limits`
-- preenche com `default_enabled` toda chave do catálogo ausente no plano, então
-- é ela que faz `voice_calls` materializar como `false` EXPLÍCITO no JSON que
-- `torquecalls-control` lê — em vez de ausente, que é indistinguível de
-- "ninguém nunca declarou".
--
-- Os campos espelham `src/modules/platform/lib/feature-registry.ts` de
-- propósito: dois catálogos da mesma feature que se contradizem é como uma
-- delas acaba invisível numa das telas.
--
-- Nasce DESLIGADA para todas, e `requires_plan` vazio: nenhum plano a concede
-- sozinho. A única porta de entrada é o override por organização.

INSERT INTO public.feature_flags (
  key, name, display_name, description, category, icon, feature_type,
  default_enabled, requires_plan, position
)
VALUES (
  'voice_calls',
  'TorqueCalls (Voz)',
  'TorqueCalls (Voz)',
  'Chamada de voz pelo WhatsApp direto no CRM, sem sair da conversa',
  'advanced',
  'Phone',
  'advanced',
  false,
  ARRAY[]::text[],
  45
)
ON CONFLICT (key) DO NOTHING;

-- Sem rollback próprio, deliberadamente: `DELETE FROM feature_flags` cascateia
-- para `organization_features` (ON DELETE CASCADE) e levaria junto, em
-- silêncio, todos os overrides já concedidos. Desligar a voz se faz virando o
-- override para `false`, não apagando a linha do catálogo.
