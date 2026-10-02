begin isolation level repeatable read;
set local statement_timeout='25s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $test$
declare org constant uuid:='36971ff5-fd73-4f30-a733-04bf8c90e5b6';
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();
 before_leads numeric;before_clients numeric;before_created numeric;got numeric;
begin
 before_leads:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_leads_atuais"}','total')->>'value')::numeric;
 before_clients:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_clientes_atuais"}','total')->>'value')::numeric;
 before_created:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"leads_criados"}','total')->>'value')::numeric;
 insert into public.leads(id,organization_id,name,phone,origin) values
 (a,org,'TESTE METRICA ROLLBACK','5511000079981','whatsapp'),
 (b,org,'TESTE METRICA ROLLBACK','5511000079982','whatsapp'),
 (c,org,'TESTE METRICA ROLLBACK','5511000079983','whatsapp');
 insert into public.leads(organization_id,name,phone,origin,is_shadow,deleted_at) values
 (org,'TESTE METRICA ROLLBACK','5511000079984','whatsapp',true,null),
 (org,'TESTE METRICA ROLLBACK','5511000079985','whatsapp',false,now());
 insert into public.deals(organization_id,source_lead_id,title,value,outcome,source) values
 (org,b,'TESTE METRICA',1,'won','api'),(org,b,'TESTE METRICA',2,'won','api'),(org,c,'TESTE METRICA',1,'lost','api');
 got:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_leads_atuais"}','total')->>'value')::numeric;
 if got<>before_leads+1 then raise exception 'Leads misturam clientes/perdidos/excluídos: % vs %',got,before_leads;end if;
 got:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_clientes_atuais"}','total')->>'value')::numeric;
 if got<>before_clients+1 then raise exception 'Clientes duplicados por venda: % vs %',got,before_clients;end if;
 got:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"leads_criados"}','total')->>'value')::numeric;
 if got<>before_created+3 then raise exception 'Métrica antiga alterada: % vs %',got,before_created;end if;
 got:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_clientes_atuais"}','total','month','2000-01-01')->>'value')::numeric;
 if got<>before_clients+1 then raise exception 'Base atual depende de período';end if;
 got:=(public.fn_metric_measure(gen_random_uuid(),'{"kind":"leaf","id":"base_clientes_atuais"}','total')->>'value')::numeric;
 if got<>0 then raise exception 'Vazou organização';end if;
 got:=(public.fn_metric_measure(org,'{"kind":"leaf","id":"base_clientes_atuais"}','total','month',null,null,null,'{"pipeline_id":"00000000-0000-0000-0000-000000000000"}')->>'value')::numeric;
 if got<>0 then raise exception 'Filtro de funil ignorado';end if;
 if has_function_privilege('authenticated','public._metric_leaf_relationship_base(uuid,text,jsonb)','EXECUTE')
 or has_function_privilege('anon','public._metric_leaf_relationship_base(uuid,text,jsonb)','EXECUTE')
 then raise exception 'Helper pública';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',gen_random_uuid())::text,true);
 begin
 perform public.fn_metric_measure(org,'{"kind":"leaf","id":"base_clientes_atuais"}','total');
 raise exception 'Acesso indevido' using errcode='22023';
 exception when sqlstate 'P0001' then
 if sqlerrm<>'access_denied' then raise;end if;end;
end $test$;
rollback;
select 'Métricas: relação, deduplicação de clientes, exclusões, período, filtro de funil, regressão e isolamento passaram; fixtures revertidas' result;
