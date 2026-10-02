begin;
set local statement_timeout='25s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.workflows set is_active=true where id='9dd137e9-e6cb-4ca2-8351-975a0982ecaf' and organization_id='36971ff5-fd73-4f30-a733-04bf8c90e5b6';
do $test$
declare org constant uuid:='36971ff5-fd73-4f30-a733-04bf8c90e5b6'; inst constant uuid:='a4decb64-bdab-4165-9ebb-77b35436330f'; wf constant uuid:='9dd137e9-e6cb-4ca2-8351-975a0982ecaf'; lid uuid; eid uuid; cid uuid; mid uuid; phone text; k int; expect_reopen boolean; expect_queue boolean; n int; total_before bigint;
begin
 select count(*) into total_before from public.whatsapp_messages where organization_id=org;
 for k in 1..12 loop
 lid:=gen_random_uuid();eid:=gen_random_uuid();cid:=gen_random_uuid();mid:=gen_random_uuid();phone:='551100008'||lpad(k::text,4,'0');
 insert into public.leads(id,organization_id,name,phone,origin) values(lid,org,'TESTE RIOFIX ROLLBACK '||k,phone,'whatsapp');
 insert into public.pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_key,closed_at)
 values(eid,org,'a9a2f3cb-63fe-4ca1-a453-f27002cc4944',lid,
 case k when 8 then 'proposta' when 9 then 'vendido' else 'sem_resposta' end,
 case when k=10 then now() else null end);
 if k=7 then
 insert into public.pipeline_entries(organization_id,pipeline_id,lead_id,stage_key) values(org,'a9a2f3cb-63fe-4ca1-a453-f27002cc4944',lid,'novo_lead');
 end if;
 insert into public.whatsapp_conversations(id,organization_id,instance_id,phone_number,archived_at)
 values(cid,org,inst,phone,case when k=11 then null else now()-interval '1 minute' end);
 insert into public.whatsapp_messages(id,organization_id,instance_id,message_id,remote_jid,phone_number,direction,status,content,lead_id,sent_source,received_via,is_group,timestamp,edited)
 values(mid,org,inst,'riofix-reopen-test-'||mid,phone||case when k=4 then '@g.us' else '@s.whatsapp.net' end,phone,
 case when k=3 then 'outgoing' else 'incoming' end,case when k=3 then 'sent' else 'received' end,'TESTE TRANSACIONAL',lid,
 'manual',case when k=2 then 'history_sync' else 'webhook' end,k=4,
 case when k=5 then now()-interval '2 minutes' when k=6 then now()-interval '1 day' else now() end,k=12);
 expect_reopen:=k in(1,7,8,9,10,11);
 expect_queue:=k=1;
 if (select archived_at is null from public.whatsapp_conversations where id=cid) is distinct from expect_reopen then
 raise exception 'Caso %: desarquivamento divergente',k;end if;
 select count(*) into n from public.workflow_executions where workflow_id=wf and organization_id=org and lead_id=lid;
 if n<>(case when expect_queue then 1 else 0 end) then raise exception 'Caso %: quantidade de execuções %',k,n;end if;
 if expect_queue then
 if not exists(select 1 from public.workflow_executions where workflow_id=wf and lead_id=lid and pipeline_entry_id=eid and context->>'instance_id'=inst::text) then raise exception 'Identidade do negócio perdida';end if;
 insert into public.whatsapp_messages(organization_id,instance_id,message_id,remote_jid,phone_number,direction,status,content,lead_id,received_via,timestamp)
 values(org,inst,'riofix-replay-'||mid,phone||'@s.whatsapp.net',phone,'incoming','received','SEGUNDA RESPOSTA',lid,'webhook',now());
 if (select count(*) from public.workflow_executions where workflow_id=wf and lead_id=lid)<>1 then raise exception 'Resposta repetida duplicou execução';end if;
 end if;
 end loop;
 if has_function_privilege('anon','private.riofix_reabrir_conversa_arquivada()','EXECUTE') or has_function_privilege('authenticated','private.riofix_reabrir_conversa_arquivada()','EXECUTE') then raise exception 'Função exposta';end if;
end $test$;
rollback;
select '12 cenários e resposta repetida passaram; todas as fixtures revertidas' result;
