/**
 * Modal leve para definir a data da reunião (ADR-0004, Slice 3).
 *
 * Grava só meeting_date (+ link opcional) na entry do funil mergeado — NÃO cria
 * entry de confirmacao nem evento de calendário (diferente do AddMeetingModal legacy).
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useSetMeetingDate } from "../../hooks/model/useSetMeetingDate";
import { useRescheduleMeeting } from "../../hooks/model/useMergedFunnelActions";

export interface SetMeetingDateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  /** "reschedule" volta o card pra `agendado` e reseta a confirmação. */
  variant?: "set" | "reschedule";
}

/** Combina o dia escolhido + "HH:mm" num instante (hora local do navegador). */
function combine(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export function SetMeetingDateModal({ open, onOpenChange, entryId, variant = "set" }: SetMeetingDateModalProps) {
  const [day, setDay] = useState<Date | undefined>();
  const [time, setTime] = useState("10:00");
  const [link, setLink] = useState("");
  const setMeetingDate = useSetMeetingDate();
  const reschedule = useRescheduleMeeting();
  const pending = setMeetingDate.isPending || reschedule.isPending;

  const save = () => {
    if (!day) return;
    const meetingDate = combine(day, time).toISOString();
    if (variant === "reschedule") {
      reschedule.mutate({ entryId, meetingDate }, { onSuccess: () => onOpenChange(false) });
    } else {
      setMeetingDate.mutate(
        { entryId, meetingDate, meetLink: link.trim() || null },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{variant === "reschedule" ? "Remarcar reunião" : "Definir data da reunião"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Data</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !day && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {day ? format(day, "dd 'de' MMMM, yyyy", { locale: ptBR }) : "Escolher data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={day} onSelect={setDay} initialFocus locale={ptBR} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Hora</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Link da reunião <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input placeholder="meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!day || pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {variant === "reschedule" ? "Remarcar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
