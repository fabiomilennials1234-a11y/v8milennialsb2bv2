/**
 * Dialog for creating internal meetings.
 *
 * Replaces the old Google-Calendar-only event creation form
 * with a richer internal meeting form that uses useCreateMeeting.
 */

import { useState, useEffect } from "react";
import { format, addHours } from "date-fns";
import {
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCreateMeeting,
  type MeetingEventType,
  type CreateMeetingInput,
} from "@/modules/engagement/hooks/useMeetings";
import { useTeamMembers } from "@/modules/identity";
import { LeadPorFunilPicker } from "./LeadPorFunilPicker";

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EVENT_TYPE_OPTIONS: Array<{ value: MeetingEventType; label: string }> = [
  { value: "meeting", label: "Reuniao" },
  { value: "call", label: "Ligacao" },
  { value: "follow_up", label: "Follow-up" },
  { value: "task", label: "Tarefa" },
  { value: "other", label: "Outro" },
];

const COLOR_OPTIONS = [
  { value: "", label: "Padrao", hex: "hsl(47, 100%, 50%)" },
  { value: "#10B981", label: "Emerald", hex: "#10B981" },
  { value: "#3B82F6", label: "Blue", hex: "#3B82F6" },
  { value: "#8B5CF6", label: "Violet", hex: "#8B5CF6" },
  { value: "#EC4899", label: "Pink", hex: "#EC4899" },
  { value: "#F97316", label: "Orange", hex: "#F97316" },
  { value: "#06B6D4", label: "Cyan", hex: "#06B6D4" },
  { value: "#E67C73", label: "Flamingo", hex: "#E67C73" },
  { value: "#D50000", label: "Red", hex: "#D50000" },
];

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled slot start (set when clicking a time grid slot). */
  initialStart?: Date;
  /**
   * Lead já escolhido — quando o diálogo é aberto de FORA da Agenda (card do
   * funil, ficha do lead) e a pessoa já disse de quem é a reunião.
   *
   * O `LeadPorFunilPicker` resolve o chip sozinho por `useLeadById`, então
   * mandar só o id basta: o funil fica em branco e continua editável. Vem sem
   * `pipeline_id` de propósito — o card sabe o lead, e adivinhar o funil
   * gravaria uma origem que a pessoa não escolheu.
   */
  initialLeadId?: string | null;
  /**
   * Nome do lead, só para semear o título.
   *
   * `handleSubmit` EXIGE título não-vazio (`!form.title.trim()` bloqueia). Sem
   * semear, quem abre pelo card cai num diálogo com o botão morto e sem dizer
   * por quê — o mesmo defeito de "botão que não faz nada" que o campo de data
   * já teve aqui.
   */
  initialLeadName?: string | null;
  /**
   * Funil de onde o diálogo foi aberto — S6.
   *
   * Quem abre pelo CARD DO FUNIL já está dentro de um funil; sem receber isso o
   * picker abriria "Nenhum funil" e o negócio nunca seria resolvido (o negócio
   * sai da ENTRADA, e a entrada só existe dentro de um funil). Com o par
   * (funil, lead) semeado, a resolução acontece sem clique nenhum.
   *
   * NÃO existe `initialDealId` de propósito: quem resolve o negócio é SEMPRE o
   * picker, a partir do par. Um só resolvedor no app é o que garante que o caso
   * ambíguo tenha sempre uma pessoa na frente dele.
   */
  initialPipelineId?: string | null;
}

interface FormState {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  event_type: MeetingEventType;
  /** Funil de onde o lead sai. `""` = nenhum. */
  pipeline_id: string;
  lead_id: string;
  /** Negócio resolvido pelo picker a partir do par (funil, lead). `""` = nenhum. */
  deal_id: string;
  color: string;
  meet_link: string;
  participant_ids: string[];
}

const FORM_VAZIO: Omit<FormState, "start_at" | "end_at"> = {
  title: "",
  description: "",
  location: "",
  all_day: false,
  event_type: "meeting",
  pipeline_id: "",
  lead_id: "",
  deal_id: "",
  color: "",
  meet_link: "",
  participant_ids: [],
};

/**
 * Título inicial quando a reunião nasce de um lead conhecido.
 *
 * "Reunião - <lead>" é o mesmo formato que a Agenda já mostra no popover, e
 * fica editável. Sem lead, volta a string vazia — o campo é obrigatório e o
 * placeholder pede o título.
 */
function tituloSemeado(leadName: string | null | undefined): string {
  const nome = (leadName ?? "").trim();
  return nome ? `Reuniao - ${nome}` : "";
}

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function CreateMeetingDialog({
  open,
  onOpenChange,
  initialStart,
  initialLeadId,
  initialLeadName,
  initialPipelineId,
}: CreateMeetingDialogProps) {
  const createMeeting = useCreateMeeting();
  const { data: teamMembers = [] } = useTeamMembers();

  const defaultStart = initialStart ?? new Date();

  const [form, setForm] = useState<FormState>({
    ...FORM_VAZIO,
    lead_id: initialLeadId ?? "",
    pipeline_id: initialPipelineId ?? "",
    title: tituloSemeado(initialLeadName),
    start_at: format(defaultStart, "yyyy-MM-dd'T'HH:mm"),
    end_at: format(addHours(defaultStart, 1), "yyyy-MM-dd'T'HH:mm"),
  });

  // Reset form when dialog opens or the seeded values change.
  //
  // ⚠️ `initialLeadId`/`initialLeadName` PRECISAM estar nas deps: o mesmo
  // diálogo é montado uma vez por superfície e reaberto para leads diferentes.
  // Sem elas, abrir pelo segundo card traria o lead do primeiro — e o campo é
  // editável, então nada na tela denunciaria a troca.
  useEffect(() => {
    if (open) {
      const start = initialStart ?? new Date();
      setForm({
        ...FORM_VAZIO,
        lead_id: initialLeadId ?? "",
        pipeline_id: initialPipelineId ?? "",
        title: tituloSemeado(initialLeadName),
        start_at: format(start, "yyyy-MM-dd'T'HH:mm"),
        end_at: format(addHours(start, 1), "yyyy-MM-dd'T'HH:mm"),
      });
    }
  }, [open, initialStart, initialLeadId, initialLeadName, initialPipelineId]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleParticipant = (id: string) => {
    setForm((prev) => ({
      ...prev,
      participant_ids: prev.participant_ids.includes(id)
        ? prev.participant_ids.filter((pid) => pid !== id)
        : [...prev.participant_ids, id],
    }));
  };

  const endBeforeStart =
    !form.all_day && new Date(form.end_at) <= new Date(form.start_at);

  /**
   * 🚨 HERDADO, corrigido junto porque é o mesmo defeito do diálogo de edição e
   * a expressão é copiada entre os dois: `endBeforeStart` NÃO cobre campo
   * vazio. `<input type="datetime-local">` devolve `""` quando a pessoa apaga a
   * data para redigitar, e comparação com `Invalid Date` é `false` nos DOIS
   * sentidos — o botão continuava habilitado e o clique morria em
   * `new Date("").toISOString() → RangeError`, dentro de um event handler, que
   * nenhum error boundary pega. Resultado: "Criar Evento" virava um botão que
   * não faz nada e não explica.
   */
  const dataInvalida =
    Number.isNaN(new Date(form.start_at).getTime()) ||
    Number.isNaN(new Date(form.end_at).getTime());

  const handleSubmit = () => {
    if (!form.title.trim() || endBeforeStart || dataInvalida) return;

    const input: CreateMeetingInput = {
      title: form.title.trim(),
      description: form.description || null,
      location: form.location || null,
      start_at: new Date(form.start_at).toISOString(),
      end_at: new Date(form.end_at).toISOString(),
      all_day: form.all_day,
      event_type: form.event_type,
      lead_id: form.lead_id || null,
      // Sem lead não há funil a guardar: gravar o funil sozinho deixaria a
      // reunião afirmando uma origem que não aponta para ninguém.
      pipeline_id: form.lead_id ? form.pipeline_id || null : null,
      // Mesma regra, um degrau acima: o negócio é a ENTRADA do lead NAQUELE
      // funil. Sem os dois não há o que ele signifique, e gravá-lo assim mesmo
      // penduraria a reunião num card que ninguém escolheu.
      deal_id:
        form.lead_id && form.pipeline_id ? form.deal_id || null : null,
      color: form.color || null,
      meet_link: form.meet_link || null,
      participant_ids:
        form.participant_ids.length > 0 ? form.participant_ids : undefined,
    };

    createMeeting.mutate(input, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-primary" />
            </div>
            Nova atividade
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title" className="text-xs text-muted-foreground">
              Titulo *
            </Label>
            <Input
              id="meeting-title"
              placeholder="Nome do evento"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              autoFocus
            />
          </div>

          {/* Event type */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("event_type", opt.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    form.event_type === opt.value
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* All day toggle + datetime */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
            <Label className="text-xs text-muted-foreground flex-1">Dia todo</Label>
            <Switch
              checked={form.all_day}
              onCheckedChange={(v) => update("all_day", v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="meeting-start"
                className="text-xs text-muted-foreground"
              >
                Inicio *
              </Label>
              <Input
                id="meeting-start"
                type={form.all_day ? "date" : "datetime-local"}
                value={
                  form.all_day
                    ? form.start_at.split("T")[0]
                    : form.start_at
                }
                onChange={(e) => {
                  if (form.all_day) {
                    update("start_at", `${e.target.value}T00:00`);
                  } else {
                    update("start_at", e.target.value);
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="meeting-end"
                className="text-xs text-muted-foreground"
              >
                Fim *
              </Label>
              <Input
                id="meeting-end"
                type={form.all_day ? "date" : "datetime-local"}
                value={
                  form.all_day
                    ? form.end_at.split("T")[0]
                    : form.end_at
                }
                onChange={(e) => {
                  if (form.all_day) {
                    update("end_at", `${e.target.value}T23:59`);
                  } else {
                    update("end_at", e.target.value);
                  }
                }}
              />
            </div>
          </div>
          {dataInvalida ? (
            <p className="text-[11px] text-destructive">
              Informe inicio e fim
            </p>
          ) : endBeforeStart ? (
            <p className="text-[11px] text-destructive">
              Fim deve ser depois do inicio
            </p>
          ) : null}

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Local</Label>
            <Input
              placeholder="Endereco ou link"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Descricao</Label>
            <Textarea
              placeholder="Notas sobre o evento..."
              rows={3}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>

          {/* Funil → Lead */}
          <LeadPorFunilPicker
            value={{
              pipelineId: form.pipeline_id || null,
              leadId: form.lead_id || null,
              dealId: form.deal_id || null,
            }}
            onChange={({ pipelineId, leadId, dealId }) =>
              setForm((prev) => ({
                ...prev,
                pipeline_id: pipelineId ?? "",
                lead_id: leadId ?? "",
                deal_id: dealId ?? "",
              }))
            }
          />

          {/* Participants */}
          {teamMembers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Participantes
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {teamMembers.map((member) => {
                  const selected = form.participant_ids.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleParticipant(member.id)}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all ${
                        selected
                          ? "border-primary bg-primary/10 text-foreground font-medium"
                          : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {member.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Color */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cor</Label>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => update("color", opt.value)}
                  title={opt.label}
                  className={`w-5 h-5 rounded-full border-2 transition-all flex-shrink-0 ${
                    form.color === opt.value
                      ? "border-foreground scale-125 shadow-sm"
                      : "border-transparent hover:scale-110"
                  }`}
                  style={{ backgroundColor: opt.hex }}
                />
              ))}
            </div>
          </div>

          {/* Meet link */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Link da reuniao (Meet / Zoom / etc)
            </Label>
            <Input
              placeholder="https://meet.google.com/..."
              value={form.meet_link}
              onChange={(e) => update("meet_link", e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createMeeting.isPending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={
                createMeeting.isPending ||
                !form.title.trim() ||
                endBeforeStart ||
                dataInvalida
              }
            >
              {createMeeting.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar atividade"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
