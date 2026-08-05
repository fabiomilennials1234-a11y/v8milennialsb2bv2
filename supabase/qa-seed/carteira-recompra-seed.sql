-- ============================================================================
-- Seed da carteira para exercitar o backfill "pedido de ERP vira Negócio".
-- BRANCH EFÊMERA. Nunca em prod.
--
-- Complementa `fatia2-branch-seed.sql`, que já cria org, plano, membro, funil
-- e lead. Aqui entra o que falta para o backfill ter o que converter:
--   • um funil de Orçamentos com etapa de ganho (o destino exigido pela guarda);
--   • um cliente de carteira ligado ao lead;
--   • TRÊS pedidos para o MESMO lead — o caso da recompra, que só é possível
--     porque a migration 20270730000050 derrubou as travas de unicidade.
--
-- Uso: node scripts/seed-branch.mjs --db-url "<url>" --file <este arquivo>
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── Desfecho no funil de Orçamentos ───────────────────────────────────────
-- O seed base já cria os três funis system, mas Orçamentos nasce SEM etapa de
-- ganho — e a guarda 1 do backfill recusa org sem destino, corretamente. Aqui
-- o desfecho é adicionado ao funil que já existe, em vez de criar outro (há
-- índice único em `pipelines(organization_id, slug)`).
insert into public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, position, stage_role, is_active)
values
  ('aaaaaaaa-0000-4000-8000-000000000001','propostas','vendido','Vendido',10,'won',true),
  ('aaaaaaaa-0000-4000-8000-000000000001','propostas','perdido','Perdido',11,'lost',true)
on conflict do nothing;

-- ── Cliente de carteira, ligado ao lead que o seed base criou ─────────────
insert into public.upsell_clients (id, organization_id, lead_id, name, order_count, lifetime_value, segment)
values ('aaaaaaaa-6666-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-3333-4000-8000-000000000001',
        'Cliente que Recompra', 3, 44300, 'ouro')
on conflict (id) do nothing;

-- ── Três pedidos. É o ponto do teste ──────────────────────────────────────
-- Mesmo lead, mesmo funil, três vendas em datas diferentes. No modelo antigo
-- isso era proibido por índice único; aqui tem que virar três Negócios ganhos.
-- `product_name` e `product_type` são NOT NULL, e há CHECK em três colunas
-- (medido na branch, não suposto): product_type ∈ (mrr, projeto, unitario),
-- source ∈ (pipe, manual, erp, copilot, csv_import) e sale_value > 0.
-- O terceiro pedido vem com nome VAZIO (não nulo) de propósito: é o único jeito
-- de exercitar o título derivado "Compra de MM/AAAA" do backfill.
insert into public.upsell_orders
  (id, organization_id, client_id, product_name, product_type, sale_value, sold_at, source, external_id)
values
  ('aaaaaaaa-7777-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-6666-4000-8000-000000000001','Linha Performance 5kg','unitario', 19500, '2026-01-14', 'erp','TINY-1001'),
  ('aaaaaaaa-7777-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-6666-4000-8000-000000000001','Linha Performance 5kg','unitario', 12400, '2026-03-20', 'erp','TINY-1002'),
  ('aaaaaaaa-7777-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-6666-4000-8000-000000000001','','unitario', 12400, '2026-05-19', 'erp','OMIE-77')
on conflict (id) do nothing;

do $$
declare v_pedidos int; v_won int;
begin
  select count(*) into v_pedidos from public.upsell_orders o
    join public.upsell_clients c on c.id = o.client_id
   where c.organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if v_pedidos <> 3 then raise exception 'FALHA: esperava 3 pedidos, achei %', v_pedidos; end if;

  select count(*) into v_won from public.pipeline_stages
   where organization_id='aaaaaaaa-0000-4000-8000-000000000001'
     and pipeline_type='propostas' and stage_role='won' and is_active;
  if v_won < 1 then raise exception 'FALHA: sem etapa de ganho, o backfill não teria destino'; end if;

  raise notice '   OK(1): 3 pedidos de ERP para o mesmo lead, e o funil tem etapa de ganho.';
end $$;
