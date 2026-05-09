import { useState } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  BarChart3,
  LineChart,
  PieChart,
  Table2,
  Hash,
  GitBranch,
  AreaChart,
  Star,
  StarOff,
  Share2,
  Calendar,
  Trash2,
  MoreVertical,
  Loader2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useReports,
  useDeleteReport,
  useUpdateReport,
  type Report,
  type ChartType,
} from "@/hooks/useReports";
import { ReportBuilder } from "@/components/reports/ReportBuilder";
import { ScheduleReportDialog } from "@/components/reports/ScheduleReportDialog";

const CHART_ICONS: Record<ChartType, typeof BarChart3> = {
  bar: BarChart3,
  line: LineChart,
  pie: PieChart,
  table: Table2,
  number: Hash,
  funnel: GitBranch,
  area: AreaChart,
};

const ENTITY_LABELS: Record<string, string> = {
  leads: "Leads",
  contacts: "Contatos",
  activities: "Atividades",
  pipelines: "Pipelines",
};

function ReportCard({
  report,
  onEdit,
  onSchedule,
}: {
  report: Report;
  onEdit: (r: Report) => void;
  onSchedule: (r: Report) => void;
}) {
  const deleteReport = useDeleteReport();
  const updateReport = useUpdateReport();
  const ChartIcon = CHART_ICONS[report.chart_type] ?? BarChart3;

  const toggleFavorite = () => {
    updateReport.mutate({ id: report.id, is_favorite: !report.is_favorite });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="group hover:border-primary/30 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ChartIcon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{report.name}</h3>
                {report.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {report.description}
                  </p>
                )}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(report)}>
                  <FileText className="h-3.5 w-3.5 mr-2" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleFavorite}>
                  {report.is_favorite ? (
                    <>
                      <StarOff className="h-3.5 w-3.5 mr-2" />
                      Remover Favorito
                    </>
                  ) : (
                    <>
                      <Star className="h-3.5 w-3.5 mr-2" />
                      Favoritar
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSchedule(report)}>
                  <Calendar className="h-3.5 w-3.5 mr-2" />
                  Agendar Envio
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => deleteReport.mutate(report.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <Badge variant="secondary" className="text-[10px]">
              {ENTITY_LABELS[report.entity_type] ?? report.entity_type}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {report.chart_type}
            </Badge>
            {report.is_shared && (
              <Share2 className="h-3 w-3 text-muted-foreground" title="Compartilhado" />
            )}
            {report.is_favorite && (
              <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
            )}
          </div>

          <div className="text-[10px] text-muted-foreground mt-2">
            Atualizado {new Date(report.updated_at).toLocaleDateString("pt-BR")}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Reports() {
  const { data: reports, isLoading } = useReports();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editReport, setEditReport] = useState<Report | null>(null);
  const [scheduleReport, setScheduleReport] = useState<Report | null>(null);

  const filtered = (reports ?? []).filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tab === "favorites" && !r.is_favorite) return false;
    if (tab === "shared" && !r.is_shared) return false;
    if (tab === "mine" && r.is_shared) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crie e gerencie relatórios customizados
          </p>
        </div>
        <Button onClick={() => { setEditReport(null); setBuilderOpen(true); }} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo Relatório
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar relatórios..."
            className="pl-9"
          />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="favorites">Favoritos</TabsTrigger>
            <TabsTrigger value="shared">Compartilhados</TabsTrigger>
            <TabsTrigger value="mine">Meus</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-full bg-muted p-5 mb-4">
            <BarChart3 className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {search ? "Nenhum relatório encontrado" : "Nenhum relatório criado ainda"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            {search
              ? "Tente ajustar sua busca."
              : "Crie seu primeiro relatório personalizado com gráficos, filtros e agendamento."}
          </p>
          {!search && (
            <Button
              onClick={() => { setEditReport(null); setBuilderOpen(true); }}
              className="mt-4 gap-1.5"
              size="sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Criar Relatório
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onEdit={(r) => {
                setEditReport(r);
                setBuilderOpen(true);
              }}
              onSchedule={setScheduleReport}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <ReportBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        editReport={editReport}
      />

      {scheduleReport && (
        <ScheduleReportDialog
          open={!!scheduleReport}
          onOpenChange={(v) => !v && setScheduleReport(null)}
          reportId={scheduleReport.id}
          reportName={scheduleReport.name}
        />
      )}
    </div>
  );
}
