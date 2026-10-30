import type { AcaoDoDia } from '@/modules/engagement';
import type { WorkItem } from '@/modules/engagement/tasks';
import { zonedDayStart } from '@/shared/time/zoned-day';

/** Personal actions keep their original table, identifiers and completion history. */
export function personalTaskItems(actions:AcaoDoDia[]|undefined,userId:string|null,organizationId:string|null,memberId:string|null,timezone:string,now=new Date()):WorkItem[] {
  if(!userId || !organizationId || !memberId)return [];
  return (actions??[]).filter(a=>a.user_id===userId && (!a.organization_id || a.organization_id===organizationId)).map(a=>{
    const start=zonedDayStart(new Date(a.created_at),timezone);
    const end=zonedDayStart(new Date(start.getTime()+36*60*60*1000),timezone).getTime()-1;
    return {id:`daily:${a.id}`,daily_action_id:a.id,origin:'member',priority:'medium',title:a.title,kind:'task',status:a.is_completed?'completed':'pending',
      assignee_id:memberId,assignee_name:'Você',pipeline_entry_id:a.pipeline_entry_id??null,routine_id:null,
      instructions:a.description??'',message_template:'',required:false,due_at:new Date(end).toISOString(),work_date:a.created_at.slice(0,10),
      completed_at:a.completed_at,result:null,lead_name:a.lead?.name??a.proposta?.lead?.name??null,lead_id:a.lead_id,
      stage_name:null,pipeline_name:null,advanced_with_pending:false,overdue:!a.is_completed && end<now.getTime()};
  });
}
