-- ============================================================================
-- A CONVERSA DO LEAD ENXERGA O CANAL OFICIAL (SCRUM-666 / W3 do épico SCRUM-648)
--
-- `get_conversas_do_lead` lê SÓ `whatsapp_messages`. O canal oficial não grava
-- lá — o provider dele persiste a própria linha em `channel_messages` (#1699,
-- `providerPersistsOwnMessages`), justamente para a conversa não aparecer
-- duplicada na tela.
--
-- Consequência medida em produção em 2026-09-04, na Chique Distribuidora
-- (org 38f3bea4-44c6-4732-bb20-065f547a7ed8):
--
--   get_conversas_do_lead('554999949630', <Chique>) devolve
--     Carol   → last_message_at NULL
--     Chiquê  → last_message_at NULL      ← MENTIRA
--     WhatsApp→ last_message_at NULL
--
--   e naquele exato momento `channel_messages` tinha conversa com aquele
--   telefone na caixa "Chiquê", com última mensagem havia MINUTOS.
--
-- Ou seja: o seletor "Conversa do Lead" diz "sem conversa" para todo contato
-- cujo histórico vive no canal oficial, e oferece "iniciar conversa" para quem
-- já está conversando. São 25 conversas só na Chique.
--
-- ⚠️ É A MESMA CEGUEIRA QUE O BACKEND JÁ CORRIGIU. `instance-routing.ts`
--    resolve a política `conversation` lendo as DUAS tabelas e ficando com a
--    mensagem mais recente (`lastChipMessage` + `lastOfficialMessage`, #1700).
--    Esta migration traz a mesma regra para a leitura da tela — sem ela, a W3
--    mostraria ao vendedor uma "Instance da automação" diferente da que a
--    automação de fato usaria, que é pior que não mostrar nada.
--
-- Não muda assinatura, não muda o modelo de segurança (segue INVOKER: a RLS de
-- `whatsapp_messages`, `whatsapp_instances` e `channel_messages` é quem recorta)
-- e não toca em nenhuma outra função.
-- ============================================================================


-- ─── 1. As variantes do telefone, com um nome só ────────────────────────────
--
-- `channel_messages.phone_number` é CRU: medido em produção, as linhas do canal
-- oficial são só dígitos, prefixadas por 55, com 12 ou 13 caracteres —
-- `554884398055` e `5555992382506`. `whatsapp_messages` tem `normalized_phone`;
-- esta tabela não tem coluna canônica nenhuma.
--
-- Comparar por `normalize_brazilian_phone(cm.phone_number)` resolveria, mas põe
-- função sobre a COLUNA e descarta o índice
-- `idx_channel_messages_conversation (organization_id, phone_number, channel,
-- timestamp DESC)`. Com variantes, a comparação é `= ANY(...)` sobre a coluna
-- crua e o índice continua servindo.
--
-- ⚠️ ESPELHO DE `phoneVariants` EM `_shared/instance-routing.ts`. As duas
--    precisam produzir o mesmo conjunto: é essa igualdade que faz a tela dizer
--    a mesma coisa que o motor faria. Mudou lá, muda aqui.
CREATE OR REPLACE FUNCTION public.phone_variants(p_phone text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH canonico AS (SELECT normalize_brazilian_phone(p_phone) AS c),
  -- O celular canônico tem 11 dígitos com o 9 na terceira posição. A variante
  -- "sem 9" existe porque número antigo foi gravado nos dois formatos.
  sem9 AS (
    SELECT CASE
             WHEN length(c) = 11 AND substr(c, 3, 1) = '9'
               THEN substr(c, 1, 2) || substr(c, 4)
           END AS s
      FROM canonico
  )
  SELECT CASE
           WHEN (SELECT c FROM canonico) IS NULL THEN ARRAY[]::text[]
           ELSE ARRAY(
             SELECT DISTINCT v FROM (
               SELECT (SELECT c FROM canonico) AS v
               UNION ALL SELECT '55' || (SELECT c FROM canonico)
               UNION ALL SELECT (SELECT s FROM sem9)
               UNION ALL SELECT '55' || (SELECT s FROM sem9)
             ) t WHERE v IS NOT NULL
           )
         END;
$function$;

COMMENT ON FUNCTION public.phone_variants(text) IS
  'As formas em que o mesmo telefone brasileiro pode ter sido gravado numa '
  'coluna CRUA (canônico, com 55, sem o 9, com 55 e sem o 9). Espelho de '
  '`phoneVariants` em supabase/functions/_shared/instance-routing.ts — as duas '
  'precisam produzir o mesmo conjunto. Existe para comparar contra '
  'channel_messages.phone_number sem descartar o índice.';

REVOKE ALL     ON FUNCTION public.phone_variants(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.phone_variants(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.phone_variants(text) TO authenticated;


-- ─── 2. A leitura passa a somar as duas caixas ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conversas_do_lead(
  p_phone           text,
  p_organization_id uuid
)
RETURNS TABLE (
  instance_id            uuid,
  instance_name          text,
  instance_status        text,
  last_message_at        timestamptz,
  last_message_content   text,
  last_message_direction text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
       p_organization_id IN (SELECT get_my_organization_ids())
    OR is_master_user()
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.instance_name,
    i.status,
    v."timestamp",
    v.content,
    v.direction
  FROM whatsapp_instances i

  -- A perna do CHIP, intacta: é o caminho de ~30 organizações e não muda um byte.
  LEFT JOIN LATERAL (
    SELECT m.content, m."timestamp", m.direction
    FROM whatsapp_messages m
    WHERE m.organization_id  = i.organization_id
      AND m.instance_id      = i.id
      AND m.normalized_phone = normalize_brazilian_phone(p_phone)
      AND m.deleted_at IS NULL
    ORDER BY m."timestamp" DESC
    LIMIT 1
  ) chip ON true

  -- A perna do CANAL OFICIAL. `channel = 'whatsapp'` recorta fora Instagram e
  -- Facebook, que moram na mesma tabela e não são caixa de WhatsApp — sem esse
  -- filtro, uma conversa de Instagram apareceria como histórico de um número.
  LEFT JOIN LATERAL (
    SELECT cm.content, cm."timestamp", cm.direction
    FROM channel_messages cm
    WHERE cm.organization_id = i.organization_id
      AND cm.instance_id     = i.id
      AND cm.channel         = 'whatsapp'
      AND cm.phone_number    = ANY (public.phone_variants(p_phone))
    ORDER BY cm."timestamp" DESC
    LIMIT 1
  ) oficial ON true

  -- Ganha a MAIS RECENTE das duas, que é a regra da política `conversation` do
  -- ADR-0025: "o número em que o cliente escreveu" não tem opinião sobre em que
  -- tabela a linha caiu. Uma caixa nunca tem as duas pernas preenchidas hoje —
  -- chip grava numa, oficial na outra —, mas a regra é escrita para o caso
  -- geral, e não para a coincidência.
  LEFT JOIN LATERAL (
    SELECT * FROM (
      SELECT chip."timestamp", chip.content, chip.direction
      UNION ALL
      SELECT oficial."timestamp", oficial.content, oficial.direction
    ) t
    WHERE t."timestamp" IS NOT NULL
    ORDER BY t."timestamp" DESC
    LIMIT 1
  ) v ON true

  WHERE i.organization_id = p_organization_id
    AND i.status <> 'error'
  ORDER BY v."timestamp" DESC NULLS LAST, i.instance_name;
END;
$function$;

COMMENT ON FUNCTION public.get_conversas_do_lead(text, uuid) IS
  'Por caixa da Organization, a última mensagem trocada com um telefone — nas '
  'DUAS tabelas (whatsapp_messages do chip e channel_messages do canal '
  'oficial), ficando com a mais recente. Mesma regra da política `conversation` '
  'do ADR-0025. SECURITY INVOKER: a RLS do chamador é quem recorta.';
