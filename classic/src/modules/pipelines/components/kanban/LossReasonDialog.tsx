/**
 * Diálogo "Marcar perdido" (ADR-0004, Slice 4).
 *
 * Escolhe o motivo de perda (loss_reasons da org) e confirma. O move pro stage
 * final_negative + gravação do loss_reason_id fica a cargo do onConfirm.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useLossReasons } from "../../hooks/config/useLossReasons";

export interface LossReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (lossReasonId: string | null) => void;
  pending?: boolean;
}

export function LossReasonDialog({ open, onOpenChange, onConfirm, pending }: LossReasonDialogProps) {
  const { data: reasons = [] } = useLossReasons();
  const [selected, setSelected] = useState<string>("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Marcar como perdido</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-xs">Motivo da perda</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um motivo" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(selected || null)}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Marcar perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
