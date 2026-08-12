-- ============================================================================
-- Prova do M4, rodada DEPOIS do backfill (`--commit`).
--
-- O que está em julgamento: a reversão da decisão 11. Um lead com card em dois
-- funis tem de sair com DOIS negócios, os dois cards vivos, e cada card ligado
-- ao seu. A versão anterior deste backfill teria criado UM negócio e APAGADO um
-- dos cards.
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── 1. DOIS negócios, e os dois cards continuam vivos ──────────────────────
do $$
declare v_cards int; v_deals int; v_ligados int;
begin
  select count(*), count(distinct deal_id), count(*) filter (where deal_id is not null)
    into v_cards, v_deals, v_ligados
    from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-00000000000d';

  if v_cards <> 2 then
    raise exception 'FAIL(1): o lead tem % card(s). A fusão da decisão 11 apagaria um — ela foi revertida, os dois têm de sobreviver.', v_cards;
  end if;
  if v_deals <> 2 then
    raise exception 'FAIL(1): % negócio(s) distinto(s) para 2 cards. Um lead PODE ter mais de um negócio ao mesmo tempo (decisão 2).', v_deals;
  end if;
  if v_ligados <> 2 then
    raise exception 'FAIL(1): só % card(s) ficaram ligados a negócio.', v_ligados;
  end if;
  raise notice 'OK(1): 2 cards vivos, 2 negócios distintos, os 2 ligados.';
end$$;

-- ── 2. Um negócio por card, não um por jornada ─────────────────────────────
-- Se algum negócio fosse compartilhado por dois cards, o índice único de
-- `pipeline_entries.deal_id` (passo 6) recusaria a base depois — longe daqui.
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select deal_id from public.pipeline_entries
     where deal_id is not null group by deal_id having count(*) > 1
  ) x;
  if v_dup <> 0 then
    raise exception 'FAIL(2): % negócio(s) ocupam mais de uma posição — o unique de deal_id vai recusar a base.', v_dup;
  end if;
  raise notice 'OK(2): nenhum negócio em duas posições — compatível com o unique do passo 6.';
end$$;

-- ── 3. Título derivado, e o fuso da org ganha da UTC ───────────────────────
-- O card de Qualificação nasceu às 22h de 31/03 em São Paulo = 01/04 em UTC.
-- Título "abril" aqui significa que o fuso foi ignorado.
do $$
declare v_qualif text; v_orcam text; v_funil int;
begin
  select d.title into v_qualif
    from public.pipeline_entries pe join public.deals d on d.id = pe.deal_id
   where pe.id = 'aaaaaaaa-4444-4000-8000-00000000000a';
  select d.title into v_orcam
    from public.pipeline_entries pe join public.deals d on d.id = pe.deal_id
   where pe.id = 'aaaaaaaa-4444-4000-8000-00000000000b';

  if v_qualif <> 'Negócio de março/2026' then
    raise exception 'FAIL(3): card de 31/03 22h (SP) virou "%" — esperava "Negócio de março/2026". O fuso da org foi ignorado.', v_qualif;
  end if;
  if v_orcam <> 'Negócio de agosto/2026' then
    raise exception 'FAIL(3): card de 01/08 virou "%" — esperava "Negócio de agosto/2026".', v_orcam;
  end if;

  -- E nenhum dos dois pode ter herdado o nome do funil (decisão 9).
  select count(*) into v_funil
    from public.deals d join public.pipelines p on p.organization_id = d.organization_id
   where d.title = p.name;
  if v_funil <> 0 then
    raise exception 'FAIL(3): % negócio(s) com título igual ao nome de um funil — é o que a decisão 9 rejeita.', v_funil;
  end if;

  raise notice 'OK(3): títulos "%" e "%" — derivados, no fuso da org, nenhum herdando nome de funil.', v_qualif, v_orcam;
end$$;

-- ── 4. Nada ficou para trás na org ─────────────────────────────────────────
do $$
declare v_orfaos int; v_total_cards int; v_total_deals int;
begin
  select count(*) into v_orfaos from public.pipeline_entries
   where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deal_id is null;
  select count(*) into v_total_cards from public.pipeline_entries
   where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  select count(*) into v_total_deals from public.deals
   where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_orfaos <> 0 then
    raise exception 'FAIL(4): % card(s) da org ficaram sem negócio.', v_orfaos;
  end if;
  raise notice 'OK(4): % card(s) na org, % negócio(s), zero órfão — um por card.', v_total_cards, v_total_deals;
end$$;
