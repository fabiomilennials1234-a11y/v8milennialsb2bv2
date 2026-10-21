import { beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CardTarefasDoDia } from '@/modules/analytics/components/dashboard/v2/CardTarefasDoDia';
import { TaskAssignmentEditor } from '@/modules/engagement/components/tasks/TaskAssignmentEditor';
import Tarefas from '@/modules/engagement/pages/Tarefas';
import { personalTaskItems } from '@/modules/analytics/lib/comando-task-items';

const mocks=vi.hoisted(()=>({isAdmin:false,personalError:false,create:vi.fn(),complete:vi.fn(),reopen:vi.fn(),remove:vi.fn(),write:vi.fn(),queue:vi.fn(),config:vi.fn()}));
const mutation=(fn:ReturnType<typeof vi.fn>)=>({isPending:false,mutate:fn,mutateAsync:fn});
vi.mock('@/modules/identity',()=>({useIdentity:()=>({isAdmin:mocks.isAdmin,isReady:true,userId:'bruno-user',teamMemberId:'bruno'}),useOrganization:()=>({organizationId:'org-a',isReady:true,timezone:'America/Sao_Paulo'}),isVirtualTeamMember:()=>false}));
vi.mock('@/modules/engagement',()=>({
  useAcoesDoDia:()=>({data:mocks.personalError?undefined:[{id:'legacy',user_id:'bruno-user',organization_id:'org-a',title:'Tarefa que já existia',description:'Descrição original',is_completed:false,position:0,created_at:'2026-10-21T12:00:00Z',completed_at:null,lead_id:null}],isLoading:false,isError:mocks.personalError,refetch:vi.fn()}),
  useCreateAcaoDoDia:()=>mutation(mocks.create),useCompleteAcaoDoDia:()=>mutation(mocks.complete),useUncompleteAcaoDoDia:()=>mutation(mocks.reopen),useDeleteAcaoDoDia:()=>mutation(mocks.remove),
}));
vi.mock('@/modules/engagement/hooks/useTaskWorkspace',()=>({useTaskQueue:(...args:unknown[])=>mocks.queue(...args),useTaskWrite:()=>mutation(mocks.write),useTaskConfiguration:()=>{mocks.config();return {data:{members:[{id:'bruno',name:'Bruno'},{id:'ana',name:'Ana'}],activities:[],routines:[],stages:[]},isLoading:false,isError:false};}}));
vi.mock('@/modules/engagement/lib/task-api',()=>({taskRpc:vi.fn()}));
const assigned={id:'admin-task',origin:'admin',priority:'high',title:'Atividade atribuída pelo admin',kind:'task',status:'pending',assignee_id:'bruno',assignee_name:'Bruno',pipeline_entry_id:null,routine_id:null,instructions:'Confira a proposta',message_template:'',required:false,due_at:'2026-10-21T21:00:00Z',work_date:'2026-10-21',completed_at:null,result:null,lead_name:null,lead_id:null,stage_name:null,pipeline_name:null,advanced_with_pending:false,overdue:false};
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.isAdmin=false;mocks.personalError=false;mocks.create.mockResolvedValue({});mocks.complete.mockResolvedValue({});mocks.write.mockResolvedValue({});mocks.queue.mockReturnValue({data:{items:[assigned],total:1,overdue:0,overview:[]},isLoading:false,isError:false,refetch:vi.fn()});});
describe('tarefas no Comando',()=>{
  it('mantém as tarefas pessoais utilizáveis quando a consulta de atribuições falha',async()=>{
    mocks.queue.mockReturnValue({data:undefined,isLoading:false,isError:true,refetch:vi.fn()});
    render(<MemoryRouter><CardTarefasDoDia/></MemoryRouter>);
    expect(screen.getByText('Tarefa que já existia')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('atividades atribuídas pelo admin');
    await userEvent.type(screen.getByRole('textbox',{name:'Nova tarefa do dia'}),'Continuar trabalhando');
    await userEvent.click(screen.getByRole('button',{name:'Adicionar'}));
    expect(mocks.create).toHaveBeenCalledWith({title:'Continuar trabalhando'});
  });
  it('mantém atividades atribuídas quando a consulta das tarefas pessoais falha',()=>{
    mocks.personalError=true;render(<MemoryRouter><CardTarefasDoDia/></MemoryRouter>);
    expect(screen.getByText('Atividade atribuída pelo admin')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('tarefas pessoais');
  });
  it('reúne tarefas existentes e atribuídas na própria central, sem porta de gestão para membro',async()=>{
    render(<MemoryRouter><CardTarefasDoDia/></MemoryRouter>);
    expect(screen.getByText('Tarefa que já existia')).toBeInTheDocument();expect(screen.getByText('Atividade atribuída pelo admin')).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Criadas por você'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Criadas pelo admin'})).toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Gerenciar'})).not.toBeInTheDocument();
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({assigneeId:'bruno',enabled:true}));
    await userEvent.type(screen.getByRole('textbox',{name:'Nova tarefa do dia'}),'Anotar perguntas');await userEvent.click(screen.getByRole('button',{name:'Adicionar'}));
    expect(mocks.create).toHaveBeenCalledWith({title:'Anotar perguntas'});
    await userEvent.click(screen.getByRole('button',{name:'Começar'}));await userEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));expect(mocks.complete).toHaveBeenCalledWith('legacy');
  });
  it('admin também executa somente a própria fila no Comando e recebe acesso à gestão',()=>{
    mocks.isAdmin=true;render(<MemoryRouter><CardTarefasDoDia/></MemoryRouter>);
    expect(screen.getByRole('link',{name:/Gerenciar/})).toHaveAttribute('href','/tarefas');
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({assigneeId:'bruno'}));
    expect(screen.queryByText('Criadas pelos membros')).not.toBeInTheDocument();
  });
  it('membro não carrega configuração nem equipe pela rota de gestão',()=>{
    render(<MemoryRouter initialEntries={['/tarefas']}><Tarefas/></MemoryRouter>);
    expect(mocks.config).not.toHaveBeenCalled();expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('ações pessoais excluem outro usuário e outra organização, preservando legado próprio',()=>{
    const base={id:'p',user_id:'bruno-user',organization_id:'org-a',title:'Minha',description:null,is_completed:false,position:0,created_at:'2026-10-21T12:00:00Z',completed_at:null,lead_id:null,proposta_id:null,confirmacao_id:null,follow_up_id:null};
    const items=personalTaskItems([base,{...base,id:'outra-org',organization_id:'org-b'},{...base,id:'outro-user',user_id:'ana-user'},{...base,id:'antiga',organization_id:null}],'bruno-user','org-a','bruno','America/Sao_Paulo');
    expect(items.map(t=>t.daily_action_id)).toEqual(['p','antiga']);expect(items.every(t=>t.origin==='member' && t.assignee_id==='bruno')).toBe(true);
  });
  it('atribuição exige destinatários e envia seleção múltipla com prioridade',async()=>{
    render(<TaskAssignmentEditor members={[{id:'bruno',name:'Bruno'},{id:'ana',name:'Ana'}]} timezone="America/Sao_Paulo" onClose={vi.fn()}/>);
    const submit=screen.getByRole('button',{name:'Atribuir atividade'});expect(submit).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox',{name:'Título'}),'Conferir proposta');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Destinatários'}),'members');expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox',{name:'Bruno'}));await userEvent.click(screen.getByRole('checkbox',{name:'Ana'}));
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Prioridade'}),'high');await userEvent.click(submit);
    expect(mocks.write).toHaveBeenCalledWith({rpc:'task_assign',args:expect.objectContaining({p_title:'Conferir proposta',p_audience:'members',p_members:['bruno','ana'],p_priority:'high'})});
  });
});
