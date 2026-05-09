import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, BarChart3, LineChart, PieChart, Table2, Hash, GitBranch, AreaChart } from "lucide-react";
import {
  useCreateReport,
  useUpdateReport,
  type ChartType,
  type EntityType,
  type Report,
} from "@/hooks/useReports";

interface ReportBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editReport?: Report | null;
}

const ENTITY_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "leads", label: "Leads" },
  { value: "deals", label: "Negócios" },
  { value: "contacts", label: "Contatos" },
  { value: "activities", label: "Atividades" },
  { value: "pipelines", label: "Pipelines" },
];

const CHART_OPTIONS: { value: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { value: "bar", label: "Barras", icon: BarChart3 },
  { value: "line", label: "Linha", icon: LineChart },
  { value: "pie", label: "Pizza", icon: PieChart },
  { value: "area", label: "Área", icon: AreaChart },
  { value: "table", label: "Tabela", icon: Table2 },
  { value: "number", label: "Número", icon: Hash },
  { value: "funnel", label: "Funil", icon: GitBranch },
];

const DATE_RANGE_OPTIONS = [
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "last_90_days", label: "Últimos 90 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "this_quarter", label: "Este trimestre" },
  { value: "this_year", label: "Este ano" },
  { value: "custom", label: "Personalizado" },
];

const FIELD_OPTIONS: Record<EntityType, { value: string; label: string }[]> = {
  leads: [
    { value: "origin", label: "Origem" },
    { value: "rating", label: "Rating" },
    { value: "qualification_score", label: "Score" },
    { value: "created_at", label: "Data de Criação" },
    { value: "responsible_id", label: "Responsável" },
    { value: "sdr_id", label: "SDR" },
    { value: "closer_id", label: "Closer" },
  ],
  deals: [
    { value: "status", label: "Status" },
    { value: "sale_value", label: "Valor" },
    { value: "loss_reason", label: "Motivo de Perda" },
    { value: "created_at", label: "Data de Criação" },
    { value: "responsible_id", label: "Responsável" },
  ],
  contacts: [
    { value: "company", label: "Empresa" },
    { value: "origin", label: "Origem" },
    { value: "created_at", label: "Data de Criação" },
  ],
  activities: [
    { value: "type", label: "Tipo" },
    { value: "user_id", label: "Vendedor" },
    { value: "created_at", label: "Data" },
  ],
  pipelines: [
    { value: "pipeline_type", label: "Pipeline" },
    { value: "stage", label: "Etapa" },
    { value: "created_at", label: "Data" },
  ],
};

export function ReportBuilder({ open, onOpenChange, editReport }: ReportBuilderProps) {
  const isEditing = !!editReport;

  const [name, setName] = useState(editReport?.name ?? "");
  const [description, setDescription] = useState(editReport?.description ?? "");
  const [entityType, setEntityType] = useState<EntityType>(editReport?.entity_type ?? "leads");
  const [chartType, setChartType] = useState<ChartType>(editReport?.chart_type ?? "bar");
  const [dateRange, setDateRange] = useState(editReport?.date_range?.type ?? "last_30_days");
  const [isShared, setIsShared] = useState(editReport?.is_shared ?? false);
  const [selectedFields, setSelectedFields] = useState<string[]>(
    (editReport?.dimensions as string[]) ?? []
  );

  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const isPending = createReport.isPending || updateReport.isPending;

  const handleSave = () => {
    const payload = {
      name,
      description: description || undefined,
      entity_type: entityType,
      chart_type: chartType,
      date_range: { type: dateRange },
      is_shared: isShared,
      dimensions: selectedFields,
      config: { fields: selectedFields },
    };

    if (isEditing && editReport) {
      updateReport.mutate({ id: editReport.id, ...payload }, {
        onSuccess: () => onOpenChange(false),
      });
    } else {
      createReport.mutate(payload, {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      });
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setEntityType("leads");
    setChartType("bar");
    setDateRange("last_30_days");
    setIsShared(false);
    setSelectedFields([]);
  };

  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const availableFields = FIELD_OPTIONS[entityType] ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Relatório" : "Novo Relatório"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step 1: Basic Info */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="report-name">Nome</Label>
              <Input
                id="report-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Leads por Origem - Mensal"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="report-desc">Descrição (opcional)</Label>
              <Textarea
                id="report-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="O que este relatório mostra..."
                rows={2}
                className="mt-1"
              />
            </div>
          </div>

          {/* Step 2: Entity */}
          <div>
            <Label>Entidade</Label>
            <Select value={entityType} onValueChange={(v) => {
              setEntityType(v as EntityType);
              setSelectedFields([]);
            }}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 3: Fields/Dimensions */}
          <div>
            <Label>Campos / Dimensões</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {availableFields.map((field) => {
                const isSelected = selectedFields.includes(field.value);
                return (
                  <button
                    key={field.value}
                    type="button"
                    onClick={() => toggleField(field.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {field.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 4: Chart Type */}
          <div>
            <Label>Tipo de Gráfico</Label>
            <div className="grid grid-cols-4 gap-2 mt-2">
              {CHART_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setChartType(opt.value)}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                      chartType === opt.value
                        ? "bg-primary/10 text-primary border-primary/50"
                        : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 5: Date Range */}
          <div>
            <Label>Período</Label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 6: Sharing */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Compartilhar com a equipe</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Todos no time poderão visualizar este relatório
              </p>
            </div>
            <Switch checked={isShared} onCheckedChange={setIsShared} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {isEditing ? "Salvar" : "Criar Relatório"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
