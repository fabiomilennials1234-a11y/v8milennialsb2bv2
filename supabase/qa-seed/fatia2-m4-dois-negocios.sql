-- ============================================================================
-- Cenário do M4: um lead com card em DOIS funis tem de sair com DOIS negócios.
--
-- Roda DEPOIS de `fatia2-branch-seed.sql` (que cria org, plano, funis, etapas) e
-- ANTES do `scripts/backfill-lead-negocio-m4.mjs`.
--
-- Por que não usar `abrir_negocio` para montar o cenário: ela já liga `deal_id`,
-- e o M4 só enxerga card com `deal_id IS NULL`. O que estamos reproduzindo aqui
-- é o card LEGADO — o que existe em prod hoje, 38.156 deles, nascido antes de a
-- tabela `deals` ser acesa. Por isso o INSERT é cru.
--
-- O caso é o dominante da base, não um extremo: medido em prod 2026-08-03, dos
-- 801 leads com mais de um card de sistema, **795 envolvem a Qualificação** —
-- 423 deles em Qualificação + Orçamentos, exatamente este par. Era esse conjunto
-- que a decisão 11 (revertida) apagaria.
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── O lead do cenário ──────────────────────────────────────────────────────
insert into public.leads (id, organization_id, name, phone, company)
values ('aaaaaaaa-3333-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Lead com Dois Negócios', '5511900000001', 'Dois Negócios ME')
on conflict (id) do nothing;

-- ── Dois cards LEGADOS, funis diferentes, sem negócio ──────────────────────
-- `assigned_to` NULL de propósito: responsável é ortogonal ao que se prova aqui,
-- e deixá-lo vazio mantém o gatilho do M6 fora do caminho.
insert into public.pipeline_entries
  (id, pipeline_id, lead_id, organization_id, stage_key, deal_id, created_at)
values
  ('aaaaaaaa-4444-4000-8000-00000000000a', 'aaaaaaaa-2222-4000-8000-000000000001',
   'aaaaaaaa-3333-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   'novo',    null, '2026-03-31T22:00:00-03:00'),
  ('aaaaaaaa-4444-4000-8000-00000000000b', 'aaaaaaaa-2222-4000-8000-000000000003',
   'aaaaaaaa-3333-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   'enviada', null, '2026-08-01T10:00:00-03:00')
on conflict (id) do nothing;

-- O primeiro card nasce às 22h de 31/03 em São Paulo — 01/04 em UTC. É armadilha
-- de propósito: se o título derivar sem o fuso da org, ele sai "abril" para um
-- card de março, e a prova depois do backfill pega.

do $$
declare v_cards int; v_com_deal int;
begin
  select count(*), count(*) filter (where deal_id is not null) into v_cards, v_com_deal
    from public.pipeline_entries where lead_id = 'aaaaaaaa-3333-4000-8000-00000000000d';

  if v_cards <> 2 then
    raise exception 'SETUP FAIL: esperava 2 cards legados, tenho %.', v_cards;
  end if;
  if v_com_deal <> 0 then
    raise exception 'SETUP FAIL: % card(s) já nasceram com negócio — o M4 os ignoraria.', v_com_deal;
  end if;
  raise notice 'SETUP OK: 2 cards legados (Qualificação + Orçamentos), nenhum com negócio.';
end$$;
