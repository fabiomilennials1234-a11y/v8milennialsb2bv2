set local lock_timeout='5s';
set local statement_timeout='20s';
insert into public.workflows(id,organization_id,name,description,is_active,trigger_type,trigger_config,definition,re_enrollment_enabled,re_enrollment_cooldown_days,loop_limit)
values('9dd137e9-e6cb-4ca2-8351-975a0982ecaf','36971ff5-fd73-4f30-a733-04bf8c90e5b6','Resposta no arquivado → Falando','Resposta nova na conexão Riofix desarquiva a conversa. Havendo exatamente um negócio aberto elegível no Mustang, retoma em Falando. Preserva ganhos, perdas, negociações avançadas e casos ambíguos. Adaptador privado da Riofix; nenhum envio de mensagem.',false,'webhook_received','{"webhook_key":"riofix_archived_reply"}',$definition${"edges":[{"id":"start","source":"trigger","target":"etapa-0"},{"id":"yes-0","source":"etapa-0","target":"falando","sourceHandle":"yes"},{"id":"no-0","source":"etapa-0","target":"etapa-1","sourceHandle":"no"},{"id":"yes-1","source":"etapa-1","target":"falando","sourceHandle":"yes"},{"id":"no-1","source":"etapa-1","target":"etapa-2","sourceHandle":"no"},{"id":"yes-2","source":"etapa-2","target":"falando","sourceHandle":"yes"},{"id":"no-2","source":"etapa-2","target":"etapa-3","sourceHandle":"no"},{"id":"yes-3","source":"etapa-3","target":"falando","sourceHandle":"yes"},{"id":"no-3","source":"etapa-3","target":"end","sourceHandle":"no"},{"id":"finish","source":"falando","target":"end"}],"nodes":[{"id":"trigger","data":{"type":"trigger","label":"Resposta em conversa arquivada","config":{"webhook_key":"riofix_archived_reply"},"triggerType":"webhook_received"},"type":"trigger","position":{"x":0,"y":0}},{"id":"etapa-0","data":{"type":"condition","field":"stage_id","label":"Ainda em Novo Lead?","value":"29949eb4-f241-4d0f-abcd-4000350601d9","operator":"equals","conditionMode":"field"},"type":"condition","position":{"x":400,"y":0}},{"id":"etapa-1","data":{"type":"condition","field":"stage_id","label":"Ainda Esperando Resposta?","value":"90dfc706-6e1b-42f6-994e-536ff2b82b10","operator":"equals","conditionMode":"field"},"type":"condition","position":{"x":750,"y":0}},{"id":"etapa-2","data":{"type":"condition","field":"stage_id","label":"Ainda Sem resposta?","value":"93f7b170-1064-44fc-9f25-f95c1e46d2ae","operator":"equals","conditionMode":"field"},"type":"condition","position":{"x":1100,"y":0}},{"id":"etapa-3","data":{"type":"condition","field":"stage_id","label":"Ainda em Futuro?","value":"383e8362-f876-4412-bc13-beca2e4195a5","operator":"equals","conditionMode":"field"},"type":"condition","position":{"x":1450,"y":0}},{"id":"falando","data":{"type":"action","label":"Retomar negócio em Falando","actionType":"move_stage","pipelineId":"a9a2f3cb-63fe-4ca1-a453-f27002cc4944","targetStage":"8a923b49-de12-4a79-b133-d08855aa8ce4","safeCustomMove":true,"expectedStageIds":["29949eb4-f241-4d0f-abcd-4000350601d9","90dfc706-6e1b-42f6-994e-536ff2b82b10","93f7b170-1064-44fc-9f25-f95c1e46d2ae","383e8362-f876-4412-bc13-beca2e4195a5"]},"type":"action","position":{"x":1850,"y":-100}},{"id":"end","data":{"type":"end","label":"Retorno concluído"},"type":"end","position":{"x":2250,"y":0}}]}$definition$::jsonb,true,0,20);

create function private.riofix_reabrir_conversa_arquivada()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
 org constant uuid:='36971ff5-fd73-4f30-a733-04bf8c90e5b6';
 wf constant uuid:='9dd137e9-e6cb-4ca2-8351-975a0982ecaf';
 reopened integer; lid uuid; n integer; entry public.pipeline_entries;
begin
 if new.organization_id is distinct from org
 or new.instance_id is distinct from 'a4decb64-bdab-4165-9ebb-77b35436330f'::uuid
 or new.direction is distinct from 'incoming'
 or new.received_via is distinct from 'webhook'
 or coalesce(new.is_group,false) or new.remote_jid like '%@g.us'
 or coalesce(new.edited,false) or new.deleted_at is not null
 or nullif(new.normalized_phone,'') is null
 or new.timestamp is null or new.timestamp<clock_timestamp()-interval '5 minutes'
 or new.timestamp>clock_timestamp()+interval '2 minutes'
 then return new; end if;
 if not exists(select 1 from public.workflows where id=wf and organization_id=org and is_active) then return new;end if;
 with changed as (
 update public.whatsapp_conversations set archived_at=null
 where organization_id=org and instance_id=new.instance_id
 and normalized_phone=new.normalized_phone and deleted_at is null
 and archived_at is not null and archived_at<=new.timestamp
 returning id
 ) select count(*) into reopened from changed;
 if reopened=0 then return new; end if;

 select count(*),(array_agg(l.id))[1] into n,lid from public.leads l
 where l.organization_id=org and l.deleted_at is null and l.normalized_phone=new.normalized_phone;
 if n<>1 or (new.lead_id is not null and new.lead_id<>lid) then return new;end if;
 select count(*) into n from public.pipeline_entries pe
 left join public.deals d on d.id=pe.deal_id and d.organization_id=org
 where pe.organization_id=org and pe.pipeline_id='a9a2f3cb-63fe-4ca1-a453-f27002cc4944'
 and pe.lead_id=lid and pe.closed_at is null
 and pe.stage_key not in ('vendido','perdido_desqualificado','pos_venda')
 and (pe.deal_id is null or (d.deleted_at is null and d.outcome='open'));
 if n<>1 then return new;end if;
 select pe.* into strict entry from public.pipeline_entries pe
 left join public.deals d on d.id=pe.deal_id and d.organization_id=org
 where pe.organization_id=org and pe.pipeline_id='a9a2f3cb-63fe-4ca1-a453-f27002cc4944'
 and pe.lead_id=lid and pe.closed_at is null
 and pe.stage_key not in ('vendido','perdido_desqualificado','pos_venda')
 and (pe.deal_id is null or (d.deleted_at is null and d.outcome='open'));
 if entry.stage_key not in ('novo_lead','esperando_resposta','sem_resposta','futuro') then return new;end if;
 perform private.riofix_enqueue_workflow(wf,lid,entry.id,entry.deal_id,
 jsonb_build_object('trigger','webhook_received','webhook_key','riofix_archived_reply',
 'lead_id',lid,'pipeline_entry_id',entry.id,'pipeline_id',entry.pipeline_id,'deal_id',entry.deal_id,
 'instance_id',new.instance_id,'message_id',new.id,'riofix_archived_reply',true),
 'archived-reply:'||new.id::text);
 return new;
exception when others then
 -- Uma falha acessória não pode impedir a persistência da mensagem recebida.
 -- O sub-bloco é revertido integralmente, inclusive o desarquivamento.
 raise warning 'Riofix: retorno do arquivado não aplicado (SQLSTATE %)',sqlstate;
 return new;
end $function$;
revoke all on function private.riofix_reabrir_conversa_arquivada() from public,anon,authenticated;
create trigger riofix_reabrir_conversa_arquivada
after insert on public.whatsapp_messages for each row
when(new.organization_id='36971ff5-fd73-4f30-a733-04bf8c90e5b6'::uuid and new.direction='incoming')
execute function private.riofix_reabrir_conversa_arquivada();
