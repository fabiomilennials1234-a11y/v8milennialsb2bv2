import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { CampanhaStage, CampanhaMember, type Campanha } from "@/hooks/useCampanhas";
import { useImportLeads, parseFilePreview, KNOWN_LEAD_FIELDS, type FilePreviewResult } from "@/hooks/useImportLeads";
import { useLeadCustomFields } from "@/hooks/useLeadCustomFields";
import { downloadLeadsImportTemplate } from "@/lib/leadsImportTemplate";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle, Loader2, Sparkles, Users, RefreshCw, AlertTriangle, FileDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ImportLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campanhaId: string;
  stages: CampanhaStage[];
  members: CampanhaMember[];
  campanha?: Campanha | null;
}

interface PreviewLead {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
}

type Step = "upload" | "map_columns" | "preview" | "importing" | "complete";

export function ImportLeadsModal({
  open,
  onOpenChange,
  campanhaId,
  stages,
  members,
  campanha,
}: ImportLeadsModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewLeads, setPreviewLeads] = useState<PreviewLead[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [userColumnMapping, setUserColumnMapping] = useState<Record<string, string>>({});
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [selectedSdrId, setSelectedSdrId] = useState<string>("");
  const [autoDistribute, setAutoDistribute] = useState(false);
  const [distributionMode, setDistributionMode] = useState<"round_robin" | "random">("round_robin");
  const [isDragging, setIsDragging] = useState(false);
  const [hasInitializedFromCampaign, setHasInitializedFromCampaign] = useState(false);

  // Preencher com configuração da campanha ao abrir
  useEffect(() => {
    if (open && campanha && !hasInitializedFromCampaign) {
      const distMode = (campanha as any)?.lead_distribution_mode;
      const distAssignedTo = (campanha as any)?.lead_assigned_to;
      if (distMode === "single" && distAssignedTo) {
        setAutoDistribute(false);
        setSelectedSdrId(distAssignedTo);
      } else if (distMode === "random" || distMode === "round_robin") {
        setAutoDistribute(true);
        setDistributionMode(distMode);
      }
      setHasInitializedFromCampaign(true);
    }
    if (!open) setHasInitializedFromCampaign(false);
  }, [open, campanha, hasInitializedFromCampaign]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { parseCSV, importLeads, resetImport, isImporting, progress, result } = useImportLeads();
  const { data: customFields = [] } = useLeadCustomFields();
  const customFieldNames = customFields.map((f) => f.field_name);

  // Set default stage to first stage (Lead)
  const defaultStage = stages.find(s => s.position === 0) || stages[0];

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    const name = (selectedFile.name || "").toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      toast.error("Use um arquivo CSV ou Excel (.xlsx, .xls)");
      return;
    }

    setFile(selectedFile);
    setPreviewResult(null);
    setUserColumnMapping({});
    
    try {
      const customNames = customFields.map((f) => f.field_name);
      const preview = await parseFilePreview(selectedFile, customNames);
      setPreviewResult(preview);
      setTotalLeads(preview.totalRows);

      if (preview.unmappedColumns.length > 0) {
        setStep("map_columns");
        return;
      }

      const leads = await parseCSV(selectedFile);
      setTotalLeads(leads.length);
      setPreviewLeads(leads.slice(0, 10).map(l => ({
        name: l.name,
        company: l.company,
        phone: l.phone,
        email: l.email,
      })));
      setSelectedStageId(defaultStage?.id || "");
      setStep("preview");
    } catch (error) {
      console.error("Error parsing file:", error);
      toast.error("Erro ao processar arquivo. Verifique o formato (CSV ou XLSX).");
    }
  }, [parseCSV, defaultStage, customFields]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleImport = async () => {
    if (!file || !selectedStageId) {
      toast.error("Selecione uma etapa inicial");
      return;
    }

    setStep("importing");

    try {
      const memberIds = members.map(m => m.team_member_id);
      await importLeads(
        file,
        campanhaId,
        selectedStageId,
        autoDistribute ? undefined : (selectedSdrId === "none" ? undefined : selectedSdrId || undefined),
        autoDistribute,
        autoDistribute ? memberIds : undefined,
        stages.map((s) => ({ id: s.id, name: s.name })),
        autoDistribute ? distributionMode : undefined
      );
      setStep("complete");
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Erro durante a importação");
      setStep("preview");
    }
  };

  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setPreviewLeads([]);
    setTotalLeads(0);
    setPreviewResult(null);
    setUserColumnMapping({});
    setSelectedStageId("");
    setSelectedSdrId("");
    setAutoDistribute(false);
    resetImport();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Importar Leads
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                <p className="font-medium">Arraste o arquivo CSV ou Excel aqui</p>
                <p className="text-sm text-muted-foreground mt-1">
                  ou clique para selecionar (.csv, .xlsx, .xls)
                </p>
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />

              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Selecionar arquivo
                </Button>
                <Button variant="ghost" size="sm" className="text-primary gap-2" onClick={downloadLeadsImportTemplate}>
                  <FileDown className="w-4 h-4" />
                  Baixar modelo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O modelo traz as colunas certas e uma aba <strong>Instruções</strong> com passos e o que preencher em cada campo. Use CSV ou Excel (XLSX/XLS).
              </p>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  <strong>Formatos:</strong> CSV ou Excel (XLSX/XLS). Colunas não reconhecidas serão exibidas para você mapear ou criar como campo personalizado.
                </p>
              </div>
            </motion.div>
          )}

          {step === "map_columns" && previewResult && previewResult.unmappedColumns.length > 0 && (
            <motion.div
              key="map_columns"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm text-amber-800 dark:text-amber-200">
                    Colunas não reconhecidas
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    O arquivo contém colunas que não existem no sistema. Mapeie cada uma para um campo existente, ou ignore. Para usar como novo dado, crie um campo personalizado em Configurações → Leads → Campos personalizados e importe de novo.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Mapeamento das colunas do arquivo</Label>
                <ScrollArea className="h-48 rounded-lg border p-2">
                  <div className="space-y-3">
                    {previewResult.unmappedColumns.map((col) => (
                      <div key={col} className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium shrink-0 w-32 truncate" title={col}>
                          {col}
                        </span>
                        <Select
                          value={userColumnMapping[col] ?? "ignore"}
                          onValueChange={(v) =>
                            setUserColumnMapping((prev) => ({ ...prev, [col]: v }))
                          }
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Escolher..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ignore">Ignorar coluna</SelectItem>
                            {KNOWN_LEAD_FIELDS.map((field) => (
                              <SelectItem key={field} value={field}>
                                {field}
                              </SelectItem>
                            ))}
                            {customFieldNames.map((name) => (
                              <SelectItem key={name} value={`custom:${name}`}>
                                {name} (personalizado)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Voltar
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const leads = await parseCSV(file!);
                      setTotalLeads(leads.length);
                      setPreviewLeads(
                        leads.slice(0, 10).map((l) => ({
                          name: l.name,
                          company: l.company,
                          phone: l.phone,
                          email: l.email,
                        }))
                      );
                      setSelectedStageId(defaultStage?.id || "");
                      setStep("preview");
                    } catch (e) {
                      toast.error("Erro ao processar arquivo");
                    }
                  }}
                >
                  Continuar para preview
                </Button>
              </div>
            </motion.div>
          )}

          {step === "preview" && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* File info */}
              <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
                <FileSpreadsheet className="w-8 h-8 text-primary" />
                <div>
                  <p className="font-medium text-sm">{file?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {totalLeads} leads encontrados
                  </p>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label>Preview (primeiros 10 leads)</Label>
                <ScrollArea className="h-40 rounded-lg border">
                  <div className="p-2 space-y-1">
                    {previewLeads.map((lead, index) => (
                      <div key={index} className="p-2 bg-muted/30 rounded text-sm">
                        <p className="font-medium">{lead.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[lead.company, lead.phone, lead.email].filter(Boolean).join(" • ") || "Sem informações adicionais"}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Stage Selection */}
              <div className="space-y-2">
                <Label>Etapa padrão *</Label>
                <p className="text-xs text-muted-foreground mb-1">Usada quando a coluna &quot;Etapa&quot; da planilha estiver vazia ou não corresponder a nenhuma etapa.</p>
                <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: stage.color || "#3B82F6" }}
                          />
                          {stage.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Auto Distribution Toggle */}
              {members.length > 1 && (
                <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-primary" />
                    <div>
                      <Label className="font-medium">Distribuição Automática</Label>
                      <p className="text-xs text-muted-foreground">
                        Distribuir leads igualmente entre {members.length} vendedores
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={autoDistribute}
                    onCheckedChange={(checked) => {
                      setAutoDistribute(checked);
                      if (checked) setSelectedSdrId("");
                    }}
                  />
                </div>
              )}

              {/* SDR Selection - Only show if not auto distributing */}
              {!autoDistribute && (
                <div className="space-y-2">
                  <Label>Atribuir a Vendedor (opcional)</Label>
                  <Select value={selectedSdrId} onValueChange={setSelectedSdrId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sem atribuição" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem atribuição</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.team_member_id} value={member.team_member_id}>
                          {member.team_member?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Distribution mode (round_robin vs random) when auto distribute */}
              {autoDistribute && members.length > 1 && (
                <div className="space-y-2">
                  <Label>Modo de distribuição</Label>
                  <Select value={distributionMode} onValueChange={(v) => setDistributionMode(v as "round_robin" | "random")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Rotativo — alterna entre vendedores em ordem</SelectItem>
                      <SelectItem value="random">Aleatório — distribui ao acaso entre vendedores</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Distribution Preview */}
              {autoDistribute && members.length > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">
                    Cada vendedor receberá aproximadamente:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {members.map((member) => (
                      <span key={member.team_member_id} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 rounded-full text-xs">
                        {member.team_member?.name}: ~{Math.ceil(totalLeads / members.length)} leads
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Voltar
                </Button>
                <Button onClick={handleImport} disabled={!selectedStageId}>
                  Importar {totalLeads} leads
                </Button>
              </div>
            </motion.div>
          )}

          {step === "importing" && (
            <motion.div
              key="importing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="py-8 space-y-6"
            >
              <div className="text-center">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
                <p className="font-medium">Importando leads...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {Math.round(progress)}% concluído
                </p>
              </div>
              
              <Progress value={progress} className="h-2" />
              
              <p className="text-xs text-center text-muted-foreground">
                Não feche esta janela durante a importação
              </p>
            </motion.div>
          )}

          {step === "complete" && result && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="py-6 space-y-6"
            >
              {/* Success celebration */}
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-green-500" />
                  </div>
                </motion.div>
                <h3 className="text-xl font-bold">Importação Concluída!</h3>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="p-4 bg-green-500/10 rounded-xl text-center"
                >
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-500" />
                  <p className="text-2xl font-bold text-green-500">{result.imported}</p>
                  <p className="text-xs text-muted-foreground">Importados</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="p-4 bg-blue-500/10 rounded-xl text-center"
                >
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 text-blue-500" />
                  <p className="text-2xl font-bold text-blue-500">{result.updated}</p>
                  <p className="text-xs text-muted-foreground">Atualizados</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="p-4 bg-amber-500/10 rounded-xl text-center"
                >
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                  <p className="text-2xl font-bold text-amber-500">{result.duplicates}</p>
                  <p className="text-xs text-muted-foreground">Duplicados</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                  className="p-4 bg-red-500/10 rounded-xl text-center"
                >
                  <XCircle className="w-6 h-6 mx-auto mb-2 text-red-500" />
                  <p className="text-2xl font-bold text-red-500">{result.invalid}</p>
                  <p className="text-xs text-muted-foreground">Inválidos</p>
                </motion.div>
              </div>

              {/* Distribution breakdown */}
              {result.distribution && Object.keys(result.distribution).length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="p-4 bg-primary/5 rounded-xl"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-primary" />
                    <p className="text-sm font-medium">Distribuição por Vendedor</p>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(result.distribution).map(([sdrId, count]) => {
                      const member = members.find(m => m.team_member_id === sdrId);
                      return (
                        <div key={sdrId} className="flex items-center justify-between text-sm">
                          <span>{member?.team_member?.name || "Vendedor"}</span>
                          <span className="font-medium text-primary">{count} leads</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Info */}
              <p className="text-sm text-center text-muted-foreground">
                Os leads importados já estão disponíveis no Kanban da campanha
              </p>

              {/* Close button */}
              <Button className="w-full" onClick={handleClose}>
                Fechar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
