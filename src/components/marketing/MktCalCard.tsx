import { useState } from "react";
import { useMktFunnel } from "@/hooks/useMktFunnel";
import { MktDashboardCard } from "./MktDashboardCard";
import { MktDashboardDetailSheet } from "./MktDashboardDetailSheet";

export interface MktCalCardProps {
  month?: number;
  year?: number;
}

export function MktCalCard({ month, year }: MktCalCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const { data, isLoading } = useMktFunnel("cal", month, year);

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
