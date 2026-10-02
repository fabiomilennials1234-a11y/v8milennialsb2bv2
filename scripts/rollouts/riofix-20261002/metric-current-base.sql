set local lock_timeout='5s'; set local statement_timeout='25s';
create or replace function public._metric_leaf_relationship_base(p_org_id uuid,p_relationship text,p_filters jsonb)
returns jsonb language plpgsql stable security invoker set search_path=''
as $body$
declare n bigint; k text;
begin
 perform public.assert_org_access(p_org_id);
 if p_relationship is null or p_relationship not in ('lead','cliente') then
 raise exception 'Relação inválida' using errcode='22023';end if;
 for k in select jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) loop
 if k not in ('member_id','origin','tag_id','product_id','pipeline_id') and p_filters->k <> 'null'::jsonb then
 raise exception 'Filtro % não suportado pela base atual',k using errcode='22023';end if;end loop;
 select count(*) into n from public.leads l
 where l.organization_id=p_org_id and l.relacao_negocios=p_relationship
 and public._metric_lead_na_coorte(l.deleted_at,l.is_shadow,l.id,p_org_id)
 and (p_filters->>'member_id' is null or l.responsible_user_id=(p_filters->>'member_id')::uuid)
 and (p_filters->>'origin' is null or l.origin=p_filters->>'origin')
 and (p_filters->>'tag_id' is null or exists(select 1 from public.lead_tags lt join public.tags t on t.id=lt.tag_id and t.organization_id=p_org_id where lt.lead_id=l.id and lt.tag_id=(p_filters->>'tag_id')::uuid))
 and (p_filters->>'product_id' is null or exists(select 1 from public.lead_products lp join public.products p on p.id=lp.product_id and p.organization_id=p_org_id where lp.lead_id=l.id and lp.product_id=(p_filters->>'product_id')::uuid))
 and (p_filters->>'pipeline_id' is null or exists(select 1 from public.pipeline_entries pe where pe.organization_id=p_org_id and pe.lead_id=l.id and pe.pipeline_id=(p_filters->>'pipeline_id')::uuid));
 return jsonb_build_object('value',n,'series',null,'empty_reason',case when n=0 then 'no_rows' else null end);
end $body$;
revoke all on function public._metric_leaf_relationship_base(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public._metric_leaf_relationship_base(uuid,text,jsonb) to service_role;

insert into public.metric_catalog_measures(id,label,unit,anchor,description,sort) values
('base_leads_atuais','Leads — base atual','count','hoje','Pessoas com relação comercial lead. Exclui clientes, perdidos e registros excluídos das métricas; conta cada pessoa uma vez.',31),
('base_clientes_atuais','Clientes — base atual','count','hoje','Pessoas com relação comercial cliente, baseada em ganhos/vendas válidos. Conta cada pessoa uma vez; estado atual, independente do período.',32)
on conflict(id) do nothing;
insert into public.metric_catalog_measure_recortes(measure_id,recorte_id) values
('base_leads_atuais','total'),('base_clientes_atuais','total') on conflict do nothing;

-- Patch estritamente aditivo: mantém o corpo que está instalado, inclusive alterações concorrentes.
do $patch$
declare body text; needle constant text:='  v_leaf := CASE p_measure_id';
begin
 body:=pg_get_functiondef('public._metric_leaf(uuid,text,text,text,date,date,date,jsonb)'::regprocedure);
 if position('WHEN ''base_leads_atuais''' in body)=0 then
 if position(needle in body)=0 then raise exception 'Dispatcher de métricas incompatível';end if;
 body:=replace(body,needle,needle || E'\n    WHEN ''base_leads_atuais'' THEN public._metric_leaf_relationship_base(p_org_id, ''lead'', p_filters)\n    WHEN ''base_clientes_atuais'' THEN public._metric_leaf_relationship_base(p_org_id, ''cliente'', p_filters)');
 execute body;
 end if;
end $patch$;
