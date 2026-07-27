-- 20260726130000_send_dedup_hit_count.sql
--
-- DEDUP CONVERSACIONAL (#1156) — volta 1 (ADENDO do macro). Área frágil (WhatsApp).
-- Reabre o rubric de DB do Crivo. Diagnóstico: Lanterna + Crivo + Bancada.
--
-- POR QUÊ (ratificado por Pauta): o reserve binário do #1252 barra a 2ª ocorrência
-- idêntica. No path CONVERSACIONAL isso é falso-positivo dominante: medição de 14
-- dias em prod = 520 rajadas de EXATAMENTE 2 (ack legítimo "Ok"/"Certo") contra 3
-- loops de 12+. Barrar a 2ª engole ~70% de tráfego legítimo pra matar 3 loops. E
-- piso de tamanho NÃO fecha: 1 dos 3 loops é "Oi Filipe!" (10 chars) — separar por
-- TAMANHO deixaria o loop escapar. O discriminador certo é FREQUÊNCIA.
--
-- SOLUÇÃO: contador por chave, com RESET-POR-GAP. Mantém o índice único (a
-- atomicidade race-free que o #1252 acertou — não dropa pra COUNT, que perde a
-- corrida). O reserve vira UPSERT atômico ON CONFLICT DO UPDATE (send-dedup.ts):
-- suprime só quando hit_count atinge o limiar do source.
--   copilot / copilot_v2 : permite 2, barra da 3ª  (bar-at-3)
--   workflow/mass_send/manual/followup : barra a 2ª (bar-at-2, = comportamento #1252)
--
-- TETO (documentado — não vender como matador de loop): dedup por conteúdo só pega
-- repetição IDÊNTICA (loop travado). Loop parafraseado (LLM varia o texto) nunca
-- repete hash — isso é domínio do Send Governor (#1156) por TAXA. Domínios disjuntos.
--
-- copilot_v2: o copilot-v2-worker (vivo, cron 1/min) manda com trackSource='copilot_v2';
-- entra no vocabulário fechado do source.
--
-- ADITIVA. Inerte até o código usar (gated pelo env SEND_DEDUP_CONVERSATIONAL_ENABLED).
-- ROLLBACK pareado: rollback/20260726130000_send_dedup_hit_count.sql

-- ---------------------------------------------------------------------------
-- 1. Contador por chave. DEFAULT 1: o 1º INSERT já responde hit_count=1 no
--    RETURNING (nunca 0/null — exigência da Bancada pro caminho feliz).
-- ---------------------------------------------------------------------------
ALTER TABLE public.send_dedup_log
  ADD COLUMN IF NOT EXISTS hit_count integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.send_dedup_log.hit_count IS
  'Ocorrências idênticas consecutivas com gap < janela (reset-por-gap no UPSERT). '
  'O reserve suprime quando hit_count atinge o limiar do source (copilot bar-at-3, '
  'demais bar-at-2). Conta FREQUÊNCIA, não tamanho — separa ack legítimo de loop. #1156.';

-- ---------------------------------------------------------------------------
-- 2. Vocabulário de source ganha copilot_v2 (o worker vivo que bypassava o dedup).
--    A CHECK inline do #1252 é auto-nomeada send_dedup_log_source_check.
-- ---------------------------------------------------------------------------
ALTER TABLE public.send_dedup_log
  DROP CONSTRAINT IF EXISTS send_dedup_log_source_check;
ALTER TABLE public.send_dedup_log
  ADD CONSTRAINT send_dedup_log_source_check
  CHECK (source IN ('manual','copilot','copilot_v2','workflow','mass_send','followup'));

-- ---------------------------------------------------------------------------
-- 3. fn_reserve_send — reserva ATÔMICA com contador + reset-por-gap.
--    UPSERT com CASE não é expressável pelo builder do PostgREST → RPC. Uma
--    instrução, race-free (mantém o índice único, não conta linhas). Testável
--    em pgTAP direto contra Postgres (exigência da Bancada: o núcleo INSERT→
--    conflito→hit_count roda de verdade, não mockado).
--
--    RETORNO: hit_count. 1º send → 1 (INSERT); repetição com gap<janela →
--    incrementa; gap>janela → reseta a 1 (auto-cura o atraso do purge). O
--    caller (send-dedup.ts) suprime quando hit_count >= limiar do source.
--
--    idk presente (chunking): usa o índice idk-partial (caminho próprio), NÃO
--    o de conteúdo — chunks distintos da MESMA reply (idk único por chunk) nunca
--    colidem entre si → mensagem não mutila. Devolve sempre hit_count baixo
--    (envia); a dedup por frequência é só do caminho de conteúdo (idk NULL).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reserve_send(
  p_org_id          uuid,
  p_phone           text,
  p_content_hash    text,
  p_source          text,
  p_idempotency_key text,
  p_ttl_seconds     integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hit integer;
  v_now timestamptz := now();
  v_exp timestamptz := now() + make_interval(secs => p_ttl_seconds);
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    -- Caminho idk: dedup de replay EXATO (mesmo idk). Chunks recebem idk único
    -- por chunk → cada um insere (hit_count=1) → envia. Só um replay literal do
    -- MESMO idk incrementa.
    INSERT INTO public.send_dedup_log
      (org_id, phone, content_hash, source, idempotency_key, reserved_at, expires_at, hit_count)
    VALUES (p_org_id, p_phone, p_content_hash, p_source, p_idempotency_key, v_now, v_exp, 1)
    ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET
      hit_count  = CASE WHEN public.send_dedup_log.expires_at < v_now THEN 1
                        ELSE public.send_dedup_log.hit_count + 1 END,
      reserved_at = v_now,
      expires_at  = v_exp
    RETURNING hit_count INTO v_hit;
    RETURN v_hit;
  END IF;

  -- Caminho de conteúdo: frequência com RESET-POR-GAP. Se a linha já expirou
  -- (gap > janela), o contador volta a 1 — "N idênticas com gap < janela", não
  -- balde acumulado. Auto-cura o atraso do cron de limpeza.
  INSERT INTO public.send_dedup_log
    (org_id, phone, content_hash, source, idempotency_key, reserved_at, expires_at, hit_count)
  VALUES (p_org_id, p_phone, p_content_hash, p_source, NULL, v_now, v_exp, 1)
  ON CONFLICT (org_id, phone, content_hash, source) WHERE idempotency_key IS NULL
  DO UPDATE SET
    hit_count  = CASE WHEN public.send_dedup_log.expires_at < v_now THEN 1
                      ELSE public.send_dedup_log.hit_count + 1 END,
    reserved_at = v_now,
    expires_at  = v_exp
  RETURNING hit_count INTO v_hit;
  RETURN v_hit;
END;
$$;

COMMENT ON FUNCTION public.fn_reserve_send(uuid, text, text, text, text, integer) IS
  'Reserva atômica de dedup de envio (#1156). UPSERT com reset-por-gap; devolve '
  'hit_count. Caller suprime quando hit_count >= limiar do source. idk usa caminho '
  'próprio (chunking não mutila). Race-free via índice único (não conta linhas).';

-- SYSTEM-ONLY. A função é SECURITY DEFINER e BYPASSA a RLS de send_dedup_log; o
-- corpo NÃO autoriza nada (p_org_id vem do parâmetro). O único caller é a edge
-- (send-dedup.ts via governSend) usando o client service_role. Expor a
-- `authenticated` seria superfície de ataque pura: um user da org A chamaria com
-- p_org_id=<org B> e inflaria o hit_count de uma chave da org B → supressão
-- cross-tenant de envio WhatsApp (DoS direcionado) + escrita cross-tenant. Por
-- isso: só service_role. Se um dia um path de usuário precisar, wrappear com
-- assert_org_access(p_org_id) como 1ª instrução — nunca conceder direto.
REVOKE EXECUTE ON FUNCTION public.fn_reserve_send(uuid, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_reserve_send(uuid, text, text, text, text, integer) TO service_role;
