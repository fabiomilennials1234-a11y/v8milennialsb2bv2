import { memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLeadTimeline } from "../../hooks/useLeadTimeline";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadDetailNotesProps {
  leadId: string;
  organizationId: string | null;
}

export const LeadDetailNotes = memo(function LeadDetailNotes({ leadId, organizationId }: LeadDetailNotesProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const timeline = useLeadTimeline(leadId);
  const noteEvents = timeline.data?.events.filter((e) => e.action === "note_added") || [];

  const handleSave = async () => {
    if (!note.trim()) return;
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: member } = user
        ? await supabase.from("team_members").select("name").eq("user_id", user.id).maybeSingle()
        : { data: null };
      const userName = member?.name || user?.email?.split("@")[0] || "Usuario";

      const { error } = await supabase.from("lead_history").insert({
        lead_id: leadId,
        action: "note_added",
        description: `${userName}: ${note.trim()}`,
        created_by: user?.id || null,
        organization_id: organizationId,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-history", leadId] });
      toast.success("Nota adicionada!");
      setNote("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao salvar nota";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Escreva uma nota..."
          rows={3}
          className="text-xs resize-none pr-12 bg-muted/30 border-border/30 focus-visible:bg-background"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-2 bottom-2 h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={handleSave}
          disabled={!note.trim() || isSaving}
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </Button>
      </div>

      <div className="space-y-2">
        {noteEvents.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <StickyNote className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground/60">Nenhuma nota ainda.</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Cmd+Enter para salvar</p>
          </div>
        ) : (
          noteEvents.map((event) => (
            <div key={event.id} className="rounded-lg bg-muted/30 border border-border/20 px-3.5 py-2.5">
              <p className="text-xs text-foreground/80 leading-relaxed">{event.description}</p>
              <p className="text-[9px] text-muted-foreground/40 mt-1.5 font-medium">
                {format(new Date(event.created_at), "dd MMM 'as' HH:mm", { locale: ptBR })}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
