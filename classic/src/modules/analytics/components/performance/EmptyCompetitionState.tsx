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
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <Trophy className="w-16 h-16 text-muted-foreground/30 mb-6" />

      <h3 className="text-lg font-semibold text-foreground mb-2">
        Nenhuma competição ativa
      </h3>

      <p className="text-sm text-muted-foreground max-w-sm mb-8">
        Crie uma competição para o mês e ative o ranking gamificado com prêmios
        por colocação.
      </p>

      {canManage && (
        <Button onClick={onCreateCompetition} size="lg">
          Criar Competição do Mês
        </Button>
      )}
    </div>
  );
}
