import { useMemo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function useLeadAge(createdAt: string | null | undefined) {
  return useMemo(() => {
    if (!createdAt) return { relative: "—", absolute: "—" };
    const date = new Date(createdAt);
    return {
      relative: formatDistanceToNow(date, { addSuffix: true, locale: ptBR }),
      absolute: format(date, "dd MMM yyyy 'às' HH:mm", { locale: ptBR }),
    };
  }, [createdAt]);
}
