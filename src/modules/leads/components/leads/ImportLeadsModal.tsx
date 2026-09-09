/**
 * Importar leads SEM funil — o caminho da tela de Leads.
 *
 * Irmão do `ImportLeadsFunnelModal`, e a diferença é uma só: aqui não existe
 * etapa a escolher, porque nenhum negócio é aberto. A planilha é a mesma (mesmo
 * modelo baixável, mesmos apelidos de coluna, mesmo mapeamento de campo
 * personalizado); o que muda é onde ela desemboca — a pessoa entra no cadastro
 * e para aí. Quem quiser o negócio abre depois, pelo funil.
 *
 * Colunas de funil que vierem na planilha (Etapa, Valor, Produto) são lidas pelo
 * parser e ignoradas no destino. É deliberado: recusar a planilha por trazer
 * coluna a mais obrigaria o vendedor a editar o arquivo do ERP antes de
 * importar, e o dado que interessa aqui — a pessoa — está lá do mesmo jeito.
 */
import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useImportLeads,
  parseFilePreview,
  KNOWN_LEAD_FIELDS,
  type FilePreviewResult,
} from "../../hooks/useImportLeads";
import { useLeadCustomFields } from "../../hooks/useLeadCustomFields";
import { useCanDo, useTeamMembers } from "@/modules/identity";
import { downloadLeadsImportTemplate } from "@/lib/leadsImportTemplate";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  FileDown,
  Calendar,
  ChevronDown,
  ChevronUp,
  UserX,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function buildMetricsPeriodOptions(): { value: string; label: string; month?: number; year?: number }[] {
  const options: { value: string; label: string; month?: number; year?: number }[] = [
    { value: "current", label: "Mês atual (padrão)" },
  ];
  const now = new Date();
  for (let i = 1; i <= 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    options.push({
      value: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTH_NAMES[d.getMonth()]}/${year}`,
      month,
      year,
    });
  }
  return options;
}

const METRICS_PERIOD_OPTIONS = buildMetricsPeriodOptions();

interface PreviewLead {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
}

type Step = "upload" | "map_columns" | "preview" | "importing" | "complete";

interface ImportLeadsContentProps {
  onDone?: () => void;
}

export function ImportLeadsContent({ onDone }: ImportLeadsContentProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewLeads, setPreviewLeads] = useState<PreviewLead[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [incompleteLeadsCount, setIncompleteLeadsCount] = useState(0);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [userColumnMapping, setUserColumnMapping] = useState<Record<string, string>>({});
  const [selectedResponsibleId, setSelectedResponsibleId] = useState<string>("");
  const [selectedMetricsPeriod, setSelectedMetricsPeriod] = useState<string>("current");
  const [showErrors, setShowErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { data: members = [] } = useTeamMembers();
  const { parseCSV, importLeadsOnly, resetImport, progress, result, lastReport } = useImportLeads();
  const { data: customFields = [] } = useLeadCustomFields();
  const { allowed: canImport, isLoading: permLoading } = useCanDo("import_leads");
  const customFieldNames = customFields.map((f) => f.field_name);
  const memberOptions = (members || []).map((m) => ({ id: m.id, name: m.name || "" }));

  const resumirLeads = useCallback(
    (leads: { name: string; company?: string; phone?: string; email?: string }[]) => {
      setTotalLeads(leads.length);
      setIncompleteLeadsCount(leads.filter((l) => !l.phone && !l.email).length);
      setPreviewLeads(
        leads.slice(0, 10).map((l) => ({
          name: l.name,
          company: l.company,
          phone: l.phone,
          email: l.email,
        })),
      );
    },
    [],
  );

  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      const name = (selectedFile.name || "").toLowerCase();
      if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        toast.error("Use um arquivo CSV ou Excel (.xlsx, .xls)");
        return;
      }
      setFile(selectedFile);
      setPreviewResult(null);
      setUserColumnMapping({});
      try {
        const preview = await parseFilePreview(selectedFile, customFieldNames);
        setPreviewResult(preview);
        setTotalLeads(preview.totalRows);
        if (preview.unmappedColumns.length > 0) {
          setStep("map_columns");
          return;
        }
        const mapping = preview.suggestedMapping ?? {};
        const leads = await parseCSV(selectedFile, Object.keys(mapping).length ? mapping : undefined);
        resumirLeads(leads);
        setStep("preview");
      } catch (error) {
        console.error("Error parsing file:", error);
        toast.error("Erro ao processar arquivo. Verifique o formato (CSV ou XLSX).");
      }
    },
    [parseCSV, customFieldNames, resumirLeads],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setStep("importing");
    try {
      const fullMapping = { ...(previewResult?.suggestedMapping ?? {}), ...userColumnMapping };
      const metricsOpt = METRICS_PERIOD_OPTIONS.find((o) => o.value === selectedMetricsPeriod);
      await importLeadsOnly(file, {
        members: memberOptions,
        userColumnMapping: Object.keys(fullMapping).length ? fullMapping : undefined,
        responsibleId: selectedResponsibleId === "none" ? undefined : selectedResponsibleId || undefined,
        metricsPeriodMonth: metricsOpt?.month,
        metricsPeriodYear: metricsOpt?.year,
      });
      setStep("complete");
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (error) {
      console.error("Import error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`Erro durante a importação: ${msg}`);
      setStep("preview");
    }
  };

  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setPreviewLeads([]);
    setTotalLeads(0);
    setIncompleteLeadsCount(0);
    setPreviewResult(null);
    setUserColumnMapping({});
    setSelectedResponsibleId("");
    setSelectedMetricsPeriod("current");
    resetImport();
    onDone?.();
  };

  return (
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
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50"
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="font-medium">Arraste o arquivo CSV ou Excel aqui</p>
            <p className="text-sm text-muted-foreground mt-1">ou clique para selecionar (.csv, .xlsx, .xls)</p>
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
            O modelo traz as colunas certas e uma aba <strong>Instruções</strong> com passos e o que preencher em cada campo.
          </p>
          <div className="p-3 bg-muted/50 rounded-lg space-y-1">
            <p className="text-xs text-muted-foreground">
              Os leads entram <strong>somente no cadastro</strong> — nenhum negócio é criado. Para colocá-los num funil, use o
              botão Importar de dentro do funil.
            </p>
            <p className="text-xs text-muted-foreground">
              Colunas não reconhecidas serão exibidas para você mapear ou ignorar antes de criar os leads.
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
              <p className="font-medium text-sm text-amber-800 dark:text-amber-200">Colunas não reconhecidas</p>
              <p className="text-xs text-muted-foreground mt-1">
                Mapeie cada coluna para um campo existente ou ignore. Para novo dado, crie um campo personalizado em
                Configurações → Leads.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Mapeamento das colunas</Label>
            <ScrollArea className="h-48 rounded-lg border p-2">
              <div className="space-y-3">
                {previewResult.unmappedColumns.map((col) => (
                  <div key={col} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium shrink-0 w-32 truncate" title={col}>
                      {col}
                    </span>
                    <Select
                      value={userColumnMapping[col] ?? "ignore"}
                      onValueChange={(v) => setUserColumnMapping((prev) => ({ ...prev, [col]: v }))}
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
                  const mapping = previewResult
                    ? { ...(previewResult.suggestedMapping ?? {}), ...userColumnMapping }
                    : userColumnMapping;
                  const leads = await parseCSV(file!, Object.keys(mapping).length ? mapping : undefined);
                  resumirLeads(leads);
                  setStep("preview");
                } catch {
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
          <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-sm">{file?.name}</p>
              <p className="text-xs text-muted-foreground">{totalLeads} leads encontrados no arquivo</p>
            </div>
          </div>

          {incompleteLeadsCount > 0 && (
            <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <UserX className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>
                  {incompleteLeadsCount} lead{incompleteLeadsCount > 1 ? "s" : ""} sem telefone e e-mail
                </strong>{" "}
                — serão importados como incompletos. Você poderá completar os dados depois.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Preview (primeiros 10)</Label>
            <ScrollArea className="h-40 rounded-lg border">
              <div className="p-2 space-y-1">
                {previewLeads.map((lead, index) => (
                  <div key={index} className="p-2 bg-muted/30 rounded text-sm">
                    <p className="font-medium">{lead.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[lead.company, lead.phone, lead.email].filter(Boolean).join(" • ") || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              Período para métricas
            </Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Para leads antigos de outros meses, escolha o período em que eles devem contar nas métricas. Deixe &quot;Mês
              atual&quot; para leads novos.
            </p>
            <Select value={selectedMetricsPeriod} onValueChange={setSelectedMetricsPeriod}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                {METRICS_PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Responsável padrão</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              A coluna <strong>Vendedor</strong> (ou Responsável/Time/Equipe) da planilha é reconhecida automaticamente. Este
              responsável entra quando ela estiver vazia ou não corresponder a ninguém.
            </p>
            <Select value={selectedResponsibleId} onValueChange={setSelectedResponsibleId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolher vendedor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem atribuição</SelectItem>
                {memberOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">
              Estes leads entram <strong>sem negócio</strong>. Colunas de funil na planilha (Etapa, Valor, Produto) são
              ignoradas nesta importação.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("upload")}>
              Voltar
            </Button>
            <Button onClick={handleImport} disabled={!totalLeads || !canImport || permLoading}>
              {permLoading ? "Verificando permissão..." : !canImport ? "Sem permissão" : `Importar ${totalLeads} leads`}
            </Button>
          </div>
          {!canImport && !permLoading && (
            <p className="text-xs text-destructive text-center">
              Você não tem permissão para importar leads. Contate um administrador.
            </p>
          )}
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
            <p className="text-sm text-muted-foreground mt-1">{Math.round(progress)}% concluído</p>
          </div>
          <Progress value={progress} className="h-2" />
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
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-xl font-bold">Importação concluída!</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-green-500/10 rounded-xl text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-500" />
              <p className="text-2xl font-bold text-green-500">{result.imported}</p>
              <p className="text-xs text-muted-foreground">Importados</p>
            </div>
            <div className="p-4 bg-blue-500/10 rounded-xl text-center">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 text-blue-500" />
              <p className="text-2xl font-bold text-blue-500">{(result as { updated?: number }).updated ?? 0}</p>
              <p className="text-xs text-muted-foreground">Atualizados</p>
            </div>
            {((result as { incomplete?: number }).incomplete ?? 0) > 0 && (
              <div className="p-4 bg-orange-500/10 rounded-xl text-center">
                <UserX className="w-6 h-6 mx-auto mb-2 text-orange-500" />
                <p className="text-2xl font-bold text-orange-500">{(result as { incomplete?: number }).incomplete}</p>
                <p className="text-xs text-muted-foreground">Sem contato</p>
              </div>
            )}
            <div className="p-4 bg-amber-500/10 rounded-xl text-center">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
              <p className="text-2xl font-bold text-amber-500">{result.duplicates}</p>
              <p className="text-xs text-muted-foreground">Duplicados</p>
            </div>
            <div className="p-4 bg-red-500/10 rounded-xl text-center">
              <XCircle className="w-6 h-6 mx-auto mb-2 text-red-500" />
              <p className="text-2xl font-bold text-red-500">{result.invalid}</p>
              <p className="text-xs text-muted-foreground">Inválidos</p>
            </div>
          </div>

          {lastReport && lastReport.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-900">
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl"
                onClick={() => setShowErrors(!showErrors)}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {lastReport.errors.length} {lastReport.errors.length === 1 ? "erro" : "erros"} encontrados
                </span>
                {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showErrors && (
                <ScrollArea className="max-h-48">
                  <div className="space-y-1 px-3 pb-3">
                    {lastReport.errors.map((err, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-2">
                        <span className="text-red-500 font-mono shrink-0">{err.row > 0 ? `L${err.row}` : ""}</span>
                        <span>{err.reason}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <p className="text-sm text-center text-muted-foreground">
            Os leads já estão no cadastro. Nenhum negócio foi criado.
          </p>
          <Button className="w-full" onClick={handleClose}>
            Fechar
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ImportLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportLeadsModal({ open, onOpenChange }: ImportLeadsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Importar leads
          </DialogTitle>
        </DialogHeader>
        <ImportLeadsContent onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
