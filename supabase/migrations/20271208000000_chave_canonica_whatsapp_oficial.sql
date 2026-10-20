-- 20271208000000_chave_canonica_whatsapp_oficial.sql
--
-- ⚠️ VERSÃO PROVISÓRIA e NÃO APLICADA. O ledger de prod colide com frequência;
-- renumerar acima do topo real de supabase_migrations.schema_migrations na hora
-- de aplicar. Aplicação em prod é do CTO. Transacional: pode ir por
-- apply_migration.
--
-- ⚠️ ORDEM: aplicar DEPOIS do deploy das edge functions que gravam a chave
-- canônica (notificame-webhook + as que importam notificame-provider). Antes
-- disso, linhas novas continuam nascendo com 12 dígitos. A migration é
-- idempotente: rodar de novo depois do deploy recolhe o que tiver entrado no
-- intervalo.
--
-- ─── O DEFEITO ──────────────────────────────────────────────────────────────
--
-- A caixa do canal oficial (NotificaMe/WhatsApp) agrupa a conversa por
-- `channel_messages.(instance_id, contact_external_id)`. O envio grava o
-- telefone do lead COM o nono dígito (5591999990000); a Meta entrega a resposta
-- de números antigos SEM ele (559199990000). Mesma pessoa, duas conversas.
--
-- Medido em prod em 2026-10-20 (somente leitura):
--   channel_messages WhatsApp de instância notificame ... 3.133 linhas
--   linhas com chave de 12 dígitos de celular ........... 1.276 (247 contatos)
--   contact_external_id com não-dígito .................. 0
--   phone_number ≠ contact_external_id .................. 0
--   conversation_read_state 'whatsapp_oficial:' ......... 439 (248 a reescrever,
--                                                          9 colidem com a chave
--                                                          canônica já existente)
--   lead_social_identities .............................. CHECK recusa 'whatsapp'
--                                                          → nada a reescrever
--   triggers em channel_messages ........................ nenhum
--   índice único que envolve a chave .................... nenhum em
--     channel_messages (só pkey e (external_id, channel, organization_id));
--     conversation_read_state tem (organization_id, user_id, conversation_key)
--     → as 9 colisões são FUNDIDAS antes do UPDATE.
--
-- ─── A REGRA ────────────────────────────────────────────────────────────────
--
-- Gêmea de `supabase/functions/_shared/br-whatsapp-contact-id.ts`: só dígitos;
-- 12 dígitos começando com 55 e 5º dígito 6–9 → insere 9 após o DDD. Fixo
-- (5º dígito 2–5), 13 dígitos e não-BR saem intactos.
--
-- NÃO usa `public.normalize_br_mobile` nem `normalize_brazilian_phone`: as duas
-- põem o 9 também em fixo (551133334444 → 5511933334444).
--
-- ─── O QUE NÃO É TOCADO ─────────────────────────────────────────────────────
--
--   • Instagram (channel='instagram', instance_id nulo) — o IGSID é opaco.
--   • WhatsApp de chip (uazapi/evolution) e meta_cloud — filtro por provider.
--   • `sender_id` — é o `wa_id` CRU que a Meta mandou (quem enviou). O valor
--     antigo continua recuperável ali e em `raw_payload`; por isso não há
--     tabela de backup (backup em public herda grant — ver memória do projeto).
--
-- ⚠️ channel_messages está em supabase_realtime: ~1,3 mil UPDATEs viram eventos
-- de postgres_changes num pulso só. Volume pequeno; aplicar fora do pico.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 1. A função gêmea ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.canonical_br_whatsapp_id(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN length(d) = 12 AND left(d, 2) = '55' AND substr(d, 5, 1) BETWEEN '6' AND '9'
             THEN left(d, 4) || '9' || substr(d, 5)
           ELSE d
         END
    FROM (SELECT pg_catalog.regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') AS d) s;
$$;

COMMENT ON FUNCTION public.canonical_br_whatsapp_id(text) IS
  'Chave canônica de contato WhatsApp BR: 12 dígitos 55+DDD+[6-9]… ganham o nono dígito; '
  'fixo, 13 dígitos e não-BR intactos. Gêmea de _shared/br-whatsapp-contact-id.ts. '
  'NÃO é normalize_br_mobile (que põe 9 em fixo).';

-- Pura, mas sem consumidor fora de migration: ninguém além do dono executa.
-- `FROM PUBLIC` não alcança service_role (grant explícito do Supabase), por
-- isso cada papel é nomeado.
REVOKE ALL ON FUNCTION public.canonical_br_whatsapp_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_br_whatsapp_id(text) FROM anon, authenticated, service_role;

-- ─── 2. channel_messages ────────────────────────────────────────────────────

UPDATE public.channel_messages m
   SET contact_external_id = public.canonical_br_whatsapp_id(m.contact_external_id),
       phone_number        = CASE
                               WHEN m.phone_number IS NULL THEN NULL
                               ELSE public.canonical_br_whatsapp_id(m.phone_number)
                             END
  FROM public.whatsapp_instances w
 WHERE w.id              = m.instance_id
   AND w.organization_id = m.organization_id
   AND w.provider        = 'notificame'
   AND m.channel         = 'whatsapp'
   AND m.contact_external_id IS NOT NULL
   AND (
         m.contact_external_id IS DISTINCT FROM public.canonical_br_whatsapp_id(m.contact_external_id)
      OR (m.phone_number IS NOT NULL
          AND m.phone_number IS DISTINCT FROM public.canonical_br_whatsapp_id(m.phone_number))
   );

-- ─── 3. conversation_read_state ('whatsapp_oficial:<instance>:<contato>') ───
--
-- A chave de leitura é montada com o contact_external_id; sem reescrevê-la, a
-- conversa unificada volta com o contador de não-lidas dos últimos 7 dias.

CREATE TEMP TABLE _rs_canon ON COMMIT DROP AS
SELECT rs.id,
       rs.organization_id,
       rs.user_id,
       rs.last_read_at,
       rs.marked_unread,
       'whatsapp_oficial:' || w.id::text || ':'
         || public.canonical_br_whatsapp_id(split_part(rs.conversation_key, ':', 3)) AS new_key
  FROM public.conversation_read_state rs
  JOIN public.whatsapp_instances w
    ON w.id::text         = split_part(rs.conversation_key, ':', 2)
   AND w.organization_id  = rs.organization_id
   AND w.provider         = 'notificame'
 WHERE rs.conversation_key LIKE 'whatsapp_oficial:%'
   AND split_part(rs.conversation_key, ':', 3)
       IS DISTINCT FROM public.canonical_br_whatsapp_id(split_part(rs.conversation_key, ':', 3))
   AND split_part(rs.conversation_key, ':', 3) <> '';

-- 3a. Colisão: a chave canônica já existe para o mesmo usuário. Funde — fica a
--     leitura mais recente das duas na linha canônica, e "marcada como não
--     lida" sobrevive se qualquer uma das duas estava marcada (o usuário pediu
--     para voltar a ela; perder isso na fusão seria apagar um lembrete). A
--     antiga sai.
UPDATE public.conversation_read_state keep
   SET last_read_at  = GREATEST(keep.last_read_at, c.last_read_at),
       marked_unread = keep.marked_unread OR c.marked_unread,
       updated_at    = now()
  FROM _rs_canon c
 WHERE keep.organization_id  = c.organization_id
   AND keep.user_id          = c.user_id
   AND keep.conversation_key = c.new_key
   AND (c.last_read_at > keep.last_read_at
        OR (c.marked_unread AND NOT keep.marked_unread));

DELETE FROM public.conversation_read_state old
 USING _rs_canon c
 WHERE old.id = c.id
   AND EXISTS (
         SELECT 1
           FROM public.conversation_read_state keep
          WHERE keep.organization_id  = c.organization_id
            AND keep.user_id          = c.user_id
            AND keep.conversation_key = c.new_key
       );

-- 3b. Sem colisão: renomeia.
UPDATE public.conversation_read_state rs
   SET conversation_key = c.new_key,
       updated_at       = now()
  FROM _rs_canon c
 WHERE rs.id = c.id;

-- ─── 4. Guarda: nada de 12 dígitos de celular sobra no escopo ───────────────

DO $$
DECLARE
  v_msgs int;
  v_rs   int;
BEGIN
  SELECT count(*) INTO v_msgs
    FROM public.channel_messages m
    JOIN public.whatsapp_instances w
      ON w.id = m.instance_id AND w.organization_id = m.organization_id
   WHERE w.provider = 'notificame'
     AND m.channel  = 'whatsapp'
     AND m.contact_external_id IS NOT NULL
     AND m.contact_external_id IS DISTINCT FROM public.canonical_br_whatsapp_id(m.contact_external_id);

  SELECT count(*) INTO v_rs
    FROM public.conversation_read_state rs
    JOIN public.whatsapp_instances w
      ON w.id::text = split_part(rs.conversation_key, ':', 2)
     AND w.organization_id = rs.organization_id
     AND w.provider = 'notificame'
   WHERE rs.conversation_key LIKE 'whatsapp_oficial:%'
     AND split_part(rs.conversation_key, ':', 3)
         IS DISTINCT FROM public.canonical_br_whatsapp_id(split_part(rs.conversation_key, ':', 3));

  IF v_msgs > 0 OR v_rs > 0 THEN
    RAISE EXCEPTION 'chave canônica incompleta: channel_messages=% conversation_read_state=%',
      v_msgs, v_rs;
  END IF;
END
$$;
