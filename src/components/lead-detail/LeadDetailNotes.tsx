import { memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLeadTimeline } from "@/hooks/useLeadTimeline";
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
      const userName = member?.name || user?.email?.split("@")[0] || "Usuário";

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
    <div>
      <div className="flex gap-2 mb-4">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Adicionar nota..."
          rows={2}
          className="text-xs resize-none"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-auto shrink-0"
          onClick={handleSave}
          disabled={!note.trim() || isSaving}
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <div className="space-y-2">
        {noteEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhuma nota ainda.</p>
        ) : (
          noteEvents.map((event) => (
            <div key={event.id} className="bg-muted/30 rounded-md p-2.5">
              <p className="text-xs text-foreground/70">{event.description}</p>
              <p className="text-[9px] text-muted-foreground/50 mt-1">
                {format(new Date(event.created_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
