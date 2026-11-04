import { createContext,useCallback,useContext } from 'react';
export type TaskMoveSource=string|string[]|{leadIds:string[];pipelineId:string};
export type RequestTaskMove = (source:TaskMoveSource)=>Promise<boolean>;
export const TaskMoveContext=createContext<RequestTaskMove|null>(null);
export function useTaskMoveGate():RequestTaskMove {
  const request=useContext(TaskMoveContext);
  // Isolated embeds still reach the database guard, which rejects unrecorded exceptions.
  return useCallback(async(source:TaskMoveSource)=>request?request(source):true,[request]);
}
