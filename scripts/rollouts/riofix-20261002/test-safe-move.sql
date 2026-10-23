begin;
set local statement_timeout='25s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $test$
declare org constant uuid:='36971ff5-fd73-4f30-a733-04bf8c90e5b6';pipe constant uuid:='a9a2f3cb-63fe-4ca1-a453-f27002cc4944';src constant uuid:='93f7b170-1064-44fc-9f25-f95c1e46d2ae';dest constant uuid:='8a923b49-de12-4a79-b133-d08855aa8ce4';
 lid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); did uuid:=gen_random_uuid(); r jsonb; n integer;
begin
 insert into public.leads(id,organization_id,name,phone,origin) values(lid,org,'TESTE SAFE MOVE ROLLBACK','5511000079991','whatsapp');
 insert into public.pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_key) values(eid,org,pipe,lid,'sem_resposta'),(second,org,pipe,lid,'novo_lead');
 r:=public.workflow_move_custom_entry_safely(org,lid,eid,pipe,dest::text,array[src]);
 if r->>'status'<>'moved' or r->>'entry_id'<>eid::text then raise exception 'Movimento exato falhou: %',r;end if;
 if not exists(select 1 from public.pipeline_entries where id=second and stage_key='novo_lead') then raise exception 'Negócio vizinho alterado';end if;
 r:=public.workflow_move_custom_entry_safely(org,lid,eid,pipe,dest::text,array[src]);
 if r->>'status'<>'skipped' then raise exception 'Resposta repetida não preservou etapa';end if;
 r:=public.workflow_move_custom_entry_safely(org,lid,null,pipe,dest::text,array[src]);
 if r->>'reason'<>'ambiguous_or_missing_entry' then raise exception 'Aceitou duas entradas sem identidade';end if;
 r:=public.workflow_move_custom_entry_safely(org,lid,gen_random_uuid(),pipe,dest::text,array[src]);
 if r->>'reason'<>'entry_not_in_scope' then raise exception 'Identidade inexistente gerou fallback';end if;

 update public.pipeline_entries set closed_at=now() where id=second;
 update public.pipeline_entries set stage_key='sem_resposta',stage_id=src where id=eid;
 r:=public.workflow_move_custom_entry_safely(org,lid,null,pipe,'conversando',array[src]);
 if r->>'status'<>'moved' or r->>'entry_id'<>eid::text then raise exception 'Entrada única não foi movida';end if;
 update public.pipeline_entries set stage_key='proposta',stage_id='70d2ac81-d1e7-4636-b7b7-405dfc78bde4' where id=eid;
 r:=public.workflow_move_custom_entry_safely(org,lid,eid,pipe,dest::text,array[src]);
 if r->>'status'<>'skipped' then raise exception 'Avanço manual sobrescrito';end if;
 update public.pipeline_entries set stage_key='sem_resposta',stage_id=src,closed_at=now() where id=eid;
 r:=public.workflow_move_custom_entry_safely(org,lid,eid,pipe,dest::text,array[src]);
 if r->>'status'<>'skipped' then raise exception 'Negócio fechado reaberto';end if;

 insert into public.deals(id,organization_id,source_lead_id,title,value,outcome,source) values(did,org,lid,'TESTE SAFE MOVE',1,'won','api');
 update public.pipeline_entries set deal_id=did,closed_at=null where id=eid;
 r:=public.workflow_move_custom_entry_safely(org,lid,eid,pipe,dest::text,array[src]);
 if r->>'status'<>'skipped' then raise exception 'Ganho sobrescrito';end if;
 begin
 perform public.workflow_move_custom_entry_safely(gen_random_uuid(),lid,eid,pipe,dest::text,array[src]);
 raise exception 'Outra organização aceita';
 exception when sqlstate '22023' then null;end;
 begin
 perform public.workflow_move_custom_entry_safely(org,gen_random_uuid(),eid,pipe,dest::text,array[src]);
 raise exception 'Lead fora da organização aceito';
 exception when sqlstate '22023' then null;end;
 if has_function_privilege('anon','public.workflow_move_custom_entry_safely(uuid,uuid,uuid,uuid,text,uuid[])','EXECUTE')
 or has_function_privilege('authenticated','public.workflow_move_custom_entry_safely(uuid,uuid,uuid,uuid,text,uuid[])','EXECUTE')
 then raise exception 'RPC exposta ao cliente';end if;
end $test$;
rollback;
select 'Movimento exato, ambiguidade, avanço manual, ganho, fechado e isolamento passaram; fixtures revertidas' result;
