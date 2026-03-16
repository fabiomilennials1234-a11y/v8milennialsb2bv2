import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { Loader2, UserCheck } from "lucide-react";

interface CompareceuModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (responsibleId: string | null) => void;
  leadName: string;
  currentResponsibleId?: string | null;
  isLoading?: boolean;
}

export function CompareceuModal({
  open,
  onOpenChange,
  onConfirm,
  leadName,
  currentResponsibleId,
  isLoading,
}: CompareceuModalProps) {
  const responsibleMembers = useResponsibleMembers();
  const [responsibleId, setResponsibleId] = useState<string | null>(null);

  // Sync state when modal opens or currentId changes
  useEffect(() => {
    if (open) {
      setResponsibleId(currentResponsibleId || null);
    }
  }, [open, currentResponsibleId]);

  const handleConfirm = () => {
    onConfirm(responsibleId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-green-500" />
            Confirmar Comparecimento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            <strong>{leadName}</strong> compareceu à reunião. Selecione o
            responsável para criar a proposta.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <UserCheck className="w-4 h-4" />
                Responsável
              </Label>
              <Select
                value={responsibleId || "none"}
                onValueChange={(v) => setResponsibleId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {responsibleMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            className="bg-green-500 hover:bg-green-600"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4 mr-2" />
                Confirmar e Criar Proposta
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
