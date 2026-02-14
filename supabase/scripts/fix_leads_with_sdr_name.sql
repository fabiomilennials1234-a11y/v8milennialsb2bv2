-- Script para corrigir leads que foram criados com o nome do SDR
-- ao invés do nome do contato WhatsApp.
--
-- O bug: quando o lead era criado automaticamente via WhatsApp,
-- o push_name da mensagem outgoing (nome do SDR) era usado como nome do lead.
--
-- Esse script encontra leads cujo nome é idêntico ao nome do SDR atribuído
-- e atualiza o nome usando o push_name de mensagens incoming do mesmo telefone.

-- 1. Primeiro, visualize quais leads seriam afetados (DRY RUN):
SELECT
  l.id AS lead_id,
  l.name AS lead_name_atual,
  tm.name AS sdr_name,
  l.phone,
  (
    SELECT wm.push_name
    FROM whatsapp_messages wm
    WHERE wm.direction = 'incoming'
      AND wm.push_name IS NOT NULL
      AND wm.push_name != ''
      AND replace(wm.phone_number, '+', '') LIKE '%' || right(replace(l.phone, '+', ''), 9) || '%'
    ORDER BY wm.timestamp DESC
    LIMIT 1
  ) AS push_name_correto
FROM leads l
JOIN team_members tm ON tm.id = l.sdr_id
WHERE l.name = tm.name
  AND l.origin = 'whatsapp'
ORDER BY l.created_at DESC;

-- 2. Se os resultados parecerem corretos, rode o UPDATE abaixo:
-- (Descomente para executar)

/*
UPDATE leads l
SET name = incoming_name.push_name
FROM (
  SELECT DISTINCT ON (wm.phone_number)
    wm.phone_number,
    wm.push_name
  FROM whatsapp_messages wm
  WHERE wm.direction = 'incoming'
    AND wm.push_name IS NOT NULL
    AND wm.push_name != ''
  ORDER BY wm.phone_number, wm.timestamp DESC
) incoming_name
JOIN team_members tm ON tm.id = l.sdr_id
WHERE l.name = tm.name
  AND l.origin = 'whatsapp'
  AND replace(incoming_name.phone_number, '+', '') LIKE '%' || right(replace(l.phone, '+', ''), 9) || '%'
  AND incoming_name.push_name != tm.name;
*/
