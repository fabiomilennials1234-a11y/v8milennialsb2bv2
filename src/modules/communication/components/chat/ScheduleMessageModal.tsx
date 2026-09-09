import { useState, useRef } from "react";
import { format, addDays, nextMonday, isBefore, addMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, Paperclip, X, Image as ImageIcon, FileText, Music } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateScheduledMessage, useUpdateScheduledMessage } from "@/modules/communication/hooks/useScheduledMessages";

interface ScheduleMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
  initialMessage?: string;
  initialMediaFile?: File;
  editingId?: string;
  editingContent?: string;
  editingScheduledAt?: Date;
}

const MEDIA_ICON_MAP: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: ImageIcon,
  audio: Music,
  document: FileText,
};

function getMediaType(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function ScheduleMessageModal({
  open,
  onOpenChange,
  leadId,
  leadName,
  phoneNumber,
  instanceId,
  initialMessage = "",
  initialMediaFile,
  editingId,
  editingContent,
  editingScheduledAt,
}: ScheduleMessageModalProps) {
  const [message, setMessage] = useState(editingContent ?? initialMessage);
  const [mediaFile, setMediaFile] = useState<File | null>(initialMediaFile ?? null);
  const [date, setDate] = useState<Date | undefined>(editingScheduledAt);
  const [time, setTime] = useState(editingScheduledAt ? format(editingScheduledAt, "HH:mm") : "09:00");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useCreateScheduledMessage();
  const updateMutation = useUpdateScheduledMessage();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const scheduledDateTime = date
    ? (() => {
        const [h, m] = time.split(":").map(Number);
        const dt = new Date(date);
        dt.setHours(h, m, 0, 0);
        return dt;
      })()
    : null;

  // Validação separada por razão — um único `isValid` mascarava a causa real
  // (mensagem vazia culpava sempre a data). Cada flag alimenta seu próprio feedback.
  const hasContent = !!(message.trim() || mediaFile);
  const isDateInFuture =
    !!scheduledDateTime && isBefore(addMinutes(new Date(), 1), scheduledDateTime);
  // Em modo edição o anexo fica desabilitado e o textarea vazio significa "sem
  // alteração" — não "sem conteúdo". Gatear por hasContent travaria o re-save de um
  // agendamento só-mídia (o update nunca apaga a mídia persistida; mensagem vazia
  // vira `undefined` no handleSubmit e a mutation a ignora).
  const isValid = editingId ? isDateInFuture : hasContent && isDateInFuture;

  const handleSubmit = async () => {
    if (!scheduledDateTime || !isValid) return;

    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        messageContent: message.trim() || undefined,
        scheduledAt: scheduledDateTime,
      });
    } else {
      await createMutation.mutateAsync({
        leadId,
        phoneNumber,
        messageContent: message.trim() || undefined,
        mediaFile: mediaFile || undefined,
        scheduledAt: scheduledDateTime,
        instanceId,
      });
    }

    setMessage("");
    setMediaFile(null);
    setDate(undefined);
    setTime("09:00");
    onOpenChange(false);
  };

  const quickDates = [
    { label: "Amanhã 9h", getDate: () => { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Em 2 dias", getDate: () => { const d = addDays(new Date(), 2); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Seg 9h", getDate: () => { const d = nextMonday(new Date()); d.setHours(9, 0, 0, 0); return d; } },
    { label: "1 semana", getDate: () => { const d = addDays(new Date(), 7); d.setHours(9, 0, 0, 0); return d; } },
  ];

  const handleQuickDate = (getDate: () => Date) => {
    const d = getDate();
    setDate(d);
    setTime(format(d, "HH:mm"));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setMediaFile(file);
    e.target.value = "";
  };

  const MediaIcon = mediaFile ? MEDIA_ICON_MAP[getMediaType(mediaFile)] || FileText : FileText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* O mesmo formulário serve para criar e para editar. O título dizia
              "Agendar mensagem" nos dois casos, então quem abria a edição a
              partir da Agenda ou do chat lia um convite a criar um agendamento
              novo — e o botão embaixo já dizia "Salvar". */}
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            {editingId ? "Editar agendamento" : "Agendar mensagem"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Para {leadName}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mensagem + mídia */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escreva a mensagem..."
                rows={3}
                className="flex-1 bg-muted rounded-lg resize-none"
              />
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!!editingId}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />

            {mediaFile && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border border-border">
                <MediaIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {mediaFile.name}
                </span>
                <button
                  onClick={() => setMediaFile(null)}
                  className="p-0.5 rounded hover:bg-background"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>

          {/* Quick dates */}
          <div className="space-y-2">
            <p className="stat-card-label">Quando enviar</p>
            <div className="flex flex-wrap gap-2">
              {quickDates.map((qd) => {
                const targetDate = qd.getDate();
                const isSelected = date && scheduledDateTime &&
                  scheduledDateTime.getTime() === targetDate.getTime();

                return (
                  <Button
                    key={qd.label}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => handleQuickDate(qd.getDate)}
                  >
                    {qd.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Calendar + Time */}
          <div className="flex gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start gap-2 text-sm">
                  <Clock className="w-4 h-4" />
                  {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "Escolher data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  locale={ptBR}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-28"
            />
          </div>

          {scheduledDateTime && isValid && (
            <p className="text-xs text-muted-foreground">
              Sera enviada em{" "}
              <span className="font-medium text-foreground">
                {format(scheduledDateTime, "dd 'de' MMM 'as' HH:mm", { locale: ptBR })}
              </span>
            </p>
          )}

          {scheduledDateTime && !isDateInFuture && (
            <p className="text-xs text-destructive" role="alert">
              A data precisa ser no futuro (minimo 1 minuto a partir de agora)
            </p>
          )}

          {!editingId && isDateInFuture && !hasContent && (
            <p className="text-xs text-muted-foreground" role="status">
              Escreva uma mensagem ou anexe um arquivo para agendar.
            </p>
          )}

          {!editingId && hasContent && !scheduledDateTime && (
            <p className="text-xs text-muted-foreground" role="status">
              Escolha uma data e hora para agendar.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
          >
            {isPending ? "Agendando..." : editingId ? "Salvar" : "Agendar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
