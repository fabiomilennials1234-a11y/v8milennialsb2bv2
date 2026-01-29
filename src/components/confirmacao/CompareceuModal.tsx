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
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { Loader2, Users, UserCheck } from "lucide-react";

interface CompareceuModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sdrId: string | null, closerId: string | null) => void;
  leadName: string;
  currentSdrId?: string | null;
  currentCloserId?: string | null;
  isLoading?: boolean;
}

export function CompareceuModal({
  open,
  onOpenChange,
  onConfirm,
  leadName,
  currentSdrId,
  currentCloserId,
  isLoading,
}: CompareceuModalProps) {
  const { data: teamMembers } = useTeamMembers();
  const [sdrId, setSdrId] = useState<string | null>(null);
  const [closerId, setCloserId] = useState<string | null>(null);

  // Sync state when modal opens or currentIds change
  useEffect(() => {
    if (open) {
      setSdrId(currentSdrId || null);
      setCloserId(currentCloserId || null);
    }
  }, [open, currentSdrId, currentCloserId]);

  const sdrs = teamMembers?.filter((m) => m.role === "sdr" && m.is_active) || [];
  const closers = teamMembers?.filter((m) => m.role === "closer" && m.is_active) || [];

  const handleConfirm = () => {
    onConfirm(sdrId, closerId);
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
            <strong>{leadName}</strong> compareceu à reunião. Selecione o SDR e
            Closer responsáveis para criar a proposta.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                SDR Responsável
              </Label>
              <Select
                value={sdrId || "none"}
                onValueChange={(v) => setSdrId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o SDR" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {sdrs.map((sdr) => (
                    <SelectItem key={sdr.id} value={sdr.id}>
                      {sdr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <UserCheck className="w-4 h-4" />
                Closer Responsável
              </Label>
              <Select
                value={closerId || "none"}
                onValueChange={(v) => setCloserId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o Closer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {closers.map((closer) => (
                    <SelectItem key={closer.id} value={closer.id}>
                      {closer.name}
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
