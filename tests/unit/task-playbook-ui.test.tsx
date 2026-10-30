import { beforeEach,describe,expect,it,vi } from 'vitest';
import { render,screen,waitFor,cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '@/modules/engagement/components/tasks/TaskList';
import { TaskMoveGateProvider } from '@/modules/engagement/components/tasks/TaskMoveGate';
import { useTaskMoveGate } from '@/modules/engagement/components/tasks/task-move-context';
import { TaskDetails } from '@/modules/engagement/components/tasks/TaskDetails';
import type { WorkItem } from '@/modules/engagement/lib/task-types';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),error:vi.fn(),result:vi.fn(),org:'org-a'}));
vi.mock('@/modules/engagement/lib/task-api',()=>({taskRpc:mocks.rpc}));
vi.mock('@/modules/identity',()=>({useOrganization:()=>({organizationId:mocks.org}),useIdentity:()=>({userId:'bruno'})}));
vi.mock('@/shared/errors',()=>({notifyError:mocks.error}));
const task=(id:string,patch:Partial<WorkItem>={}):WorkItem=>({
  id,origin:'admin',priority:'medium',title:`Tarefa ${id}`,kind:'task',status:'pending',assignee_id:'bruno',assignee_name:'Bruno',pipeline_entry_id:'negocio',routine_id:null,
  instructions:'Leia a proposta antes de ligar.',message_template:'Olá, como ficou a proposta?',required:true,due_at:'2026-10-21T21:00:00Z',work_date:'2026-10-21',
  completed_at:null,result:null,lead_name:'Metalúrgica Alfa',lead_id:'lead',stage_name:'Proposta',pipeline_name:'Vendas',advanced_with_pending:false,overdue:false,...patch,
});
function MoveButton({entries='negocio'}:{entries?:string|string[]}) {
  const request=useTaskMoveGate();
  return <button onClick={async()=>mocks.result(await request(entries))}>Mover negócio</button>;
}
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.org='org-a';});
describe('execução da fila',()=>{
  it('unifica as origens na mesma lista, com títulos discretos e a execução na ordem exibida',async()=>{
    const onAction=vi.fn();
    render(<TaskList items={[task('admin'),task('pessoal',{origin:'member',pipeline_entry_id:null,required:false})]} myMemberId="bruno" onSelect={vi.fn()} onAction={onAction}/>);
    expect(screen.getAllByRole('list',{name:'Lista de tarefas'})).toHaveLength(1);
    expect(screen.getByRole('heading',{name:'Criadas por você'})).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Criadas pelo admin'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Começar'}));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id:'pessoal'}),'start');
  });
  it('mostra ações somente para o responsável e deixa o admin consultar as alheias',async()=>{
    const onAction=vi.fn();
    render(<TaskList items={[task('minha'),task('outra',{assignee_id:'ana',assignee_name:'Ana'})]} myMemberId="bruno" onSelect={vi.fn()} onAction={onAction}/>);
    expect(screen.getAllByRole('button',{name:/Começar|Iniciar/})).toHaveLength(1);
    await userEvent.click(screen.getByRole('button',{name:'Começar'}));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({id:'minha'}),'start');
  });
  it('mantém a execução focada na tarefa em andamento',()=>{
    render(<TaskList items={[task('atual',{status:'in_progress'}),task('seguinte')]} myMemberId="bruno" onSelect={vi.fn()} onAction={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'Concluir'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Iniciar'})).toBeDisabled();
  });
  it('histórico não oferece execução e identifica a rotina não feita',()=>{
    render(<TaskList items={[task('ontem',{status:'missed',routine_id:'rotina'})]} myMemberId="bruno" onSelect={vi.fn()} onAction={vi.fn()}/>);
    expect(screen.getByText('Não feita')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Começar|Iniciar|Concluir/})).not.toBeInTheDocument();
  });
  it('detalhe apresenta a orientação e registra o resultado sem enviar mensagens',async()=>{
    const complete=vi.fn();
    render(<TaskDetails item={task('ligar')} timezone="America/Sao_Paulo" canComplete busy={false} onClose={vi.fn()} onComplete={complete}/>);
    expect(screen.getByText('Leia a proposta antes de ligar.')).toBeInTheDocument();
    expect(screen.getByText('Olá, como ficou a proposta?')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox',{name:/Resultado/}),'Cliente pediu retorno amanhã');
    await userEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
    expect(complete).toHaveBeenCalledWith('Cliente pediu retorno amanhã');
  });
});
describe('motivo de avanço',()=>{
  it('não libera o movimento ao trocar de organização durante a consulta das entradas',async()=>{
    let resolveEntries!:(ids:string[])=>void;
    mocks.rpc.mockReturnValueOnce(new Promise<string[]>(resolve=>{resolveEntries=resolve;}));
    function CrossPipeButton(){const request=useTaskMoveGate();return <button onClick={async()=>mocks.result(await request({pipelineId:'pipe',leadIds:['lead']}))}>Consultar entradas</button>;}
    const view=render(<TaskMoveGateProvider><CrossPipeButton/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Consultar entradas'}));
    mocks.org='org-b';view.rerender(<TaskMoveGateProvider><CrossPipeButton/></TaskMoveGateProvider>);
    resolveEntries([]);
    await waitFor(()=>expect(mocks.result).toHaveBeenCalledWith(false));
  });
  it('lote pede um só motivo e autoriza os negócios juntos',async()=>{
    mocks.rpc.mockResolvedValueOnce([{id:'t1',title:'Ligar',lead_name:'Alfa'},{id:'t2',title:'Enviar proposta',lead_name:'Beta'}]).mockResolvedValueOnce(null);
    render(<TaskMoveGateProvider><MoveButton entries={['a','b']}/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    await screen.findByText('Ligar · Alfa');
    await userEvent.type(screen.getByRole('textbox',{name:'Motivo'}),'Acordo do grupo');
    await userEvent.click(screen.getByRole('button',{name:'Registrar e avançar'}));
    await waitFor(()=>expect(mocks.result).toHaveBeenCalledWith(true));
    expect(mocks.rpc).toHaveBeenLastCalledWith('task_authorize_moves',{p_entries:['a','b'],p_reason:'Acordo do grupo'});
  });
  it('solicita um motivo e só libera o movimento depois que o banco confirma o registro',async()=>{
    mocks.rpc.mockResolvedValueOnce([{id:'t1',title:'Ligar para confirmar'}]).mockResolvedValueOnce(null);
    render(<TaskMoveGateProvider><MoveButton/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    const confirm=await screen.findByRole('button',{name:'Registrar e avançar'});
    expect(confirm).toBeDisabled();expect(mocks.result).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox',{name:'Motivo'}),'Cliente solicitou avanço');
    await userEvent.click(confirm);
    await waitFor(()=>expect(mocks.result).toHaveBeenCalledWith(true));
    expect(mocks.rpc).toHaveBeenLastCalledWith('task_authorize_move',{p_entry:'negocio',p_reason:'Cliente solicitou avanço'});
  });
  it('cancelamento não autoriza nem move o negócio',async()=>{
    mocks.rpc.mockResolvedValueOnce([{id:'t1',title:'Ligar'}]);
    render(<TaskMoveGateProvider><MoveButton/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    await userEvent.click(await screen.findByRole('button',{name:'Voltar'}));
    await waitFor(()=>expect(mocks.result).toHaveBeenCalledWith(false));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('falha de rede impede avanço; ausência da migration permite o fluxo legado',async()=>{
    mocks.rpc.mockRejectedValueOnce({code:'NETWORK'}).mockRejectedValueOnce({code:'PGRST202'});
    render(<TaskMoveGateProvider><MoveButton/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    await waitFor(()=>expect(mocks.result).toHaveBeenLastCalledWith(false));
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    await waitFor(()=>expect(mocks.result).toHaveBeenLastCalledWith(true));
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
  it('trocar organização cancela uma decisão pendente',async()=>{
    mocks.rpc.mockResolvedValueOnce([{id:'t1',title:'Ligar'}]);
    const view=render(<TaskMoveGateProvider><MoveButton/></TaskMoveGateProvider>);
    await userEvent.click(screen.getByRole('button',{name:'Mover negócio'}));
    await screen.findByRole('button',{name:'Registrar e avançar'});
    mocks.org='org-b';view.rerender(<TaskMoveGateProvider><MoveButton/></TaskMoveGateProvider>);
    await waitFor(()=>expect(mocks.result).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('button',{name:'Registrar e avançar'})).not.toBeInTheDocument();
  });
});
