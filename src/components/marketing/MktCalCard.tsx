import { useState } from "react";
import { useMktFunnel } from "@/hooks/useMktFunnel";
import { MktDashboardCard } from "./MktDashboardCard";
import { MktDashboardDetailSheet } from "./MktDashboardDetailSheet";

export function MktCalCard() {
  const [detailOpen, setDetailOpen] = useState(false);
  const { data, isLoading } = useMktFunnel("cal");

  return (
    <>
      <MktDashboardCard
        variant="cal"
        data={data ?? null}
        isLoading={isLoading}
        onViewDetails={() => setDetailOpen(true)}
      />
      <MktDashboardDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title="Marketing Call — Detalhes"
        description="Investimento, leads, agendamento, propostas e vendas (origem Cal.com)."
        variant="cal"
        data={data ?? null}
      />
    </>
  );
}
