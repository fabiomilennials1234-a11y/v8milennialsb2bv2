import { z } from "zod";
import type { Tables } from "@/integrations/supabase/types";

export const TASK_STATUSES = ["a_fazer", "fazendo", "feito"] as const;
export type MasterTaskStatus = (typeof TASK_STATUSES)[number];
export const PROMPT_COMPLEXITIES = ["baixa", "media", "alta"] as const;
export type PromptComplexity = (typeof PROMPT_COMPLEXITIES)[number];
export type MasterTask = Omit<Tables<"master_tasks">, "status" | "prompt_complexity"> & { status: MasterTaskStatus; prompt_complexity: PromptComplexity };
export interface MasterTaskOwner { id: string; userId: string; name: string }
const OWNER_NAMES = ["Gabriel", "Marcelo", "Lucas"] as const;

/** Nomes confirmados no cadastro; os vínculos e o filtro sempre usam o ID real da conta. */
export function selectTaskOwners(staff: MasterTaskOwner[]): MasterTaskOwner[] {
  return OWNER_NAMES.flatMap(name => staff
    .filter(owner => owner.name.trim().split(/\s+/)[0].toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))
    .map(owner => ({ ...owner, name })));
}

export const TASK_LABELS: Record<MasterTaskStatus, string> = {
  a_fazer: "A fazer", fazendo: "Fazendo", feito: "Feito",
};
export const masterTaskSchema = z.object({
  title: z.string().trim().min(1, "Informe o título da tarefa.").max(200, "O título deve ter até 200 caracteres."),
  context: z.string().trim().max(5000, "O contexto deve ter até 5.000 caracteres."),
  prompt_complexity: z.enum(PROMPT_COMPLEXITIES),
  description: z.string().trim().max(10000, "A descrição deve ter até 10.000 caracteres."),
  status: z.enum(TASK_STATUSES),
  owner_master_user_id: z.string().uuid("Selecione o responsável pela tarefa."),
});
export type MasterTaskInput = z.infer<typeof masterTaskSchema>;

export function groupMasterTasks(tasks: readonly MasterTask[], search = ""): Record<MasterTaskStatus, MasterTask[]> {
  const grouped: Record<MasterTaskStatus, MasterTask[]> = { a_fazer: [], fazendo: [], feito: [] };
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const query = normalize(search.trim());
  for (const task of tasks) {
    if (!query || normalize(`${task.title} ${task.context} ${task.description}`).includes(query)) grouped[task.status].push(task);
  }
  return grouped;
}
