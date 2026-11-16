/** Entry is the commercial pipeline, covering forms and WhatsApp without Profit. */
export function regionalWorkflow({ instanceId, pipelineId, triageMemberId, statusFieldId }) {
 const nodes=[]; const edges=[];
 const node=(id,type,data)=>{nodes.push({id,type,position:{x:0,y:nodes.length*200},data:{type,...data}});return id;};
 const edge=(source,target,sourceHandle)=>edges.push({id:`${source}-${sourceHandle??'next'}-${target}`,source,target,...(sourceHandle?{sourceHandle}:{})});
 const send=(id,label,messageTemplate)=>node(id,'action',{label,actionType:'send_whatsapp_message',messageType:'texto',semiAutomatic:false,messageTemplate,whatsappInstanceId:instanceId,whatsappInstanceName:'WhatsApp Principal',instanceRoutingPolicy:'fixed'});
 const owner=(id)=>node(id,'condition',{label:'Já encaminhado ao representante?',conditionMode:'field',guidedCondition:{id:`${id}-rule`,kind:'group',match:'all',version:1,children:[
   {id:`${id}-filled`,version:1,field:'lead.sale_responsible_id',operator:'is_not_empty'},
   {id:`${id}-not-triage`,version:1,field:'lead.sale_responsible_id',operator:'not_equals',memberId:triageMemberId,memberName:'Karine Chaves'},
 ]}});
 const question=(id,text)=>node(id,'question_buttons',{label:'Confirmar cidade, UF e CNPJ',text,instanceId,timeoutHours:24,buttons:[{id:'provided',label:'Já informei'},{id:'human',label:'Falar com a Karine'}]});
 const factory=id=>node(id,'condition',{label:'Atendimento da fábrica?',conditionMode:'field',guidedCondition:{id:`${id}-rule`,version:1,field:'lead.custom',fieldId:statusFieldId,fieldName:'Status Jrtex',fieldType:'text',operator:'equals',value:'Atendimento da fábrica'}});
 node('trigger','trigger',{label:'Novo contato no funil comercial Jrtex',triggerType:'lead_created',config:{filter_pipeline_id:pipelineId}});
 send('hello','Apresentação da Karine','Olá! Sou a Karine, analista comercial da JRTex. Tudo bem? Recebemos seu contato. Trabalhamos com malhas em rolos fechados no atacado para clientes com CNPJ ativo. Vamos direcionar seu atendimento ao representante da sua região.');
 owner('owner_initial');
 question('collect','Para encaminharmos seu atendimento, informe sua cidade, estado (UF) e CNPJ. Exemplo: Blumenau, SC, seguido do CNPJ da empresa. Se já enviou tudo, toque em “Já informei”.');
 owner('owner_after_reply');
 question('missing','Ainda precisamos confirmar cidade, UF e um CNPJ válido antes do encaminhamento. Envie os dados que faltam ou toque em “Falar com a Karine” para receber ajuda.');
 owner('owner_final');
 factory('factory_initial');factory('factory_after_reply');
 send('assigned','Confirmar representante','Seu atendimento está com {{responsavel}}, representante da JRTex. Em breve ele continuará a conversa por aqui.');
 node('notify','action',{label:'Avisar Karine sobre pendência',actionType:'notify_team_member',notifyChannel:'app',notifyMemberId:triageMemberId,notifyMemberName:'Karine Chaves',notifyMessage:'JRTex: {{nome}} precisa de ajuda na qualificação. Confira cidade, UF, CNPJ e a fila de recuperação.'});
 send('triage','Confirmar atendimento da fábrica','Obrigado! A Karine vai revisar seus dados e continuar o atendimento por aqui.');
 node('done','end',{label:'Atendimento encaminhado'});
 node('pending','end',{label:'Pendência acompanhada pela Karine'});
 edge('trigger','hello');edge('hello','owner_initial');edge('hello','notify','error');
 edge('owner_initial','assigned','yes');edge('owner_initial','factory_initial','no');
 edge('factory_initial','triage','yes');edge('factory_initial','collect','no');
 for(const [q,next] of [['collect','owner_after_reply'],['missing','owner_final']]){
   edge(q,next,'button:provided');edge(q,next,'other_response');edge(q,'notify','button:human');edge(q,'notify','timeout');edge(q,'notify','send_failure');
 }
 edge('owner_after_reply','assigned','yes');edge('owner_after_reply','factory_after_reply','no');
 edge('factory_after_reply','triage','yes');edge('factory_after_reply','missing','no');
 edge('owner_final','assigned','yes');edge('owner_final','notify','no');
 edge('assigned','done');edge('assigned','notify','error');edge('notify','triage');edge('triage','pending');edge('triage','pending','error');
 return {definition:{nodes,edges},required_fields:['lead.sale_responsible_id',`lead.custom:${statusFieldId}`],trigger_type:'lead_created',trigger_config:{filter_pipeline_id:pipelineId},settings:{name:'JRTEX | Qualificação e distribuição regional',enrollment_criteria:{enabled:false,match_all:true,conditions:[]},re_enrollment_enabled:false,re_enrollment_max_times:1,re_enrollment_cooldown_days:30}};
}
