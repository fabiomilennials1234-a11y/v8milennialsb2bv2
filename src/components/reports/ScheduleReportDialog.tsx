import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Calendar, Clock, Mail, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

interface ScheduleReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  reportName: string;
}

type Frequency = "daily" | "weekly" | "monthly";

const DAY_OF_WEEK = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Segunda" },
  { value: "2", label: "Terça" },
  { value: "3", label: "Quarta" },
  { value: "4", label: "Quinta" },
  { value: "5", label: "Sexta" },
  { value: "6", label: "Sábado" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00`,
}));

export function ScheduleReportDialog({
  open,
  onOpenChange,
  reportId,
  reportName,
}: ScheduleReportDialogProps) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [hour, setHour] = useState("8");
  const [isActive, setIsActive] = useState(true);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");

  const addRecipient = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Email inválido");
      return;
    }
    if (recipients.includes(email)) {
      toast.error("Email já adicionado");
      return;
    }
    setRecipients((prev) => [...prev, email]);
    setEmailInput("");
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const createSchedule = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        report_id: reportId,
        organization_id: organizationId!,
        frequency,
        hour: Number(hour),
        timezone: "America/Sao_Paulo",
        recipients: JSON.stringify(recipients),
        is_active: isActive,
      };

      if (frequency === "weekly") {
        payload.day_of_week = Number(dayOfWeek);
      }
      if (frequency === "monthly") {
        payload.day_of_month = Number(dayOfMonth);
      }

      const { error } = await (supabase.from as any)("report_schedules").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento criado");
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(`Erro ao criar agendamento: ${err.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Agendar Envio
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-3">
            Relatório: <span className="font-medium text-foreground">{reportName}</span>
          </div>

          {/* Frequency */}
          <div>
            <Label>Frequência</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Day of Week (weekly) */}
          {frequency === "weekly" && (
            <div>
              <Label>Dia da Semana</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OF_WEEK.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Day of Month (monthly) */}
          {frequency === "monthly" && (
            <div>
              <Label>Dia do Mês</Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Hour */}
          <div>
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Horário
            </Label>
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Recipients */}
          <div>
            <Label className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Destinatários
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
                placeholder="email@exemplo.com"
                type="email"
              />
              <Button variant="outline" size="sm" onClick={addRecipient} className="flex-shrink-0">
                Adicionar
              </Button>
            </div>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-md"
                  >
                    {email}
                    <button onClick={() => removeRecipient(email)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativo</Label>
              <p className="text-xs text-muted-foreground">
                Envios começam imediatamente se ativado
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createSchedule.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => createSchedule.mutate()}
            disabled={createSchedule.isPending || recipients.length === 0}
          >
            {createSchedule.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
