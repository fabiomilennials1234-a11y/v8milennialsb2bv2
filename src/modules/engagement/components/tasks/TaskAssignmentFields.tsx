import { TASK_PRIORITY_LABELS,type TaskPriority,type TaskAudience,type TaskConfiguration } from '../../lib/task-types';

export function PriorityField({value,onChange}:{value:TaskPriority;onChange:(value:TaskPriority)=>void}) {
  return <label className="grid gap-1.5 text-sm font-medium">Prioridade<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={e=>onChange(e.target.value as TaskPriority)}>
    {Object.entries(TASK_PRIORITY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}
  </select></label>;
}
export function RecipientFields({audience,memberIds,members,allowOwner=false,onChange}:{
  audience:TaskAudience|'';memberIds:string[];members:TaskConfiguration['members'];allowOwner?:boolean;
  onChange:(audience:TaskAudience|'',memberIds:string[])=>void;
}) {
  return <fieldset className="space-y-2"><legend className="mb-1.5 text-sm font-medium">Destinatários</legend>
    <select aria-label="Destinatários" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={audience} onChange={e=>onChange(e.target.value as TaskAudience|'',[])}>
      <option value="">Selecione quem vai receber</option>
      <option value="team">Toda a equipe da organização</option><option value="members">Membros específicos</option>
      {allowOwner && <option value="owner">Responsável pelo negócio</option>}
    </select>
    {audience==='members' && <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
      {members.map(member=><label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={memberIds.includes(member.id)} onChange={e=>onChange(audience,e.target.checked?[...memberIds,member.id]:memberIds.filter(id=>id!==member.id))}/>{member.name}</label>)}
      {!members.length && <p className="text-xs text-muted-foreground">Nenhum membro ativo nesta organização.</p>}
    </div>}
    {audience==='members' && !memberIds.length && <p className="text-xs text-muted-foreground">Selecione ao menos um membro.</p>}
    {audience==='team' && <p className="text-xs text-muted-foreground">Cada membro ativo recebe sua própria tarefa.</p>}
  </fieldset>;
}
