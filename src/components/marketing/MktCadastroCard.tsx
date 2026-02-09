import { useState } from "react";
import { useMktFunnel } from "@/hooks/useMktFunnel";
import { MktDashboardCard } from "./MktDashboardCard";
import { MktDashboardDetailSheet } from "./MktDashboardDetailSheet";

export interface MktCadastroCardProps {
  month?: number;
  year?: number;
}

export function MktCadastroCard({ month, year }: MktCadastroCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const { data, isLoading } = useMktFunnel("cadastro_lp", month, year);

  return (
    <>
      <MktDashboardCard
        variant="cadastro"
        data={data ?? null}
        isLoading={isLoading}
        onViewDetails={() => setDetailOpen(true)}
      />
      <MktDashboardDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title="Marketing Cadastro — Detalhes"
        description="Investimento, leads, agendamento, propostas e vendas (origem cadastro/LP)."
        variant="cadastro"
        data={data ?? null}
      />
    </>
  );
}
