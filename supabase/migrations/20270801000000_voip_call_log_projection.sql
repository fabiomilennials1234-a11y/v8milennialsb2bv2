-- A chamada de voz vira registro no histórico do CRM (S13, tarefa 1).
-- ROLLBACK pareado: rollback/20270801000000_voip_call_log_projection.sql
--
-- O PROBLEMA
-- ----------
-- Desde o S11 o CRM SABE o que acontece na chamada: `voip_calls` tem
-- `connected_at`, `ended_at` e `end_reason`, escritos pelo webhook assinado da
-- VPS. Nada disso chega à tela. `call_logs` — a tabela que o produto usa para o
-- histórico de ligação do lead — tinha UMA linha em produção, de 02/jun, vinda
-- do registro manual, contra 14 chamadas no ledger de voz.
--
-- A tabela já foi desenhada para isto: `voip_call_id`, `voip_provider`,
-- `duration_seconds`, `outcome`, `started_at`, `ended_at` já existem. O que
-- faltava era quem escrevesse.
--
-- ONDE A PROJEÇÃO MORA, E POR QUÊ — SÃO TRÊS PORTAS, NÃO DUAS
-- -----------------------------------------------------------
-- Medido no código, não deduzido. Fecham chamada hoje:
--
--   1. `torquecalls-signal` (edge function, service_role) — UPDATE DIRETO na
--      tabela no clique de desligar/recusar do operador, com
--      `end_reason` = `user_ended` | `rejected`
--      (supabase/functions/torquecalls-signal/index.ts:334-340). Esta porta NÃO
--      passa por RPC nenhuma: escreve na tabela direto. É a maioria das 14
--      linhas de produção — 8 a 10, dependendo de quantas o webhook fechou.
--   2. `voip-sweep-stuck-calls` (pg_cron, migration 20270730000007) —
--      `end_reason = 'no_terminal_event'`. 4 linhas de produção.
--   3. `fn_voip_apply_vps_event` (webhook da VPS, migration 20270730000011).
--      VIVA, mas ainda quase muda: só 2 das 14 chamadas têm `last_seq > 0` (ou
--      seja, receberam evento da VPS), então ela fechou entre 0 e 2 delas.
--      (`voip_webhook_events` não serve de contagem histórica: as linhas
--      expiram na janela de dedup de 60 min.)
--
-- Projetar dentro da RPC do webhook cobriria SÓ A TERCEIRA — a que fechou no
-- máximo 2 das 14. As outras doze ficariam fora do histórico, e o buraco só
-- apareceria semanas depois, quando alguém perguntasse por que a ligação que
-- ele fez ontem não está lá.
--
-- Um gatilho em `voip_calls` cobre as três porque a invariante não é "o webhook
-- aplicou um evento", é "esta chamada terminou". A quarta porta que alguém
-- acrescentar amanhã já nasce coberta — e a terceira porta deste comentário era
-- a "terceira porta hipotética" do plano original, que já existia.
--
-- O gatilho é FIAÇÃO, não autoridade: toda a regra vive em
-- `fn_voip_project_call_log(uuid)`, que é também o que o backfill chama. Uma
-- regra, dois chamadores, um lugar para consertar.
--
-- O MAPEAMENTO DE `outcome`, E A ARMADILHA DENTRO DELE
-- ----------------------------------------------------
-- `outcome` NÃO sai de `end_reason` sozinho. Quem decide "a pessoa atendeu" é
-- `connected_at IS NOT NULL`: uma chamada atendida e depois encerrada pelo
-- operador termina com `end_reason = 'user_ended'` e É `connected`. Só quando
-- não houve atendimento é que o motivo decide qual foi a recusa.
--
-- A prova de que isso importa está no varredor: ele recolhe também chamada
-- CONECTADA depois de 2 h, com o mesmo `no_terminal_event` de uma que nunca
-- tocou. Um mapeamento que olhasse só o motivo registraria duas horas de
-- conversa como falha.
--
--   atendeu (connected_at NÃO nulo) ............................. connected
--   timeout ..................................................... no_answer
--   busy ........................................................ busy
--   do_not_disturb .............................................. busy
--   declined .................................................... rejected
--   rejected .................................................... rejected
--   cancelled  (dois L, da VPS) ................................. canceled
--   user_ended (sem atendimento) ................................ canceled
--   failed / unknown / no_terminal_event / NULL ................. failed
--
-- A ARMADILHA: a VPS emite `cancelled`, com dois L
-- (tc-s5/internal/voip/core/types.go:32-39); o CHECK de `call_logs.outcome`
-- aceita `canceled`, com um. Um mapeamento ingênuo passa direto por isso, o
-- INSERT é recusado pelo banco e a exceção derruba a transação DO WEBHOOK — que
-- é a transação que não se quer derrubar, em produção, no caminho que também
-- grava o ledger de eventos.
--
-- `do_not_disturb` NÃO vira `rejected`, e é decisão: em DND a pessoa nunca soube
-- da ligação. Contá-la como recusa infla a métrica "o prospect me recusou" com
-- chamadas que ele não viu. `busy` é a leitura honesta — a linha estava
-- indisponível.
--
-- `rejected` não pertence ao vocabulário da VPS: quem o escreve é
-- `torquecalls-signal` quando o OPERADOR recusa uma chamada de entrada. Sem esta
-- linha o mapeamento cairia no ELSE e uma recusa deliberada viraria falha
-- técnica.
--
-- `unknown` e `no_terminal_event` são marcadores de IGNORÂNCIA, não causas.
-- Entre as nove saídas do CHECK, `failed` é a única gaveta honesta para eles —
-- e a causa crua continua em `voip_calls.end_reason`, que é onde a auditoria
-- olha.
--
-- DURAÇÃO: `ended_at - connected_at`, E NULA QUANDO NÃO HOUVE CONVERSA
-- -------------------------------------------------------------------
-- Não `ended_at - authorized_at`: o tempo tocando não é conversa, e somá-lo
-- inflaria toda média de duração do produto (medido no teste: 480 s de vida
-- para 180 s de conversa).
--
-- Chamada não atendida recebe `NULL`, não `0`. `0` é um valor MEDIDO — "a
-- conversa durou zero segundos" — e entra em `avg(duration_seconds)` puxando a
-- média para baixo com chamadas que nunca foram conversa. `NULL` é "não houve o
-- que medir", e `avg()` o ignora sem que ninguém precise lembrar de filtrar. É
-- também o que o registro manual (LogCallModal) já escreve quando o vendedor não
-- digita duração, então a coluna continua com UM significado só.
--
-- IDEMPOTÊNCIA
-- ------------
-- A mesma chamada É projetada mais de uma vez, por desenho, e não por acidente:
--   - o varredor fecha com `no_terminal_event` e o webhook chega depois com a
--     causa verdadeira (`sweeper_reason_corrected`, 20270730000011);
--   - a faixa tardia do S11 preenche `connected_at` DEPOIS do fim — o que
--     transforma uma chamada registrada como não atendida na conversa que ela
--     de fato foi;
--   - o webhook pode reentregar e o varredor pode correr junto.
--
-- Nenhuma dessas pode gerar segunda linha, e nenhuma pode ser descartada: a
-- segunda passada sabe MAIS que a primeira. Por isso `ON CONFLICT DO UPDATE`, e
-- não `DO NOTHING` — corrige no lugar, preservando o `id` da linha.
--
-- A chave natural é `voip_call_id`, com índice ÚNICO PARCIAL (as linhas de
-- registro manual têm `voip_call_id` nulo e não podem colidir entre si). NÃO é
-- escopada por `organization_id`: `voip_call_id` é o PK de `voip_calls`, então a
-- mesma chamada só pertence a uma org — acrescentar a org ENFRAQUECERIA a trava,
-- permitindo a mesma chamada registrada em duas orgs. Seria um vetor cross-tenant
-- disfarçado de multi-tenancy.
--
-- `notes` e `recording_url` ficam fora do `DO UPDATE` de propósito: a projeção
-- nunca os escreve (não inventa conteúdo) e não pode apagar o que um humano
-- escreveu depois.
--
-- FORA DE ESCOPO, EXPLICITAMENTE
-- ------------------------------
-- Gravação de áudio: `recording_url` fica NULO. É decisão de produto ainda não
-- tomada, com implicações de aviso à outra parte e de retenção.
--
-- SEM BACKFILL AQUI
-- -----------------
-- As 14 chamadas já encerradas em produção NÃO são projetadas por esta
-- migration. Migration é só schema: um `db push` disparado de um checkout
-- atrasado re-roda todo `DO` de backfill que ela carregar, e já reescreveu dado
-- de cliente nesta base. O backfill vive em
-- `scripts/backfill-voip-call-logs.sql`, é idempotente (passa pelo mesmo
-- `ON CONFLICT`) e roda quando um humano decidir.

-- ===========================================================================
-- 1. A CHAVE NATURAL
-- ===========================================================================
-- Sem o índice não há `ON CONFLICT` para onde inferir, e a idempotência vira
-- convenção em vez de invariante. Parcial: as linhas manuais têm NULO.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_logs_voip_call_id_unique
  ON public.call_logs (voip_call_id)
  WHERE voip_call_id IS NOT NULL;

COMMENT ON INDEX public.idx_call_logs_voip_call_id_unique IS
  'Chave natural da projeção de voip_calls. Alvo do ON CONFLICT de '
  'fn_voip_project_call_log. Parcial porque registro manual tem voip_call_id '
  'NULO. NÃO escopar por organization_id: enfraqueceria a trava.';

-- ===========================================================================
-- 2. A REGRA
-- ===========================================================================
-- SECURITY DEFINER porque a projeção é um fato do sistema, não a escrita de
-- quem por acaso encerrou a chamada. As três portas chegam aqui com identidades
-- diferentes — `postgres` (cron e RPC do webhook) e `service_role` (o UPDATE
-- direto do torquecalls-signal) — e o registro tem que ser idêntico nas três.
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

  -- Só chamada ENCERRADA vira registro, e a checagem mora AQUI e não só no
  -- `WHEN` do gatilho: a função é a autoridade, o gatilho é fiação. Quem chamar
  -- à mão (backfill, correção pontual) recebe a mesma recusa.
  --
  -- `expired` fica de fora com intenção: é reserva vencida antes de a VPS
  -- aceitar (TTL de 12 s, `voip-reap-authorized`). Ninguém discou, nada tocou.
  -- Registrar isso encheria o histórico do lead de não-eventos.
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
      -- failed, unknown, no_terminal_event, NULL e qualquer motivo novo que
      -- apareça amanhã. Fail-closed para um valor que o CHECK aceita: um motivo
      -- desconhecido não pode virar exceção dentro da transação do webhook.
      ELSE 'failed'
    END
  END;

  v_duration := CASE
    WHEN v_answered AND v_call.ended_at IS NOT NULL
      -- GREATEST(0, ...) é guarda, não caminho: as duas escritas de
      -- 20270730000011 já impedem `ended_at < connected_at` (GREATEST no fim,
      -- LEAST no carimbo tardio). Fica porque duração negativa numa média é
      -- pior defeito que um zero grudado, e relógios de terceiro já produziram
      -- -00:00:01.999797 nesta base.
      THEN GREATEST(0, round(extract(epoch FROM v_call.ended_at - v_call.connected_at)))::integer
    ELSE NULL
  END;

  INSERT INTO public.call_logs (
    organization_id, lead_id, user_id, direction, outcome, duration_seconds,
    phone_number, voip_provider, voip_call_id, started_at, ended_at
  ) VALUES (
    v_call.organization_id,
    v_call.lead_id,
    -- Chamada de entrada nasce sem operador. A coluna aceita NULO (medido em
    -- produção), então a linha existe mesmo sem dono — o histórico do lead não
    -- pode perder a ligação só porque ninguém a atendeu ainda.
    v_call.operator_user_id,
    v_call.direction,
    v_outcome,
    v_duration,
    v_call.peer_phone,
    'torquecalls',
    v_call.id::text,
    -- `started_at` é NOT NULL e `authorized_at` também: sempre há âncora.
    COALESCE(v_call.connected_at, v_call.authorized_at),
    v_call.ended_at
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
    ended_at         = EXCLUDED.ended_at
    -- `notes` e `recording_url` NÃO entram: a projeção não os escreve e não
    -- pode apagar o que um humano escreveu depois.
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.fn_voip_project_call_log(uuid) IS
  'Projeta uma voip_calls ENCERRADA em call_logs. Idempotente por voip_call_id '
  '(ON CONFLICT DO UPDATE: a segunda passada sabe mais que a primeira). '
  'outcome sai de connected_at, não de end_reason. Chamadores: os gatilhos '
  'trg_voip_calls_project_call_log_* e o backfill.';

-- Isto NÃO é uma API: o único caminho legítimo é o gatilho, e trigger NÃO checa
-- EXECUTE em tempo de disparo — provado no teste, que exercita a porta 1
-- rodando como `service_role` justamente depois deste REVOKE.
--
-- `FROM PUBLIC` SOZINHO NÃO BASTA, e é o erro que quase passou: o Supabase tem
-- ALTER DEFAULT PRIVILEGES no schema `public` concedendo EXECUTE a `anon`,
-- `authenticated` e `service_role` em toda função nova. Com apenas o REVOKE de
-- PUBLIC, o detector INV-2 de rls_invariants.sql acusou a função como
-- "writing SECURITY DEFINER reachable by anon" — uma função DEFINER que escreve
-- em `call_logs`, alcançável sem sessão. Os papéis nomeados são obrigatórios.
REVOKE ALL ON FUNCTION public.fn_voip_project_call_log(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 3. A FIAÇÃO
-- ===========================================================================
-- O `SECURITY DEFINER` DESTE WRAPPER É LOAD-BEARING. NÃO TROQUE POR INVOKER.
--
-- Parece hardening trocar um wrapper de três linhas para INVOKER — afinal quem
-- escreve em `call_logs` é a outra função, e esta só repassa. Não é: trocar
-- MATA A PORTA 1 em produção.
--
-- A cadeia exata, e ela tem DOIS regimes de privilégio diferentes:
--
--   1. Postgres NÃO checa EXECUTE ao DISPARAR um trigger — a checagem acontece
--      uma vez, no `CREATE TRIGGER`. Por isso `service_role` consegue provocar
--      este wrapper sem ter EXECUTE nele.
--   2. Mas a chamada ANINHADA lá dentro é uma chamada de função COMUM, e essa
--      CHECA EXECUTE do usuário corrente. E o REVOKE logo acima tirou EXECUTE
--      de `fn_voip_project_call_log` de PUBLIC, anon, authenticated E
--      service_role — de propósito, porque a projeção não é API.
--
-- Como INVOKER, o wrapper rodaria como `service_role` quando o UPDATE direto do
-- torquecalls-signal disparasse o gatilho, e bateria em `permission denied for
-- function fn_voip_project_call_log`. Como DEFINER, roda como o dono
-- (`postgres`), que é dono da outra função também — e a cadeia fecha.
--
-- Isto foi medido: virando este wrapper para INVOKER, a suíte para em `ok=3`,
-- exatamente na primeira asserção da porta 1.
--
-- O regime só não aparece nas portas 2 e 3 porque as duas já chegam como
-- `postgres` (cron e RPC DEFINER). A porta 1 é a única com identidade
-- diferente — e é a que fechou a maioria das chamadas de produção.
CREATE OR REPLACE FUNCTION public.fn_voip_calls_project_call_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_voip_project_call_log(NEW.id);
  RETURN NULL;  -- AFTER trigger: o retorno é ignorado.
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_calls_project_call_log()
  FROM PUBLIC, anon, authenticated, service_role;

-- Linha que já NASCE encerrada. Não existe caminho assim hoje (a reserva nasce
-- `authorized`), e é exatamente por isso que o gatilho está aqui: a porta que
-- alguém abrir amanhã — um backfill de chamada de entrada que o CRM só ficou
-- sabendo depois — nasce coberta.
DROP TRIGGER IF EXISTS trg_voip_calls_project_call_log_ins ON public.voip_calls;
CREATE TRIGGER trg_voip_calls_project_call_log_ins
  AFTER INSERT ON public.voip_calls
  FOR EACH ROW
  WHEN (NEW.status = 'ended')
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();

-- O `WHEN` é o que impede o gatilho de virar ruído. Ele NÃO é apenas
-- "status virou ended":
--
--   - `OLD.status IS DISTINCT FROM NEW.status` pega as três portas fechando a
--     chamada, e também a ressurreição do S11 fechando de novo depois;
--   - `end_reason` pega `sweeper_reason_corrected` — o webhook substitui o
--     chute do varredor pela causa verdadeira SEM mexer no status, e sem esta
--     cláusula o registro congelaria em `failed`;
--   - `connected_at` pega a faixa tardia — sem ela, uma chamada que atendeu
--     ficaria registrada para sempre como não atendida;
--   - `ended_at` pega a correção de carimbo, que muda a duração.
--
-- E, do outro lado: `UPDATE` que só move `last_seq`/`updated_at` (a marca
-- d'água do webhook bate nisso a cada evento) não dispara nada.
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
    )
  )
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();

-- ===========================================================================
-- 4. A ORIGEM NA LINHA DO TEMPO
-- ===========================================================================
-- `trg_call_log_history` já existia e transforma todo INSERT em `call_logs` em
-- entrada de `lead_history`. A projeção herda isso de graça, que é o ponto: a
-- chamada passa a existir onde o vendedor olha.
--
-- Só o rótulo estava errado. `source` era `'manual'` fixo, e uma ligação que o
-- sistema registrou sozinho não é registro manual — `source` é justamente a
-- coluna que responde "quem fez isso". A correção é cirúrgica: quem tem
-- `voip_provider` veio da telefonia (`system`); quem não tem é o LogCallModal e
-- continua `manual`, byte por byte.
--
-- O resto do corpo é o de 20260602* — recriado inteiro porque
-- CREATE OR REPLACE substitui a função toda.
CREATE OR REPLACE FUNCTION public.fn_call_log_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.lead_id,
      NEW.organization_id,
      'call_logged',
      CASE NEW.direction
        WHEN 'outbound' THEN 'Ligação realizada'
        ELSE 'Ligação recebida'
      END || ' — ' || NEW.outcome,
      CASE WHEN NEW.voip_provider IS NOT NULL THEN 'system' ELSE 'manual' END,
      jsonb_build_object(
        'direction', NEW.direction,
        'outcome', NEW.outcome,
        'duration_seconds', NEW.duration_seconds,
        'phone_number', NEW.phone_number
      ),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_call_log_to_history()
  FROM PUBLIC, anon, authenticated, service_role;
