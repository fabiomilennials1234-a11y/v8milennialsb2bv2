-- =============================================================================
-- Semeadura do recuo da Instance Routing Policy — issue #1333, ADR-0025
-- =============================================================================
--
-- Escreve `fallbackInstanceId` / `fallbackInstanceName` nos WhatsApp Message
-- Nodes que estão em "Automático" (sem instância declarada) das Organizations
-- com mais de uma Instance viva. O valor semeado é a Instance de **maior
-- volume de saída** da própria Organization nos últimos 7 dias.
--
-- POR QUE NÃO É MIGRATION: isto reescreve dado de cliente. Migration roda
-- sozinha em qualquer `db push` — inclusive de um checkout desatualizado, e
-- inclusive por engano contra produção. Semeadura é ato deliberado, rodado à
-- mão, com o relatório lido antes.
--
-- POR QUE SEM VIEWS: `create view` deixaria objeto permanente no schema
-- `public`, herdando o GRANT do schema e sem RLS. Tudo aqui é CTE — nada
-- sobrevive à sessão.
--
-- COMO RODAR
--   1. PASSO 1 (dry-run, só leitura) — leia o relatório, confira os números.
--   2. PASSO 2 (escrita) — só depois de o CTO aprovar o relatório.
--   Sempre com --db-url explícito. Nunca `supabase db push`.
--
-- IDEMPOTENTE: só toca nós cujo recuo ainda está vazio. Rodar de novo não
-- sobrescreve nada, nem desfaz edição manual do operador.
--
-- EXECUTADO EM PRODUÇÃO em 2026-08-01: 131 nós, 27 automações, 7 organizações
-- (0 → 131). Integridade conferida: nenhum nó perdeu `data` ou `id`.
-- =============================================================================

-- Tipos de ação que declaram política de roteamento. Espelha
-- INSTANCE_ROUTED_ACTION_TYPES em src/modules/workflows/lib/instance-routing.ts,
-- menos `send_to_number` — cujos destinatários são números fixos, não o lead.
-- (Mantido inline nas duas etapas: um array literal não justifica uma view.)

-- =============================================================================
-- PASSO 1 — RELATÓRIO (só leitura). Insumo direto do aviso às orgs (#1334).
-- =============================================================================

with vivas as (
  -- Viva = conectada, sem sessão morta (o watchdog é o veredito real; `status`
  -- congela em 'connected' após logout remoto) e não-Meta (isolamento de cert).
  select id, organization_id, instance_name
  from whatsapp_instances
  where status in ('open', 'connected')
    and session_dead_since is null
    and provider in ('uazapi', 'evolution')
), multi as (
  select organization_id from vivas group by 1 having count(*) > 1
), vol as (
  select instance_id, count(*) n
  from whatsapp_messages
  where timestamp > now() - interval '7 days' and direction = 'outgoing'
  group by 1
), vencedora as (
  select organization_id, id as instance_id, instance_name, saidas
  from (
    select v.organization_id, v.id, v.instance_name, coalesce(vol.n, 0) saidas,
           row_number() over (
             partition by v.organization_id
             order by coalesce(vol.n, 0) desc, v.instance_name
           ) rn
    from vivas v
    join multi m on m.organization_id = v.organization_id
    left join vol on vol.instance_id = v.id
  ) ranked
  where rn = 1
), alvos as (
  select w.id as workflow_id, w.organization_id, w.is_active
  from workflows w, lateral jsonb_array_elements(coalesce(w.definition->'nodes', '[]'::jsonb)) node
  where node->'data'->>'actionType' in (
          'send_whatsapp_message', 'send_whatsapp', 'send_whatsapp_audio',
          'send_whatsapp_image', 'send_whatsapp_video', 'send_whatsapp_sticker',
          'send_whatsapp_document', 'send_whatsapp_template', 'send_campaign_message'
        )
    and coalesce(node->'data'->>'whatsappInstanceId', '') = ''
    and coalesce(node->'data'->>'fallbackInstanceId', '') = ''
    and w.organization_id in (select organization_id from vencedora)
)
select o.name                              as org,
       v.instance_name                     as recuo_semeado,
       v.saidas                            as saidas_7d_do_recuo,
       count(*)                            as nos,
       count(*) filter (where a.is_active) as nos_ativos,
       count(distinct a.workflow_id)       as automacoes
from alvos a
join vencedora v on v.organization_id = a.organization_id
join organizations o on o.id = a.organization_id
group by 1, 2, 3
order by nos_ativos desc, org;

-- =============================================================================
-- PASSO 2 — ESCRITA. Rodar só após aprovação do relatório acima.
-- Descomente o bloco inteiro.
-- =============================================================================

-- begin;
--
-- with vivas as (
--   select id, organization_id, instance_name
--   from whatsapp_instances
--   where status in ('open', 'connected')
--     and session_dead_since is null
--     and provider in ('uazapi', 'evolution')
-- ), multi as (
--   select organization_id from vivas group by 1 having count(*) > 1
-- ), vol as (
--   select instance_id, count(*) n
--   from whatsapp_messages
--   where timestamp > now() - interval '7 days' and direction = 'outgoing'
--   group by 1
-- ), vencedora as (
--   select organization_id, id as instance_id, instance_name
--   from (
--     select v.organization_id, v.id, v.instance_name,
--            row_number() over (
--              partition by v.organization_id
--              order by coalesce(vol.n, 0) desc, v.instance_name
--            ) rn
--     from vivas v
--     join multi m on m.organization_id = v.organization_id
--     left join vol on vol.instance_id = v.id
--   ) ranked
--   where rn = 1
-- )
-- update workflows w
-- set definition = jsonb_set(
--       w.definition,
--       '{nodes}',
--       (
--         select jsonb_agg(
--           case
--             when node->'data'->>'actionType' in (
--                    'send_whatsapp_message', 'send_whatsapp', 'send_whatsapp_audio',
--                    'send_whatsapp_image', 'send_whatsapp_video', 'send_whatsapp_sticker',
--                    'send_whatsapp_document', 'send_whatsapp_template', 'send_campaign_message'
--                  )
--              and coalesce(node->'data'->>'whatsappInstanceId', '') = ''
--              and coalesce(node->'data'->>'fallbackInstanceId', '') = ''
--             then jsonb_set(
--                    node, '{data}',
--                    (node->'data')
--                      || jsonb_build_object(
--                           'fallbackInstanceId',   v.instance_id::text,
--                           'fallbackInstanceName', v.instance_name
--                         )
--                  )
--             else node
--           end
--           order by ord
--         )
--         from jsonb_array_elements(coalesce(w.definition->'nodes', '[]'::jsonb))
--              with ordinality as t(node, ord)
--       )
--     ),
--     updated_at = now()
-- from vencedora v
-- where v.organization_id = w.organization_id
--   -- Só workflows que TÊM nó elegível. Sem isto, toda automação da org seria
--   -- reescrita idêntica e teria `updated_at` batido à toa.
--   and exists (
--     select 1 from jsonb_array_elements(coalesce(w.definition->'nodes','[]'::jsonb)) n
--     where n->'data'->>'actionType' in (
--             'send_whatsapp_message', 'send_whatsapp', 'send_whatsapp_audio',
--             'send_whatsapp_image', 'send_whatsapp_video', 'send_whatsapp_sticker',
--             'send_whatsapp_document', 'send_whatsapp_template', 'send_campaign_message'
--           )
--       and coalesce(n->'data'->>'whatsappInstanceId','') = ''
--       and coalesce(n->'data'->>'fallbackInstanceId','') = ''
--   );
--
-- -- Confira o total antes de confirmar. Esperado: igual ao `nos` do PASSO 1.
-- select count(*) as nos_com_recuo
-- from workflows w, lateral jsonb_array_elements(coalesce(w.definition->'nodes','[]'::jsonb)) node
-- where coalesce(node->'data'->>'fallbackInstanceId','') <> '';
--
-- commit;   -- ou rollback; se o número não bater
