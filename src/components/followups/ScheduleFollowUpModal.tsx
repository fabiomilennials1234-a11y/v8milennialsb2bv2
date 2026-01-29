import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateFollowUp } from "@/hooks/useFollowUps";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { cn } from "@/lib/utils";

interface ScheduleFollowUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  sourcePipe?: "whatsapp" | "confirmacao" | "propostas";
  sourcePipeId?: string;
  defaultAssignedTo?: string;
}

export function ScheduleFollowUpModal({
  open,
  onOpenChange,
  leadId,
  leadName,
  sourcePipe,
  sourcePipeId,
  defaultAssignedTo,
}: ScheduleFollowUpModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<Date>();
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [assignedTo, setAssignedTo] = useState(defaultAssignedTo || "");

  const { data: teamMembers } = useTeamMembers();
  const createFollowUp = useCreateFollowUp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !title) return;

    await createFollowUp.mutateAsync({
      lead_id: leadId,
      assigned_to: assignedTo || undefined,
      title,
      description: description || undefined,
      due_date: date.toISOString(),
      priority,
      source_pipe: sourcePipe,
      source_pipe_id: sourcePipeId,
    });

    // Reset form
    setTitle("");
    setDescription("");
    setDate(undefined);
    setPriority("normal");
    onOpenChange(false);
  };

  const quickDates = [
    { label: "Hoje", days: 0 },
    { label: "Amanhã", days: 1 },
    { label: "Em 3 dias", days: 3 },
    { label: "Em 1 semana", days: 7 },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Agendar Follow Up
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lead info */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-sm font-medium">{leadName}</p>
            {sourcePipe && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Via: {sourcePipe === "whatsapp" ? "WhatsApp" : sourcePipe === "confirmacao" ? "Confirmação" : "Propostas"}
              </p>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label>Título da tarefa *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para acompanhar proposta"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes adicionais sobre o follow up..."
              rows={2}
            />
          </div>

          {/* Quick date buttons */}
          <div className="space-y-2">
            <Label>Data do follow up *</Label>
            <div className="flex flex-wrap gap-2">
              {quickDates.map((qd) => {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() + qd.days);
                targetDate.setHours(9, 0, 0, 0);
                
                const isSelected = date && 
                  date.toDateString() === targetDate.toDateString();

                return (
                  <Button
                    key={qd.label}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDate(targetDate)}
                  >
                    {qd.label}
                  </Button>
                );
              })}
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {date ? format(date, "dd/MM", { locale: ptBR }) : "Escolher"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    locale={ptBR}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Priority and Assigned to */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v: typeof priority) => setPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers?.filter(m => m.is_active).map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!date || !title || createFollowUp.isPending}
            >
              {createFollowUp.isPending ? "Salvando..." : "Agendar Follow Up"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
