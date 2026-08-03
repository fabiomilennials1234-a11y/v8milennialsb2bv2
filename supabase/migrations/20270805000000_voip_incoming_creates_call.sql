-- 20270805000000_voip_incoming_creates_call.sql
--
-- Entrada E2 (#1372, PRD #1370, ADR-0027) — a ligação RECEBIDA vira linha no
-- CRM.
-- ROLLBACK pareado: rollback/20270805000000_voip_incoming_creates_call.sql
--
-- O QUE MUDA
-- ----------
-- `fn_voip_apply_vps_event` ganha um sexto tipo, `incoming`, e com ele o poder
-- que nunca teve: CRIAR linha em `voip_calls`. Até aqui ela só atualizava.
--
-- Duas peças, e nada mais:
--
--   1. `public.fn_phone_match_forms(text)` — as formas em que o MESMO telefone
--      brasileiro pode estar gravado. É o `phoneVariants` do chat
--      (`src/modules/communication/lib/conversationCallsQuery.ts`) na forma que
--      o SQL alcança, e existe porque o casamento do lead acontece dentro da
--      RPC.
--   2. `fn_voip_apply_vps_event` recriada INTEIRA (é o único jeito em Postgres)
--      — o corpo de 20270803000000 com o ramo `incoming` acrescentado e NADA
--      MAIS mexido.
--
-- POR QUE A CRIAÇÃO MORA NUM RAMO PRÓPRIO
-- ---------------------------------------
-- Está escrito por extenso dentro do ramo. O resumo: a criação na entrada não
-- pode abrir caminho para criar na saída, onde ela já tem dono
-- (`fn_voip_call_reserve`). Com um tipo próprio, o ramo de `call-status` — que
-- serve entrada E saída — continua sem nenhuma aresta que leve a um INSERT.
--
-- A ORDEM DE SUBIDA INVERTE A REGRA GERAL DO PRD
-- ----------------------------------------------
-- **A imagem da VPS vai por ÚLTIMO**, porque aqui é ela a PRODUTORA do evento
-- novo. Se subir primeiro, cada ligação recebida bate num `unknown_type`, que
-- vira `transition_refused` → HTTP 409 → uma linha de `runtime_logs` em nível
-- error no CRM E um `webhook: CRM RECUSOU` em error na VPS, por chamada. Nada
-- quebra (a VPS não espera nem retenta), mas é ruído de nível error no lugar
-- onde se procura incidente de verdade.
--
-- A ordem completa, que é a do comentário de correção do PRD #1370:
--
--   1. esta migration
--   2. deploy de `torquecalls-webhook` (ele precisa conhecer `peer_unusable`)
--   3. a imagem da VPS
--
-- A janela entre 1 e 2 é inofensiva por construção: sem o passo 3 não existe
-- evento `incoming` nenhum para exercitar o código novo.
--
-- A regra "imagem nova antes de o CRM esperar o evento novo" do PRD vale quando
-- o CRM é o produtor. Medido e corrigido na revisão da E1.
--
-- ESTA MIGRATION É SÓ SCHEMA
-- --------------------------
-- Zero `DO` de backfill, zero escrita em dado de cliente. As chamadas de
-- entrada que já aconteceram e ninguém registrou não são recuperáveis: o evento
-- não existia. Nasce inerte — nenhuma linha aparece até a VPS emitir `incoming`.

-- ===========================================================================
-- 1. fn_phone_match_forms — as formas do mesmo telefone
-- ===========================================================================
--
-- Espelho EXATO de `phoneVariants` (conversationCallsQuery.ts:137). As duas
-- cópias existem porque o mesmo casamento acontece nos dois lados: no navegador
-- (a ligação encontra a conversa) e no banco (a ligação encontra o lead). Os
-- casos do teste são os mesmos dos dois lados, de propósito — é isso que
-- transforma "espelho" em afirmação verificável em vez de intenção.
--
-- POR QUE QUATRO FORMAS, E NÃO SÓ A CANÔNICA
-- ------------------------------------------
-- `normalize_brazilian_phone` já resolve o caso comum: o JID `555185960716` e o
-- cadastro `51985960716` viram a mesma chave. Mas `leads.normalized_phone` não
-- é garantidamente canônico — medido em produção em 2026-08-03: 32.968 leads
-- com 11 dígitos (canônico), **103 com 12** e **21 com 13**, isto é, gravados
-- COM o DDI. Contra esses 124 a igualdade canônica erra em silêncio.
--
-- As quatro formas cobrem exatamente os comprimentos observados (10 a 13), e
-- `= ANY (...)` sobre `normalized_phone` continua usando
-- `idx_leads_org_normalized_phone`.
--
-- IMMUTABLE e sem acesso a tabela nenhuma: é aritmética de string, não
-- consulta. Por isso NÃO é SECURITY DEFINER — não há nada para definir.
CREATE OR REPLACE FUNCTION public.fn_phone_match_forms(p_canonical text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT f
      FROM unnest(ARRAY[
        p_canonical,
        '55' || p_canonical,
        -- Sem o nono dígito: o `9` que a normalização insere em número de 10
        -- dígitos, e que o texto cru muitas vezes não tem.
        CASE WHEN length(p_canonical) = 11 AND substr(p_canonical, 3, 1) = '9'
             THEN left(p_canonical, 2) || substr(p_canonical, 4) END,
        CASE WHEN length(p_canonical) = 11 AND substr(p_canonical, 3, 1) = '9'
             THEN '55' || left(p_canonical, 2) || substr(p_canonical, 4) END
      ]) AS f
     -- Mesma janela do `add()` do original: uma forma que não caberia em
     -- `peer_phone` também não casa com nada que tenha vindo dele.
     WHERE f IS NOT NULL AND length(f) BETWEEN 8 AND 15
  );
$$;

-- `FROM PUBLIC` sozinho NÃO fecha função nova neste projeto: o
-- `ALTER DEFAULT PRIVILEGES` do schema `public` concede EXECUTE a `anon`,
-- `authenticated` e `service_role` em tudo que nasce aqui. Os papéis nomeados
-- são obrigatórios — lição de 20270801000000, onde o REVOKE de PUBLIC sozinho
-- deixou o detector INV-2 acusar a função.
--
-- Ninguém precisa de GRANT: o único chamador é `fn_voip_apply_vps_event`, que é
-- SECURITY DEFINER e roda como o DONO desta função aqui.
REVOKE ALL ON FUNCTION public.fn_phone_match_forms(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_phone_match_forms(text) IS
  'As formas em que o MESMO telefone brasileiro pode estar gravado, a partir da '
  'forma canônica: ela própria, com o DDI 55, sem o nono dígito e sem o nono '
  'com DDI — filtradas para 8 a 15 dígitos. Espelho de phoneVariants() do chat '
  '(conversationCallsQuery.ts). Existe porque leads.normalized_phone NÃO é '
  'garantidamente canônico: 124 leads em produção guardam 12 ou 13 dígitos. '
  'Chamadores: fn_voip_apply_vps_event (casamento do lead na ligação recebida).';

-- ===========================================================================
-- 2. fn_voip_apply_vps_event — o ramo `incoming`
-- ===========================================================================
-- CREATE OR REPLACE do corpo INTEIRO, porque é o único jeito em Postgres. O que
-- segue é 20270803000000 com DUAS mudanças cirúrgicas e nada mais:
--
--   a) quatro variáveis novas no DECLARE;
--   b) o ramo `incoming` inteiro, ANTES da seção que localiza a linha de
--      chamada — e fora dela, que é a garantia estrutural da fatia.

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

  -- ENTRADA (#1372). A linha que NASCE nesta função, e as três coisas que
  -- precisam existir antes de ela nascer: o telefone que cabe na coluna, a
  -- forma canônica dele e o lead que ela encontra (ou não).
  v_peer      text;
  v_canonical text;
  v_lead      uuid;
  v_new_call  uuid;

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
  -- incoming — O ÚNICO RAMO QUE CRIA LINHA, E ELE É O DA ENTRADA
  -- =========================================================================
  --
  -- POR QUE UM TIPO PRÓPRIO, E POR QUE ELE FICA AQUI EM CIMA
  -- -------------------------------------------------------
  -- Esta é a consequência mais delicada do ADR-0027: até hoje esta função só
  -- ATUALIZAVA. Criar na entrada não pode abrir caminho para criar na SAÍDA,
  -- onde a criação já tem dono (`fn_voip_call_reserve`, que cobra cota, checa
  -- consentimento, valida a instância e cunha o token).
  --
  -- A garantia é ESTRUTURAL, não disciplinar, e tem três partes:
  --
  --   1. `incoming` NÃO está na lista do `IF v_type IN (...)` logo abaixo, que
  --      é quem LOCALIZA a linha. Então o `SELECT ... FOR UPDATE` de lá nunca
  --      roda para este tipo, e o `call_not_found` de lá — que é o ramo por
  --      onde `call-status`/`call-ended` passam quando a linha não existe —
  --      continua sendo o que sempre foi: um caminho que NÃO CRIA.
  --   2. O `INSERT INTO public.voip_calls` desta função existe DENTRO deste
  --      `IF` e em lugar nenhum mais. `call-status` e `call-ended` não têm por
  --      onde alcançá-lo: o ramo termina em `RETURN`.
  --   3. `direction` é o LITERAL `'inbound'`. O corpo do evento não carrega
  --      `direction` de propósito (E1, #1371) — e mesmo que carregasse, não é
  --      lido. Um evento de fora não escolhe o sentido de uma chamada.
  --
  -- É ausência de aresta. Para criar na saída por aqui alguém teria que mover o
  -- INSERT para fora deste `IF` — e é exatamente isso que o teste de mutante
  -- de `voip_incoming_creates_call_test.sql` mata.
  --
  -- A ORDEM DOS EVENTOS DE UMA CHAMADA DE ENTRADA
  -- ---------------------------------------------
  --   1. incoming     → CRIA a linha            (aqui)
  --   2. call-status  status=ringing            (ATUALIZA)
  --   3. call-status  status=connected          (se alguém atender)
  --   4. call-ended   reason=...
  --
  -- Por isso a linha nasce com a marca d'água em (p_epoch, p_seq): o evento 2,
  -- com seq maior, entra EM ORDEM. Sem isso ele cairia na faixa tardia por ter
  -- perdido para o zero... não: `last_seq` nasce 0 por DEFAULT, e qualquer seq
  -- positivo ganharia dele. O carimbo aqui serve para o caso oposto — a oferta
  -- RETRANSMITIDA, que a E1 mediu: ela anuncia duas vezes, com jti e seq
  -- DIFERENTES, e sem esta marca a segunda passaria por evento novo.
  --
  -- A LINHA NASCE SEM DONO
  -- ----------------------
  -- `operator_user_id` NULO: ninguém atendeu ainda; ela ganha dono na E4.
  -- `idx_voip_calls_one_live_per_operator` é UNIQUE PARCIAL sobre
  -- `operator_user_id IS NOT NULL`, então nulo não colide com nulo e N ligações
  -- de entrada podem tocar ao mesmo tempo. Isto já custou um quase-incidente: a
  -- primeira versão do gate de instância matava toda ligação recebida por não
  -- esperar operador nulo.
  --
  -- VOZ DESLIGADA REGISTRA ASSIM MESMO
  -- ----------------------------------
  -- `whatsapp_instances.voice_calls_enabled` NÃO é lido aqui, e a ausência é a
  -- decisão (ADR-0027, decisão 5): o interruptor é do CRM, o celular toca de
  -- qualquer jeito, e que o cliente ligou é fato do RELACIONAMENTO. O que a
  -- flag desliga é tocar e atender, que é E3/E4.
  IF v_type = 'incoming' THEN
    v_tc_call := NULLIF(p_payload->>'id', '');

    IF v_tc_call IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                'detail', 'missing_call_id');
    END IF;

    -- ISTO É UMA GUARDA DE DOMÍNIO DA COLUNA. NÃO É VALIDAÇÃO DE TELEFONE, E A
    -- DIFERENÇA É O ACHADO QUE A E1 PAGOU PARA APRENDER.
    --
    -- O que esta linha garante: que o valor CABE em
    -- `voip_calls.peer_phone`, que carrega `CHECK (peer_phone ~ '^[0-9]{8,15}$')`.
    -- Fora dessa faixa o Postgres levanta 23514, a exceção ABORTA A TRANSAÇÃO
    -- INTEIRA, o endpoint devolve 500 e a linha nunca é criada — perda em
    -- silêncio, que é o modo de falhar que esta base já pagou caro.
    --
    -- E não é hipótese. Medido com sonda na revisão da E1: conta LID sem
    -- `caller_pn` produz 17 dígitos, oferta de grupo com criador LID produz 18,
    -- `From` vazio produz string vazia.
    --
    -- O QUE ESTA LINHA **NÃO** GARANTE, E NÃO TEM COMO GARANTIR: que o valor
    -- seja um telefone. COMPRIMENTO NÃO DISTINGUE IDENTIFICADOR DE NÚMERO —
    -- **um LID de 8 a 15 dígitos passa por aqui incólume**. A primeira versão do
    -- gate da E1 media só comprimento e tinha exatamente este buraco: LID longo
    -- era barrado por ACIDENTE de tamanho, LID curto entrava como se fosse
    -- telefone de verdade. O teste dela é que revelou.
    --
    -- Quem distingue é o SERVIDOR DO JID (`s.whatsapp.net` × `lid`), e esse
    -- campo não existe deste lado: o corpo do evento traz dígitos, não JID. Por
    -- isso o gate de verdade mora na VPS (`offerPeerJID` + a checagem de
    -- servidor em `cmd/server/session.go`), que é quem vê o stanza — e por isso
    -- esta guarda é a SEGUNDA linha, não a primeira. Ela existe porque evento
    -- vindo de fora nunca é confiável, e a alternativa a ela é um 500 sem causa
    -- apontável.
    --
    -- A consequência do limite, dita em voz alta: um LID que caiba na faixa
    -- entra como `peer_phone`, não casa com lead nenhum e vira uma ligação
    -- registrada sem dono nem cadastro. Ela NÃO corrompe nada — só não ajuda.
    -- Fechar isso exige o servidor do JID no corpo do evento, que é mudança de
    -- contrato com a VPS, não conserto de RPC.
    --
    -- NÃO HÁ `regexp_replace` AQUI, E A AUSÊNCIA É DELIBERADA.
    -- `fn_voip_call_reserve` filtra dígitos porque recebe telefone digitado por
    -- humano. Aqui o produtor é a VPS, e o contrato dela (E1) é dígitos puros.
    -- Filtrar transformaria `555185960716:12@s.whatsapp.net` — um JID com
    -- sufixo de aparelho — em `55518596071612`: 14 dígitos, que PASSAM pelo
    -- CHECK, entram no banco e não casam com lead nenhum, para sempre e sem
    -- erro. Recusar é a leitura honesta: quem sabe desmontar JID é a VPS, que
    -- usa `types.ParseJID` + `ToNonAD` justamente para isso.
    v_peer := COALESCE(p_payload->>'peer', '');

    IF v_peer !~ '^[0-9]{8,15}$' THEN
      -- UMA linha, e só uma. Ela carrega o peer, quantos dígitos vieram e qual
      -- era a faixa — é estritamente mais informativa que qualquer coisa que o
      -- endpoint saberia escrever, e é por isso que o endpoint NÃO escreve
      -- nenhuma para este código (mesma razão pela qual `applied` e `replay`
      -- ficam fora do `CODE_ACTION`).
      INSERT INTO public.runtime_logs
        (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
      VALUES (v_session.organization_id, 'voip', 'webhook_entrada_sem_telefone', 'error',
              'voip_session', v_session.id,
              jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                 'peer', left(v_peer, 64),
                                 'digitos', length(regexp_replace(v_peer, '[^0-9]', '', 'g')),
                                 'faixa_aceita', '8-15',
                                 'motivo', 'peer fora do dominio de peer_phone — a ligacao TOCA, mas nao vira registro',
                                 'seq_epoch', p_epoch, 'seq', p_seq));

      -- CÓDIGO PRÓPRIO, `ok = true`, E ISSO É A CORREÇÃO DE UM DEFEITO DE
      -- DESENHO — NÃO CONVENIÊNCIA.
      --
      -- A primeira versão devolvia `transition_refused`. Custo medido no
      -- contrato, não suposto: `transition_refused` é 409 e está no `CODE_ACTION`
      -- do endpoint (`torquecalls-webhook/index.ts`), que escreve uma SEGUNDA
      -- linha de `runtime_logs` em nível `error`; e a VPS, ao ver 4xx, registra
      -- `webhook: CRM RECUSOU`, TERCEIRA linha de erro (`webhook.go`). Três
      -- registros de incidente por oferta que o desenho ESPERA recusar, para uma
      -- população que a E1 mediu como real (LID sem `caller_pn`, oferta de
      -- grupo).
      --
      -- **Recusa esperada não é incidente.** `ok = true` significa "consumido,
      -- NÃO retente" — e retentar de fato não mudaria nada: mesmo envelope,
      -- mesmo peer, mesmo veredito. É a mesma semântica de `session_not_found`
      -- e `session_inert`, que também mapeiam para 202: o CRM recebeu, decidiu
      -- deliberadamente não fazer nada, e não há falha do outro lado para
      -- corrigir.
      --
      -- O que sobra é UMA linha, a de cima, em nível `error` — porque a E1 já
      -- filtra esta população antes de anunciar (`storablePeerPhone`), então um
      -- aviso destes CHEGANDO aqui significa deriva de contrato, e isso merece
      -- olho humano. Volume esperado em regime: zero.
      --
      -- ORDEM DE SUBIDA: o endpoint precisa conhecer `peer_unusable` ANTES desta
      -- migration, senão o código cai no `webhook_codigo_desconhecido` e vira
      -- 500. O PRD #1370 já põe o deploy da edge function como passo 2 — e a
      -- janela é inofensiva de qualquer jeito, porque o PRODUTOR do evento (a
      -- imagem da VPS) é o passo 3: entre 1 e 2 não existe `incoming` nenhum
      -- para exercitar este caminho.
      RETURN jsonb_build_object('ok', true, 'code', 'peer_unusable',
                                'detail', 'peer_phone_unusable');
    END IF;

    -- O INSTANTE DA OFERTA. Mesma faixa em milissegundos do resto da função,
    -- testada ANTES de `to_timestamp` — ver o bloco "CARIMBO DA VPS" no topo do
    -- corpo. `offeredAt` viaja em milissegundos, como `startedAt`/`endedAt`.
    v_ms := CASE WHEN jsonb_typeof(p_payload->'offeredAt') = 'number'
                 THEN (p_payload->>'offeredAt')::numeric ELSE NULL END;
    v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                 THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

    -- O LEAD, PELA REGRA DO CHAT — E SEM INVENTAR CADASTRO.
    --
    -- O JID chega `555185960716` (DDI presente, nono dígito ausente) e o CRM
    -- guarda `51985960716` (DDI ausente, nono presente). Quem faz as duas
    -- formas virarem a mesma chave é `normalize_brazilian_phone`, que JÁ é a
    -- regra do chat: `fn_whatsapp_message_to_history` casa mensagem recebida
    -- com lead exatamente assim, com o mesmo JID cru na entrada.
    --
    -- `fn_phone_match_forms` cobre o resto: medido em produção em 2026-08-03,
    -- 124 leads têm `normalized_phone` de 12 ou 13 dígitos — gravados COM o
    -- DDI, fora da forma canônica. Contra eles a igualdade canônica sozinha
    -- erra. As quatro formas são as do `phoneVariants` do chat, e o teste as
    -- ancora uma a uma.
    --
    -- SEM LEAD, `lead_id` FICA NULO. Nada de criar lead: 47% dos contatos dos
    -- últimos 90 dias não têm cadastro (ADR-0027, decisão 4), e criar
    -- automaticamente encheria o funil de engano, entregador e fornecedor. Se o
    -- lead nascer depois, a ligação antiga aparece nele pelo telefone — a mesma
    -- regra do chat, que funciona apesar de 84,5% das mensagens não terem
    -- `lead_id`.
    v_canonical := public.normalize_brazilian_phone(v_peer);

    SELECT l.id INTO v_lead
      FROM public.leads l
     WHERE l.organization_id = v_session.organization_id
       AND l.deleted_at IS NULL
       AND l.normalized_phone = ANY (public.fn_phone_match_forms(v_canonical))
     -- Determinístico: a forma canônica ganha das variantes, e entre iguais o
     -- cadastro mais novo. Sem ORDER BY, duas entregas do mesmo evento
     -- poderiam vincular a leads diferentes.
     ORDER BY (l.normalized_phone = v_canonical) DESC, l.created_at DESC
     LIMIT 1;

    -- A IDEMPOTÊNCIA NÃO É O `jti`, E ISSO IMPORTA.
    --
    -- O anti-replay do envelope cobre a ENTREGA repetida do MESMO envelope. Não
    -- cobre o que a E1 mediu: oferta retransmitida pelo WhatsApp anuncia DUAS
    -- VEZES, com jti e seq diferentes — dois envelopes legítimos sobre a mesma
    -- chamada. Quem barra a segunda linha é `voip_calls_network_id_unique`
    -- (tc_session_id, tc_call_id), que é a identidade de REDE da chamada.
    --
    -- `DO NOTHING` e não `DO UPDATE`: a segunda oferta não sabe nada que a
    -- primeira não soubesse, e sobrescrever reescreveria carimbo e vínculo de
    -- lead de uma linha que já pode ter andado (tocando, atendida, encerrada).
    -- É também o que impede a entrada de PISAR NUMA LINHA DE SAÍDA que por
    -- acaso tivesse o mesmo id de rede: quem chegou primeiro fica.
    --
    -- A marca d'água NÃO é avançada no caminho de conflito, de propósito: um
    -- anúncio repetido com seq maior faria o `call-status` que ainda está no ar
    -- parecer velho.
    INSERT INTO public.voip_calls (
      organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
      peer_phone, direction, status, authorized_at, ringing_at,
      last_seq_epoch, last_seq
    ) VALUES (
      v_session.organization_id, p_sid, v_tc_call, v_lead, NULL,
      v_peer,
      -- LITERAIS. Nunca do corpo. Ver o bloco no topo deste ramo.
      'inbound',
      -- `'ringing'`, NÃO o default `'authorized'` da coluna: `authorized` é
      -- vocabulário de chamada que SAI ("o CRM autorizou, pode discar"), e
      -- ninguém autorizou nada aqui. A ligação que entra nasce TOCANDO, e
      -- `ringing` já está no CHECK da coluna — nenhum valor novo, nenhuma
      -- mudança de schema.
      'ringing',
      -- `authorized_at` é NOT NULL e para a entrada significa "quando a oferta
      -- chegou", que é a única âncora honesta que a linha tem. É dela que a
      -- projeção do S13 tira `started_at` quando não houve atendimento.
      v_ts, v_ts,
      p_epoch, p_seq
    )
    ON CONFLICT ON CONSTRAINT voip_calls_network_id_unique DO NOTHING
    RETURNING id INTO v_new_call;

    IF v_new_call IS NULL THEN
      -- Anúncio repetido. NÃO deixa rastro: a E1 mediu que ele é o caso NORMAL
      -- de uma oferta retransmitida, e uma linha de log por toque repetido é
      -- ruído no lugar onde se procura incidente.
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'incoming_already_registered');
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied',
                              'detail', 'incoming_registered',
                              'call_id', v_new_call::text,
                              'lead_matched', v_lead IS NOT NULL);
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
  '(epoch, seq) POR ENTIDADE, transição de sessão, criação E escrita no ledger '
  'de chamada e o estado da GRAVAÇÃO — tudo numa transação. SEIS tipos: '
  'incoming, auth-state, call-status, call-ended, recording-ready, '
  'recording-failed. `incoming` é o ÚNICO que CRIA linha, sempre com '
  'direction=inbound e status=ringing LITERAIS, operador nulo e lead casado por '
  'telefone (nulo quando não há cadastro) — e ele mora num ramo que a SAÍDA não '
  'alcança por construção, porque lá a criação é de fn_voip_call_reserve. '
  'Oferta retransmitida não duplica: quem barra é voip_calls_network_id_unique, '
  'não o jti. `peer` fora de ^[0-9]{8,15}$ é recusado LIMPO — code '
  '`peer_unusable` com ok=true (202, recusa esperada NÃO é incidente) e UMA '
  'linha em runtime_logs, em vez de derrubar a transação no CHECK da coluna. A '
  'organização sai de voip_sessions pelo tc_session_id, NUNCA do corpo. '
  'service_role apenas.';
