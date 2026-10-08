import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyCompetitionStateProps {
  onCreateCompetition: () => void;
  canManage: boolean;
}

export function EmptyCompetitionState({
  onCreateCompetition,
  canManage,
}: EmptyCompetitionStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-card-border bg-card py-16 px-6 text-center shadow-relevo">
      <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Trophy className="h-5 w-5" />
      </span>

      <h3 className="text-sm font-semibold text-foreground mb-1">
        Nenhuma competição ativa
      </h3>

      <p className="text-[13px] text-muted-foreground max-w-sm mb-6">
        Crie uma competição para o mês e ative o ranking gamificado com prêmios
        por colocação.
      </p>

      {canManage && (
        <Button onClick={onCreateCompetition}>
          Criar Competição do Mês
        </Button>
      )}
    </div>
  );
}
