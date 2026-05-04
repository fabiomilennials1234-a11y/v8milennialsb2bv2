/**
 * Dialog for creating internal meetings.
 *
 * Replaces the old Google-Calendar-only event creation form
 * with a richer internal meeting form that uses useCreateMeeting.
 */

import { useState, useEffect, useMemo } from "react";
import { format, addHours } from "date-fns";
import {
  Plus,
  Loader2,
  Search,
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
} from "@/hooks/useMeetings";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useLeads } from "@/hooks/useLeads";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled slot start (set when clicking a time grid slot). */
  initialStart?: Date;
}

interface FormState {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  event_type: MeetingEventType;
  lead_id: string;
  color: string;
  meet_link: string;
  participant_ids: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateMeetingDialog({
  open,
  onOpenChange,
  initialStart,
}: CreateMeetingDialogProps) {
  const createMeeting = useCreateMeeting();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: leadsRaw } = useLeads();
  const leads = useMemo(() => leadsRaw ?? [], [leadsRaw]);

  const [leadSearch, setLeadSearch] = useState("");
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);

  const defaultStart = initialStart ?? new Date();

  const [form, setForm] = useState<FormState>({
    title: "",
    description: "",
    location: "",
    start_at: format(defaultStart, "yyyy-MM-dd'T'HH:mm"),
    end_at: format(addHours(defaultStart, 1), "yyyy-MM-dd'T'HH:mm"),
    all_day: false,
    event_type: "meeting",
    lead_id: "",
    color: "",
    meet_link: "",
    participant_ids: [],
  });

  // Reset form when dialog opens or initialStart changes
  useEffect(() => {
    if (open) {
      const start = initialStart ?? new Date();
      setForm({
        title: "",
        description: "",
        location: "",
        start_at: format(start, "yyyy-MM-dd'T'HH:mm"),
        end_at: format(addHours(start, 1), "yyyy-MM-dd'T'HH:mm"),
        all_day: false,
        event_type: "meeting",
        lead_id: "",
        color: "",
        meet_link: "",
        participant_ids: [],
      });
      setLeadSearch("");
      setShowLeadDropdown(false);
    }
  }, [open, initialStart]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const filteredLeads = useMemo(() => {
    if (!leadSearch.trim()) return leads.slice(0, 10);
    const q = leadSearch.toLowerCase();
    return leads
      .filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [leads, leadSearch]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === form.lead_id),
    [leads, form.lead_id],
  );

  const toggleParticipant = (id: string) => {
    setForm((prev) => ({
      ...prev,
      participant_ids: prev.participant_ids.includes(id)
        ? prev.participant_ids.filter((pid) => pid !== id)
        : [...prev.participant_ids, id],
    }));
  };

  const handleSubmit = () => {
    if (!form.title.trim()) return;

    const input: CreateMeetingInput = {
      title: form.title.trim(),
      description: form.description || null,
      location: form.location || null,
      start_at: new Date(form.start_at).toISOString(),
      end_at: new Date(form.end_at).toISOString(),
      all_day: form.all_day,
      event_type: form.event_type,
      lead_id: form.lead_id || null,
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
            Novo Evento
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
              <Label className="text-xs text-muted-foreground">Inicio *</Label>
              <Input
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
              <Label className="text-xs text-muted-foreground">Fim *</Label>
              <Input
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

          {/* Lead selector */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Lead</Label>
            {selectedLead ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-muted/20">
                <span className="text-xs text-foreground flex-1 truncate">
                  {selectedLead.name}
                  {selectedLead.company ? ` - ${selectedLead.company}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    update("lead_id", "");
                    setLeadSearch("");
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="text-xs">Limpar</span>
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                  <Input
                    placeholder="Buscar lead..."
                    className="pl-8"
                    value={leadSearch}
                    onChange={(e) => {
                      setLeadSearch(e.target.value);
                      setShowLeadDropdown(true);
                    }}
                    onFocus={() => setShowLeadDropdown(true)}
                    onBlur={() =>
                      setTimeout(() => setShowLeadDropdown(false), 200)
                    }
                  />
                </div>
                {showLeadDropdown && filteredLeads.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-card border border-border/50 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {filteredLeads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          update("lead_id", lead.id);
                          setLeadSearch("");
                          setShowLeadDropdown(false);
                        }}
                      >
                        <span className="text-foreground">{lead.name}</span>
                        {lead.company && (
                          <span className="text-muted-foreground ml-1.5">
                            - {lead.company}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

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
              disabled={createMeeting.isPending || !form.title.trim()}
            >
              {createMeeting.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Evento"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
