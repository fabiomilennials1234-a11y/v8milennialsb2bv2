/** O nome projetado pela Agenda não tem o mesmo papel em todas as fontes. */
export function agendaAttributionLabel(source: string): string {
  if (source === "google") return "Agenda";
  if (source === "follow_up" || source === "pipe_confirmacao") return "Responsável";
  return "Agendado por";
}
