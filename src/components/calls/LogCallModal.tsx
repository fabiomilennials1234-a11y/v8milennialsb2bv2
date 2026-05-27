import { useState } from "react";
import { Phone, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogCall, OUTCOME_LABELS, type CallDirection, type CallOutcome } from "@/modules/engagement/hooks/useCallLogs";
import { cn } from "@/lib/utils";

interface LogCallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  leadName?: string;
  phoneNumber?: string;
}

const DIRECTION_OPTIONS: Array<{ value: CallDirection; label: string }> = [
  { value: "outbound", label: "Ligação realizada" },
  { value: "inbound", label: "Ligação recebida" },
];

const OUTCOME_OPTIONS: Array<{ value: CallOutcome; label: string }> = (
  Object.entries(OUTCOME_LABELS) as Array<[CallOutcome, string]>
).map(([value, label]) => ({ value, label }));

export function LogCallModal({ open, onOpenChange, leadId, leadName, phoneNumber }: LogCallModalProps) {
  const logCall = useLogCall();
  const [direction, setDirection] = useState<CallDirection>("outbound");
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [durationMin, setDurationMin] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState(phoneNumber ?? "");

  const handleSubmit = () => {
    logCall.mutate(
      {
        lead_id: leadId,
        direction,
        outcome,
        duration_seconds: durationMin ? Math.round(parseFloat(durationMin) * 60) : undefined,
        notes: notes.trim() || undefined,
        phone_number: phone.trim() || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDirection("outbound");
          setOutcome("connected");
          setDurationMin("");
          setNotes("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Registrar ligação
            {leadName && (
              <span className="text-sm font-normal text-muted-foreground">— {leadName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Direção</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as CallDirection)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Resultado</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input
                placeholder="(11) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Duração (min)
              </Label>
              <Input
                type="number"
                placeholder="5"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                className="h-9"
                min="0"
                step="0.5"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <Textarea
              placeholder="Resumo da ligação..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>

          <Button onClick={handleSubmit} className="w-full gap-2" disabled={logCall.isPending}>
            {logCall.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
            Registrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
