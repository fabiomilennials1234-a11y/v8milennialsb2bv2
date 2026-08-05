-- A gravação da chamada chega ao CRM (Gravação S2, #1358 do PRD #1356).
-- ROLLBACK pareado: rollback/20270803000000_voip_recording_ingest.sql
--
-- O QUE ENTRA AQUI
-- ---------------
-- Desde a S1 a VPS produz um arquivo Ogg Opus estéreo por chamada atendida —
-- vendedor no canal esquerdo, lead no direito — e o deixa no próprio disco.
-- Nada o move para lugar nenhum. Esta migration é a metade de banco do caminho
-- que o move: dois eventos novos no envelope assinado que o S11 já entrega, o
-- bucket privado onde o áudio passa a morar, e a regra de quem pode ouvi-lo.
--
-- SEM SUPERFÍCIE NOVA — É O PONTO DA FATIA
-- ----------------------------------------
-- A gravação NÃO ganha endpoint, tabela de fila nem autenticação própria. Ela é
-- mais um `type` para `fn_voip_apply_vps_event`, ao lado de `auth-state`,
-- `call-status` e `call-ended`. Tudo que já vale para os três — anti-replay pelo
-- jti, ordem por (epoch, seq) por entidade, organização derivada de
-- `voip_sessions` e nunca do corpo — vale para os dois novos de graça.
--
--   recording-ready   → há arquivo na VPS; o CRM vai buscá-lo
--   recording-failed  → não haverá arquivo, e a causa é esta
--
-- A ASSIMETRIA É DELIBERADA (ADR-0026, decisão 5)
-- ----------------------------------------------
-- A VPS ANUNCIA; o CRM BUSCA. A VPS continua sem qualquer credencial de escrita
-- no Supabase: uma ponta comprometida não escreve na outra. Por isso o evento
-- não carrega caminho de armazenamento nem URL — ele carrega o fato de que o
-- arquivo existe, e o CRM decide onde guardá-lo.
--
-- TRÊS ESTADOS, NÃO DOIS
-- ----------------------
-- `call_logs.recording_url` vazio hoje significa uma coisa só: "não existe".
-- Depois desta fatia precisa distinguir três, e ausência é uma QUARTA:
--
--   recording_status NULO ....... não houve gravação (ninguém atendeu, ou a
--                                 gravação está desligada na VPS). Ausência.
--   recording_status processing . o CRM sabe que existe e está buscando
--   recording_status ready ...... está no bucket, o endereço está em
--                                 recording_url
--   recording_status failed ..... não vai haver, e `recording_failure_reason`
--                                 diz por quê
--
-- Ausência e falha NÃO podem colapsar: com uma só, o gestor não sabe se espera
-- ou se desiste. É por isso que a VPS NÃO emite evento para chamada sem
-- atendimento — emitir `failed` ali transformaria "não havia o que gravar" em
-- "a gravação quebrou".
--
-- CARIMBO DE REGIME
-- -----------------
-- Cada gravação registra sob qual regime nasceu. Hoje é `no_notice`: a decisão
-- do CTO é não avisar o lead (ADR-0026, decisão 9). O carimbo é o que impede
-- "por ora" de virar permanente por omissão — se a política mudar, as antigas
-- continuam distinguíveis das novas em vez de formarem um acervo indistinguível.
--
-- O VALOR É CONSTANTE DESTA FUNÇÃO, não campo do payload. O regime é política do
-- CRM; deixá-lo vir da VPS daria a uma máquina de terceiro a caneta para
-- carimbar o próprio consentimento.
--
-- ONDE O ESTADO MORA, E POR QUE NÃO DIRETO EM call_logs
-- ----------------------------------------------------
-- A autoridade é `voip_calls`; `call_logs` é PROJEÇÃO, exatamente como no S13.
-- Duas razões, e as duas são de ordem:
--
--   1. Quando o evento de gravação chega, a linha de `call_logs` pode não
--      existir. As duas entregas (`call-ended` e `recording-ready`) partem em
--      goroutines próprias, sem fila (webhook.go:74) — chegam na ordem que a
--      rede quiser. Escrever direto em `call_logs` exigiria criar a linha ali,
--      duplicando a regra de projeção num segundo lugar.
--   2. `fn_voip_project_call_log` é a única escritora de `call_logs` para
--      chamada de voz. Uma segunda escritora é como as duas divergem.
--
-- O gatilho de `voip_calls` já reprojeta a cada mudança relevante; esta
-- migration só acrescenta as colunas de gravação ao `WHEN` dele.
--
-- QUEM OUVE — E POR QUE NÃO É `voip_can_see_call`
-- -----------------------------------------------
-- Admin, gestor e master ouvem tudo da organização; o vendedor ouve SÓ AS
-- PRÓPRIAS. Colega não ouve colega.
--
-- Isto DIVERGE de propósito de `voip_can_see_call`, que amarra visibilidade ao
-- LEAD: um lead reatribuído faria o vendedor perder a gravação da ligação que
-- ele mesmo fez. Material de treino pertence a quem o produziu, e o vendedor
-- ouvir a si mesmo é o que faz a gravação virar autocorreção em vez de
-- vigilância (ADR-0026, decisão 7).
--
-- SEM BACKFILL AQUI
-- -----------------
-- Não há acervo: `recording_url` está NULO em todas as linhas de produção.
-- Migration é só schema — a guarda F4 do projeto, e a lição de um `db push` de
-- checkout atrasado que já reescreveu dado de cliente nesta base.

-- ===========================================================================
-- 1. O BUCKET
-- ===========================================================================
-- Nenhum dos cinco existentes serve: `media` e `help-media` são PÚBLICOS (o
-- áudio de uma conversa com cliente não pode ser lido por quem tiver a URL), e
-- `product-materials`, `support-attachments` e `agent-documents` já têm dono e
-- policy própria — pendurar gravação neles herdaria a regra de quem lê, que é
-- outra.
--
-- Molde: `agent-documents`/`support-attachments` — privado, com teto de tamanho,
-- lido por URL assinada.
--
-- 70 MiB: o gravador da VPS corta em 64 MiB (`defaultMaxFileBytes`, ~4,5 h a
-- 32 kbps). O teto do bucket fica ACIMA de propósito, para que quem recusa seja
-- sempre o lado que sabe explicar — empatar os dois números faria o arquivo de
-- fronteira morrer com um 413 mudo do storage. Uma ligação de vendas de 3 min
-- pesa ~720 KB.
--
-- `audio/ogg` e nada mais. O bucket guarda UMA coisa; aceitar mais seria abrir
-- um depósito de arquivo arbitrário atrás de uma policy escrita para áudio.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  false,
  70 * 1024 * 1024,
  ARRAY['audio/ogg']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ===========================================================================
-- 2. AS COLUNAS DE ESTADO, EM voip_calls (a autoridade)
-- ===========================================================================

ALTER TABLE public.voip_calls
  ADD COLUMN IF NOT EXISTS recording_status         text,
  ADD COLUMN IF NOT EXISTS recording_path           text,
  ADD COLUMN IF NOT EXISTS recording_bytes          bigint,
  ADD COLUMN IF NOT EXISTS recording_duration_ms    integer,
  ADD COLUMN IF NOT EXISTS recording_failure_reason text,
  ADD COLUMN IF NOT EXISTS recording_notice_regime  text,
  ADD COLUMN IF NOT EXISTS recording_stored_at      timestamptz;

-- NOT VALID é deliberado e não é preguiça: a checagem passa a valer para toda
-- escrita nova sem varrer a tabela inteira sob lock. Como as colunas nascem
-- NULAS em 100% das linhas, não há nada a varrer — mas a forma é a que não
-- morde quando um dia houver.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voip_calls_recording_status_chk') THEN
    ALTER TABLE public.voip_calls
      ADD CONSTRAINT voip_calls_recording_status_chk
      CHECK (recording_status IS NULL
             OR recording_status IN ('processing', 'ready', 'failed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voip_calls_recording_regime_chk') THEN
    ALTER TABLE public.voip_calls
      ADD CONSTRAINT voip_calls_recording_regime_chk
      CHECK (recording_notice_regime IS NULL
             OR recording_notice_regime IN ('no_notice', 'announced')) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN public.voip_calls.recording_status IS
  'NULO = não houve gravação (não atendida, ou gravação desligada na VPS). '
  'processing = anunciada, o CRM está buscando. ready = no bucket '
  'call-recordings, endereço em recording_path. failed = não vai haver, causa '
  'em recording_failure_reason. AUSÊNCIA E FALHA SÃO ESTADOS DIFERENTES: com um '
  'só, o gestor não sabe se espera ou se desiste.';

COMMENT ON COLUMN public.voip_calls.recording_path IS
  'Caminho do objeto em storage (bucket call-recordings), NÃO uma URL assinada: '
  'assinatura expira, e o que se guarda é o endereço. Forma: '
  '<organization_id>/<voip_calls.id>.opus — a org no primeiro segmento é o que a '
  'policy de storage.objects lê para decidir quem ouve.';

COMMENT ON COLUMN public.voip_calls.recording_notice_regime IS
  'Sob qual regime a gravação nasceu. no_notice = sem aviso ao lead (decisão do '
  'CTO, ADR-0026 §9). É CONSTANTE do CRM, nunca campo do payload da VPS: o '
  'regime é política nossa. Existe para que "por ora" não vire permanente por '
  'omissão — se a política mudar, as antigas continuam distinguíveis das novas.';

COMMENT ON COLUMN public.voip_calls.recording_duration_ms IS
  'Duração que um tocador vai renderizar, medida pelo gravador da VPS. Existe '
  'para poder ser comparada com a duração da chamada (PRD #1356, história 24): '
  'dois números que deveriam bater e que ninguém conferiria se um deles não '
  'fosse guardado.';

-- ===========================================================================
-- 3. AS COLUNAS DE LEITURA, EM call_logs (a projeção)
-- ===========================================================================
-- `recording_url` já existia, vazia desde que a tabela nasceu. O que faltava
-- era o estado ao lado dela.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS recording_status        text,
  ADD COLUMN IF NOT EXISTS recording_notice_regime text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_recording_status_chk') THEN
    ALTER TABLE public.call_logs
      ADD CONSTRAINT call_logs_recording_status_chk
      CHECK (recording_status IS NULL
             OR recording_status IN ('processing', 'ready', 'failed')) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN call_logs.recording_status IS
  'Projeção de voip_calls.recording_status. NULO em registro manual e em '
  'chamada que não gerou gravação. O player (S3) lê daqui.';

COMMENT ON COLUMN call_logs.recording_url IS
  'Caminho do objeto no bucket call-recordings quando recording_status = ready. '
  'NÃO é URL assinada — quem toca gera a assinatura na hora, e a policy do '
  'bucket decide se pode.';

-- ===========================================================================
-- 4. QUEM OUVE
-- ===========================================================================
-- Wrapper SECURITY DEFINER, e não subquery inline na policy: é a regra da casa
-- contra recursão quando o Realtime avalia apply_rls(), e é o mesmo desenho de
-- `can_read_support_attachment`, que é o bucket privado mais parecido com este.
--
-- FAIL-CLOSED EM TODO CAMINHO DE DÚVIDA: nome malformado, uuid inválido,
-- chamada que não existe — tudo devolve false. Um `::uuid` que ESTOURA dentro de
-- policy vira erro na leitura, não permissão; mesmo assim a conversão fica
-- dentro de BEGIN/EXCEPTION, porque erro de storage é diagnosticado como falha
-- de infraestrutura e mandaria o plantonista olhar o lugar errado.
CREATE OR REPLACE FUNCTION public.fn_voip_can_hear_recording(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org      uuid;
  v_call_id  uuid;
  v_call     public.voip_calls%ROWTYPE;
BEGIN
  BEGIN
    v_org     := split_part(object_name, '/', 1)::uuid;
    v_call_id := split_part(split_part(object_name, '/', 2), '.', 1)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_org IS NULL OR v_call_id IS NULL THEN
    RETURN false;
  END IF;

  -- Master primeiro: é o único papel que não precisa da linha para decidir, e
  -- resolvê-lo antes evita o SELECT em toda leitura de suporte.
  IF public.is_master_user() THEN
    RETURN true;
  END IF;

  SELECT * INTO v_call FROM public.voip_calls WHERE id = v_call_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- O caminho do objeto NÃO É AUTORIDADE. A organização que vale é a da linha
  -- de `voip_calls`; o segmento do nome só serve para achar a linha. Sem esta
  -- comparação, quem pudesse ESCREVER um objeto escolheria a org do path e
  -- leria a gravação alheia colocando-a debaixo da própria pasta.
  IF v_call.organization_id IS DISTINCT FROM v_org THEN
    RETURN false;
  END IF;

  -- Admin e gestor de portfólio: toda a organização (ADR-0021 §6 — a mesma
  -- função que o resto do projeto usa para "admin operacional").
  IF v_org IN (SELECT public.get_my_admin_organization_ids()) THEN
    RETURN true;
  END IF;

  -- Vendedor: só as próprias, e só se ainda pertencer à organização. O membro
  -- DESATIVADO não passa, porque `get_my_organization_ids` já filtra
  -- `is_active` — é o mesmo furo que o #1209 fechou nos leitores de métrica.
  RETURN v_call.operator_user_id IS NOT NULL
     AND v_call.operator_user_id = auth.uid()
     AND v_org IN (SELECT public.get_my_organization_ids());
END;
$$;

COMMENT ON FUNCTION public.fn_voip_can_hear_recording(text) IS
  'Quem pode ouvir uma gravação, a partir do NOME DO OBJETO '
  '(<org>/<voip_call_id>.opus). Master e admin/gestor: toda a organização. '
  'Vendedor: só as chamadas que ele mesmo operou. DIVERGE de voip_can_see_call '
  'de propósito — aquela amarra ao lead, e um lead reatribuído faria o vendedor '
  'perder a gravação da ligação que ele fez (ADR-0026 §7). Fail-closed em nome '
  'malformado, chamada ausente e divergência entre a org do caminho e a da linha.';

-- `FROM PUBLIC` sozinho NÃO fecha: o ALTER DEFAULT PRIVILEGES do Supabase no
-- schema `public` concede EXECUTE a `anon` e `authenticated` em toda função
-- nova, e revogar de PUBLIC não alcança grant direto. Os papéis nomeados são
-- obrigatórios — é a mesma lição de 20270801000000 (o detector INV-2 acusou a
-- função como alcançável por anon com só o REVOKE de PUBLIC).
--
-- `authenticated` recebe de volta logo abaixo, e de propósito: a policy do
-- bucket é avaliada COMO O USUÁRIO, então sem EXECUTE nenhuma leitura passaria.
-- `anon` e `service_role` não recebem: anon não ouve nada, e service_role
-- bypassa RLS por definição — dar-lhe EXECUTE só ampliaria superfície.
REVOKE ALL ON FUNCTION public.fn_voip_can_hear_recording(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_voip_can_hear_recording(text) TO authenticated;

-- SÓ SELECT, e só para `authenticated`.
--
-- Não há policy de INSERT/UPDATE/DELETE, e a ausência é a decisão: quem escreve
-- é o `service_role` da edge function, que bypassa RLS. Um usuário logado NÃO
-- pode plantar objeto neste bucket — se pudesse, escolheria a org do caminho, e
-- a fronteira de tenant viraria escolha do atacante.
DROP POLICY IF EXISTS "call_recordings_select" ON storage.objects;
CREATE POLICY "call_recordings_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND public.fn_voip_can_hear_recording(name)
  );

-- ===========================================================================
-- 5. A APLICAÇÃO DOS DOIS EVENTOS NOVOS
-- ===========================================================================
-- Escritas de sistema, chamadas por `fn_voip_apply_vps_event` (que é DEFINER e
-- roda como `postgres`) e pela edge function depois de guardar o arquivo.
--
-- Separadas da RPC do webhook porque têm DOIS chamadores com identidades
-- diferentes — o webhook (postgres, dentro da transação do evento) e o
-- `service_role` da edge function, depois do upload. Uma regra, dois
-- chamadores, um lugar para consertar. É o mesmo desenho de
-- `fn_voip_project_call_log`.
--
-- A REGRA QUE GOVERNA AS TRÊS: NUNCA PIORAR O QUE JÁ SE SABE.
-- `ready` é o estado terminal bom; nada o rebaixa. Isto não é elegância — é o
-- que faz a reentrega do mesmo evento (com jti NOVO, que o anti-replay não pega)
-- ser inofensiva. O emissor da VPS é best-effort e a rede repete.

CREATE OR REPLACE FUNCTION public.fn_voip_recording_announced(
  p_call_id     uuid,
  p_bytes       bigint,
  p_duration_ms integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- O regime é POLÍTICA DO CRM. Constante, e não parâmetro: um valor que
  -- viajasse no payload daria à VPS a caneta para carimbar o próprio
  -- consentimento. Mudar a política é mudar esta linha — e as gravações
  -- antigas continuam com o valor sob o qual nasceram.
  c_notice_regime constant text := 'no_notice';
  v_call    public.voip_calls%ROWTYPE;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'call_not_found';
  END IF;

  -- Já guardada. A reentrega NÃO pode rebaixar `ready` para `processing`: isso
  -- mandaria o CRM buscar de novo um arquivo que a VPS talvez já tenha apagado,
  -- e a segunda busca marcaria FALHA numa gravação que está inteira no bucket.
  IF v_call.recording_status = 'ready' THEN
    RETURN 'already_stored';
  END IF;

  UPDATE public.voip_calls
     SET recording_status = 'processing',
         -- COALESCE nos dois: um anúncio repetido sem os números não pode
         -- apagar os que o primeiro trouxe.
         recording_bytes         = COALESCE(p_bytes, recording_bytes),
         recording_duration_ms   = COALESCE(p_duration_ms, recording_duration_ms),
         -- O carimbo de regime é imutável depois de posto: ele diz sob qual
         -- política a gravação NASCEU, e reescrevê-lo apagaria exatamente a
         -- distinção que ele existe para preservar.
         recording_notice_regime = COALESCE(recording_notice_regime, c_notice_regime),
         -- Anúncio novo limpa a causa da falha anterior: a VPS está dizendo que
         -- desta vez há arquivo.
         recording_failure_reason = NULL,
         updated_at = now()
   WHERE id = p_call_id;

  RETURN 'fetch';
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_announced(uuid, bigint, integer) IS
  'Aplica recording-ready: marca `processing` e carimba o regime. Devolve '
  '`fetch` quando o CRM deve ir buscar o arquivo, `already_stored` quando a '
  'gravação já está no bucket (reentrega não rebusca nem rebaixa), e '
  '`call_not_found`. Chamadores: fn_voip_apply_vps_event.';

CREATE OR REPLACE FUNCTION public.fn_voip_recording_failed(
  p_call_id uuid,
  p_reason  text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c_notice_regime constant text := 'no_notice';
  v_call   public.voip_calls%ROWTYPE;
  v_reason text;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'call_not_found';
  END IF;

  -- Gravação já guardada não "falha" depois. Uma entrega atrasada de
  -- `recording-failed` não pode apagar o endereço de um arquivo que está no
  -- bucket e toca.
  IF v_call.recording_status = 'ready' THEN
    RETURN 'already_stored';
  END IF;

  -- Motivo é diagnóstico, e vem de fora: cortado, e nunca nulo. "Falhou" sem
  -- causa manda o plantonista olhar o lugar errado.
  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'unknown');
  IF length(v_reason) > 120 THEN
    v_reason := left(v_reason, 120);
  END IF;

  UPDATE public.voip_calls
     SET recording_status         = 'failed',
         recording_failure_reason = v_reason,
         recording_notice_regime  = COALESCE(recording_notice_regime, c_notice_regime),
         updated_at               = now()
   WHERE id = p_call_id;

  RETURN 'failed';
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_failed(uuid, text) IS
  'Aplica recording-failed E a falha do download no CRM: marca `failed` com a '
  'causa. Nunca rebaixa `ready`. Chamadores: fn_voip_apply_vps_event e a edge '
  'function torquecalls-webhook quando a busca do arquivo não completa.';

CREATE OR REPLACE FUNCTION public.fn_voip_recording_stored(
  p_call_id uuid,
  p_path    text,
  p_bytes   bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call public.voip_calls%ROWTYPE;
BEGIN
  IF p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN 'invalid_path';
  END IF;

  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'call_not_found';
  END IF;

  -- O CAMINHO É DERIVADO, NÃO ACEITO. A edge function o compõe, mas se ela
  -- errasse a organização o objeto ficaria debaixo da pasta de outro tenant — e
  -- a policy do bucket concederia a leitura a quem não deve. Recompor aqui, a
  -- partir da linha, é a última barreira antes de o endereço virar permanente.
  IF p_path IS DISTINCT FROM (v_call.organization_id::text || '/' || v_call.id::text || '.opus') THEN
    RETURN 'path_mismatch';
  END IF;

  UPDATE public.voip_calls
     SET recording_status         = 'ready',
         recording_path           = p_path,
         recording_bytes          = COALESCE(p_bytes, recording_bytes),
         recording_failure_reason = NULL,
         recording_stored_at      = COALESCE(recording_stored_at, now()),
         updated_at               = now()
   WHERE id = p_call_id;

  RETURN 'stored';
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_stored(uuid, text, bigint) IS
  'Fecha o caminho: o arquivo está no bucket, e este é o endereço. Recompõe o '
  'caminho a partir da linha e RECUSA (path_mismatch) se não bater — objeto '
  'debaixo da pasta da org errada seria leitura concedida a quem não deve. '
  'Idempotente: repetir devolve `stored` sem mover recording_stored_at.';

-- Não são API. Os chamadores legítimos são a RPC do webhook (DEFINER, roda como
-- `postgres`, dono destas) e a edge function pelo `service_role`.
--
-- `service_role` RECEBE, e é a diferença para 20270801000000: lá o único
-- chamador era um gatilho, e gatilho não checa EXECUTE ao disparar. Aqui a edge
-- function chama por PostgREST, que é chamada de função comum — e chamada comum
-- CHECA EXECUTE do papel corrente.
REVOKE ALL ON FUNCTION public.fn_voip_recording_announced(uuid, bigint, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_voip_recording_failed(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_voip_recording_stored(uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fn_voip_recording_failed(uuid, text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_voip_recording_stored(uuid, text, bigint)  TO service_role;
-- `fn_voip_recording_announced` NÃO vai para service_role: o único caminho
-- legítimo para ela é o evento assinado, dentro da transação da RPC do webhook.
-- Concedê-la à edge function abriria um jeito de marcar `processing` sem
-- envelope nenhum.

-- ===========================================================================
-- 6. OS DOIS EVENTOS NOVOS EM fn_voip_apply_vps_event
-- ===========================================================================
-- CREATE OR REPLACE do corpo INTEIRO — é o único jeito em Postgres, e por isso
-- o que segue é 20270730000010 com DUAS mudanças cirúrgicas, e nada mais:
--
--   a) `recording-ready` e `recording-failed` entram na lista de tipos que
--      LOCALIZAM a linha de chamada (seção "Localização da linha");
--   b) um bloco novo, logo depois da marca d'água, aplica os dois.
--
-- O bloco fica ANTES do `IF v_late`, e isso é decisão: as três regras da faixa
-- tardia (não avança marca d'água, nunca escreve `status`, só melhora o que
-- sabe) já são satisfeitas POR CONSTRUÇÃO pelas funções acima — nenhuma toca
-- `voip_calls.status`, e nenhuma rebaixa `ready`. Duplicar o tratamento nas duas
-- faixas seria duas cópias da mesma regra divergindo em três meses.
--
-- E importa que o evento atrasado SEJA aplicado: `recording-ready` é emitido
-- depois do `call-ended`, mas as duas entregas são goroutines independentes.
-- Descartá-lo por chegar fora de ordem perderia a gravação inteira — a mesma
-- classe de perda que a faixa tardia foi criada para acabar.

CREATE OR REPLACE FUNCTION public.fn_voip_apply_vps_event(
  p_event_jti uuid,
  p_sid       text,
  p_epoch     bigint,
  p_seq       bigint,
  p_signed_at timestamptz,
  p_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_dedup_window constant interval := interval '60 minutes';

  c_end_reasons  constant text[] := ARRAY[
    'user_ended','declined','timeout','busy','cancelled','failed','do_not_disturb','unknown'
  ];

  c_ts_past      constant interval := interval '24 hours';
  c_ts_future    constant interval := interval '5 minutes';

  v_session public.voip_sessions%ROWTYPE;
  v_call    public.voip_calls%ROWTYPE;
  v_claimed uuid;
  v_type    text;
  v_state   text;
  v_next    text;
  v_status  text;
  v_tc_call text;
  v_reason  text;
  v_ts      timestamptz;

  v_late    boolean;

  v_ms      numeric;
  v_ms_min  numeric;
  v_ms_max  numeric;

  -- Gravação: o desfecho da função de estado, devolvido ao endpoint.
  v_rec_outcome text;
  v_rec_bytes   bigint;
  v_rec_ms      integer;
BEGIN
  IF p_event_jti IS NULL OR p_sid IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'malformed_envelope');
  END IF;

  IF COALESCE(p_epoch, 0) <= 0 OR COALESCE(p_seq, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'invalid_sequence');
  END IF;

  v_type := p_payload->>'type';

  v_ms_min := extract(epoch from now() - c_ts_past)   * 1000;
  v_ms_max := extract(epoch from now() + c_ts_future) * 1000;

  SELECT * INTO v_session
    FROM public.voip_sessions
   WHERE tc_session_id = p_sid
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'code', 'session_not_found');
  END IF;

  IF v_session.status = 'quarantined' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'session_inert');
  END IF;

  INSERT INTO public.voip_webhook_events (
    event_jti, organization_id, tc_session_id, seq_epoch, seq, signed_at, expires_at
  ) VALUES (
    p_event_jti, v_session.organization_id, p_sid, p_epoch, p_seq,
    COALESCE(p_signed_at, now()), now() + c_dedup_window
  )
  ON CONFLICT (event_jti) DO NOTHING
  RETURNING event_jti INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'replay');
  END IF;

  -- =========================================================================
  -- auth-state
  -- =========================================================================
  IF v_type = 'auth-state' THEN
    IF NOT (p_epoch > v_session.last_seq_epoch
            OR (p_epoch = v_session.last_seq_epoch AND p_seq > v_session.last_seq)) THEN
      RETURN jsonb_build_object('ok', true, 'code', 'out_of_order',
                                'detail', 'session_watermark');
    END IF;

    UPDATE public.voip_sessions
       SET last_seq_epoch = p_epoch,
           last_seq       = p_seq,
           updated_at     = now()
     WHERE id = v_session.id;

    v_state := p_payload->>'state';

    v_next := CASE v_session.status
      WHEN 'pending' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pending'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'pairing' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pairing'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'open'    THEN CASE v_state
                            WHEN 'qr' THEN NULL       WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pending'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'closed'  THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN NULL
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN NULL
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      ELSE NULL
    END;

    IF v_next IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'transition_refused',
        'detail', CASE WHEN v_state IN ('qr','open','logged_out','connecting','failed')
                       THEN 'state_transition_refused' ELSE 'unknown_state' END,
        'from', v_session.status, 'to', v_state);
    END IF;

    IF v_next <> v_session.status THEN
      UPDATE public.voip_sessions
         SET status = v_next, updated_at = now()
       WHERE id = v_session.id;

      IF v_state = 'failed' THEN
        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_session.organization_id, 'voip', 'webhook_sessao_falhou', 'error',
                'voip_session', v_session.id,
                jsonb_build_object('tc_session_id', p_sid, 'status_anterior', v_session.status,
                                   'status_novo', v_next,
                                   'motivo', 'ConnectFailure/StreamReplaced na VPS — exige repareamento',
                                   'seq_epoch', p_epoch, 'seq', p_seq));
      ELSIF v_state = 'connecting' THEN
        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_session.organization_id, 'voip', 'webhook_sessao_reconectando', 'success',
                'voip_session', v_session.id,
                jsonb_build_object('tc_session_id', p_sid, 'status_anterior', v_session.status,
                                   'status_novo', v_next,
                                   'motivo', 'Disconnected na VPS — chamada suspensa até voltar open',
                                   'seq_epoch', p_epoch, 'seq', p_seq));
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied',
                              'detail', 'auth_state', 'session_status', v_next);
  END IF;

  -- =========================================================================
  -- Localização da linha de chamada — comum a call-status, call-ended e aos
  -- DOIS eventos de gravação
  -- =========================================================================
  IF v_type IN ('call-status', 'call-ended', 'recording-ready', 'recording-failed') THEN
    v_tc_call := NULLIF(p_payload->>'id', '');

    IF v_tc_call IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                'detail', 'missing_call_id');
    END IF;

    SELECT * INTO v_call
      FROM public.voip_calls
     WHERE tc_session_id   = p_sid
       AND tc_call_id      = v_tc_call
       AND organization_id = v_session.organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.runtime_logs
        (organization_id, module, action, status, payload_snapshot)
      VALUES (v_session.organization_id, 'voip', 'webhook_chamada_desconhecida', 'skipped',
              jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                 'type', v_type));
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'call_not_found');
    END IF;

    v_late := NOT (p_epoch > v_call.last_seq_epoch
                   OR (p_epoch = v_call.last_seq_epoch AND p_seq > v_call.last_seq));

    IF NOT v_late THEN
      UPDATE public.voip_calls
         SET last_seq_epoch = p_epoch,
             last_seq       = p_seq
       WHERE id = v_call.id;
    END IF;
  END IF;

  -- =========================================================================
  -- 3.3 GRAVAÇÃO — aplicada nas DUAS faixas, e por isso vem antes do IF v_late
  -- =========================================================================
  -- O anúncio da gravação é emitido DEPOIS do `call-ended`, mas as duas entregas
  -- partem em goroutines independentes e sem fila. Descartar o anúncio por
  -- chegar fora de ordem perderia a gravação inteira — e ela é a única coisa que
  -- aquele evento carrega.
  --
  -- Aplicar nas duas faixas é seguro porque as três regras da faixa tardia valem
  -- por construção: `fn_voip_recording_*` não escreve `status` de chamada, não
  -- move marca d'água, e nunca rebaixa `ready`.
  IF v_type IN ('recording-ready', 'recording-failed') THEN
    IF v_type = 'recording-ready' THEN
      -- Números vindos de fora: só entram se forem número mesmo. `jsonb_typeof`
      -- antes do cast, pela mesma razão que os carimbos de tempo desta função
      -- são testados antes de converter — um cast que estoura aborta a
      -- transação inteira e devolve 500 por um payload malformado da VPS.
      v_rec_bytes := CASE WHEN jsonb_typeof(p_payload->'bytes') = 'number'
                          THEN (p_payload->>'bytes')::bigint ELSE NULL END;
      v_rec_ms    := CASE WHEN jsonb_typeof(p_payload->'durationMs') = 'number'
                          THEN least((p_payload->>'durationMs')::numeric, 2147483647)::integer
                          ELSE NULL END;
      IF v_rec_bytes IS NOT NULL AND v_rec_bytes < 0 THEN v_rec_bytes := NULL; END IF;
      IF v_rec_ms    IS NOT NULL AND v_rec_ms    < 0 THEN v_rec_ms    := NULL; END IF;

      v_rec_outcome := public.fn_voip_recording_announced(v_call.id, v_rec_bytes, v_rec_ms);

      -- `fetch_call_id` é o que manda a edge function ir buscar. Só sai quando
      -- há de fato o que buscar: reentrega sobre gravação já guardada devolve
      -- `already_stored` e NÃO rebusca — o arquivo pode já ter sido apagado da
      -- VPS, e a segunda busca marcaria falha numa gravação inteira.
      RETURN jsonb_build_object(
        'ok', true, 'code', 'applied',
        'detail', CASE WHEN v_rec_outcome = 'fetch' THEN 'recording_pending'
                       ELSE 'recording_' || v_rec_outcome END,
        'recording', v_rec_outcome,
        'fetch_call_id', CASE WHEN v_rec_outcome = 'fetch' THEN v_call.id::text ELSE NULL END,
        'tc_call_id',    CASE WHEN v_rec_outcome = 'fetch' THEN v_tc_call ELSE NULL END,
        'organization_id', CASE WHEN v_rec_outcome = 'fetch'
                                THEN v_call.organization_id::text ELSE NULL END);
    END IF;

    v_reason      := p_payload->>'reason';
    v_rec_outcome := public.fn_voip_recording_failed(v_call.id, v_reason);

    -- Falha SEMPRE deixa rastro. É o único desfecho da gravação que um humano
    -- pode precisar investigar, e o endpoint não registra `applied`.
    INSERT INTO public.runtime_logs
      (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
    VALUES (v_call.organization_id, 'voip', 'webhook_gravacao_falhou', 'error',
            'voip_call', v_call.id,
            jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                               'motivo', v_reason, 'desfecho', v_rec_outcome,
                               'atrasado', v_late,
                               'seq_epoch', p_epoch, 'seq', p_seq));

    RETURN jsonb_build_object('ok', true, 'code', 'applied',
                              'detail', 'recording_' || v_rec_outcome,
                              'recording', v_rec_outcome);
  END IF;

  -- =========================================================================
  -- 3.4 FAIXA TARDIA — o evento que perdeu a corrida contra a própria chamada
  -- =========================================================================
  IF v_late THEN
    IF v_type = 'call-status' THEN
      v_status := p_payload->>'status';

      IF v_status = 'connected' AND v_call.connected_at IS NULL THEN
        UPDATE public.voip_calls
           SET connected_at = LEAST(now(), v_call.ended_at),
               updated_at   = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'connected_at',
                                   'motivo', 'connected entregue DEPOIS de evento com seq maior',
                                   'status_da_linha', v_call.status,
                                   'seq_epoch', p_epoch, 'seq', p_seq,
                                   'marca_epoch', v_call.last_seq_epoch,
                                   'marca_seq', v_call.last_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'late_connected_at');
      END IF;

      IF v_status = 'ringing' AND v_call.ringing_at IS NULL THEN
        v_ms := CASE WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
                     THEN (p_payload->>'startedAt')::numeric ELSE NULL END;
        v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                     THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

        UPDATE public.voip_calls
           SET ringing_at = LEAST(v_ts, v_call.connected_at, v_call.ended_at),
               updated_at = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'ringing_at',
                                   'status_da_linha', v_call.status,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'late_ringing_at');
      END IF;
    END IF;

    IF v_type = 'call-ended' THEN
      v_reason := COALESCE(NULLIF(p_payload->>'reason', ''), 'unknown');
      IF NOT (v_reason = ANY (c_end_reasons)) THEN
        v_reason := 'unknown';
      END IF;

      v_ms := CASE WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
                   THEN (p_payload->>'endedAt')::numeric ELSE NULL END;
      v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                   THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

      IF v_call.ended_at IS NULL
         OR v_call.end_reason IS NULL
         OR v_call.end_reason IN ('unknown', 'no_terminal_event') THEN
        UPDATE public.voip_calls
           SET ended_at   = COALESCE(v_call.ended_at,
                                     GREATEST(v_ts, v_call.connected_at)),
               end_reason = CASE WHEN v_call.end_reason IS NULL
                                   OR v_call.end_reason IN ('unknown', 'no_terminal_event')
                                 THEN v_reason ELSE v_call.end_reason END,
               updated_at = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'end_reason',
                                   'motivo_anterior', v_call.end_reason,
                                   'motivo_novo', v_reason,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'late_end_stamp', 'end_reason', v_reason);
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'out_of_order',
                              'detail', 'call_watermark');
  END IF;

  -- =========================================================================
  -- call-status
  -- =========================================================================
  IF v_type = 'call-status' THEN
    v_status := p_payload->>'status';

    IF v_status = 'starting' THEN
      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'noop_starting');
    END IF;

    IF v_status = 'ringing' THEN
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      v_ms := CASE WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
                   THEN (p_payload->>'startedAt')::numeric ELSE NULL END;
      v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                   THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

      IF v_call.status = 'connected' THEN
        UPDATE public.voip_calls
           SET ringing_at = COALESCE(ringing_at, v_ts), updated_at = now()
         WHERE id = v_call.id;
        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'noop_already_connected');
      END IF;

      UPDATE public.voip_calls
         SET status     = 'ringing',
             ringing_at = COALESCE(ringing_at, v_ts),
             updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ringing');
    END IF;

    IF v_status = 'connected' THEN
      IF v_call.status = 'ended' AND v_call.end_reason = 'no_terminal_event' THEN
        IF v_call.operator_user_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.voip_calls c2
           WHERE c2.operator_user_id = v_call.operator_user_id
             AND c2.id <> v_call.id
             AND c2.status IN ('authorized','ringing','connected')
        ) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                    'detail', 'operator_busy');
        END IF;

        BEGIN
          UPDATE public.voip_calls
             SET status       = 'connected',
                 connected_at = COALESCE(connected_at, now()),
                 ended_at     = NULL,
                 end_reason   = NULL,
                 updated_at   = now()
           WHERE id = v_call.id;
        EXCEPTION WHEN unique_violation THEN
          RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                    'detail', 'operator_busy');
        END;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_chamada_ressuscitada', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'ended_at_anterior', v_call.ended_at,
                                   'end_reason_anterior', v_call.end_reason,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'resurrected');
      END IF;

      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status       = 'connected',
             connected_at = COALESCE(connected_at, now()),
             updated_at   = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'connected');
    END IF;

    IF v_status = 'ended' THEN
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status     = 'ended',
             ended_at   = COALESCE(ended_at, now()),
             end_reason = 'unknown',
             updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ended_via_status');
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'unknown_status', 'status', v_status);
  END IF;

  -- =========================================================================
  -- call-ended
  -- =========================================================================
  IF v_type = 'call-ended' THEN
    v_reason := COALESCE(NULLIF(p_payload->>'reason', ''), 'unknown');
    IF NOT (v_reason = ANY (c_end_reasons)) THEN
      v_reason := 'unknown';
    END IF;

    v_ms := CASE WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
                 THEN (p_payload->>'endedAt')::numeric ELSE NULL END;
    v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                 THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

    IF v_call.status NOT IN ('ended','expired') THEN
      UPDATE public.voip_calls
         SET status     = 'ended',
             ended_at   = COALESCE(ended_at, GREATEST(v_ts, v_call.connected_at)),
             end_reason = v_reason,
             updated_at = now()
       WHERE id = v_call.id;
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'ended', 'end_reason', v_reason);
    END IF;

    IF v_call.end_reason = 'no_terminal_event' THEN
      UPDATE public.voip_calls
         SET end_reason = v_reason,
             ended_at   = GREATEST(v_ts, v_call.connected_at),
             updated_at = now()
       WHERE id = v_call.id;
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'sweeper_reason_corrected', 'end_reason', v_reason);
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'already_terminal');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                            'detail', 'unknown_type', 'type', v_type);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) IS
  'Aplica UM evento assinado da VPS: anti-replay pelo jti, ordem por '
  '(epoch, seq) POR ENTIDADE, transição de sessão, escrita no ledger de chamada '
  'e o estado da GRAVAÇÃO — tudo numa transação. Cinco tipos: auth-state, '
  'call-status, call-ended, recording-ready, recording-failed. Os dois de '
  'gravação são aplicados também quando chegam fora de ordem, porque o anúncio '
  'é a única coisa que carrega a existência do arquivo. Quando há o que buscar, '
  'a saída traz fetch_call_id/tc_call_id/organization_id — é assim que o '
  'endpoint sabe que precisa ir à VPS. A organização sai de voip_sessions pelo '
  'tc_session_id, NUNCA do corpo. service_role apenas.';

-- ===========================================================================
-- 7. A PROJEÇÃO CARREGA A GRAVAÇÃO ATÉ call_logs
-- ===========================================================================
-- Corpo de 20270801000000 com UMA mudança: as três colunas de gravação entram
-- no INSERT e no DO UPDATE. Tudo o mais é byte por byte o mesmo.

CREATE OR REPLACE FUNCTION public.fn_voip_project_call_log(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call     public.voip_calls%ROWTYPE;
  v_answered boolean;
  v_outcome  text;
  v_duration integer;
  v_log_id   uuid;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_call.status <> 'ended' THEN
    RETURN NULL;
  END IF;

  v_answered := v_call.connected_at IS NOT NULL;

  v_outcome := CASE
    WHEN v_answered THEN 'connected'
    ELSE CASE v_call.end_reason
      WHEN 'timeout'        THEN 'no_answer'
      WHEN 'busy'           THEN 'busy'
      WHEN 'do_not_disturb' THEN 'busy'
      WHEN 'declined'       THEN 'rejected'
      WHEN 'rejected'       THEN 'rejected'
      -- A ARMADILHA: dois L da VPS, um L no CHECK do banco.
      WHEN 'cancelled'      THEN 'canceled'
      WHEN 'user_ended'     THEN 'canceled'
      ELSE 'failed'
    END
  END;

  v_duration := CASE
    WHEN v_answered AND v_call.ended_at IS NOT NULL
      THEN GREATEST(0, round(extract(epoch FROM v_call.ended_at - v_call.connected_at)))::integer
    ELSE NULL
  END;

  INSERT INTO public.call_logs (
    organization_id, lead_id, user_id, direction, outcome, duration_seconds,
    phone_number, voip_provider, voip_call_id, started_at, ended_at,
    recording_url, recording_status, recording_notice_regime
  ) VALUES (
    v_call.organization_id,
    v_call.lead_id,
    v_call.operator_user_id,
    v_call.direction,
    v_outcome,
    v_duration,
    v_call.peer_phone,
    'torquecalls',
    v_call.id::text,
    COALESCE(v_call.connected_at, v_call.authorized_at),
    v_call.ended_at,
    v_call.recording_path,
    v_call.recording_status,
    v_call.recording_notice_regime
  )
  ON CONFLICT (voip_call_id) WHERE voip_call_id IS NOT NULL
  DO UPDATE SET
    organization_id  = EXCLUDED.organization_id,
    lead_id          = EXCLUDED.lead_id,
    user_id          = EXCLUDED.user_id,
    direction        = EXCLUDED.direction,
    outcome          = EXCLUDED.outcome,
    duration_seconds = EXCLUDED.duration_seconds,
    phone_number     = EXCLUDED.phone_number,
    voip_provider    = EXCLUDED.voip_provider,
    started_at       = EXCLUDED.started_at,
    ended_at         = EXCLUDED.ended_at,
    -- `recording_url` entra COM COALESCE, e a diferença importa: a projeção
    -- roda em toda mudança da chamada, inclusive nas que não têm nada a ver
    -- com gravação. Sem o COALESCE, uma correção de `end_reason` chegando
    -- depois do upload apagaria o endereço do áudio — e o registro passaria a
    -- dizer `ready` sem ter para onde apontar.
    --
    -- É também o que preserva a intenção original da migration do S13: a
    -- projeção NÃO apaga o que outro escreveu. `notes` continua inteiramente
    -- de fora.
    recording_url           = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
    recording_status        = COALESCE(EXCLUDED.recording_status, call_logs.recording_status),
    recording_notice_regime = COALESCE(EXCLUDED.recording_notice_regime, call_logs.recording_notice_regime)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.fn_voip_project_call_log(uuid) IS
  'Projeta uma voip_calls ENCERRADA em call_logs. Idempotente por voip_call_id '
  '(ON CONFLICT DO UPDATE: a segunda passada sabe mais que a primeira). '
  'outcome sai de connected_at, não de end_reason. As colunas de gravação vão '
  'junto, com COALESCE: a projeção nunca APAGA um endereço de áudio já gravado. '
  '`notes` segue fora. Chamadores: os gatilhos '
  'trg_voip_calls_project_call_log_* e o backfill.';

REVOKE ALL ON FUNCTION public.fn_voip_project_call_log(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- O gatilho de UPDATE ganha as colunas de gravação no `WHEN`. Sem isto, o
-- upload do áudio escreveria `voip_calls` e a projeção não rodaria — o endereço
-- ficaria na tabela de autoridade e nunca chegaria à tela.
DROP TRIGGER IF EXISTS trg_voip_calls_project_call_log_upd ON public.voip_calls;
CREATE TRIGGER trg_voip_calls_project_call_log_upd
  AFTER UPDATE ON public.voip_calls
  FOR EACH ROW
  WHEN (
    NEW.status = 'ended'
    AND (
      OLD.status       IS DISTINCT FROM NEW.status
      OR OLD.end_reason   IS DISTINCT FROM NEW.end_reason
      OR OLD.connected_at IS DISTINCT FROM NEW.connected_at
      OR OLD.ended_at     IS DISTINCT FROM NEW.ended_at
      OR OLD.recording_status        IS DISTINCT FROM NEW.recording_status
      OR OLD.recording_path          IS DISTINCT FROM NEW.recording_path
      OR OLD.recording_notice_regime IS DISTINCT FROM NEW.recording_notice_regime
    )
  )
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();
