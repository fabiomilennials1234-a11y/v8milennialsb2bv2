import { z } from "zod";
import type { Tables } from "@/integrations/supabase/types";

export const TASK_STATUSES = ["a_fazer", "fazendo", "feito"] as const;
export type MasterTaskStatus = (typeof TASK_STATUSES)[number];
export type MasterTask = Omit<Tables<"master_tasks">, "status"> & { status: MasterTaskStatus };
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
  due_date: z.string().date("Informe uma data limite válida.").refine(value => value >= "0001-01-01", "Informe uma data limite válida."),
  estimated_minutes: z.number().int("Informe o tempo estimado em horas e minutos inteiros.").positive("Informe o tempo estimado para concluir a tarefa.").max(2147483647, "O tempo estimado é muito longo."),
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
    if (!query || normalize(`${task.title} ${task.description}`).includes(query)) grouped[task.status].push(task);
  }
  return grouped;
}

/** A data limite vale até o fim do dia em Brasília, independentemente do fuso do navegador. */
export function isMasterTaskOverdue(task: Pick<MasterTask, "due_date" | "status">, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return task.status !== "feito" && task.due_date < today;
}

export function formatTaskDueDate(date: string): string {
  return date.split("-").reverse().join("/");
}

export function formatTaskEstimate(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : "", remainder ? `${remainder}min` : ""].filter(Boolean).join(" ");
}
