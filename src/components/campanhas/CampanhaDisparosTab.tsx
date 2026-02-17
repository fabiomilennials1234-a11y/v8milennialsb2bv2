import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CampanhaDispatchRulesSection } from "./CampanhaDispatchRulesSection";
import { CampanhaPipeAutomationsSection } from "./CampanhaPipeAutomationsSection";
import { CampanhaSemiAutomaticaPanel } from "./CampanhaSemiAutomaticaPanel";
import { CampanhaAutomaticaPanel } from "./CampanhaAutomaticaPanel";
import { CreateTemplateModal } from "./CreateTemplateModal";
import type { Campanha, CampanhaStage } from "@/hooks/useCampanhas";
import {
  useCampanhaTemplates,
  useCampaignTemplates,
  useAddTemplateToCampanha,
  useRemoveTemplateFromCampanha,
} from "@/hooks/useCampaignTemplates";
import { FileText, Send, Zap, Plus, Link2, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";

interface CampanhaDisparosTabProps {
  campanha: Campanha;
  stages: CampanhaStage[];
}

export function CampanhaDisparosTab({ campanha, stages }: CampanhaDisparosTabProps) {
  const [activeSubTab, setActiveSubTab] = useState("templates");
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [linkTemplateId, setLinkTemplateId] = useState<string>("");

  const { data: campanhaTemplates = [] } = useCampanhaTemplates(campanha.id);
  const { data: allTemplates = [] } = useCampaignTemplates();
  const addToCampanha = useAddTemplateToCampanha();
  const removeFromCampanha = useRemoveTemplateFromCampanha();

  // Templates not yet linked to this campaign
  const availableTemplates = allTemplates.filter(
    (t) => !campanhaTemplates.some((ct) => ct.template_id === t.id)
  );

  const handleCreateAndLink = async (templateId: string) => {
    try {
      await addToCampanha.mutateAsync({
        campanha_id: campanha.id,
        template_id: templateId,
        position: campanhaTemplates.length,
      });
      toast.success("Template criado e vinculado à campanha!");
      setCreateTemplateOpen(false);
    } catch {
      toast.error("Erro ao vincular template à campanha");
    }
  };

  const handleLinkExisting = async () => {
    if (!linkTemplateId) return;
    try {
      await addToCampanha.mutateAsync({
        campanha_id: campanha.id,
        template_id: linkTemplateId,
        position: campanhaTemplates.length,
      });
      toast.success("Template vinculado!");
      setLinkTemplateId("");
    } catch {
      toast.error("Erro ao vincular template");
    }
  };

  const handleUnlink = async (id: string) => {
    try {
      await removeFromCampanha.mutateAsync({ id, campanha_id: campanha.id });
      toast.success("Template removido da campanha");
    } catch {
      toast.error("Erro ao remover template");
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="w-4 h-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="regras" className="gap-2">
            <Send className="w-4 h-4" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="automacoes" className="gap-2">
            <Zap className="w-4 h-4" />
            Automações
          </TabsTrigger>
        </TabsList>

        {/* Templates Sub-tab */}
        <TabsContent value="templates" className="mt-4 space-y-6">
          {/* Template Management Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setCreateTemplateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Template
            </Button>
            {availableTemplates.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={linkTemplateId} onValueChange={setLinkTemplateId}>
                  <SelectTrigger className="w-[220px] h-9">
                    <SelectValue placeholder="Vincular template existente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleLinkExisting}
                  disabled={!linkTemplateId || addToCampanha.isPending}
                >
                  <Link2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Type-specific content */}
          {campanha.campaign_type === "semi_automatica" ? (
            <CampanhaSemiAutomaticaPanel campanha={campanha} />
          ) : campanha.campaign_type === "automatica" ? (
            <>
              <CampanhaAutomaticaPanel campanha={campanha} />
              <TemplateListCard
                campanhaTemplates={campanhaTemplates}
                onUnlink={handleUnlink}
                isPending={removeFromCampanha.isPending}
              />
            </>
          ) : (
            /* Manual campaigns: just template list */
            <TemplateListCard
              campanhaTemplates={campanhaTemplates}
              onUnlink={handleUnlink}
              isPending={removeFromCampanha.isPending}
            />
          )}
        </TabsContent>

        {/* Regras Sub-tab */}
        <TabsContent value="regras" className="mt-4">
          <CampanhaDispatchRulesSection campanhaId={campanha.id} stages={stages} embedded />
        </TabsContent>

        {/* Automações Sub-tab */}
        <TabsContent value="automacoes" className="mt-4">
          <CampanhaPipeAutomationsSection campanhaId={campanha.id} stages={stages} embedded />
        </TabsContent>
      </Tabs>

      <CreateTemplateModal
        open={createTemplateOpen}
        onOpenChange={setCreateTemplateOpen}
        onSuccess={handleCreateAndLink}
      />
    </div>
  );
}

// Simple template list card for manual/automatic campaigns
function TemplateListCard({
  campanhaTemplates,
  onUnlink,
  isPending,
}: {
  campanhaTemplates: { id: string; template_id: string; template?: { name: string; content: string } | null }[];
  onUnlink: (id: string) => void;
  isPending: boolean;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (campanhaTemplates.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Nenhum template vinculado</p>
            <p className="text-sm">Crie ou vincule um template acima</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Templates da Campanha</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {campanhaTemplates.map((ct) => (
            <div key={ct.id}>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{ct.template?.name ?? "Template"}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                      {ct.template?.content?.substring(0, 60)}...
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewId(previewId === ct.id ? null : ct.id)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onUnlink(ct.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {previewId === ct.id && ct.template?.content && (
                <div className="ml-8 mt-1 p-3 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap border">
                  {ct.template.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
