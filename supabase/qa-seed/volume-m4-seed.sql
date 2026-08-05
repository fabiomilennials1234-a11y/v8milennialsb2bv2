-- ============================================================================
-- Volume sintético para cronometrar o M4. BRANCH EFÊMERA. Nunca em prod.
--
-- Cria uma org com o mesmo tamanho da MAIOR org real: Basic4u, 4.221 cards
-- pendentes de backfill (medido em prod 2026-08-04). O objetivo é wall-clock,
-- não realismo de conteúdo — os leads são gerados, os cards são distribuídos
-- entre as etapas do funil, e é isso que o M4 vai percorrer.
--
-- Uso: node scripts/seed-branch.mjs --db-url "<url>" --file <este arquivo>
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── Org de volume ─────────────────────────────────────────────────────────
insert into public.organizations (id, name, slug, timezone, subscription_plan)
values ('cccccccc-0000-4000-8000-000000000001', 'Org Volume M4', 'org-volume-m4',
        'America/Sao_Paulo', 'torque-v8')
on conflict (id) do nothing;

insert into public.pipelines (id, organization_id, name, slug, type, color, is_active)
values ('cccccccc-2222-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',
        'Qualificação','whatsapp','system','#22c55e',true)
on conflict (id) do nothing;

insert into public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, position, stage_role, is_active)
values
  ('cccccccc-0000-4000-8000-000000000001','whatsapp','novo','Novo lead',0,'open',true),
  ('cccccccc-0000-4000-8000-000000000001','whatsapp','abordado','Abordado',1,'open',true),
  ('cccccccc-0000-4000-8000-000000000001','whatsapp','respondeu','Respondeu',2,'open',true)
on conflict do nothing;

-- ── 4.221 leads e 4.221 cards ─────────────────────────────────────────────
-- Mesmo tamanho da Basic4u. `generate_series` em vez de laço: o M4 é
-- set-based, e semear linha a linha mediria o seed, não o backfill.
insert into public.leads (id, organization_id, name, phone, origin)
select ('cccccccc-3333-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'cccccccc-0000-4000-8000-000000000001',
       'Lead de volume ' || g,
       '5511' || lpad(g::text, 9, '0'),
       'outro'
from generate_series(1, 4221) g
on conflict (id) do nothing;

insert into public.pipeline_entries
  (organization_id, pipeline_id, lead_id, stage_key, entered_at, stage_changed_at, metadata)
select 'cccccccc-0000-4000-8000-000000000001',
       'cccccccc-2222-4000-8000-000000000001',
       ('cccccccc-3333-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       (array['novo','abordado','respondeu'])[1 + (g % 3)],
       now() - (g || ' hours')::interval,
       now() - (g || ' hours')::interval,
       -- Um em cada dez carrega valor, aproximando a esparsidade real de
       -- `sale_value` (1,1% em prod, aqui exagerado de propósito para o
       -- cast numérico do M4 ser exercitado).
       case when g % 10 = 0 then jsonb_build_object('sale_value', (g * 7)::text) else '{}'::jsonb end
from generate_series(1, 4221) g
on conflict do nothing;

do $$
declare v_cards int;
begin
  select count(*) into v_cards from public.pipeline_entries
   where organization_id='cccccccc-0000-4000-8000-000000000001' and deal_id is null;
  if v_cards <> 4221 then
    raise exception 'FALHA: esperava 4221 cards pendentes, achei %', v_cards;
  end if;
  raise notice '   OK(1): 4.221 cards pendentes — mesmo tamanho da maior org real.';
end $$;
