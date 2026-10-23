set local lock_timeout='5s'; set local statement_timeout='20s';
create or replace function public.workflow_move_custom_entry_safely(
 p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_pipeline_id uuid,
 p_target_stage text,p_expected_stage_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare entry public.pipeline_entries; target public.pipeline_stages; ids uuid[]; n int;
begin
 if p_organization_id is null or p_lead_id is null or p_pipeline_id is null
 or coalesce(cardinality(p_expected_stage_ids),0)=0 then
 raise exception 'Parâmetros obrigatórios ausentes' using errcode='22023';end if;
 perform public.assert_org_access(p_organization_id);
 if not exists(select 1 from public.pipelines where id=p_pipeline_id and organization_id=p_organization_id and is_active and type='custom')
 or not exists(select 1 from public.leads where id=p_lead_id and organization_id=p_organization_id and deleted_at is null)
 then raise exception 'Funil ou lead fora do escopo' using errcode='22023';end if;
 select * into target from public.pipeline_stages
 where organization_id=p_organization_id and pipeline_id=p_pipeline_id and is_active
 and (id::text=p_target_stage or stage_key=p_target_stage) for share nowait;
 if not found or target.stage_role is distinct from 'open' or target.is_final_positive is true or target.is_final_negative is true
 then raise exception 'Destino deve ser etapa aberta do mesmo funil' using errcode='22023';end if;

 if p_entry_id is not null then
 select * into entry from public.pipeline_entries where id=p_entry_id
 and organization_id=p_organization_id and lead_id=p_lead_id and pipeline_id=p_pipeline_id for update;
 if not found then return jsonb_build_object('status','skipped','reason','entry_not_in_scope');end if;
 else
 -- Sem identidade, só prossegue quando há UMA entrada aberta no funil.
 select array_agg(pe.id) into ids from public.pipeline_entries pe
 left join public.deals d on d.id=pe.deal_id and d.organization_id=pe.organization_id
 join public.pipeline_stages st on st.id=pe.stage_id and st.organization_id=pe.organization_id and st.pipeline_id=pe.pipeline_id
 where pe.organization_id=p_organization_id and pe.lead_id=p_lead_id and pe.pipeline_id=p_pipeline_id
 and pe.closed_at is null and st.stage_role='open'
 and (pe.deal_id is null or (d.deleted_at is null and d.outcome='open'));
 if coalesce(cardinality(ids),0)<>1 then return jsonb_build_object('status','skipped','reason','ambiguous_or_missing_entry');end if;
 select * into entry from public.pipeline_entries where id=ids[1] and organization_id=p_organization_id
 and lead_id=p_lead_id and pipeline_id=p_pipeline_id for update;
 if not found then return jsonb_build_object('status','skipped','reason','entry_changed');end if;
 end if;
 if entry.closed_at is not null or not(entry.stage_id=any(p_expected_stage_ids))
 or not exists(select 1 from public.pipeline_stages where id=entry.stage_id and organization_id=p_organization_id and pipeline_id=p_pipeline_id and stage_role='open')
 then return jsonb_build_object('status','skipped','reason','stage_changed_or_closed','entry_id',entry.id);end if;
 if entry.deal_id is not null then
 -- A venda manual bloqueia deal antes do card. Não esperar aqui evita ciclo
 -- entry -> deal -> entry; 55P03 faz somente a automação recuar e tentar depois.
 perform 1 from public.deals where id=entry.deal_id and organization_id=p_organization_id
 and source_lead_id=p_lead_id and deleted_at is null and outcome='open' for update nowait;
 if not found then return jsonb_build_object('status','skipped','reason','deal_closed_or_missing','entry_id',entry.id);end if;
 end if;
 update public.pipeline_entries set stage_id=target.id,stage_key=target.stage_key,stage_changed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=entry.id and organization_id=p_organization_id and lead_id=p_lead_id and pipeline_id=p_pipeline_id;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Entrada alterada durante movimentação';end if;
 return jsonb_build_object('status','moved','entry_id',entry.id,'stage_key',target.stage_key);
end $function$;
revoke all on function public.workflow_move_custom_entry_safely(uuid,uuid,uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workflow_move_custom_entry_safely(uuid,uuid,uuid,uuid,text,uuid[]) to service_role;
comment on function public.workflow_move_custom_entry_safely(uuid,uuid,uuid,uuid,text,uuid[]) is
'Opt-in de workflows: movimenta o negócio exato, apenas de etapas de origem esperadas para destino aberto no mesmo funil. Sem identidade, exige uma única entrada aberta. Serviço apenas; preserva mudanças manuais e negócios fechados.';
