/** Narrow public surface: tasks do not import the pipeline/leads module barrels. */
export { useTaskQueue,useTaskWrite } from './hooks/useTaskWorkspace';
export { TaskMoveGateProvider } from './components/tasks/TaskMoveGate';
export { useTaskMoveGate } from './components/tasks/task-move-context';
export { DealTasks } from './components/tasks/DealTasks';
export { TaskList } from './components/tasks/TaskList';
export { TaskDetails } from './components/tasks/TaskDetails';
export type { WorkItem,TaskQueue } from './lib/task-types';
