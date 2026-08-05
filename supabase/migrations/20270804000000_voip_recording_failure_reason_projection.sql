-- A causa da falha chega até a tela (Gravação S3, #1359 do PRD #1356).
-- ROLLBACK pareado: rollback/20270804000000_voip_recording_failure_reason_projection.sql
--
-- O QUE FALTAVA
-- ------------
-- A S2 (#1358) fez `recording_status` distinguir três estados — `processing`,
-- `ready`, `failed` — e a ausência como quarto. Mas só o ESTADO atravessou até
-- `call_logs`; a CAUSA da falha ficou em `voip_calls.recording_failure_reason`,
-- que a tela não lê.
--
-- Sem a causa, "falhou" na tela é uma parede: o gestor sabe que não vai ouvir e
-- não sabe se aquilo se resolve sozinho (a VPS estava fora do ar por um minuto),
-- se é para reclamar (o arquivo veio quebrado), ou se nunca vai existir. A
-- história 20 do PRD pede que a falha apareça COMO FALHA; a fatia do player pede
-- que ela apareça com o porquê.
--
-- É UMA COLUNA A MAIS NA PROJEÇÃO, E É SÓ ISSO
-- --------------------------------------------
-- Nenhuma regra nova de gravação nasce aqui. `voip_calls` continua sendo a
-- autoridade, `fn_voip_project_call_log` continua sendo a ÚNICA escritora de
-- `call_logs` para chamada de voz, e o gatilho continua sendo quem a chama.
--
-- A CAUSA VIAJA COLADA AO ESTADO — e essa é a única decisão desta migration
-- -------------------------------------------------------------------------
-- As três colunas de gravação que a S2 projetou entram com `COALESCE`, para que
-- uma correção de `end_reason` chegando depois do upload não apague o endereço
-- do áudio. Para a causa, `COALESCE` seria ERRADO, e o erro seria visível:
--
--   falhou (`vps_timeout`) → a VPS reemite → `processing` → `ready`
--
-- é um caminho REAL — `fn_voip_recording_announced` e `fn_voip_recording_stored`
-- limpam `recording_failure_reason` justamente porque ele existe. Com `COALESCE`,
-- `call_logs` guardaria `ready` ao lado de `vps_timeout` para sempre, e a tela
-- diria "pronta" e "falhou por tempo esgotado" na mesma linha.
--
-- Então a regra é: a causa é projetada SEMPRE QUE O ESTADO É PROJETADO, e só
-- então. Quando a chamada é reprojetada por um motivo que nada tem a ver com
-- gravação (`EXCLUDED.recording_status` nulo), o par inteiro fica intocado —
-- que é a mesma proteção que o `COALESCE` dá às outras três.
--
-- SEM BACKFILL
-- ------------
-- `recording_failure_reason` está NULO em 100% das linhas de `voip_calls` em
-- produção: nenhuma gravação foi anunciada ainda. Migration é só schema (guarda
-- F4 do projeto).

-- ===========================================================================
-- 1. A COLUNA NA PROJEÇÃO
-- ===========================================================================

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS recording_failure_reason text;

COMMENT ON COLUMN public.call_logs.recording_failure_reason IS
  'Projeção de voip_calls.recording_failure_reason. Só tem valor quando '
  'recording_status = failed — a causa viaja COLADA ao estado, e uma gravação '
  'que se recuperou (failed → processing → ready) perde a causa junto. '
  'Diagnóstico bruto do produtor (ex.: vps_timeout, storage_upload_failed), '
  'cortado em 120 chars por fn_voip_recording_failed; a tela traduz.';

-- ===========================================================================
-- 2. A PROJEÇÃO
-- ===========================================================================
-- Corpo de 20270803000000 com UMA mudança: `recording_failure_reason` entra no
-- INSERT e no DO UPDATE. Tudo o mais é byte por byte o mesmo.

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
    recording_url, recording_status, recording_notice_regime,
    recording_failure_reason
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
    v_call.recording_notice_regime,
    v_call.recording_failure_reason
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
    recording_notice_regime = COALESCE(EXCLUDED.recording_notice_regime, call_logs.recording_notice_regime),
    -- A CAUSA NÃO LEVA COALESCE, DE PROPÓSITO. Ela é atributo do estado, não
    -- valor independente: `COALESCE` a deixaria sobreviver à recuperação
    -- (`failed` → `processing` → `ready`) e a tela mostraria "pronta" ao lado
    -- de "falhou por tempo esgotado". Projeta junto com o estado, ou nada.
    recording_failure_reason = CASE
      WHEN EXCLUDED.recording_status IS NOT NULL THEN EXCLUDED.recording_failure_reason
      ELSE call_logs.recording_failure_reason
    END
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.fn_voip_project_call_log(uuid) IS
  'Projeta uma voip_calls ENCERRADA em call_logs. Idempotente por voip_call_id '
  '(ON CONFLICT DO UPDATE: a segunda passada sabe mais que a primeira). '
  'outcome sai de connected_at, não de end_reason. As colunas de gravação vão '
  'junto: endereço/estado/regime com COALESCE (a projeção nunca APAGA um '
  'endereço de áudio já gravado), e a CAUSA da falha colada ao estado (uma '
  'gravação recuperada não guarda o motivo de quando falhou). `notes` segue '
  'fora. Chamadores: os gatilhos trg_voip_calls_project_call_log_* e o backfill.';

REVOKE ALL ON FUNCTION public.fn_voip_project_call_log(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 3. O GATILHO PRECISA ACORDAR QUANDO SÓ A CAUSA MUDA
-- ===========================================================================
-- Há um caminho em que o estado NÃO muda e a causa muda: duas falhas seguidas
-- na mesma gravação (`vps_timeout` e depois `storage_upload_failed`), porque
-- `fn_voip_recording_failed` reescreve `failed` sobre `failed`. Sem esta linha
-- no `WHEN`, a segunda causa ficaria só em `voip_calls` e a tela continuaria
-- exibindo a primeira — dizendo ao plantonista para olhar o lugar errado.
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
      OR OLD.recording_status         IS DISTINCT FROM NEW.recording_status
      OR OLD.recording_path           IS DISTINCT FROM NEW.recording_path
      OR OLD.recording_notice_regime  IS DISTINCT FROM NEW.recording_notice_regime
      OR OLD.recording_failure_reason IS DISTINCT FROM NEW.recording_failure_reason
    )
  )
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();
