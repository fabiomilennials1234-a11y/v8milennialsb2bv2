import { useAcoesDoDia } from '@/modules/engagement';
import { useTaskQueue } from '@/modules/engagement/tasks';
import { useIdentity,useOrganization,isVirtualTeamMember } from '@/modules/identity';
import { personalTaskItems } from '../lib/comando-task-items';

/** Always personal, including when the rest of Comando shows the team. */
export function useComandoTasks({history=false,future=false,page=0}:{history?:boolean;future?:boolean;page?:number}={}) {
  const {userId,teamMemberId}=useIdentity();const {organizationId,timezone}=useOrganization();
  const realMember=teamMemberId && !isVirtualTeamMember(teamMemberId)?teamMemberId:null;
  const myMemberId=teamMemberId??(userId?`user:${userId}`:null);
  const personal=useAcoesDoDia('meu');
  const assigned=useTaskQueue({assigneeId:realMember,history,future,page,enabled:!!realMember});
  const personalItems=future?[]:personalTaskItems(personal.data,userId,organizationId,myMemberId,timezone??'America/Sao_Paulo').filter(t=>history?t.status==='completed':t.status==='pending');
  const assignedData=realMember?assigned.data:undefined;
  const assignedError=!!realMember && assigned.isError;
  const items=[...(page===0?personalItems:[]),...(assignedData?.items??[])];
  const isLoading=personal.isLoading || (!!realMember && assigned.isLoading);
  const isBlockingError=personal.isError && (!realMember || assignedError);
  const unavailableSource=isBlockingError?null:personal.isError?'personal':assignedError?'assigned':null;
  return {items,myMemberId,
    total:personalItems.length+(assignedData?.total??0),assignedTotal:assignedData?.total??0,
    overdue:personalItems.filter(t=>t.overdue).length+(assignedData?.overdue??0),
    isLoading,isError:personal.isError || assignedError,isBlockingError,unavailableSource,
    isCardLoading:isLoading && !items.length,
    refetch:()=>Promise.all([personal.refetch(),...(realMember?[assigned.refetch()]:[])])};
}
