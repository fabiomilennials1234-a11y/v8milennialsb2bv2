import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  parseFilePreview,
  parseExcelSheetNames,
  parseFileToRows,
  type FilePreviewResult,
} from "@/modules/leads";
import { useCarteiraStages, type CarteiraStageFamily } from "@/modules/carteira/hooks/useCarteiraStages";
import { useTeamMembers } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadUpsellImportTemplate } from "@/lib/upsellImportTemplate";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  FileDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  Users,
  RefreshCw,
  AlertTriangle,
  Table2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/** Campos extras para importação de clientes de carteira */
const UPSELL_EXTRA_FIELDS = ["potencial", "data_primeira_venda"] as const;

const UPSELL_HEADER_ALIASES: Record<string, string> = {
  potencial: "potencial",
  "potencial cliente": "potencial",
  perfil: "potencial",
  "perfil cliente": "potencial",
  "data primeira venda": "data_primeira_venda",
  "data 1a venda": "data_primeira_venda",
  "primeira venda": "data_primeira_venda",
  "first sale": "data_primeira_venda",
  "data venda": "data_primeira_venda",
  // última compra → grava em upsell_clients.last_order_at (sem order;
  // sale_value tem CHECK > 0 e a planilha não traz valor). O cron
  // calculate-portfolio-health preserva last_order_at quando há 0 orders.
  "data ultima compra": "data_ultima_compra",
  "data da ultima compra": "data_ultima_compra",
  "ultima compra": "data_ultima_compra",
  "last purchase": "data_ultima_compra",
  "data ultima venda": "data_ultima_compra",
  // order-scope fields (customer_portfolio)
  produto: "produto",
  product: "produto",
  item: "produto",
  quantidade: "quantidade",
  qty: "quantidade",
  qtd: "quantidade",
  quantity: "quantidade",
  "valor unitario": "valor_unitario",
  "preco unitario": "valor_unitario",
  "unit price": "valor_unitario",
  valor: "valor_unitario",
  unidade: "unidade",
  unit: "unidade",
  un: "unidade",
  "data pedido": "data_pedido",
  "data do pedido": "data_pedido",
  "order date": "data_pedido",
  cnpj: "cnpj",
};

const POTENCIAL_ALIASES: Record<string, string> = {
  baixo: "baixo",
  low: "baixo",
  medio: "medio",
  médio: "medio",
  medium: "medio",
  alto: "alto",
  high: "alto",
  estrategico: "estrategico",
  estratégico: "estrategico",
  strategic: "estrategico",
  vip: "estrategico",
};

/** Campos importantes para importação de clientes da carteira, na ordem que aparecem na tela */
const UPSELL_SYSTEM_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "name", label: "Nome", required: true },
  { key: "company", label: "Empresa" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "potencial", label: "Potencial" },
  { key: "data_primeira_venda", label: "Data Primeira Venda" },
  { key: "data_ultima_compra", label: "Data Última Compra" },
  { key: "vendedor", label: "Vendedor / Responsável" },
  { key: "stage", label: "Etapa" },
  { key: "faturamento", label: "Faturamento" },
  { key: "segment", label: "Segmento" },
  { key: "notes", label: "Notas / Observações" },
  { key: "origin", label: "Origem" },
];

/** Campos adicionais disponíveis quando a flag customer_portfolio está ativa */
const UPSELL_ORDER_FIELDS: { key: string; label: string }[] = [
  { key: "produto", label: "Produto" },
  { key: "quantidade", label: "Quantidade" },
  { key: "valor_unitario", label: "Valor Unitário" },
  { key: "unidade", label: "Unidade (un/kg/l/m/cx/pc)" },
  { key: "data_pedido", label: "Data do Pedido" },
  { key: "cnpj", label: "CNPJ" },
];

interface PreviewClient {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
}

type Step = "upload" | "select_sheet" | "map_columns" | "preview" | "importing" | "complete";

interface ImportError {
  row: number;
  reason: string;
}

interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  updated: number;
  invalid: number;
  errors: ImportError[];
}

interface ImportUpsellClientsContentProps {
  pipeType: CarteiraStageFamily;
  onDone?: () => void;
}

export function ImportUpsellClientsContent({
  pipeType,
  onDone,
}: ImportUpsellClientsContentProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [previewClients, setPreviewClients] = useState<PreviewClient[]>([]);
  const [totalClients, setTotalClients] = useState(0);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [userColumnMapping, setUserColumnMapping] = useState<Record<string, string>>({});
  const [selectedStageKey, setSelectedStageKey] = useState<string>("");
  const [selectedResponsibleId, setSelectedResponsibleId] = useState<string>("");
  const [selectedPotencial, setSelectedPotencial] = useState<string>("medio");
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [sampleData, setSampleData] = useState<Record<string, string>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { hasFeature } = useOrgFeatures();
  const hasPortfolio = hasFeature("customer_portfolio");
  const { data: stages = [] } = useCarteiraStages(pipeType);
  const { data: baseStages = [] } = useCarteiraStages("upsell_base");
  const { data: members = [] } = useTeamMembers();

  /** Combined field list — order fields only when feature flag is ON */
  const activeSystemFields = hasPortfolio
    ? [...UPSELL_SYSTEM_FIELDS, ...UPSELL_ORDER_FIELDS]
    : UPSELL_SYSTEM_FIELDS;

  const memberOptions = (members || []).map((m) => ({ id: m.id, name: m.name || "" }));
  const defaultStage = stages.find((s) => s.position === 0) || stages[0];

  /** Colunas do arquivo detectadas */
  const [fileColumns, setFileColumns] = useState<string[]>([]);

  const normalizeCol = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  /** Carrega preview de uma aba específica e vai direto para mapeamento.
   *  O mapeamento agora é INVERTIDO: campo do sistema → coluna do arquivo. */
  const loadSheetPreview = useCallback(
    async (targetFile: File, sheet?: string) => {
      try {
        const rows = await parseFileToRows(targetFile, sheet);
        if (rows.length === 0) {
          toast.error("A aba selecionada está vazia");
          return;
        }
        const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(Boolean);
        const sampleRows = rows.slice(0, 5);
        setSampleData(sampleRows);
        setTotalClients(rows.length);
        setFileColumns(columns);

        // Build suggested mapping: coluna arquivo → campo sistema (para inverter depois)
        const colToField: Record<string, string> = {};
        const preview = await parseFilePreview(targetFile);
        for (const col of columns) {
          if (preview.suggestedMapping[col]) {
            colToField[col] = preview.suggestedMapping[col];
          }
        }
        for (const col of columns) {
          const norm = normalizeCol(col);
          if (!colToField[col] && UPSELL_HEADER_ALIASES[norm]) {
            colToField[col] = UPSELL_HEADER_ALIASES[norm];
          }
        }

        // Inverter: campo sistema → coluna arquivo
        const fieldToCol: Record<string, string> = {};
        for (const [col, field] of Object.entries(colToField)) {
          if (!fieldToCol[field]) {
            fieldToCol[field] = col;
          }
        }

        // Pre-fill: todos os campos ativos → coluna sugerida ou "none"
        // activeSystemFields não está disponível aqui (hook state), por isso
        // inicializamos para todos os campos possíveis e filtramos na UI.
        const allFields = [...UPSELL_SYSTEM_FIELDS, ...UPSELL_ORDER_FIELDS];
        const initialMapping: Record<string, string> = {};
        for (const { key } of allFields) {
          initialMapping[key] = fieldToCol[key] || "none";
        }

        setPreviewResult({
          columns,
          sampleRows,
          suggestedMapping: colToField,
          unmappedColumns: columns.filter((c) => !colToField[c]),
          knownFields: [],
          totalRows: rows.length,
        });
        setUserColumnMapping(initialMapping);
        setStep("map_columns");
      } catch (error) {
        console.error("Error loading sheet:", error);
        toast.error("Erro ao processar a aba selecionada");
      }
    },
    []
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
      setSampleData([]);

      try {
        const sheets = await parseExcelSheetNames(selectedFile);

        if (sheets.length > 1) {
          // Multiple sheets — let user pick
          setSheetNames(sheets);
          setSelectedSheet(sheets[0]);
          setStep("select_sheet");
        } else {
          // Single sheet or CSV — go straight to mapping
          setSheetNames(sheets);
          setSelectedSheet(sheets[0] || "");
          await loadSheetPreview(selectedFile, sheets[0]);
        }
      } catch (error) {
        console.error("Error parsing file:", error);
        toast.error("Erro ao processar arquivo. Verifique o formato (CSV ou XLSX).");
      }
    },
    [loadSheetPreview]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const normalizeName = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

  const resolveSellerToId = (
    sellerName: string | undefined,
    membersList: { id: string; name: string }[],
    defaultId: string | null
  ): string | null => {
    if (!sellerName?.trim() || !membersList.length) return defaultId;
    const normalized = normalizeName(sellerName);
    if (!normalized) return defaultId;
    const withNorm = membersList.map((m) => ({ ...m, norm: normalizeName(m.name || "") })).filter((m) => m.norm);
    if (withNorm.length === 0) return defaultId;
    const exact = withNorm.find((m) => m.norm === normalized);
    if (exact) return exact.id;
    const contains = withNorm.find((m) => m.norm.includes(normalized) || normalized.includes(m.norm));
    if (contains) return contains.id;
    return defaultId;
  };

  const formatPhone = (phone: string): string => {
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
      digits = "55" + digits;
    }
    return digits;
  };

  const resolvePotencial = (value: string | undefined): "baixo" | "medio" | "alto" | "estrategico" => {
    if (!value?.trim()) return selectedPotencial as any;
    const norm = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return (POTENCIAL_ALIASES[norm] as any) || (selectedPotencial as any);
  };

  const parseDateValue = (value: string | undefined): string => {
    if (!value?.trim()) return new Date().toISOString();
    const trimmed = value.trim();
    const brMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (brMatch) {
      const [, d, m, y] = brMatch;
      const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      if (!isNaN(date.getTime())) return date.toISOString();
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    return new Date().toISOString();
  };

  const resolveStageFromName = (
    stageName: string | undefined,
    stagesList: { stage_key: string; name: string }[],
    defaultKey: string
  ): string => {
    if (!stageName?.trim() || !stagesList.length) return defaultKey;
    const norm = normalizeName(stageName);
    const exact = stagesList.find(
      (s) => normalizeName(s.name) === norm || normalizeName(s.stage_key) === norm
    );
    if (exact) return exact.stage_key;
    const contains = stagesList.find(
      (s) => normalizeName(s.name).includes(norm) || norm.includes(normalizeName(s.name))
    );
    if (contains) return contains.stage_key;
    return defaultKey;
  };

  /** Verifica se o campo "name" está mapeado a uma coluna do arquivo */
  const hasNameMapped = userColumnMapping["name"] != null && userColumnMapping["name"] !== "none";

  /** Converte mapeamento invertido (campo→coluna) para coluna→campo */
  const buildColToFieldMapping = (): Record<string, string> => {
    const mapping: Record<string, string> = {};
    for (const [field, col] of Object.entries(userColumnMapping)) {
      if (col && col !== "none") {
        mapping[col] = field;
      }
    }
    return mapping;
  };

  const applyMapping = (row: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [field, col] of Object.entries(userColumnMapping)) {
      if (col && col !== "none" && row[col] != null) {
        const val = String(row[col]).trim();
        if (val) result[field] = val;
      }
    }
    return result;
  };

  const handleContinueToPreview = async () => {
    if (!hasNameMapped) {
      toast.error("Mapeie pelo menos o campo Nome para continuar");
      return;
    }
    try {
      const rows = await parseFileToRows(file!, selectedSheet || undefined);
      const mapped = rows
        .map((row) => applyMapping(row))
        .filter((r) => r.name?.trim());

      setTotalClients(mapped.length);
      setPreviewClients(
        mapped.slice(0, 10).map((r) => ({
          name: r.name,
          company: r.company,
          phone: r.phone,
          email: r.email,
        }))
      );
      setSelectedStageKey(defaultStage?.stage_key ?? "");
      setStep("preview");
    } catch {
      toast.error("Erro ao processar arquivo. Verifique se o campo Nome está mapeado corretamente.");
    }
  };

  const handleImport = async () => {
    if (!file || !organizationId) {
      toast.error("Selecione um arquivo");
      return;
    }
    setStep("importing");
    setIsImporting(true);
    setProgress(0);

    try {
      // Single parse — correct sheet, no index mismatch
      const allRows = await parseFileToRows(file, selectedSheet || undefined);
      const rows = allRows
        .map((raw, idx) => ({ m: applyMapping(raw), raw, fileRow: idx + 2 }))
        .filter((r) => r.m.name?.trim());

      if (rows.length === 0) {
        throw new Error("Nenhum cliente válido encontrado");
      }

      // Deduplication: existing leads by phone
      const phones = rows.filter((r) => r.m.phone).map((r) => formatPhone(r.m.phone!));
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("id, phone, name, company, email")
        .eq("organization_id", organizationId)
        .in("phone", phones.length > 0 ? phones : ["__none__"]);

      const existingLeadsMap = new Map<string, { id: string; phone: string | null }>();
      existingLeads?.forEach((l) => {
        if (l.phone) existingLeadsMap.set(l.phone, l);
      });

      // Deduplication: existing upsell clients
      const { data: existingClients } = await supabase
        .from("upsell_clients")
        .select("id, lead_id, phone")
        .eq("organization_id", organizationId);
      const existingClientLeadIds = new Set((existingClients || []).map((c) => c.lead_id));
      const existingClientPhones = new Set(
        (existingClients || []).filter((c) => c.phone).map((c) => formatPhone(c.phone!))
      );

      let imported = 0;
      let duplicates = 0;
      let updated = 0;
      let invalid = 0;
      const errors: ImportError[] = [];
      const processedPhones = new Set<string>();
      const BATCH_SIZE = 25;
      const stagesList = stages.map((s) => ({ stage_key: s.stage_key, name: s.name }));
      const effectiveDefaultStageKey = selectedStageKey || stagesList[0]?.stage_key || "";

      // Determine if this import contains order-scope columns (customer_portfolio feature)
      const hasOrderColumns =
        hasPortfolio &&
        (userColumnMapping["produto"] != null && userColumnMapping["produto"] !== "none");

      // Map: clientKey → { upsellClientId, rows: MappedRow[] }
      // Used to batch-create orders after all clients are processed
      type OrderGroup = { upsellClientId: string; rows: Record<string, string>[] };
      const orderGroups = new Map<string, OrderGroup>();

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        for (const { m: lead, fileRow } of batch) {
          const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;
          if (formattedPhone && processedPhones.has(formattedPhone)) {
            duplicates++;
            continue;
          }

          if (formattedPhone && existingClientPhones.has(formattedPhone)) {
            duplicates++;
            if (formattedPhone) processedPhones.add(formattedPhone);
            continue;
          }

          try {
            let leadId: string;
            const existingLead = formattedPhone ? existingLeadsMap.get(formattedPhone) : null;

            if (existingLead) {
              leadId = existingLead.id;
              if (existingClientLeadIds.has(leadId)) {
                duplicates++;
                if (formattedPhone) processedPhones.add(formattedPhone);
                continue;
              }
            } else {
              const { data: newLead, error: leadError } = await supabase
                .from("leads")
                .insert({
                  organization_id: organizationId,
                  name: lead.name,
                  company: lead.company || null,
                  phone: formattedPhone || null,
                  email: lead.email || null,
                  faturamento: lead.faturamento || null,
                  segment: lead.segment || null,
                  notes: lead.notes || null,
                  origin: "outro" as const,
                })
                .select("id")
                .single();
              if (leadError || !newLead) {
                invalid++;
                errors.push({ row: fileRow, reason: `Erro ao criar lead: ${leadError?.message || "resposta vazia"}` });
                continue;
              }
              leadId = newLead.id;
            }

            const responsibleId = resolveSellerToId(
              lead.vendedor,
              memberOptions,
              selectedResponsibleId === "none" ? null : selectedResponsibleId || null
            );

            const potencial = resolvePotencial(lead.potencial);
            // first_sale_at: usa primeira venda; cai pra última compra quando só esta existe.
            const firstSaleAt = parseDateValue(lead.data_primeira_venda || lead.data_ultima_compra);
            const stageKey = resolveStageFromName(lead.stage, stagesList, effectiveDefaultStageKey);

            const baseStageKey = baseStages.find((s) => s.position === 0)?.stage_key || baseStages[0]?.stage_key || "0-3m";
            const tipoClienteTempo = pipeType === "upsell_base" ? stageKey : baseStageKey;

            // Última compra → last_order_at direto (sem order). Quando presente,
            // semeia recência/saúde iniciais; o cron calculate-portfolio-health
            // (patchado) preserva e refina, pois esses clientes têm 0 orders.
            const lastOrderAt = lead.data_ultima_compra ? parseDateValue(lead.data_ultima_compra) : null;
            const REORDER_CYCLE_FALLBACK = 30;
            const lastOrderFields = lastOrderAt
              ? {
                  last_order_at: lastOrderAt,
                  days_since_last_order: Math.round(
                    Math.abs(Date.now() - new Date(lastOrderAt).getTime()) / 86_400_000,
                  ),
                  reorder_cycle_days: REORDER_CYCLE_FALLBACK,
                  next_order_expected: new Date(
                    new Date(lastOrderAt).getTime() + REORDER_CYCLE_FALLBACK * 86_400_000,
                  ).toISOString(),
                  health_score: 70,
                  health_status: "atencao",
                  segment: "novo",
                }
              : {};

            const clientData = {
              organization_id: organizationId,
              lead_id: leadId,
              name: lead.name,
              company: lead.company || null,
              email: lead.email || null,
              phone: formattedPhone || null,
              potencial,
              responsible_id: responsibleId,
              closer_id: responsibleId,
              sale_responsible_id: responsibleId,
              first_sale_at: firstSaleAt,
              tipo_cliente_tempo: tipoClienteTempo,
              ...lastOrderFields,
              ...(pipeType === "upsell_gestao"
                ? { gestao_stage: stageKey, gestao_manual_override: true }
                : {}),
            };

            if (responsibleId) {
              await supabase.from("leads").update({ responsible_id: responsibleId, closer_id: responsibleId, sale_responsible_id: responsibleId }).eq("id", leadId);
            }

            const { data: insertedClient, error: clientError } = await supabase
              .from("upsell_clients")
              .insert(clientData)
              .select("id")
              .single();

            if (clientError) {
              if (clientError.code === "23505") {
                duplicates++;
              } else {
                console.error(`[ImportUpsell] Row ${fileRow} error:`, clientError.message, clientError.code);
                invalid++;
                errors.push({ row: fileRow, reason: clientError.message || "Erro ao criar cliente upsell" });
              }
            } else {
              imported++;
              existingClientLeadIds.add(leadId);

              // Collect rows for order creation if customer_portfolio is active
              if (hasOrderColumns && insertedClient) {
                const clientKey = formattedPhone || `${normalizeName(lead.name)}__${normalizeName(lead.company || "")}`;
                const existing = orderGroups.get(clientKey);
                if (existing) {
                  existing.rows.push(lead);
                } else {
                  orderGroups.set(clientKey, { upsellClientId: insertedClient.id, rows: [lead] });
                }
              }
            }

            if (formattedPhone) processedPhones.add(formattedPhone);
          } catch (err) {
            console.error(`[ImportUpsell] Row ${fileRow} unexpected error:`, err);
            invalid++;
            errors.push({ row: fileRow, reason: err instanceof Error ? err.message : "Erro inesperado" });
          }
        }
        setProgress(Math.round(((i + batch.length) / rows.length) * 100));
      }

      // ── Order creation (customer_portfolio) ────────────────────────────────
      if (hasOrderColumns && orderGroups.size > 0) {
        for (const [, group] of orderGroups) {
          // Group rows by data_pedido to create one order per date per client
          const byDate = new Map<string, Record<string, string>[]>();
          for (const row of group.rows) {
            const dateKey = row.data_pedido?.trim() || "__none__";
            const bucket = byDate.get(dateKey);
            if (bucket) {
              bucket.push(row);
            } else {
              byDate.set(dateKey, [row]);
            }
          }

          for (const [dateKey, dateRows] of byDate) {
            const soldAt =
              dateKey === "__none__" ? new Date().toISOString() : parseDateValue(dateKey);

            // Aggregate sale value: sum(quantidade * valor_unitario)
            let saleValue = 0;
            for (const row of dateRows) {
              const qty = parseFloat((row.quantidade || "1").replace(",", ".")) || 1;
              const unitPrice = parseFloat((row.valor_unitario || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
              saleValue += qty * unitPrice;
            }

            const productNames = dateRows
              .map((r) => r.produto?.trim())
              .filter(Boolean)
              .join(", ");

            // upsell_orders: client_id (não upsell_client_id), product_name/product_type/
            // sale_value são NOT NULL e sale_value tem CHECK > 0. Sem valor positivo,
            // não há order a criar (a recência já vem de last_order_at no cliente).
            if (!(saleValue > 0)) {
              continue;
            }

            const { data: newOrder, error: orderError } = await supabase
              .from("upsell_orders")
              .insert({
                organization_id: organizationId,
                client_id: group.upsellClientId,
                source: "csv_import",
                // Histórico importado entra aprovado — conta na métrica (recompute síncrono).
                approval_status: "approved",
                approved_at: new Date().toISOString(),
                sale_value: saleValue,
                product_name: productNames || "Importação",
                product_type: "unitario",
                sold_at: soldAt,
              })
              .select("id")
              .single();

            if (orderError) {
              console.error("[ImportUpsell] Order insert error:", orderError.message);
              continue;
            }

            if (newOrder) {
              // Create line items
              const lineItems = dateRows.map((row) => ({
                order_id: newOrder.id,
                product_name: row.produto?.trim() || null,
                quantity: parseFloat((row.quantidade || "1").replace(",", ".")) || 1,
                unit_price: parseFloat((row.valor_unitario || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0,
                unit: row.unidade?.trim() || null,
              }));

              const { error: itemsError } = await supabase
                .from("client_purchase_items")
                .insert(lineItems);

              if (itemsError) {
                console.error("[ImportUpsell] Line items insert error:", itemsError.message);
              }
            }
          }
        }

        queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
        queryClient.invalidateQueries({ queryKey: ["client_purchase_items"] });
      }
      // ───────────────────────────────────────────────────────────────────────

      setProgress(100);
      setResult({ total: rows.length, imported, duplicates, updated, invalid, errors });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setStep("complete");
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Erro durante a importação");
      setStep("preview");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setSheetNames([]);
    setSelectedSheet("");
    setPreviewClients([]);
    setTotalClients(0);
    setPreviewResult(null);
    setUserColumnMapping({});
    setSampleData([]);
    setFileColumns([]);
    setSelectedStageKey("");
    setSelectedResponsibleId("");
    setSelectedPotencial("medio");
    setProgress(0);
    setResult(null);
    setShowErrors(false);
    onDone?.();
  };

  const pipeLabel = pipeType === "upsell_base" ? "Carteira Base" : "Carteira Gestão";

  // Count mapped fields (non-none)
  const mappedCount = Object.values(userColumnMapping).filter((v) => v && v !== "none").length;

  return (
    <AnimatePresence mode="wait">
      {/* ========== STEP: UPLOAD ========== */}
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
            <Button variant="ghost" size="sm" className="text-primary gap-2" onClick={downloadUpsellImportTemplate}>
              <FileDown className="w-4 h-4" />
              Baixar modelo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O modelo traz as colunas certas e uma aba <strong>Instruções</strong> com passos e o que preencher em cada campo.
          </p>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">
              Aceita qualquer planilha. Na próxima tela você escolhe qual coluna corresponde a cada campo (Nome, Telefone, etc).
            </p>
          </div>
        </motion.div>
      )}

      {/* ========== STEP: SELECT SHEET ========== */}
      {step === "select_sheet" && (
        <motion.div
          key="select_sheet"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-sm">{file?.name}</p>
              <p className="text-xs text-muted-foreground">{sheetNames.length} abas encontradas</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Table2 className="w-3.5 h-3.5 text-primary" />
              Selecione a aba com os dados dos clientes
            </Label>
            <div className="space-y-2">
              {sheetNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setSelectedSheet(name)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedSheet === name
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  }`}
                >
                  <span className="text-sm font-medium">{name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setStep("upload")}>
              Voltar
            </Button>
            <Button
              onClick={() => {
                if (selectedSheet && file) {
                  loadSheetPreview(file, selectedSheet);
                }
              }}
              disabled={!selectedSheet}
            >
              Continuar
            </Button>
          </div>
        </motion.div>
      )}

      {/* ========== STEP: MAP COLUMNS ========== */}
      {step === "map_columns" && (
        <motion.div
          key="map_columns"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
            <FileSpreadsheet className="w-6 h-6 text-primary" />
            <div>
              <p className="font-medium text-sm">{file?.name}{selectedSheet && selectedSheet !== "CSV" ? ` — ${selectedSheet}` : ""}</p>
              <p className="text-xs text-muted-foreground">{totalClients} linhas • {fileColumns.length} colunas na planilha • {mappedCount} campos mapeados</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-blue-800 dark:text-blue-200">Mapeie os campos</p>
              <p className="text-xs text-muted-foreground mt-1">
                Para cada campo do sistema, escolha qual coluna da planilha contém o dado. <strong>Nome</strong> é obrigatório.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Campos do sistema → Coluna da planilha</Label>
            <ScrollArea className="h-72 rounded-lg border">
              <div className="p-3 space-y-2.5">
                {activeSystemFields.map(({ key, label, required }) => {
                  const selectedCol = userColumnMapping[key] || "none";
                  const sample = selectedCol !== "none" ? sampleData[0]?.[selectedCol] : undefined;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <div className="shrink-0 w-[170px]">
                        <p className="text-sm font-medium">
                          {label}
                          {required && <span className="text-red-500 ml-0.5">*</span>}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-xs shrink-0">←</span>
                      <div className="flex-1 min-w-0">
                        <Select
                          value={selectedCol}
                          onValueChange={(v) => setUserColumnMapping((prev) => ({ ...prev, [key]: v }))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecionar coluna..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Não mapear —</SelectItem>
                            {fileColumns.map((col) => {
                              const colSample = sampleData[0]?.[col] || "";
                              return (
                                <SelectItem key={col} value={col}>
                                  {col}{colSample ? ` (ex: ${colSample.slice(0, 30)})` : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {sample && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate pl-1" title={sample}>
                            ex: {sample}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {!hasNameMapped && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">
                Mapeie o campo <strong>Nome</strong> a uma coluna da planilha para continuar.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => {
              if (sheetNames.length > 1) {
                setStep("select_sheet");
              } else {
                setStep("upload");
              }
            }}>
              Voltar
            </Button>
            <Button onClick={handleContinueToPreview} disabled={!hasNameMapped}>
              Continuar para preview
            </Button>
          </div>
        </motion.div>
      )}

      {/* ========== STEP: PREVIEW ========== */}
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
              <p className="text-xs text-muted-foreground">{totalClients} clientes encontrados</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Preview (primeiros 10)</Label>
            <ScrollArea className="h-40 rounded-lg border">
              <div className="p-2 space-y-1">
                {previewClients.map((client, index) => (
                  <div key={index} className="p-2 bg-muted/30 rounded text-sm">
                    <p className="font-medium">{client.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[client.company, client.phone, client.email].filter(Boolean).join(" • ") || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {stages.length > 0 && (
            <div className="space-y-2">
              <Label>Etapa padrão *</Label>
              <p className="text-xs text-muted-foreground mb-1">
                A coluna <strong>Etapa</strong> da planilha é usada automaticamente. Caso esteja vazia, usa a etapa selecionada abaixo.
              </p>
              <Select value={selectedStageKey} onValueChange={setSelectedStageKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.stage_key}>
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
          )}

          <div className="space-y-2">
            <Label>Potencial padrão</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Usado quando a coluna <strong>Potencial</strong> estiver vazia.
            </p>
            <Select value={selectedPotencial} onValueChange={setSelectedPotencial}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baixo">Baixo</SelectItem>
                <SelectItem value="medio">Medio</SelectItem>
                <SelectItem value="alto">Alto</SelectItem>
                <SelectItem value="estrategico">Estrategico</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="p-3 bg-muted/50 rounded-lg space-y-1">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              Reconhecimento automático
            </p>
            <p className="text-xs text-muted-foreground">
              As colunas <strong>Vendedor</strong>, <strong>Potencial</strong> e <strong>Data Primeira Venda</strong> são reconhecidas automaticamente quando mapeadas.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Responsável padrão</Label>
            <p className="text-xs text-muted-foreground -mt-1">Usado quando a coluna Vendedor estiver vazia.</p>
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

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setStep("map_columns")}>
              Voltar
            </Button>
            <Button onClick={handleImport} disabled={stages.length > 0 && !selectedStageKey}>
              Importar {totalClients} clientes
            </Button>
          </div>
        </motion.div>
      )}

      {/* ========== STEP: IMPORTING ========== */}
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
            <p className="font-medium">Importando clientes...</p>
            <p className="text-sm text-muted-foreground mt-1">{Math.round(progress)}% concluído</p>
          </div>
          <Progress value={progress} className="h-2" />
        </motion.div>
      )}

      {/* ========== STEP: COMPLETE ========== */}
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
              <p className="text-2xl font-bold text-blue-500">{result.updated}</p>
              <p className="text-xs text-muted-foreground">Atualizados</p>
            </div>
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

          {result.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-900">
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl"
                onClick={() => setShowErrors(!showErrors)}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  {result.errors.length} {result.errors.length === 1 ? "erro" : "erros"} encontrados
                </span>
                {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showErrors && (
                <ScrollArea className="max-h-48">
                  <div className="space-y-1 px-3 pb-3">
                    {result.errors.map((err, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-2">
                        <span className="text-red-500 font-mono shrink-0">
                          {err.row > 0 ? `L${err.row}` : ""}
                        </span>
                        <span>{err.reason}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <p className="text-sm text-center text-muted-foreground">
            {result.errors.length > 0
              ? `${result.imported} clientes entraram na ${pipeLabel}. Veja os erros acima.`
              : `Os clientes já estão na ${pipeLabel}.`}
          </p>
          <Button className="w-full" onClick={handleClose}>
            Fechar
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
