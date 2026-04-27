import { memo } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, LayoutDashboard } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface DashboardHeaderProps {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
}

function DashboardHeaderBase({ month, year, onMonthChange }: DashboardHeaderProps) {
  const { user } = useAuth();
  const userName = user?.user_metadata?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "Usuário";

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const monthDate = new Date(year, month - 1, 1);
  const monthLabel = format(monthDate, "MMMM yyyy", { locale: ptBR });

  const goToPrevMonth = () => {
    if (month === 1) {
      onMonthChange(12, year - 1);
    } else {
      onMonthChange(month - 1, year);
    }
  };

  const goToNextMonth = () => {
    if (month === 12) {
      onMonthChange(1, year + 1);
    } else {
      onMonthChange(month + 1, year);
    }
  };

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex items-center justify-between"
    >
      <div>
        <h1 className="text-2xl font-bold" style={{ letterSpacing: "-0.03em" }}>
          {greeting}, {userName}.
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Aqui está o panorama do seu mês.
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={goToPrevMonth}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="bg-card border border-border rounded-full px-4 py-1.5 min-w-[160px] text-center">
          <span className="text-sm font-medium capitalize">{monthLabel}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={goToNextMonth}
          disabled={isCurrentMonth}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}

export const DashboardHeader = memo(DashboardHeaderBase);
