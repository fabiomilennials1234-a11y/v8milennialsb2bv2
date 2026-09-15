import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { zonedDateParts } from "@/shared/time/zoned-day";
import { fetchMetricMeasure } from "./useMetricMeasure";

/** Medida da organização inteira, em minutos; null é ausência de respostas elegíveis. */
export async function fetchTeamResponseTime(args: {
  organizationId: string;
  start: Date;
  end: Date;
  timezone: string;
}): Promise<number | null> {
  const calendarDate = (date: Date) => {
    const { y, m, d } = zonedDateParts(date, args.timezone);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const response = await fetchMetricMeasure({ organizationId: args.organizationId,
    measureRef: { kind: "leaf", id: "tempo_resposta_equipe" }, recorte: "total",
    period: "range", start: calendarDate(args.start), end: calendarDate(args.end) });
  if (response === null) throw new Error("A medida de resposta está indisponível");
  return response.value == null || response.empty_reason ? null : response.value / 60;
}

/** Separada de receita/metas: indisponibilidade de mensagens não bloqueia o painel. */
export function useTeamResponseTime(range: { start: Date; end: Date }, enabled = true) {
  const { organizationId, timezone, isReady } = useOrganization();
  return useQuery({
    queryKey: ["team-response-time", organizationId, range.start.toISOString(), range.end.toISOString(), timezone],
    queryFn: () => fetchTeamResponseTime({ organizationId: organizationId!, ...range, timezone: timezone ?? "UTC" }),
    enabled: enabled && isReady && !!organizationId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
