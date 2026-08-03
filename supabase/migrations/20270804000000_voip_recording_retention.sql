-- O áudio some em 90 dias, e a busca que falhou é tentada de novo
-- (Gravação S4, #1360 do PRD #1356).
-- ROLLBACK pareado: rollback/20270804000000_voip_recording_retention.sql
-- BASE: 20270803000000_voip_recording_ingest.sql (S2, #1358) — sem ela nada
-- aqui tem sobre o que operar.
--
-- DUAS COISAS, E A SEGUNDA NÃO ESTAVA NA ISSUE
-- --------------------------------------------
-- 1. EXPURGO. Gravação de ligação com mais de 90 dias é apagada.
-- 2. REENFILEIRAMENTO. Busca que falhou é tentada de novo, com teto.
--
-- A segunda veio da revisão da S2 e é CONDIÇÃO para a primeira decisão
-- continuar de pé. Hoje, se a busca do arquivo falha, a linha fica `failed` e
-- ninguém tenta de novo: cada oscilação de rede vira perda definitiva, e o
-- áudio órfão fica no disco da VPS para sempre — o `sweepPartials` de lá só
-- limpa `.part`. Retenção que promete apagar em 90 dias sobre um acervo que
-- vaza para fora do CRM não é retenção.
--
-- POR QUE 90 DIAS (ADR-0026 §8)
-- ----------------------------
-- Ligação de seis meses atrás não treina ninguém. E o registro duradouro NÃO é
-- o áudio: quando a transcrição existir, é o texto que fica. Custo não foi o
-- motivo (com opus são ~2,4 GB/ano no cenário cheio) — o motivo é não acumular
-- acervo que ninguém revisa, sobretudo porque estas gravações nascem SEM AVISO
-- AO LEAD (`recording_notice_regime = 'no_notice'`).
--
-- APAGAR DE VERDADE, E POR QUE ISSO OBRIGA O DESENHO INTEIRO
-- ---------------------------------------------------------
-- O objeto tem que sair do ARMAZENAMENTO, não só a referência. Apagar apenas
-- `recording_url` deixaria o arquivo lá, e "90 dias" viraria intenção em vez de
-- fato — com o passivo que a retenção existe para limitar crescendo, invisível.
--
-- Medido nesta base (prod e local): `storage.objects` tem o gatilho
-- `protect_objects_delete`, que chama `storage.protect_delete()` e LEVANTA
-- 42501 em qualquer DELETE vindo do SQL:
--
--     "Direct deletion from storage tables is not allowed. Use the Storage API
--      instead." / HINT: "This prevents accidental data loss from orphaned
--      objects."
--
-- Isso decide a arquitetura: o expurgo NÃO PODE ser um cron de SQL puro como o
-- `voip-sweep-stuck-calls`. Ele é cron -> pg_net -> edge function, que apaga
-- pela Storage API (a única coisa que recupera os bytes no S3), e só então
-- volta ao banco para confirmar. Mesmo desenho do `whatsapp_media_retention`,
-- que é o único precedente de retenção com storage neste projeto.
--
-- E é isso que dá a barreira contra o mutante que mais importa — "trocar o
-- apagar-de-verdade por apagar-só-a-referência":
--
--     `fn_voip_recording_purged` RECUSA enquanto o objeto ainda estiver em
--     `storage.objects`.
--
-- Quem pular a chamada à Storage API não consegue marcar nada como expurgado.
-- O banco não aceita esquecer o endereço de um arquivo que ainda existe.
--
-- UM QUARTO ESTADO: `purged`
-- -------------------------
-- A S2 fixou três estados mais a ausência, e o argumento dela é o mesmo aqui:
-- ausência e falha não podem colapsar, porque o gestor não saberia se espera ou
-- se desiste. Expurgo é uma QUINTA coisa e colapsá-la em NULO diria "esta
-- ligação nunca foi gravada" sobre uma ligação que foi gravada e ouvida.
--
--   NULO ......... não houve gravação
--   processing ... o CRM está buscando
--   ready ........ está no bucket
--   failed ....... não vai haver, e a causa está em recording_failure_reason
--   purged ....... existiu, foi ouvida, e os 90 dias venceram
--
-- `recording_bytes` e `recording_duration_ms` SOBREVIVEM ao expurgo de
-- propósito: são fatos sobre o que existiu, e a história 18 do PRD ("medir
-- quanto a gravação custa em espaço") deixa de ter fonte se o expurgo os apagar.
-- O que morre é o ENDEREÇO e o ÁUDIO.
--
-- SEM BACKFILL, E SEM ESCRITA DE DADO DE CLIENTE
-- ---------------------------------------------
-- Migration é só schema. Nenhum DO block de backfill: é a guarda F4 do projeto
-- e a lição de um `db push` de checkout atrasado que já reescreveu parede de
-- cliente nesta base. As colunas nascem NULAS/zero e a primeira execução do
-- cron é quem começa a agir.

-- ===========================================================================
-- 1. AS COLUNAS DO EXPURGO E DA RETENTATIVA
-- ===========================================================================

ALTER TABLE public.voip_calls
  ADD COLUMN IF NOT EXISTS recording_purged_at          timestamptz,
  ADD COLUMN IF NOT EXISTS recording_refetch_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recording_last_attempt_at    timestamptz,
  ADD COLUMN IF NOT EXISTS recording_fetch_abandoned_at timestamptz;

COMMENT ON COLUMN public.voip_calls.recording_purged_at IS
  'Quando o expurgo de 90 dias apagou o áudio. Carimbo de TRILHA: diz o que '
  'aconteceu, e é o que distingue "expurgada" de "nunca gravada" junto com '
  'recording_status = purged. recording_bytes e recording_duration_ms '
  'sobrevivem — são fatos sobre o que existiu.';

COMMENT ON COLUMN public.voip_calls.recording_refetch_count IS
  'Quantas vezes o CRM REENFILEIROU a busca do arquivo na VPS. A tentativa '
  'original (inline, disparada pelo anúncio) é zero. É INCREMENTADO NO CLAIM, '
  'nunca no relato da falha — um worker que morre depois de reivindicar já '
  'gastou a ficha, e é isso que impede o laço quando ninguém volta para contar '
  'o que houve.';

COMMENT ON COLUMN public.voip_calls.recording_last_attempt_at IS
  'Quando a última tentativa de buscar o arquivo COMEÇOU. Trilha, e também a '
  'âncora do espaçamento: a elegibilidade é '
  'last_attempt_at < now() - fn_voip_recording_retry_delay(refetch_count). '
  'Carimbá-lo no claim é o que serve de arrendamento — duas execuções '
  'simultâneas do cron não pegam a mesma linha.';

COMMENT ON COLUMN public.voip_calls.recording_fetch_abandoned_at IS
  'Quando o CRM desistiu de vez de buscar este arquivo. A CAUSA fica em '
  'recording_failure_reason, que não é sobrescrita por nenhum marcador — '
  '"desistiu" e "por quê" são duas perguntas e moram em dois lugares. NULO '
  'enquanto ainda há tentativa pela frente.';

-- ---------------------------------------------------------------------------
-- O quarto estado entra nos dois CHECK.
--
-- DROP + ADD porque Postgres não altera predicado de CHECK no lugar. NOT VALID
-- pelo mesmo motivo da S2: passa a valer para toda escrita nova sem varrer a
-- tabela sob lock, e não há o que varrer (nenhuma linha de produção tem
-- recording_status preenchido).
-- ---------------------------------------------------------------------------
ALTER TABLE public.voip_calls DROP CONSTRAINT IF EXISTS voip_calls_recording_status_chk;
ALTER TABLE public.voip_calls
  ADD CONSTRAINT voip_calls_recording_status_chk
  CHECK (recording_status IS NULL
         OR recording_status IN ('processing', 'ready', 'failed', 'purged')) NOT VALID;

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_recording_status_chk;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_recording_status_chk
  CHECK (recording_status IS NULL
         OR recording_status IN ('processing', 'ready', 'failed', 'purged')) NOT VALID;

COMMENT ON COLUMN public.voip_calls.recording_status IS
  'NULO = não houve gravação (não atendida, ou gravação desligada na VPS). '
  'processing = anunciada, o CRM está buscando. ready = no bucket '
  'call-recordings, endereço em recording_path. failed = não vai haver, causa '
  'em recording_failure_reason. purged = existiu e os 90 dias venceram (S4). '
  'AUSÊNCIA, FALHA E EXPURGO SÃO ESTADOS DIFERENTES: colapsá-los faz o gestor '
  'não saber se espera, se desiste, ou se chegou tarde.';

-- ---------------------------------------------------------------------------
-- Os dois índices parciais que sustentam as duas varreduras.
--
-- Sem eles, um cron de 5 em 5 minutos varre voip_calls inteira 288 vezes por
-- dia para achar nada — barato hoje (14 linhas em produção) e caro exatamente
-- quando a gravação começar a valer a pena.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_voip_calls_recording_purge
  ON public.voip_calls (COALESCE(ended_at, connected_at, authorized_at))
  WHERE recording_status = 'ready';

CREATE INDEX IF NOT EXISTS idx_voip_calls_recording_retry
  ON public.voip_calls (recording_last_attempt_at)
  WHERE recording_status = 'failed' AND recording_fetch_abandoned_at IS NULL;

-- ===========================================================================
-- 2. O EXPURGO — QUEM ESTÁ VENCIDO
-- ===========================================================================
-- OS 90 DIAS SÃO CONSTANTE DAQUI, NÃO PARÂMETRO. Um `p_older_than_days` daria
-- ao chamador a caneta para escolher a retenção, e a política passaria a morar
-- no TypeScript, onde nenhum teste desta fatia a alcança. O precedente do
-- `list_expired_whatsapp_media` fez isso e o resultado é que o DEFAULT do banco
-- ali é decoração: quem manda é a constante da edge function. Aqui o banco é a
-- autoridade e a edge function não tem opinião.
--
-- A ÂNCORA É A LIGAÇÃO, NÃO O UPLOAD. `recording_stored_at` diria quando o
-- CRM guardou, e uma gravação que só chegou depois de quatro reentregas
-- ganharia sobrevida por causa de um problema de rede. O que a política promete
-- é sobre a CONVERSA: "gravação de ligação de 91 dias atrás não existe mais".
-- `authorized_at` é NOT NULL DEFAULT now(), então há sempre âncora — mesmo
-- raciocínio do COALESCE do `voip-sweep-stuck-calls`.
CREATE OR REPLACE FUNCTION public.fn_voip_recording_purge_candidates(
  p_limit integer DEFAULT 200
)
RETURNS TABLE (call_id uuid, organization_id uuid, object_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.organization_id, c.recording_path
    FROM public.voip_calls c
   WHERE c.recording_status = 'ready'
     AND c.recording_path IS NOT NULL
     AND COALESCE(c.ended_at, c.connected_at, c.authorized_at)
           < now() - interval '90 days'
   ORDER BY COALESCE(c.ended_at, c.connected_at, c.authorized_at) ASC
   LIMIT GREATEST(COALESCE(p_limit, 0), 0);
$$;

COMMENT ON FUNCTION public.fn_voip_recording_purge_candidates(integer) IS
  'Gravações vencidas: `ready`, com endereço, de ligação encerrada há mais de '
  '90 DIAS — constante desta função, nunca parâmetro, para a política não '
  'migrar para o chamador. Somente leitura. Consumida por '
  'torquecalls-recording-maintenance, que apaga pela Storage API (DELETE em '
  'storage.objects pelo SQL é barrado por storage.protect_delete).';

-- ===========================================================================
-- 3. O EXPURGO — A CONFIRMAÇÃO, E A BARREIRA CONTRA APAGAR-SÓ-A-REFERÊNCIA
-- ===========================================================================
-- Esta função é o ponto inteiro da fatia. Ela RECUSA enquanto o objeto estiver
-- em `storage.objects`.
--
-- Se alguém trocar o apagar-de-verdade por apagar-só-a-referência — pulando a
-- Storage API e vindo direto marcar o registro —, o banco devolve
-- `object_still_present` e NADA é esquecido. O endereço continua lá, o status
-- continua `ready`, e a gravação continua tocando. "90 dias" não pode virar
-- intenção porque o único caminho para o estado `purged` passa pela ausência
-- comprovada do objeto.
--
-- `storage.objects` é o índice do armazenamento: a Storage API apaga a linha E
-- os bytes no S3; o SQL não consegue apagar nem a linha (gatilho
-- `protect_objects_delete`). Ausência da linha é, nesta base, a evidência
-- disponível mais forte de que os bytes se foram.
CREATE OR REPLACE FUNCTION public.fn_voip_recording_purged(p_call_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call public.voip_calls%ROWTYPE;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'call_not_found';
  END IF;

  -- Rodar duas vezes não quebra. A segunda passada encontra `purged` e sai sem
  -- mover recording_purged_at — o carimbo diz quando a gravação foi apagada, e
  -- reescrevê-lo a cada varredura transformaria a trilha em relógio.
  IF v_call.recording_status = 'purged' THEN
    RETURN 'already_purged';
  END IF;

  -- Só se expurga o que estava guardado. Uma linha `processing`, `failed` ou
  -- sem gravação nenhuma não tem áudio para apagar, e marcá-la `purged` diria
  -- que houve o que não houve.
  IF v_call.recording_status IS DISTINCT FROM 'ready' OR v_call.recording_path IS NULL THEN
    RETURN 'not_stored';
  END IF;

  -- ┌───────────────────────────────────────────────────────────────────────┐
  -- │ A BARREIRA. Sem ela, esta fatia entrega intenção em vez de fato.      │
  -- └───────────────────────────────────────────────────────────────────────┘
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'call-recordings'
       AND name = v_call.recording_path
  ) THEN
    RETURN 'object_still_present';
  END IF;

  -- Autoridade primeiro. Este UPDATE dispara
  -- trg_voip_calls_project_call_log_upd (recording_status mudou), e a projeção
  -- leva `purged` até call_logs.
  UPDATE public.voip_calls
     SET recording_status  = 'purged',
         recording_path    = NULL,
         recording_purged_at = now(),
         updated_at        = now()
   WHERE id = p_call_id;

  -- A ORDEM É A DECISÃO, E ESTE É O ÚNICO LUGAR DO PROJETO QUE ESCREVE
  -- `call_logs.recording_url` FORA DA PROJEÇÃO.
  --
  -- `fn_voip_project_call_log` grava recording_url com
  -- COALESCE(EXCLUDED.recording_url, call_logs.recording_url) — de propósito:
  -- ela roda em toda mudança da chamada, e sem o COALESCE uma correção de
  -- `end_reason` chegando depois do upload apagaria o endereço do áudio. Essa
  -- garantia é "a projeção NUNCA apaga um endereço", e ela continua valendo.
  --
  -- Expurgo é a única operação cujo propósito É apagar o endereço. Ela não cabe
  -- numa função que promete não apagar, e enfraquecer a promessa para todo
  -- mundo por causa deste caso seria pior. Então: a projeção escreve o que
  -- sabe, e o expurgo DESESCREVE a única coisa que veio existir para
  -- desescrever — uma coluna, uma linha, com chave.
  --
  -- Depois do UPDATE acima, nunca antes: invertido, a projeção disparada pelo
  -- gatilho traria o endereço de volta pelo COALESCE.
  UPDATE public.call_logs
     SET recording_url = NULL
   WHERE voip_call_id = p_call_id::text;

  RETURN 'purged';
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_purged(uuid) IS
  'Confirma o expurgo de UMA gravação: marca `purged`, apaga o endereço em '
  'voip_calls E em call_logs, e carimba recording_purged_at. RECUSA com '
  '`object_still_present` enquanto o objeto existir em storage.objects — é o '
  'que impede a fatia de degradar para "apagar só a referência". Idempotente '
  '(`already_purged`). A linha de call_logs SOBREVIVE: perde o endereço, '
  'mantém desfecho e duração. service_role apenas.';

-- ===========================================================================
-- 4. O ESPAÇAMENTO DA RETENTATIVA
-- ===========================================================================
-- QUANTAS: 1 tentativa original (inline, quando o anúncio chega) + 4
-- reenfileiramentos = 5 no total.
--
-- COM QUE ESPAÇAMENTO: 5, 15, 45 e 135 minutos depois da falha anterior.
-- Triplicar cobre, em ordem de grandeza crescente, as três causas transitórias
-- reais — um soluço de rede (segundos), uma reinicialização da VPS (minutos), e
-- uma indisponibilidade de storage ou de deploy (dezenas de minutos) — sem
-- martelar a VPS enquanto ela está justamente caída.
--
-- QUANDO DESISTIR: o total dá ~3h20 depois da primeira falha. Isso é
-- deliberadamente MENOR que um dia, porque a história 22 do PRD promete a
-- gravação de hoje ainda hoje; uma retentativa que ainda estivesse tentando
-- amanhã já teria descumprido a promessa que a torna útil.
--
-- Retentativa infinita numa gravação cuja origem já sumiu é laço; nenhuma
-- retentativa é a perda que esta fatia existe para consertar. Cinco tentativas
-- em três horas é o meio termo com as duas pontas fechadas.
--
-- IMMUTABLE e pura para poder ser exercida diretamente pelo teste: o
-- espaçamento é política, e política que só se observa por efeito colateral
-- vira folclore.
CREATE OR REPLACE FUNCTION public.fn_voip_recording_retry_delay(p_refetch_count integer)
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_refetch_count, 0)
           WHEN 0 THEN interval '5 minutes'
           WHEN 1 THEN interval '15 minutes'
           WHEN 2 THEN interval '45 minutes'
           WHEN 3 THEN interval '135 minutes'
           ELSE NULL          -- teto: não há quinta busca
         END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_retry_delay(integer) IS
  'Espaçamento até o próximo reenfileiramento, a partir de quantos já houve: '
  '5, 15, 45, 135 minutos — e NULO no quarto, que é o teto. NULO é o que torna '
  'a linha ineligível mesmo se o carimbo de desistência faltar: duas barreiras '
  'para o mesmo laço.';

-- ===========================================================================
-- 5. A FALHA DA BUSCA — QUEM ENTRA NA FILA E QUEM NÃO ENTRA
-- ===========================================================================
-- Função NOVA, e não uma alteração de `fn_voip_recording_failed`. As duas
-- falhas não são a mesma coisa, e é a diferença que impede o laço:
--
--   fn_voip_recording_failed (S2) ....... a VPS disse `recording-failed`.
--       Não vai existir arquivo nenhum. Buscar de novo é bater numa porta que
--       o dono avisou que não abre. NÃO entra na fila — e é por isso que a
--       função da S2 fica intocada.
--
--   fn_voip_recording_fetch_failed ...... o arquivo existe (ou existia) e a
--       BUSCA falhou. É esta que a esta fatia devolve para a fila.
--
-- MOTIVOS TERMINAIS. Três, e a lista é curta de propósito: retentar custa uma
-- requisição, e não retentar custa a gravação inteira. Só ficam de fora os
-- motivos que NUNCA mudam de resposta por si:
--
--   db_path_mismatch  o caminho não bate com a linha. Recomposto do mesmo
--                     jeito na próxima vez, com o mesmo resultado.
--   db_call_not_found a chamada não existe. Não vai passar a existir.
--   too_large         corpo acima de 68 MiB, quando a VPS corta em 64. Quem
--                     respondeu não foi a VPS, e não será na próxima.
--
-- Tudo o mais entra: `vps_timeout`, `vps_unreachable`, `vps_http_5xx`,
-- `storage_upload_failed`, `db_write_failed`, `token_unavailable`,
-- `unexpected_error`, `empty_body`, `truncated_body`, `not_ogg` (uma página de
-- erro de proxy durante deploy responde 200 com HTML) e até `vps_http_404` — um
-- proxy à frente da VPS devolve 404 no meio de um deploy, e o teto de quatro
-- buscas torna barato errar para o lado de tentar.
CREATE OR REPLACE FUNCTION public.fn_voip_recording_fetch_failed(
  p_call_id uuid,
  p_reason  text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c_notice_regime constant text   := 'no_notice';
  c_terminal      constant text[] := ARRAY['db_path_mismatch', 'db_call_not_found', 'too_large'];
  v_call     public.voip_calls%ROWTYPE;
  v_reason   text;
  v_give_up  boolean;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'call_not_found';
  END IF;

  -- Nunca rebaixa o que já está bom, e nunca ressuscita o que já foi apagado.
  -- Mesma regra da S2, estendida ao quarto estado: uma falha atrasada chegando
  -- depois do expurgo devolveria a linha para `failed` e a fila tentaria buscar
  -- na VPS um arquivo que o CRM apagou de propósito.
  IF v_call.recording_status = 'ready'  THEN RETURN 'already_stored'; END IF;
  IF v_call.recording_status = 'purged' THEN RETURN 'already_purged'; END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'unknown');
  IF length(v_reason) > 120 THEN
    v_reason := left(v_reason, 120);
  END IF;

  -- O teto é lido do contador, que quem incrementa é o CLAIM. Aqui só se
  -- constata: a ficha já foi gasta antes de a busca começar.
  v_give_up := v_reason = ANY (c_terminal)
            OR public.fn_voip_recording_retry_delay(v_call.recording_refetch_count) IS NULL;

  UPDATE public.voip_calls
     SET recording_status         = 'failed',
         recording_failure_reason = v_reason,
         recording_notice_regime  = COALESCE(recording_notice_regime, c_notice_regime),
         recording_last_attempt_at = now(),
         -- COALESCE: quem já desistiu não volta a desistir mais tarde. O
         -- primeiro carimbo é o que vale, senão a trilha diria que a decisão
         -- foi tomada na última vez em que alguém passou por aqui.
         recording_fetch_abandoned_at =
           CASE WHEN v_give_up THEN COALESCE(recording_fetch_abandoned_at, now())
                ELSE recording_fetch_abandoned_at END,
         updated_at = now()
   WHERE id = p_call_id;

  RETURN CASE WHEN v_give_up THEN 'abandoned' ELSE 'retry_scheduled' END;
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_fetch_failed(uuid, text) IS
  'A BUSCA do arquivo falhou (distinto de fn_voip_recording_failed, que é a '
  'VPS avisando que arquivo não haverá). Marca `failed` com a causa e decide '
  'entre `retry_scheduled` e `abandoned`. Desiste em motivo terminal '
  '(db_path_mismatch, db_call_not_found, too_large) ou quando o teto de 4 '
  'reenfileiramentos foi gasto. Nunca rebaixa `ready` nem ressuscita `purged`. '
  'Chamadores: torquecalls-webhook (tentativa inline) e '
  'torquecalls-recording-maintenance (as reenfileiradas).';

-- ===========================================================================
-- 6. A FILA — REIVINDICAR AS QUE ESTÃO NA HORA
-- ===========================================================================
-- INCREMENTAR NO CLAIM É O QUE FECHA O LAÇO. Se o contador subisse só no relato
-- da falha, um worker que morre entre reivindicar e relatar devolveria a linha
-- para a fila sem gastar ficha nenhuma — e a mesma gravação seria buscada a
-- cada cinco minutos, para sempre, que é exatamente o laço que esta fatia foi
-- avisada para não criar. Gastando a ficha na entrada, o pior caso de um worker
-- que sempre morre é quatro buscas e ponto.
--
-- Carimbar `recording_last_attempt_at` no claim serve de ARRENDAMENTO: a linha
-- sai da janela de elegibilidade pelo próximo espaçamento, então duas execuções
-- simultâneas do cron não buscam o mesmo arquivo. FOR UPDATE SKIP LOCKED cobre
-- a corrida dentro do mesmo instante.
--
-- O STATUS FICA `failed`, e não vira `processing`. Se o worker morrer, uma
-- linha `processing` ficaria assim para sempre — a "ausência disfarçada de
-- processando há três dias" que a S2 existe para acabar. Enquanto o arquivo não
-- estiver no bucket, o que o gestor vê é o último desfecho verdadeiro.
--
-- A SEGUNDA BARREIRA É DE RELÓGIO, e é independente do contador: nada é buscado
-- se a ligação terminou há mais de 24 horas. Ela existe porque o contador é uma
-- promessa de que alguém volta para contar o que houve; o relógio não depende
-- de ninguém voltar. E é também a leitura de produto: gravação de ontem que
-- ainda não chegou não vai chegar.
CREATE OR REPLACE FUNCTION public.fn_voip_recording_retry_claim(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  call_id         uuid,
  tc_call_id      text,
  tc_session_id   text,
  organization_id uuid,
  refetch_count   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT c.id
      FROM public.voip_calls c
     WHERE c.recording_status = 'failed'
       AND c.recording_fetch_abandoned_at IS NULL
       AND c.tc_call_id IS NOT NULL
       -- Teto de tentativas: NULO significa "não há próxima".
       AND public.fn_voip_recording_retry_delay(c.recording_refetch_count) IS NOT NULL
       -- Espaçamento. `recording_last_attempt_at` é NULO só em linha que nunca
       -- passou por fn_voip_recording_fetch_failed — isto é, falha ANUNCIADA
       -- pela VPS, que não se busca. NULO aqui é ineligível de propósito.
       AND c.recording_last_attempt_at
             < now() - public.fn_voip_recording_retry_delay(c.recording_refetch_count)
       -- Barreira de relógio, independente do contador.
       AND COALESCE(c.ended_at, c.connected_at, c.authorized_at) > now() - interval '24 hours'
     ORDER BY c.recording_last_attempt_at ASC
     LIMIT GREATEST(COALESCE(p_limit, 0), 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.voip_calls c
     SET recording_refetch_count   = c.recording_refetch_count + 1,
         recording_last_attempt_at = now(),
         updated_at                = now()
    FROM eligible e
   WHERE c.id = e.id
  RETURNING c.id, c.tc_call_id, c.tc_session_id, c.organization_id, c.recording_refetch_count;
END;
$$;

COMMENT ON FUNCTION public.fn_voip_recording_retry_claim(integer) IS
  'Reivindica gravações cuja BUSCA falhou e está na hora de tentar de novo. '
  'Incrementa recording_refetch_count NA ENTRADA — worker que morre já gastou '
  'a ficha, e é o que impede o laço. Carimba recording_last_attempt_at como '
  'arrendamento. Duas barreiras contra tentar para sempre: o teto de 4 '
  '(fn_voip_recording_retry_delay devolve NULO) e 24 h desde o fim da ligação. '
  'Falha ANUNCIADA pela VPS nunca é reivindicada: ela não tem '
  'recording_last_attempt_at. service_role apenas.';

-- ===========================================================================
-- 7. GRANTS — E POR QUE `REVOKE ... FROM PUBLIC` NÃO BASTA NESTE PROJETO
-- ===========================================================================
-- O `ALTER DEFAULT PRIVILEGES` do Supabase no schema `public` concede EXECUTE a
-- `anon` e `authenticated` em TODA função nova. Revogar de PUBLIC não alcança
-- grant direto — os papéis precisam ser nomeados um a um.
--
-- Medido nesta base: na S2 o mutante que concedia acesso a `anon` deixou o
-- `rls_invariants` VERDE. A rede que parece geral não cobre grant de função. Por
-- isso o teste pareado desta migration confere
-- has_function_privilege('anon'|'authenticated', ...) nome por nome.
--
-- NENHUMA destas é API de usuário. As quatro são maquinaria de sistema, e o
-- único chamador legítimo é a edge function pelo `service_role` — que chega por
-- PostgREST, chamada de função comum, e chamada comum CHECA EXECUTE.
REVOKE ALL ON FUNCTION public.fn_voip_recording_purge_candidates(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_voip_recording_purged(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_voip_recording_fetch_failed(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_voip_recording_retry_claim(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- Pura, sem acesso a dado nenhum — e mesmo assim fechada. Superfície que não
-- precisa existir não existe, e a exceção "esta é inofensiva" é como a lista
-- vira porosa.
REVOKE ALL ON FUNCTION public.fn_voip_recording_retry_delay(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fn_voip_recording_purge_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_voip_recording_purged(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_voip_recording_fetch_failed(uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_voip_recording_retry_claim(integer)      TO service_role;

-- ===========================================================================
-- 8. O CRON — pg_net PARA A EDGE FUNCTION
-- ===========================================================================
-- NÃO é um cron de SQL puro como o `voip-sweep-stuck-calls`, e a diferença não
-- é estilo: `storage.protect_delete()` proíbe DELETE em storage.objects vindo
-- do SQL. Apagar de verdade exige a Storage API, que só existe do lado de fora.
--
-- Molde: `invoke_whatsapp_media_retention` — a URL sai do `cron_config`
-- derivando do template compartilhado, e o segredo do mesmo lugar. A função
-- ENGOLE erro de propósito: um cron que estoura vira ruído em `cron.job_run_
-- details` e nada mais, enquanto o WARNING chega ao log do Postgres.
CREATE OR REPLACE FUNCTION public.invoke_torquecalls_recording_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[torquecalls-recording-maintenance] cron_config incompleto: url=%, secret=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'torquecalls-recording-maintenance');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[torquecalls-recording-maintenance] invoke falhou: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_torquecalls_recording_maintenance()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoke_torquecalls_recording_maintenance() TO service_role;

COMMENT ON FUNCTION public.invoke_torquecalls_recording_maintenance() IS
  'Dispara torquecalls-recording-maintenance via pg_net (x-cron-secret). Duas '
  'tarefas na mesma invocação: expurgo de 90 dias (apaga pela Storage API) e '
  'reenfileiramento das buscas que falharam.';

-- ---------------------------------------------------------------------------
-- A CADÊNCIA É DA RETENTATIVA, e o expurgo pega carona.
--
-- 5 minutos é o menor espaçamento da escada de retentativa; um cron mais lento
-- transformaria "espera 5 minutos" em "espera até o próximo tique". O expurgo
-- não tem opinião sobre 5 minutos ou um dia — a fronteira dele são 90 dias — e
-- é idempotente, então roda junto em vez de ganhar um segundo cron, um segundo
-- deploy e um segundo lugar para desligar por engano.
--
-- Minuto 3 e não 0: o topo do minuto redondo já está cheio neste projeto (ver
-- 20260427210000_stagger_pg_cron_jobs). Escalonar custa nada.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente — torquecalls-recording-maintenance não agendado';
    RETURN;
  END IF;

  -- Idempotente: sobrevive a `db reset`, que reaplica migrations num banco onde
  -- o job pode já existir. Mesmo padrão do voip-sweep-stuck-calls.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torquecalls-recording-maintenance') THEN
    PERFORM cron.unschedule('torquecalls-recording-maintenance');
  END IF;

  PERFORM cron.schedule(
    'torquecalls-recording-maintenance',
    '3-59/5 * * * *',
    'SELECT public.invoke_torquecalls_recording_maintenance()'
  );
END
$cron$;
