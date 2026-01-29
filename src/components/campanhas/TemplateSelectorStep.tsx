import { useState } from "react";
import { useCampaignTemplates } from "@/hooks/useCampaignTemplates";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Plus, Eye, AlertCircle, Check, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateTemplateModal } from "./CreateTemplateModal";
import { replaceVariablesWithExamples } from "@/hooks/useCampaignTemplates";

interface TemplateSelectorStepProps {
  selectedTemplateIds: string[];
  onTemplatesChange: (templateIds: string[]) => void;
}

export function TemplateSelectorStep({
  selectedTemplateIds,
  onTemplatesChange,
}: TemplateSelectorStepProps) {
  const { data: templates, isLoading, refetch } = useCampaignTemplates();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  const handleToggleTemplate = (templateId: string) => {
    if (selectedTemplateIds.includes(templateId)) {
      onTemplatesChange(selectedTemplateIds.filter((id) => id !== templateId));
    } else {
      onTemplatesChange([...selectedTemplateIds, templateId]);
    }
  };

  const previewTemplate = templates?.find((t) => t.id === previewTemplateId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Selecione os Templates
          </Label>
          <p className="text-sm text-muted-foreground">
            Escolha os templates que serão usados para disparar mensagens em lote.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Novo Template
        </Button>
      </div>

      {/* Templates List */}
      {!templates?.length ? (
        <Card className="border-dashed border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-600">Nenhum template criado</p>
              <p className="text-sm text-muted-foreground mt-1">
                Crie templates de mensagem para usar em campanhas semi-automáticas.
                Templates suportam variáveis como <code className="bg-muted px-1 rounded">{"{nome}"}</code> e{" "}
                <code className="bg-muted px-1 rounded">{"{empresa}"}</code>.
              </p>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="mt-3"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="w-4 h-4 mr-1" />
                Criar Primeiro Template
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Template List */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Templates disponíveis ({templates.length})
            </Label>
            <ScrollArea className="h-[280px] rounded-md border p-2">
              <div className="space-y-2">
                {templates.map((template) => {
                  const isSelected = selectedTemplateIds.includes(template.id);
                  const isPreviewing = previewTemplateId === template.id;

                  return (
                    <div
                      key={template.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg transition-colors",
                        "hover:bg-muted/50 cursor-pointer",
                        isSelected && "bg-primary/5 border border-primary/20",
                        isPreviewing && "ring-2 ring-primary/30"
                      )}
                      onClick={() => handleToggleTemplate(template.id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleTemplate(template.id)}
                        className="shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate text-sm">
                            {template.name}
                          </span>
                          {template.message_type === "audio" && (
                            <Badge variant="outline" className="text-[10px]">
                              Áudio
                            </Badge>
                          )}
                          {template.times_used > 0 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {template.times_used}x usado
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {template.message_type === "audio" ? (
                            <span className="inline-flex items-center gap-1">
                              <Mic className="w-3 h-3" />
                              Mensagem em áudio
                            </span>
                          ) : (
                            `${template.content.substring(0, 60)}...`
                          )}
                        </p>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewTemplateId(
                            isPreviewing ? null : template.id
                          );
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Preview Panel */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Preview {previewTemplate ? `- ${previewTemplate.name}` : ""}
            </Label>
            <div className="h-[280px] rounded-md border bg-muted/30 p-4 overflow-auto">
              {previewTemplate ? (
                <div className="space-y-4">
                  {previewTemplate.message_type === "audio" ? (
                    <>
                      <div className="flex items-center gap-2 text-primary">
                        <Mic className="w-5 h-5" />
                        <span className="font-medium">Template em áudio</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Este disparo enviará o áudio gravado para cada lead via Evolution API.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {previewTemplate.available_variables?.map((v) => (
                          <Badge key={v} variant="outline" className="text-xs">
                            {`{${v}}`}
                          </Badge>
                        ))}
                      </div>
                      <div className="bg-background rounded-lg p-3 text-sm whitespace-pre-wrap">
                        {replaceVariablesWithExamples(previewTemplate.content)}
                      </div>
                      <p className="text-xs text-muted-foreground italic">
                        * As variáveis serão substituídas pelos dados reais do lead
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  <div className="text-center">
                    <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>Clique no ícone de olho para</p>
                    <p>visualizar um template</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Selected Count */}
      {selectedTemplateIds.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
          <Check className="w-4 h-4 text-primary" />
          <span className="text-sm">
            <strong>{selectedTemplateIds.length}</strong> template(s) selecionado(s)
          </span>
        </div>
      )}

      {/* Create Template Modal */}
      <CreateTemplateModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onSuccess={(newTemplateId) => {
          refetch();
          // Auto-seleciona o template recém-criado
          onTemplatesChange([...selectedTemplateIds, newTemplateId]);
          setShowCreateModal(false);
        }}
      />
    </div>
  );
}
