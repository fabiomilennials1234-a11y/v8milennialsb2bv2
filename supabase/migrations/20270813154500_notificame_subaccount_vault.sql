-- ============================================================================
-- Migration: NotificaMe — cofre da SUBCONTA por org + sessão de conexão
-- Data: 2027-08-13
-- Branch: feat/notificame-seamless
--
-- ⚠️ ORDEM DE APPLY — esta migration é a PRIMEIRA das duas da fatia. O timestamp
--   (…154500) é anterior ao da fundação (…154600) DE PROPÓSITO: o cabeçalho da
--   fundação exige o cofre "antes dela ou junto", porque é aqui que o
--   `notificame-channel-start` grava o token. A ordem inversa deixaria a janela em
--   que a flag já está ligada e o start não tem onde escrever.
--
--   Os dois timestamps foram escolhidos DEPOIS da última migration da main
--   (20270813120000_carteira_order_edit) e fora dos slots redondos que as branches
--   em voo ocupam (…100000/…110000 em develop). O par original (…000000/…010000)
--   nascia ANTES da main inteira, e `supabase db push` sem `--include-all`
--   simplesmente NÃO aplicaria nenhuma das duas — falha silenciosa com cara de
--   sucesso.
--
-- O FATO QUE OBRIGA ESTA TABELA A EXISTIR (verificado contra a conta viva em
--   2027-08-13): o `CompanyId` devolvido por `POST /v2/accounts` **É O TOKEN** da
--   subconta. Byte-a-byte igual ao `acccount_id` que `GET /v1/resale/` devolve
--   para ela. Logo o `company_uuid` que viaja na querystring do popup Seamless
--   NÃO é um identificador público: é CREDENCIAL.
--
-- CONSEQUÊNCIA DIRETA: ele não pode ser carimbado em
--   `whatsapp_instances.provider_config`. Essa tabela é legível sob RLS por
--   QUALQUER membro da org — inclusive quem não tem `whatsapp.manage_instances`.
--   Na linha da instância fica apenas `provider_config->>'subaccount_id'`: o UUID
--   da linha DESTA tabela, referência não-reversível. O token mora aqui, cifrado.
--
-- POR QUE NÃO `whatsapp_instance_secrets` — e o motivo decisivo NÃO é o
--   `chk_secrets_has_credential`. É a PK/FK: `instance_id REFERENCES
--   whatsapp_instances(id) ON DELETE CASCADE`. Dois defeitos estruturais:
--     (a) ORDEM — o token é necessário no START, para montar a URL do popup, e
--         nesse instante não existe linha de instância (23503). Criar uma
--         instância meia-nascida consumiria vaga de `max_whatsapp_instances` e
--         sujaria a tabela a cada popup abandonado;
--     (b) DESTRUIÇÃO — apagar a última instância notificame CASCATEARIA o token de
--         uma subconta que segue VIVA e faturável no fornecedor, e a reconexão
--         provisionaria uma SEGUNDA subconta irremovível.
--   Sem FK para `whatsapp_instances`, DE PROPÓSITO: apagar o canal deixa a
--   subconta intacta e a reconexão a REUSA. O pior efeito colateral do desenho
--   (subconta órfã faturável) vira um não-evento.
--
-- O MESMO RACIOCÍNIO, APLICADO À FK PARA `organizations` — e ele MUDA a resposta.
--   `ON DELETE CASCADE` aqui repetiria, pela porta da frente, exatamente o defeito
--   que motivou não usar `whatsapp_instance_secrets`: apagar a org destruiria o
--   token E a trilha (`vendor_email`) de uma subconta que segue VIVA e FATURÁVEL no
--   fornecedor — e ela é IRREMOVÍVEL, então some o registro e fica a cobrança, sem
--   nada que ligue a fatura a quem a gerou.
--
--   ESCOLHA: `ON DELETE SET NULL` + trilha preservada. NÃO `RESTRICT`. Por quê:
--     - `RESTRICT` transforma o cofre em refém de uma operação rotineira (apagar
--       org de teste, churn, limpeza do master). Quem levar o 23503 no meio de um
--       delete de org vai destravar do jeito mais curto — `DELETE FROM
--       notificame_subaccounts WHERE organization_id = …` — que é PRECISAMENTE o
--       dano que se queria evitar. RESTRICT protege a linha só até virar
--       inconveniente, e só protege quem entendeu o erro;
--     - `SET NULL` não pede ação de ninguém e não tem caminho de contorno: o delete
--       da org passa, e a linha do cofre é estruturalmente INCAPAZ de ser levada
--       junto. A trilha sobrevive por construção, não por disciplina.
--
--   O QUE SOBREVIVE AO DELETE DA ORG: `vendor_email` (determinístico,
--   `torque-<organization_id>@<dominio>` — carrega o id da org morta no próprio
--   texto), `detached_organization_id` (o id, em coluna própria, gravado pelo
--   trigger abaixo) e `detached_at` (QUANDO). Com isso o `GET /v1/resale/` — única
--   trilha de reconciliação que existe do lado deles — casa item a item com a org
--   que gerou a cobrança, mesmo meses depois.
--
--   POR QUE COLUNA DE TRILHA E NÃO `status = 'detached'`: `status` descreve o
--   provisionamento AGORA ('ready' segue verdadeiro — a subconta está viva lá). Um
--   fato do passado ("esta linha perdeu a org em tal instante") pede coluna própria;
--   sobrecarregar `status` apagaria o desfecho do provisionamento para sempre.
--
--   EFEITO NA UNIQUE: `organization_id` passa a ser NULLABLE. Em Postgres NULLs são
--   distintos entre si numa UNIQUE, então N linhas desanexadas convivem, e o portão
--   de idempotência (uma org viva → no máximo uma subconta) segue intacto para todo
--   valor não-nulo — que é o único caso que o `INSERT … ON CONFLICT DO NOTHING` do
--   provisionamento exercita.
--
-- POR QUE CIFRADO E NÃO TEXTO PURO: o repo tem dois padrões de cofre — Uazapi
--   (texto puro) e Omie (AES-256-GCM, ADR-0020). Este token dá acesso à subconta
--   INTEIRA daquela org. Escolher o mais fraco dos dois que já existem não passa.
--   Molde de RLS/GRANT copiado de `omie_connection_secrets` (20270203000000).
--   Chave: secret `NOTIFICAME_ENCRYPTION_KEY` (hex, 64 chars) — NOVA, não
--   reaproveitar `OMIE_ENCRYPTION_KEY`. Choke único: `_shared/notificame-credentials.ts`.
--
-- A `UNIQUE (organization_id)` NÃO É ORNAMENTO — é o portão de idempotência do
--   provisionamento. `POST /v2/accounts` cria objeto IRREMOVÍVEL e faturável no
--   fornecedor; a única guarda confiável contra clique-duplo é o banco, nunca o
--   cache do TanStack. O fluxo grava a claim (INSERT ... ON CONFLICT DO NOTHING)
--   ANTES de falar com o fornecedor.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ROLLBACK: `supabase/migrations/rollback/20270813154500_notificame_subaccount_vault.sql`
--   — é DESTRUTIVO de um jeito que o rollback da fundação não é. Leia o cabeçalho
--   dele antes de rodar: derrubar esta tabela apaga a ÚNICA trilha entre uma org e
--   a subconta dela no fornecedor.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. notificame_subaccounts — o cofre. DENY-ALL, service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificame_subaccounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE: portão de idempotência. Uma org, uma subconta, para sempre.
  --
  -- NULLABLE + SET NULL, não NOT NULL + CASCADE: a subconta do outro lado é
  -- IRREMOVÍVEL e FATURÁVEL. Apagar a org não pode apagar a única trilha que liga
  -- a fatura a quem a gerou. Ver o bloco "O MESMO RACIOCÍNIO" no cabeçalho.
  organization_id UUID UNIQUE
    REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Trilha do desanexamento. Preenchidas pelo trigger abaixo, no instante em que a
  -- FK zera `organization_id`. São FATO PASSADO — nunca sobrescrevem `status`.
  detached_organization_id UUID,
  detached_at TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'ready', 'failed')),

  -- O token da subconta (CompanyId), AES-256-GCM. Só ciphertext desce ao disco.
  company_uuid_ciphertext TEXT,
  company_uuid_nonce TEXT,
  encryption_key_id TEXT NOT NULL DEFAULT 'v1',

  -- Determinístico (`torque-<organization_id>@<dominio>`). NÃO é segredo, e é a
  -- única coisa que permite reconciliar uma subconta órfã do painel de revenda
  -- com a org dona dela. Por isso fica em claro.
  vendor_email TEXT,

  provisioned_at TIMESTAMPTZ,

  -- Código NOSSO, estável, de máquina. NUNCA o corpo do fornecedor: esta coluna é
  -- lida por service_role e acaba em log, e o corpo deles carrega texto livre.
  last_error_code TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Integridade: uma escrita parcial não pode se passar por 'ready'. Quem lê o
  -- cofre filtra por status='ready' e confia que os dois campos estão lá.
  CONSTRAINT chk_notificame_subaccount_ready
    CHECK (
      status <> 'ready'
      OR (company_uuid_ciphertext IS NOT NULL AND company_uuid_nonce IS NOT NULL)
    )
);

COMMENT ON TABLE public.notificame_subaccounts IS
  'Uma subconta NotificaMe por organização. Guarda o CompanyId da subconta '
  'cifrado (AES-256-GCM) — e esse CompanyId É O TOKEN dela, provado contra a '
  'conta viva: idêntico ao acccount_id de GET /v1/resale/. Deny-all: só '
  'service_role, via o choke _shared/notificame-credentials.ts. NÃO tem FK para '
  'whatsapp_instances de propósito — apagar o canal não pode destruir o token de '
  'uma subconta que segue viva e faturável no fornecedor. Pelo mesmo motivo a FK '
  'para organizations é ON DELETE SET NULL, nunca CASCADE: apagar a org deixa a '
  'linha de pé, desanexada, com a trilha de reconciliação intacta.';

COMMENT ON COLUMN public.notificame_subaccounts.organization_id IS
  'UNIQUE = portão de idempotência do provisionamento. POST /v2/accounts cria '
  'objeto irremovível e faturável; a claim é gravada AQUI antes de falar com o '
  'fornecedor, e é isso que impede clique-duplo de criar duas subcontas. NULLABLE '
  'porque a FK é ON DELETE SET NULL: NULL significa "a org foi apagada e a subconta '
  'continua viva lá" — estado de reconciliação, não de erro. NULLs são distintos '
  'numa UNIQUE, então várias linhas desanexadas convivem sem afrouxar o portão.';

COMMENT ON COLUMN public.notificame_subaccounts.detached_organization_id IS
  'Org que era dona desta subconta antes de ser apagada. Gravado pelo trigger '
  'trg_notificame_subaccounts_detach_trail no instante em que a FK zera '
  'organization_id. Fato PASSADO, em coluna própria — status segue descrevendo o '
  'provisionamento, que continua verdadeiro.';

COMMENT ON COLUMN public.notificame_subaccounts.detached_at IS
  'Quando a org dona foi apagada. NULL = ainda anexada.';

COMMENT ON COLUMN public.notificame_subaccounts.vendor_email IS
  'Email determinístico torque-<organization_id>@<dominio>. Não é segredo. É a '
  'ÚNICA trilha para reconciliar uma subconta do painel de revenda com a org dona.';

COMMENT ON COLUMN public.notificame_subaccounts.last_error_code IS
  'Código NOSSO (estável, de máquina). Nunca corpo nem mensagem do fornecedor.';

CREATE INDEX IF NOT EXISTS idx_notificame_subaccounts_status
  ON public.notificame_subaccounts(status);

ALTER TABLE public.notificame_subaccounts ENABLE ROW LEVEL SECURITY;

-- Uma policy só: service_role. Nenhuma policy para authenticated/anon = deny-all
-- pelo default do RLS.
DROP POLICY IF EXISTS "Service role full access notificame_subaccounts"
  ON public.notificame_subaccounts;
CREATE POLICY "Service role full access notificame_subaccounts"
  ON public.notificame_subaccounts
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defesa em profundidade: o Supabase managed mantém GRANTs de TABELA, e o GRANT
-- de tabela domina — REVOKE por coluna aqui seria ineficaz.
REVOKE ALL ON public.notificame_subaccounts FROM authenticated;
REVOKE ALL ON public.notificame_subaccounts FROM anon;
GRANT ALL ON public.notificame_subaccounts TO service_role;

DROP TRIGGER IF EXISTS trg_notificame_subaccounts_updated_at
  ON public.notificame_subaccounts;
CREATE TRIGGER trg_notificame_subaccounts_updated_at
  BEFORE UPDATE ON public.notificame_subaccounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Trilha do desanexamento.
--
--     `ON DELETE SET NULL` salva a LINHA, mas sozinho ele apaga QUAL org era —
--     e sem isso a linha sobrevivente vira uma subconta anônima: viva, faturada,
--     e sem dono conhecido. Este trigger fotografa o id no exato instante em que a
--     FK o zera, que é a última vez que ele existe nesta tabela.
--
--     BEFORE UPDATE e não AFTER: precisa ESCREVER em NEW, e a escrita tem que
--     acontecer na mesma tupla que a FK está atualizando.
--
--     A condição é estreita de propósito (não-nulo → nulo). Um UPDATE comum nunca
--     zera `organization_id`; se algum dia zerar, é exatamente o mesmo evento
--     semântico (a subconta perdeu o dono) e merece o mesmo carimbo.
--
--     Idempotente: o carimbo só é escrito quando `detached_at` ainda é NULL, então
--     um re-anexar/desanexar futuro não reescreve a PRIMEIRA perda, que é a que
--     interessa para casar com a fatura.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notificame_subaccount_stamp_detach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS NULL THEN
    NEW.detached_organization_id := COALESCE(NEW.detached_organization_id, OLD.organization_id);
    NEW.detached_at := COALESCE(NEW.detached_at, now());
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notificame_subaccount_stamp_detach() IS
  'Preserva QUAL org era dona da subconta no instante em que a FK ON DELETE SET '
  'NULL zera organization_id. Sem isto, a linha sobrevive ao delete da org mas '
  'vira subconta anônima — viva e faturável no fornecedor, sem dono conhecido.';

DROP TRIGGER IF EXISTS trg_notificame_subaccounts_detach_trail
  ON public.notificame_subaccounts;
CREATE TRIGGER trg_notificame_subaccounts_detach_trail
  BEFORE UPDATE OF organization_id ON public.notificame_subaccounts
  FOR EACH ROW EXECUTE FUNCTION public.notificame_subaccount_stamp_detach();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. notificame_connect_sessions — a sessão de conexão, com BASELINE.
--
--    POR QUE NÃO É UM NONCE CLÁSSICO: o `postMessage` do Seamless devolve
--    `{status:"channel-success"}` e MAIS NADA — sem id de canal. Nonce nenhum
--    pareia sessão↔canal quando o terceiro não carrega o id. O que pareia é o
--    DIFF: no clique, o servidor fotografa os canais que JÁ existiam na subconta;
--    o canal novo é `(listados \ baseline) \ reivindicados`.
--
--    O modo de falha que isso — e só isso — conserta: um popup ABANDONADO deixa um
--    canal livre dentro da própria subconta da org. Sem baseline, toda conexão
--    seguinte daquela org bate em `ambiguous_channel` PARA SEMPRE, sem saída pela
--    UI. Com baseline, o órfão está na foto e sai da conta.
--
--    A sessão NÃO é bearer: `organization_id` e `created_by` vêm SEMPRE do
--    contexto de auth, e a validação inteira mora no predicado do UPDATE que a
--    consome (atômico — duas abas concorrentes, só a primeira ganha). E o
--    session_id NUNCA trafega pelo payload do terceiro: ele anda no NOSSO canal
--    start→finish.
--
--    FK PARA `organizations`: aqui `ON DELETE CASCADE` está CERTO, e a diferença
--    para o cofre é o que a linha representa. A sessão é um rascunho efêmero (TTL
--    de minutos) que não tem contraparte no fornecedor: apagá-la não deixa nada
--    vivo, nada faturável e nada por reconciliar. Levar as sessões junto com a org
--    é higiene; levar o cofre junto seria perder a única trilha de uma cobrança que
--    continua correndo. Mesma pergunta ("o que sobrevive do outro lado?"), respostas
--    opostas — e é a resposta, não o hábito, que escolhe a ação da FK.
--
--    `created_by` de propósito SEM FK para `auth.users`: um usuário apagado no meio
--    do fluxo não pode derrubar (CASCADE) nem travar (RESTRICT) a sessão em voo. A
--    coluna é registro de quem clicou, e a autorização real é reavaliada no consumo
--    contra o auth context — nunca contra este valor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificame_connect_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,

  -- A foto. TEXT[] e não jsonb: é uma lista de ids e nada mais, e o operador de
  -- contenção de array é o que o consumo precisa.
  baseline_channel_ids TEXT[] NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'consumed', 'expired')),

  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notificame_connect_sessions IS
  'Sessão de conexão Seamless com BASELINE dos canais que já existiam na subconta '
  'no instante do clique. Não é nonce: o postMessage do fornecedor não carrega id '
  'de canal, então quem pareia sessão↔canal é o DIFF contra esta foto. Resolve o '
  'popup abandonado, que sem ela travaria ambiguous_channel na org para sempre. '
  'Não é bearer: org e usuário vêm do auth, o predicado do UPDATE é a autorização. '
  'Deny-all: só service_role, via o choke _shared/notificame-sessions.ts.';

COMMENT ON COLUMN public.notificame_connect_sessions.baseline_channel_ids IS
  'Ids dos canais listados na subconta no momento do clique. O canal novo é '
  '(listados \ baseline) \ reivindicados.';

-- Índice PARCIAL: a única leitura quente é "sessões abertas desta org" (consumo e
-- prune). Sessões consumidas/expiradas não entram no índice.
CREATE INDEX IF NOT EXISTS idx_notificame_connect_sessions_open
  ON public.notificame_connect_sessions(organization_id)
  WHERE status = 'open';

ALTER TABLE public.notificame_connect_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access notificame_connect_sessions"
  ON public.notificame_connect_sessions;
CREATE POLICY "Service role full access notificame_connect_sessions"
  ON public.notificame_connect_sessions
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.notificame_connect_sessions FROM authenticated;
REVOKE ALL ON public.notificame_connect_sessions FROM anon;
GRANT ALL ON public.notificame_connect_sessions TO service_role;
