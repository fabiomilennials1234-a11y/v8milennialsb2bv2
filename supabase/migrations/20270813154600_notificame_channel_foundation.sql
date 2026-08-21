-- ============================================================================
-- Migration: NotificaMe — fundação do canal (Fatia 1, "só o ato de conectar")
-- Data: 2027-08-13
-- Branch: feat/notificame-seamless
--
-- O QUE FAZ: torna INSERÍVEL uma linha `whatsapp_instances` com
--   provider='notificame' (canal oficial conectado via Seamless do NotificaMe),
--   torna double-binding IMPOSSÍVEL no banco, e abre a porta de entrada (flag)
--   só para a org Milennials.
--
-- POR QUE `whatsapp_instances` E NÃO TABELA NOVA: a fatia 2 é um
--   `NotificameProvider` dentro de `getWhatsAppProvider`, que recebe uma
--   `WhatsAppInstance` vinda DESTA tabela. Tabela paralela transformaria a
--   fatia 2 em migração de dados + fork do dispatch. Precedente direto:
--   archive/20261217000001_widen_provider_check_meta_cloud.sql.
--
-- MODELO DE DADOS: SUBCONTA POR ORG. A revenda está ATIVA na conta-mãe
--   Milennials (verificado contra a conta viva em 2027-08-13), e cada org ganha
--   sua própria subconta via `POST /v2/accounts`.
--
--   O fato que decidiu o desenho: o `CompanyId` devolvido por esse POST **É O
--   TOKEN** da subconta — byte-a-byte igual ao `acccount_id` de `GET /v1/resale/`.
--   Logo o `company_uuid` que viaja na querystring do popup Seamless não é
--   identificador público, é CREDENCIAL. Sob conta ÚNICA, essa querystring
--   entregaria o token da CONTA-MÃE — acesso a TODAS as orgs — ao browser de cada
--   cliente. Conta única está morta por isso, não por preferência.
--
--   Onde o token mora: `public.notificame_subaccounts`, cifrado AES-256-GCM,
--   deny-all service_role (migration 20270813154500). NÃO em `provider_config`,
--   que é legível sob RLS por qualquer membro da org. Na linha do canal fica
--   apenas `provider_config->>'subaccount_id'` — o UUID da NOSSA linha, referência
--   não-reversível. O secret `NOTIFICAME_COMPANY_UUID` DEIXOU DE EXISTIR.
--
--   GANHO DE SEGURANÇA DE QUEBRA: com o token da subconta, `GET /v1/channels` já
--   chega ESCOPADO àquela org. A heurística "pega o único canal sem dono na
--   conta-mãe" morreu, e com ela o vetor de captura cross-tenant.
--
-- ⚠️ GATE DE SEQUENCIAMENTO — esta migration é o PORTÃO HABILITADOR.
--   Ela só pode cair em prod DEPOIS de, nesta ordem:
--     (1) mergeado + deployado o código de ISOLAMENTO:
--         - `_shared/whatsapp-dispatch.ts` — fallback de `selectSendableInstance`
--           escopado por ALLOWLIST a ('uazapi','evolution'); hoje é provider-cego e
--           já sangra para meta_cloud. Allowlist e não denylist de 'notificame':
--           denylist deixaria o 5º provider nascer sangrando;
--         - `src/modules/campaigns/components/disparo-wizard/instances-to-numbers.ts`
--           — canal oficial NÃO pode virar número disparável em massa;
--         - perfil `notificame` em `src/modules/communication/lib/whatsapp-provider.ts`
--           — sem ele `getProviderProfile` rotula o canal oficial como "Uazapi /
--           escaneia um QR";
--     (2) deploy das edge functions `notificame-channel-start` e
--         `notificame-channel-finish` (elas são quem INSERE a linha);
--     (3) migration 20270813154500 (cofre da subconta) aplicada ANTES desta —
--         sem ela o start não tem onde gravar o token e a feature fica inerte.
--         Isso deixou de ser instrução e virou GARANTIA: o timestamp do cofre é
--         menor que o desta, então qualquer `db push` as aplica nessa ordem;
--     (4) secrets setados: `NOTIFICAME_API_TOKEN` (conta-mãe),
--         `NOTIFICAME_ENCRYPTION_KEY` (hex 64, NOVO — não reaproveitar o do Omie) e
--         `NOTIFICAME_SUBACCOUNT_DEFAULTS` (JSON). Sem eles a feature fica INERTE e
--         legível, que é o estado correto de merge.
--   Aplicar antes de (1) abre a janela em que um canal oficial pode ser sorteado
--   como remetente de copiloto ou de disparo em massa.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ⚠️ TIMESTAMP — o par nasceu como …000000/…010000, ANTERIOR à main inteira (cuja
--   última é 20270813120000_carteira_order_edit). `supabase db push` sem
--   `--include-all` ignora migration cujo timestamp é menor que o do último
--   registro do ledger: as duas seriam PULADAS EM SILÊNCIO, com o push relatando
--   sucesso e a feature simplesmente não existindo no banco. Re-datadas para
--   …154500/…154600, depois da main e fora dos slots redondos ocupados por branches
--   em voo (…100000/…110000 em develop).
--
-- NÃO TOCA, DE PROPÓSITO:
--   - `whatsapp_instance_secrets` (RLS deny-all): existe SIM uma credencial por
--     ORG — o token da subconta —, e ela mora em tabela própria org-scoped
--     (`notificame_subaccounts`, migration 20270813154500). O motivo decisivo não
--     é o `chk_secrets_has_credential` (que exige uazapi_token OU
--     meta_access_token): é a PK/FK `instance_id REFERENCES whatsapp_instances(id)
--     ON DELETE CASCADE`. (a) ORDEM — o token é necessário no START, para montar a
--     URL do popup, e nesse instante não existe linha de instância (23503);
--     (b) DESTRUIÇÃO — apagar a última instância notificame CASCATEARIA o token de
--     uma subconta que segue VIVA e faturável no fornecedor, e a reconexão
--     provisionaria uma SEGUNDA subconta irremovível.
--   - `organizations.whatsapp_provider_override` (CHECK segue 'uazapi'|'evolution'):
--     é kill-switch entre os DOIS legados, não seletor de provider. Alargá-lo
--     COAGIRIA o canal oficial para uazapi.
--   - `feature_catalog` / `organization_features`: a flag desta fatia é o
--     jsonb leve `organizations.feature_flags`, lido por `useFeatureFlag`
--     (fail-closed) e pelo gate server-side das edge functions. Entrar no
--     catálogo viraria `FeatureKey` tipada, apareceria no BillingOverrideModal e
--     exigiria regerar `src/modules/platform/lib/feature-catalog.generated.ts`
--     sob pena de `tests/unit/feature-catalog.test.ts` vermelho.
--
-- ROLLBACK: `supabase/migrations/rollback/20270813154600_notificame_channel_foundation.sql`
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Alargar o CHECK de `provider` para aceitar 'notificame'.
--    DO-block porque o nome do constraint é auto-gerado em alguns bancos; o
--    filtro casa qualquer CHECK sobre `provider` que mencione 'uazapi'.
--    Idempotente: reaplicar não quebra (DROP IF EXISTS + ADD do nome canônico).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_instances'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider%'
      AND pg_get_constraintdef(oid) ILIKE '%uazapi%'
  LOOP
    EXECUTE format('ALTER TABLE public.whatsapp_instances DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;

ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_check
  CHECK (provider IN ('evolution', 'uazapi', 'meta_cloud', 'notificame'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guarda DURA contra double-binding.
--    A unicidade é GLOBAL — sobre `channel_id` e nada mais —, e sob subconta por
--    org isso é uma ESCOLHA, não uma consequência. A unicidade "natural" agora
--    seria (organization_id, channel_id); ela PERMITIRIA duas orgs reivindicarem o
--    mesmo channel_id, que é exatamente o dano a evitar: mensagens de um tenant
--    entregues a outro. Os ids de canal são uuids globais do fornecedor, então a
--    forma global é estritamente mais estrita e não custa nada.
--
--    O índice único PARCIAL torna o double-binding impossível mesmo sob corrida
--    entre dois cliques simultâneos — a segunda transação leva 23505 e a edge
--    function traduz para 409 `channel_already_bound`.
--
--    Escopo PARCIAL (`WHERE provider = 'notificame'`) e não global: mantém o
--    índice pequeno e o invariante legível — ele fala sobre canais NotificaMe, e
--    só sobre eles. Linhas uazapi/evolution/meta_cloud, cujo `provider_config`
--    é '{}', ficam de fora e nunca entram na conta.
--
--    Sem CONCURRENTLY de propósito: `db push` roda a migration em transação
--    (CONCURRENTLY falharia) e a tabela tem dezenas de linhas — o lock é
--    instantâneo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_instances_notificame_channel
  ON public.whatsapp_instances ((provider_config ->> 'channel_id'))
  WHERE provider = 'notificame';

COMMENT ON INDEX public.uq_whatsapp_instances_notificame_channel IS
  'Um channel_id do NotificaMe pertence a UMA org. Cada org tem sua própria '
  'subconta, mas os ids de canal são uuids globais do fornecedor — e a unicidade '
  'aqui é GLOBAL de propósito, não por organization_id: (organization_id, '
  'channel_id) permitiria duas orgs reivindicarem o mesmo canal, que é exatamente '
  'o dano (mensagens de um tenant entregues a outro). Global é mais estrito e é a '
  'última linha de defesa contra um finish que atribua errado. Violação = 23505 → '
  'a edge function notificame-channel-finish devolve 409 channel_already_bound.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Documentar o vocabulário novo na própria coluna.
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.whatsapp_instances.provider IS
  'Provedor da instância WhatsApp: evolution (legado), uazapi (atual), '
  'meta_cloud (API oficial Meta, conexão via Embedded Signup) ou '
  'notificame (canal oficial via Seamless do NotificaMe — provider_config '
  'carrega vendor, subaccount_id, channel_id, channel_type, connected_via e '
  'connected_at; a coluna instance_id fica NULL de propósito, o id do canal '
  'tem um dono só: provider_config->>''channel_id''). ATENÇÃO: subaccount_id é o '
  'UUID da linha de notificame_subaccounts — REFERÊNCIA, nunca o company_uuid da '
  'subconta, que É o token dela. Esta tabela é lida sob RLS por qualquer membro '
  'da org, inclusive quem não tem whatsapp.manage_instances.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Porta de entrada — feature flag `notificame`.
--    DEFAULT OFF por construção: `organizations.feature_flags` é
--    `jsonb NOT NULL DEFAULT '{}'`, e tanto `useFeatureFlag` (frontend) quanto o
--    gate server-side das duas edge functions exigem `=== true` estrito. Chave
--    ausente = desligado, para TODAS as ~30 orgs. Este UPDATE liga para UMA:
--    a Milennials (org do CTO), que é onde a fatia é validada.
--
--    Ligar/desligar depois é UPDATE de dados, sem deploy:
--      UPDATE public.organizations
--         SET feature_flags = feature_flags || '{"notificame": true}'::jsonb
--       WHERE id = '<org>';
--
--    `||` preserva as demais chaves; o COALESCE é cinto e suspensório para o
--    caso de algum banco ter a coluna nula apesar do NOT NULL.
--
--    POR QUE ENVELOPADO EM DO-BLOCK COM RAISE: o UUID é de uma org que só existe em
--    PROD. Em dev, local, CI e em qualquer `db reset`, este UPDATE casa ZERO linhas
--    — e um UPDATE de zero linhas é sucesso silencioso, indistinguível de ter
--    funcionado. Quem aplicasse a migration num banco de dev e fosse testar a tela
--    encontraria a feature desligada sem nenhum sinal de por quê, e procuraria o
--    defeito no código.
--
--    RAISE WARNING e NÃO exceção: a ausência da org é o estado CORRETO fora de
--    prod. Falhar ali quebraria `db reset` e o CI por um fato de dados. O contrato
--    é: a migration sempre aplica, e sempre DIZ o que fez com a flag.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- Org Milennials (do CTO) — é onde esta fatia é validada. Existe só em prod.
  v_org_id CONSTANT UUID := '6030520a-2ca7-477d-be89-55758e2cd808';
  v_updated INTEGER;
BEGIN
  UPDATE public.organizations
     SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"notificame": true}'::jsonb
   WHERE id = v_org_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE WARNING
      '[notificame] flag NAO ligada: org % nao existe neste banco (esperado fora de prod). A feature fica DESLIGADA para todas as orgs. Para ligar em outra org: UPDATE public.organizations SET feature_flags = COALESCE(feature_flags, ''{}''::jsonb) || ''{"notificame": true}''::jsonb WHERE id = ''<org>'';',
      v_org_id;
  ELSE
    RAISE NOTICE '[notificame] flag ligada para a org % (1 linha).', v_org_id;
  END IF;
END $$;
