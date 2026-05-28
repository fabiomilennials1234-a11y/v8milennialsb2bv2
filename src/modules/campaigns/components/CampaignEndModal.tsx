import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, Snowflake } from "lucide-react";
import { useCustomPipelines } from "@/modules/pipelines/hooks/useCustomPipelines";
import { usePipelineDisplayConfig } from "@/modules/pipelines/hooks/usePipelineDisplayConfig";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface CampaignEndModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignName: string;
  leadsCount: number;
}

export function CampaignEndModal({ open, onOpenChange, campaignId, campaignName, leadsCount }: CampaignEndModalProps) {
  const [action, setAction] = useState<"move" | "freeze">("freeze");
  const [targetPipeline, setTargetPipeline] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const { data: customPipes } = useCustomPipelines();
  const { data: displayConfig } = usePipelineDisplayConfig();

  const visiblePipes = (displayConfig ?? []).filter((c) => c.is_visible);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const endAction = action === "freeze"
        ? { type: "freeze" as const }
        : { type: "move_to_funnel" as const, pipeline_id: targetPipeline, stage_id: "" };

      const { error } = await supabase
        .from("campanhas")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          end_action: endAction,
          is_active: false,
        })
        .eq("id", campaignId);

      if (error) throw error;

      toast.success("Campanha encerrada com sucesso");
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao encerrar campanha: " + (err?.message || ""));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Encerrar Campanha
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            A campanha <strong>"{campaignName}"</strong> será encerrada.
            {leadsCount > 0 && (
              <> O que fazer com os <strong>{leadsCount} leads</strong> restantes?</>
            )}
          </p>

          {leadsCount > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setAction("freeze")}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${action === "freeze" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <Snowflake className="w-4 h-4" />
                  <span className="font-medium text-sm">Manter na campanha</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leads ficam congelados. A campanha fica acessível em modo leitura.</p>
              </button>

              <button
                onClick={() => setAction("move")}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${action === "move" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-medium text-sm">Mover para um funil</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leads são movidos para um funil estrutural da sua operação.</p>
              </button>

              {action === "move" && (
                <Select value={targetPipeline} onValueChange={setTargetPipeline}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {visiblePipes.map((p) => (
                      <SelectItem key={p.pipe_type} value={p.pipe_type}>{p.display_name}</SelectItem>
                    ))}
                    {(customPipes ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || (action === "move" && !targetPipeline)}
          >
            {isSubmitting ? "Encerrando..." : "Encerrar Campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
