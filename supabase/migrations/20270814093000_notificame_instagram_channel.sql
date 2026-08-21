-- ============================================================================
-- Migration: NotificaMe — canal de INSTAGRAM (Fatia 1.1, "só o ato de conectar")
-- Data: 2027-08-14
-- Branch: feat/notificame-seamless
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM DE APPLY — ESTA MIGRATION PRIMEIRO, AS EDGE FUNCTIONS DEPOIS.   ║
-- ║                                                                          ║
-- ║      1º  este arquivo, no banco alvo (com `--db-url` EXPLÍCITO);         ║
-- ║      2º  `supabase functions deploy notificame-channel-start`;           ║
-- ║          `supabase functions deploy notificame-channel-finish`.          ║
-- ║                                                                          ║
-- ║  NÃO é preferência de estilo. A FATIA 1 JÁ ESTÁ EM PRODUÇÃO: as duas     ║
-- ║  funções estão no ar, a flag `notificame` está ligada para a org         ║
-- ║  Milennials, e gente conecta WhatsApp Oficial por elas HOJE. Este        ║
-- ║  arquivo NÃO foi aplicado em prod. Deploy e apply são dois atos          ║
-- ║  manuais, em duas ferramentas, e NADA no CI os ordena por você.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── O QUE QUEBRA SE INVERTEREM (funções novas sobre schema velho) ──────────
--
--   As funções novas pedem DOIS objetos que só nascem AQUI:
--     `notificame_connect_sessions.requested_channel_type` (bloco 2) e a tabela
--     `messaging_channels` (bloco 1). Objeto ausente no PostgREST não devolve
--     nulo — devolve ERRO —, e cada erro tem um desfecho já mapeado:
--
--   a) `readConnectSession` erra ⇒ a sessão é lida como INVÁLIDA ⇒ o finish
--      responde 403 `session_invalid` em TODA conexão de WhatsApp;
--   b) `loadClaimedChannels` erra ⇒ 500 `claimed_lookup_failed`, idem;
--   c) `openConnectSession` erra ⇒ a sessão não abre ⇒ a BASELINE se perde ⇒ a
--      org trava em `ambiguous_channel`, sem saída pela UI.
--
--   E o desfecho de (a) e (b) NÃO é "o usuário tenta de novo": quando o finish
--   falha, o canal JÁ NASCEU no NotificaMe. Ele é FATURÁVEL e IRREMOVÍVEL do
--   lado deles, e sem vínculo no nosso banco nenhuma tela o alcança. Cada
--   tentativa vira mais um canal órfão cobrado para sempre — o mesmo padrão que
--   produziu as 87 órfãs na Uazapi. Não é um erro que se limpa depois.
--
--   Existe uma rede em `supabase/functions/_shared/notificame-schema-guard.ts`:
--   as funções reconhecem "coluna/tabela ainda não existe" e degradam com
--   `console.warn` em vez de derrubar. ELA NÃO AUTORIZA INVERTER — cobre a
--   janela de segundos do cache de schema do PostgREST e o dedo trocado, e
--   nesse estado o Instagram não funciona (a flag do bloco 3 nasce aqui). Rede
--   é para quem cai, não para quem pula.
--
-- ─── E NA ORDEM CERTA (schema novo sob funções velhas)? SEGURO ──────────────
--
--   Nada quebra entre um passo e o outro: `requested_channel_type` tem DEFAULT
--   'whatsapp', `messaging_channels` nasce vazia e sem escritor, e a flag
--   `notificame_instagram` só é lida por código que ainda não subiu. É por isso
--   que a ordem é esta, e não a inversa.
--
-- ─── ROLLBACK: A MESMA REGRA, DE TRÁS PARA A FRENTE ─────────────────────────
--
--   Desfazer é FUNÇÕES PRIMEIRO (redeploy da versão da fatia 1), MIGRATION
--   DEPOIS. Rodar o rollback com as funções da 1.1 no ar reproduz exatamente o
--   (a)/(b)/(c) acima.
--
-- DECISÃO DO CTO (2026-08-13): o NotificaMe passa a ser o caminho de mensageria
--   do INSTAGRAM. Esta migration NÃO aposenta nada do lado Meta/Graph: ela só abre
--   o lugar onde um canal de Instagram conectado pelo Seamless passa a morar.
--
-- ─── O QUE FAZ ──────────────────────────────────────────────────────────────
--   1. Cria `public.messaging_channels` — canais SOCIAIS não-WhatsApp do
--      NotificaMe (instagram, e depois facebook);
--   2. `notificame_connect_sessions.requested_channel_type` — o tipo que o
--      usuário PEDIU no clique, para o finish não vincular um canal de WhatsApp
--      nascido em paralelo como se fosse Instagram;
--   3. liga a flag `notificame_instagram` só para a org Milennials.
--
-- ─── POR QUE TABELA NOVA, E NÃO `whatsapp_instances` ────────────────────────
--   A fronteira certa NÃO é o vendor — é o TIPO DE CANAL. `whatsapp_instances` =
--   canais que falam WhatsApp, de qualquer provider; um canal WhatsApp do
--   NotificaMe já está no lugar certo e NENHUMA linha existente se move aqui.
--   `messaging_channels` = canais sociais não-WhatsApp. Por isso o CHECK de
--   `channel_type` RECUSA 'whatsapp' de propósito: é ele que impede o cisma de
--   nascer por descuido, num INSERT distraído da fatia seguinte.
--
--   O argumento que sustentava `whatsapp_instances` está escrito no cabeçalho de
--   20270813154600: "a fatia 2 é um NotificameProvider dentro de
--   getWhatsAppProvider, que recebe uma WhatsAppInstance vinda DESTA tabela".
--   Isso é verdade para WhatsApp e NÃO transfere para Instagram: o envio de IG é
--   `POST /v2/channels/instagram/messages` — rota e envelope próprios, que nunca
--   passam por `getWhatsAppProvider`.
--
--   O custo de ter forçado o canal de IG em `whatsapp_instances` seria permanente:
--     - `buildNotificameInstanceRow` chumba o rótulo `WhatsApp Oficial …`, e a org
--       veria uma conta de Instagram chamada "WhatsApp Oficial 3f2a1b9c";
--     - 13 superfícies de front e ~8 caminhos de edge que leem instância por id
--       SEM filtro de provider passariam a exigir decisão caso a caso;
--     - `enforce_whatsapp_instance_limit` + `org_resolve_quota(
--       'max_whatsapp_instances')` contam `whatsapp_instances` SEM filtrar
--       provider: um canal de Instagram comeria uma vaga PAGA de número de
--       WhatsApp, e consertar depois exigiria mexer em duas funções SECURITY
--       DEFINER do baseline.
--   Fora de `whatsapp_instances`, o isolamento é POR CONSTRUÇÃO — não por 21
--   filtros que o próximo leitor esquece de replicar.
--
--   `meta_pages`/`meta_connections` também está fora: `page_access_token` e
--   `access_token` são NOT NULL e são CREDENCIAL DA GRAPH que outro código
--   EXECUTA (`send-meta-message`, `_shared/meta-api.ts`). Um canal NotificaMe não
--   tem nenhuma das duas — seria gravar mentira em coluna que roda.
--
-- ─── O QUE ESTA MIGRATION NÃO TOCA, DE PROPÓSITO ────────────────────────────
--   - `enforce_whatsapp_instance_limit` / `org_resolve_quota`: canal social NÃO
--     consome vaga de número de WhatsApp. Se o pricing quiser cobrar por canal
--     social, é decisão de billing e ganha quota própria;
--   - publicação `supabase_realtime`: não há consumidor de realtime nesta fatia.
--     Adicionar tabela à publicação sem consumidor é custo sem leitor;
--   - `meta_pages`, `meta_connections`, `meta_leadgen_configs`: a rota de
--     substituição NUNCA limpa, rotaciona ou esvazia `page_access_token`, NUNCA
--     marca `meta_connections.status='disconnected'` (gate GLOBAL, não por canal)
--     e NUNCA faz DELETE ali — o CASCADE latente
--     (`meta_leadgen_configs.meta_page_id → meta_pages(id)`) apagaria a config de
--     Lead Ads sem backup e sem trilha;
--   - `feature_catalog`/`organization_features`: a flag é o jsonb leve
--     `organizations.feature_flags`, igual à da fatia 1. Entrar no catálogo
--     viraria `FeatureKey` tipada e exigiria regerar
--     `feature-catalog.generated.ts` sob pena de teste vermelho. Consequência
--     aceita conscientemente: a flag não aparece no BillingOverrideModal e só é
--     ligável por UPDATE direto.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ⚠️ TIMESTAMP — …093000 é posterior à última do repo (20270813154600) e está
--   FORA de slot redondo, para não colidir com branch em voo. Colisão de
--   timestamp faz o CLI PULAR a migration em silêncio e o ledger dar falso verde,
--   e a guarda de cada branch só olha o próprio checkout: os dois CIs passam.
--   CONFERIR contra as branches em voo NO MOMENTO DO APPLY, não agora.
--
-- ROLLBACK: `supabase/migrations/rollback/20270814093000_notificame_instagram_channel.sql`
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. messaging_channels — canais sociais não-WhatsApp do NotificaMe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messaging_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'notificame'
    CHECK (provider IN ('notificame')),

  -- RECUSA 'whatsapp' DE PROPÓSITO. Ver o bloco "POR QUE TABELA NOVA".
  channel_type TEXT NOT NULL
    CHECK (channel_type IN ('instagram', 'facebook')),

  -- O id do canal NO FORNECEDOR. É este campo — e não `id` — que tem dono.
  external_channel_id TEXT NOT NULL,

  -- REFERÊNCIA para o cofre, nunca o token. RESTRICT e não CASCADE: ver o
  -- COMMENT da coluna.
  subaccount_id UUID NOT NULL
    REFERENCES public.notificame_subaccounts(id) ON DELETE RESTRICT,

  display_name TEXT NOT NULL,
  handle TEXT,

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),

  -- NUNCA token. Só vendor, connected_via e connected_at. Esta tabela é lida sob
  -- RLS por QUALQUER membro da org.
  provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messaging_channels IS
  'Canais SOCIAIS não-WhatsApp conectados via Seamless do NotificaMe (instagram, '
  'e depois facebook). A fronteira com whatsapp_instances é o TIPO DE CANAL, não o '
  'vendor: canal WhatsApp do NotificaMe continua em whatsapp_instances, que é o '
  'lugar certo dele (o NotificameProvider da fatia 2-WA lê UMA tabela só). O CHECK '
  'de channel_type recusa ''whatsapp'' para que o cisma não nasça por descuido. '
  'Fora de whatsapp_instances por três razões medidas: o rótulo "WhatsApp Oficial" '
  'chumbado em buildNotificameInstanceRow, 13 superfícies de front + ~8 caminhos '
  'de edge que leem instância sem filtro de provider, e o roubo de vaga PAGA em '
  'max_whatsapp_instances (a quota conta linhas sem filtrar provider). NÃO entra '
  'em enforce_whatsapp_instance_limit: canal social não consome vaga de número.';

COMMENT ON COLUMN public.messaging_channels.channel_type IS
  'instagram | facebook. ''whatsapp'' é RECUSADO pelo CHECK de propósito — canal '
  'que fala WhatsApp mora em whatsapp_instances, de qualquer provider.';

COMMENT ON COLUMN public.messaging_channels.external_channel_id IS
  'Id do canal NO FORNECEDOR. Unicidade GLOBAL em uq_messaging_channels_external '
  '(sem organization_id): um canal do NotificaMe tem UM dono, e esse índice é a '
  'última linha de defesa contra atribuição cross-tenant.';

COMMENT ON COLUMN public.messaging_channels.subaccount_id IS
  'UUID da linha de notificame_subaccounts — REFERÊNCIA, jamais o company_uuid da '
  'subconta (que É o token dela). ON DELETE RESTRICT, e não CASCADE, porque a '
  'subconta é IRREMOVÍVEL e FATURÁVEL no fornecedor: apagar a linha do cofre '
  'enquanto houver canal social vinculado destruiria a única trilha entre a org e '
  'a cobrança. Assimétrico em relação a whatsapp_instances (que não tem FK para o '
  'cofre) — assimetria CONSCIENTE. ⚠️ Quem levar 23503 numa limpeza vai querer '
  'destravar pelo caminho curto (apagar a linha do cofre); esse caminho curto É o '
  'dano. O certo é resolver o canal antes.';

COMMENT ON COLUMN public.messaging_channels.provider_config IS
  'vendor, connected_via, connected_at. NUNCA token, NUNCA company_uuid: esta '
  'tabela é lida sob RLS por qualquer membro da org. O token da subconta mora '
  'exclusivamente em notificame_subaccounts, cifrado.';

COMMENT ON COLUMN public.messaging_channels.display_name IS
  'Rótulo mostrado à org. NUNCA contém a palavra "WhatsApp" — é o defeito que a '
  'opção de gravar em whatsapp_instances produziria, e buildMessagingChannelRow '
  'existe para impedi-lo. Único por org (uq_messaging_channels_org_name); a edge '
  'function desambigua com o prefixo do channel_id quando colide.';

-- Unicidade GLOBAL, sem organization_id — mesmo invariante de
-- `uq_whatsapp_instances_notificame_channel`. (organization_id, external_channel_id)
-- PERMITIRIA duas orgs reivindicarem o mesmo canal, que é exatamente o dano:
-- mensagens de um tenant entregues a outro.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messaging_channels_external
  ON public.messaging_channels (provider, external_channel_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messaging_channels_org_name
  ON public.messaging_channels (organization_id, display_name);

-- Leitura quente: "canais desta org" (hook useMessagingChannels + finish).
CREATE INDEX IF NOT EXISTS idx_messaging_channels_org
  ON public.messaging_channels (organization_id, channel_type);

ALTER TABLE public.messaging_channels ENABLE ROW LEVEL SECURITY;

-- LEITURA: membros da org + master. Funções SECURITY DEFINER, NUNCA
-- `SELECT ... FROM team_members` inline — subquery inline em policy causa
-- recursão infinita quando o Realtime avalia apply_rls().
DROP POLICY IF EXISTS "Org members read messaging_channels"
  ON public.messaging_channels;
CREATE POLICY "Org members read messaging_channels"
  ON public.messaging_channels
  FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user()
  );

-- ESCRITA: só service_role. Quem vincula é `notificame-channel-finish`, que já
-- valida org do auth + admin + whatsapp.manage_instances. Não existe caminho
-- legítimo de INSERT/UPDATE/DELETE a partir do browser.
DROP POLICY IF EXISTS "Service role full access messaging_channels"
  ON public.messaging_channels;
CREATE POLICY "Service role full access messaging_channels"
  ON public.messaging_channels
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- GRANT de TABELA domina a policy: sem estes REVOKEs, o default privilege do
-- schema public deixa a tabela escrevível por authenticated antes de a RLS
-- opinar. `anon` não lê nada aqui.
REVOKE ALL ON public.messaging_channels FROM anon;
REVOKE ALL ON public.messaging_channels FROM authenticated;
GRANT SELECT ON public.messaging_channels TO authenticated;
GRANT ALL ON public.messaging_channels TO service_role;

DROP TRIGGER IF EXISTS trg_messaging_channels_updated_at
  ON public.messaging_channels;
CREATE TRIGGER trg_messaging_channels_updated_at
  BEFORE UPDATE ON public.messaging_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A sessão passa a lembrar QUAL tipo de canal foi pedido no clique.
--
--    O QUE ISSO IMPEDE: o pareamento sessão↔canal é um DIFF contra a baseline, e
--    o `postMessage` do Seamless devolve `{status:"channel-success"}` idêntico
--    para WhatsApp e para Instagram — não distingue canal e não devolve id. Sem
--    esta coluna, um canal de WhatsApp nascido em paralelo na mesma subconta
--    entraria no diff de uma conexão de Instagram e seria vinculado como
--    Instagram. Com ela, o finish filtra os candidatos por tipo ANTES de contar.
--
--    DEFAULT 'whatsapp' é OBRIGATÓRIO, não conveniência: há sessões ABERTAS em
--    prod neste instante, criadas pela fatia 1. NOT NULL sem default derrubaria o
--    ALTER; default diferente de 'whatsapp' reclassificaria essas sessões vivas.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notificame_connect_sessions
  ADD COLUMN IF NOT EXISTS requested_channel_type TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE public.notificame_connect_sessions
  DROP CONSTRAINT IF EXISTS chk_notificame_session_requested_channel_type;

ALTER TABLE public.notificame_connect_sessions
  ADD CONSTRAINT chk_notificame_session_requested_channel_type
  CHECK (requested_channel_type IN ('whatsapp', 'instagram'));

COMMENT ON COLUMN public.notificame_connect_sessions.requested_channel_type IS
  'Tipo de canal PEDIDO no clique. O finish filtra os candidatos do diff por este '
  'tipo antes de contar — é o que impede um canal de WhatsApp nascido em paralelo '
  'ser vinculado como Instagram (o postMessage do Seamless é idêntico para os '
  'dois e não carrega id). DEFAULT ''whatsapp'' porque há sessões abertas em prod. '
  'CHECK sem ''facebook'': a allowlist server-side também não o habilita nesta '
  'fatia.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Porta de entrada — flag `notificame_instagram`, SEPARADA de `notificame`.
--
--    Duas flags e não uma: ligar Instagram numa org é decisão distinta de ligar
--    WhatsApp Oficial. Uma org pode querer o número oficial e não querer que o
--    inbox de Instagram mude de rota — e o contrário também.
--
--    Fail-closed por construção: `feature_flags` é jsonb NOT NULL DEFAULT '{}' e
--    o gate server-side exige `=== true` ESTRITO. Chave ausente = desligado, para
--    TODAS as ~30 orgs.
--
--    DO-block com RAISE pelo mesmo motivo de 20270813154600: o UUID é de uma org
--    que só existe em PROD, e um UPDATE de zero linhas é sucesso silencioso —
--    indistinguível de ter funcionado. RAISE WARNING e não exceção: a ausência da
--    org é o estado CORRETO fora de prod, e falhar ali quebraria `db reset` e o CI
--    por um fato de dados.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- Org Milennials (do CTO) — é onde esta fatia é validada. Existe só em prod.
  v_org_id CONSTANT UUID := '6030520a-2ca7-477d-be89-55758e2cd808';
  v_updated INTEGER;
BEGIN
  UPDATE public.organizations
     SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                         || '{"notificame_instagram": true}'::jsonb
   WHERE id = v_org_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE WARNING
      '[notificame] flag notificame_instagram NAO ligada: org % nao existe neste banco (esperado fora de prod). O Instagram fica DESLIGADO para todas as orgs. Para ligar: UPDATE public.organizations SET feature_flags = COALESCE(feature_flags, ''{}''::jsonb) || ''{"notificame_instagram": true}''::jsonb WHERE id = ''<org>'';',
      v_org_id;
  ELSE
    RAISE NOTICE '[notificame] flag notificame_instagram ligada para a org % (1 linha).', v_org_id;
  END IF;
END $$;
