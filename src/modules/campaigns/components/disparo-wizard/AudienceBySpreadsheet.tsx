/**
 * AudienceBySpreadsheet — the "Subir planilha" audience source (ADR-0014, #906).
 *
 * Upload a CSV, confirm the auto-detected column map, choose the destination
 * funnel/stage (+ tags for new leads), preview the upsert (X criados · Y já no
 * CRM · Z inválidos · W duplicados), then confirm to freeze the recipient set.
 *
 * Cross-runtime: parsing is client-side (papaparse, pure twin in
 * `spreadsheet-parse`); the upsert decision is the edge function
 * `disparo-planilha-create`. Preview counts come from its `dry_run` — the front
 * never reimports the Deno partition.
 */
import { useMemo, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  UserPlus,
  Users,
  AlertTriangle,
  Copy,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useCustomPipelines,
  useCustomPipelineStages,
  usePipelineStages,
  type SystemPipelineType,
} from "@/modules/pipelines";
import { useTags } from "@/modules/leads";
import {
  useDisparoPlanilhaCreate,
  type PlanilhaReport,
} from "@/modules/campaigns/hooks/useDisparoPlanilhaCreate";
import { SYSTEM_FUNNELS } from "./audience-resolve";
import {
  parseSpreadsheetFile,
  mapGridToRows,
  type ColumnMap,
  type ColumnField,
  type ParsedSpreadsheet,
} from "./spreadsheet-parse";
import type { DisparoDraft } from "./wizard-machine";

interface AudienceBySpreadsheetProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

const NONE = "__none__";

const FIELD_LABELS: { field: ColumnField; label: string; required?: boolean }[] = [
  { field: "phone", label: "Telefone", required: true },
  { field: "name", label: "Nome" },
  { field: "company", label: "Empresa" },
  { field: "email", label: "E-mail" },
];

interface DestinationState {
  funnelKind: "system" | "custom";
  pipelineType: SystemPipelineType;
  pipelineId: string | null;
  stageKey: string;
}

const DEFAULT_DESTINATION: DestinationState = {
  funnelKind: "system",
  pipelineType: "whatsapp",
  pipelineId: null,
  stageKey: "",
};

export function AudienceBySpreadsheet({ draft, patch }: AudienceBySpreadsheetProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [map, setMap] = useState<ColumnMap>({ phone: -1, name: -1, company: -1, email: -1 });
  const [dest, setDest] = useState<DestinationState>(DEFAULT_DESTINATION);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ report: PlanilhaReport; recipients: number } | null>(null);

  const isSystem = dest.funnelKind === "system";
  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: systemStages = [], isLoading: systemStagesLoading } = usePipelineStages(
    isSystem ? dest.pipelineType : ("whatsapp" as SystemPipelineType),
  );
  const { data: customStages = [], isLoading: customStagesLoading } = useCustomPipelineStages(
    !isSystem ? (dest.pipelineId ?? undefined) : undefined,
  );
  const { data: tags = [] } = useTags();

  const stages = useMemo<{ key: string; name: string }[]>(() => {
    if (isSystem) return systemStages.map((s) => ({ key: s.stage_key, name: s.name }));
    return customStages.map((s) => ({ key: s.id, name: s.name }));
  }, [isSystem, systemStages, customStages]);
  const stagesLoading = isSystem ? systemStagesLoading : customStagesLoading;

  const rows = useMemo(
    () => (parsed ? mapGridToRows(parsed.dataRows, map) : []),
    [parsed, map],
  );
  const validPhoneRows = rows.filter((r) => r.phone.trim() !== "").length;

  const dryRun = useDisparoPlanilhaCreate();
  const confirmRun = useDisparoPlanilhaCreate();

  /** Any edit after a confirm/preview invalidates the frozen set — re-confirm needed. */
  const invalidate = () => {
    setPreview(null);
    if (draft.audienceCount > 0) {
      patch({ audienceCount: 0, leadIds: [], audienceLabel: "", audienceSource: null });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await parseSpreadsheetFile(file);
      if (result.dataRows.length === 0) {
        toast.error("A planilha parece vazia ou só tem cabeçalho.");
        return;
      }
      setFileName(file.name);
      setParsed(result);
      setMap(result.map);
      setPreview(null);
      if (draft.audienceCount > 0) {
        patch({ audienceCount: 0, leadIds: [], audienceLabel: "", audienceSource: null });
      }
      if (result.map.phone < 0) {
        toast.warning("Não detectei a coluna de telefone — selecione manualmente.");
      }
    } catch {
      toast.error("Não consegui ler o arquivo. Use um CSV válido.");
    }
  };

  const setColumn = (field: ColumnField, value: string) => {
    setMap((m) => ({ ...m, [field]: value === NONE ? -1 : Number(value) }));
    invalidate();
  };

  const onFunnelChange = (value: string) => {
    const [kind, id] = value.split(":");
    setDest(
      kind === "system"
        ? { funnelKind: "system", pipelineType: id as SystemPipelineType, pipelineId: null, stageKey: "" }
        : { funnelKind: "custom", pipelineType: "whatsapp", pipelineId: id, stageKey: "" },
    );
    invalidate();
  };

  const destReady = isSystem ? !!dest.stageKey : !!(dest.pipelineId && dest.stageKey);
  const funnelArg = isSystem ? dest.pipelineType : (dest.pipelineId ?? "");

  const runPreview = async () => {
    if (map.phone < 0) {
      toast.error("Selecione a coluna de telefone.");
      return;
    }
    try {
      const res = await dryRun.mutateAsync({
        rows,
        funnelKind: dest.funnelKind,
        funnel: funnelArg,
        stage: dest.stageKey,
        tags: tagIds,
        dryRun: true,
      });
      setPreview({ report: res.report, recipients: res.recipient_count });
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao calcular o público.");
    }
  };

  const confirm = async () => {
    try {
      const res = await confirmRun.mutateAsync({
        rows,
        funnelKind: dest.funnelKind,
        funnel: funnelArg,
        stage: dest.stageKey,
        tags: tagIds,
      });
      const ids = res.lead_ids ?? [];
      patch({
        audienceSourceType: "planilha",
        leadIds: ids,
        audienceCount: res.recipient_count,
        audienceLabel: `Planilha · ${fileName || "arquivo"}`,
        audienceSource: {
          context: "disparo",
          type: "planilha",
          fileName,
          funnelKind: dest.funnelKind,
          funnel: funnelArg,
          stage: dest.stageKey,
          report: res.report,
        },
      });
      toast.success(`${ids.length.toLocaleString("pt-BR")} contatos prontos pro disparo.`);
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao preparar o público.");
    }
  };

  const reset = () => {
    setParsed(null);
    setFileName("");
    setMap({ phone: -1, name: -1, company: -1, email: -1 });
    setPreview(null);
    patch({ audienceCount: 0, leadIds: [], audienceLabel: "", audienceSource: null });
    if (fileRef.current) fileRef.current.value = "";
  };

  const confirmed = draft.audienceSourceType === "planilha" && draft.audienceCount > 0;

  // Confirmed-and-navigated-back: no local file in memory but the audience is frozen.
  if (confirmed && !parsed) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{draft.audienceLabel}</p>
              <p className="text-xs text-muted-foreground">
                {draft.audienceCount.toLocaleString("pt-BR")} contatos congelados neste disparo
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="gap-2" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Trocar planilha
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {/* Upload dropzone */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/50 px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-card",
        )}
      >
        {parsed ? (
          <>
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {parsed.dataRows.length.toLocaleString("pt-BR")} linhas · clique para trocar
            </p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Selecione um arquivo CSV</p>
            <p className="text-xs text-muted-foreground">
              Cabeçalho na primeira linha · telefone, nome, empresa, e-mail
            </p>
          </>
        )}
      </button>

      {parsed && (
        <>
          {/* Column map confirmation */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Confira as colunas</p>
              <p className="text-xs text-muted-foreground">
                Detectamos automaticamente — ajuste se algo ficou errado.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELD_LABELS.map(({ field, label, required }) => (
                <div key={field} className="space-y-1.5">
                  <Label className="text-xs">
                    {label}
                    {required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  <Select
                    value={map[field] >= 0 ? String(map[field]) : NONE}
                    onValueChange={(v) => setColumn(field, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Nenhuma —</SelectItem>
                      {parsed.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {validPhoneRows.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")} linhas com
              telefone.
            </p>
          </div>

          {/* Destination funnel/stage for the new leads */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Onde colocar os novos contatos</p>
              <p className="text-xs text-muted-foreground">
                Quem já existe no CRM não é movido — só recebe o disparo.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Funil</Label>
                <Select
                  value={isSystem ? `system:${dest.pipelineType}` : `custom:${dest.pipelineId ?? ""}`}
                  onValueChange={onFunnelChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {SYSTEM_FUNNELS.map((f) => (
                      <SelectItem key={f.value} value={`system:${f.value}`}>
                        {f.label}
                      </SelectItem>
                    ))}
                    {customPipelines.map((p) => (
                      <SelectItem key={p.id} value={`custom:${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Etapa</Label>
                <Select
                  value={dest.stageKey}
                  onValueChange={(v) => {
                    setDest((d) => ({ ...d, stageKey: v }));
                    invalidate();
                  }}
                  disabled={stagesLoading || stages.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        stagesLoading ? "Carregando…" : stages.length === 0 ? "Sem etapas" : "Escolha"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tags for new leads */}
            {tags.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Tags pros novos contatos (opcional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const on = tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTagIds((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          );
                          invalidate();
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors",
                          on
                            ? "border-primary/50 bg-primary/15 text-foreground"
                            : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Preview / confirm */}
          {preview && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <PreviewStat icon={UserPlus} label="Novos" value={preview.report.created} accent />
              <PreviewStat icon={Users} label="Já no CRM" value={preview.report.matched} />
              <PreviewStat icon={AlertTriangle} label="Inválidos" value={preview.report.invalid} />
              <PreviewStat icon={Copy} label="Duplicados" value={preview.report.duplicates} />
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {!preview ? (
              <Button
                variant="secondary"
                onClick={runPreview}
                disabled={dryRun.isPending || !destReady || validPhoneRows === 0}
                className="gap-2"
              >
                {dryRun.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Calcular público
              </Button>
            ) : (
              <Button
                onClick={confirm}
                disabled={confirmRun.isPending || preview.recipients === 0}
                className="gap-2"
              >
                {confirmRun.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Usar {preview.recipients.toLocaleString("pt-BR")} contatos
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewStat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 text-center",
        accent ? "border-primary/40" : "border-border/70",
      )}
    >
      <Icon className={cn("mx-auto h-4 w-4", accent ? "text-primary" : "text-muted-foreground")} />
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value.toLocaleString("pt-BR")}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
