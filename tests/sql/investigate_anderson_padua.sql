-- Queries 1-4 do protocolo de investigação. Read-only.

\echo '=== Q1: estado do lead Anderson Padua ==='
SELECT
  l.id, l.name,
  l.sdr_id, l.closer_id, l.responsible_id,
  pp.id AS pipe_prop_id,
  pp.closer_id AS pp_closer_id,
  pp.responsible_id AS pp_responsible_id,
  pc.id AS pipe_conf_id,
  pc.closer_id AS pc_closer_id,
  pc.responsible_id AS pc_responsible_id,
  pw.id AS pipe_wpp_id,
  pw.responsible_id AS pw_responsible_id
FROM leads l
LEFT JOIN pipe_propostas pp ON pp.lead_id = l.id
LEFT JOIN pipe_confirmacao pc ON pc.lead_id = l.id
LEFT JOIN pipe_whatsapp pw ON pw.lead_id = l.id
WHERE l.name ILIKE '%Anderson Padua%';

\echo ''
\echo '=== Q2: Weder tem leads.view_all em member_feature_permissions ==='
SELECT fp.*, tm.name AS member_name, tm.organization_id
FROM member_feature_permissions fp
JOIN team_members tm ON tm.id = fp.team_member_id
WHERE tm.name ILIKE '%Weder%'
  AND fp.feature_key = 'leads.view_all';

\echo ''
\echo '=== Q3: leads.view_all configurado na org do Weder ==='
SELECT fp.*
FROM feature_permissions fp
WHERE fp.organization_id = (
  SELECT organization_id FROM team_members WHERE name ILIKE '%Weder%' LIMIT 1
)
AND fp.feature_key = 'leads.view_all';

\echo ''
\echo '=== Q4: quantos registros desincronizados em pipe_propostas ==='
SELECT COUNT(*) AS leads_desincronizados_propostas
FROM pipe_propostas pp
JOIN leads l ON l.id = pp.lead_id
WHERE pp.closer_id IS DISTINCT FROM l.closer_id
  AND l.closer_id IS NOT NULL;

\echo ''
\echo '=== Q4b: quantos registros desincronizados em pipe_confirmacao ==='
SELECT COUNT(*) AS leads_desincronizados_confirmacao
FROM pipe_confirmacao pc
JOIN leads l ON l.id = pc.lead_id
WHERE pc.closer_id IS DISTINCT FROM l.closer_id
  AND l.closer_id IS NOT NULL;
