import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Papa from "papaparse";
import { useOrganization } from "./useOrganization";

/** Campos conhecidos do sistema (leads + UTM + funil). Custom fields são passados separadamente. */
export const KNOWN_LEAD_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "faturamento",
  "segment",
  "notes",
  "rating",
  "origin",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
  "urgency",
  "compromisso_date",
  "temperatura",
  "valor",
  "produto",
  "data_compromisso",
  "tempo_contrato",
  "observacoes_etapa",
  "stage", // Etapa do funil — mapeada automaticamente para as etapas do sistema
  "vendedor", // Responsável / Time — mapeado automaticamente ao vendedor da equipe
] as const;

/** Aliases comuns (header normalizado → campo sistema) para sugestão de mapeamento */
const HEADER_TO_FIELD: Record<string, string> = {
  nome: "name",
  "nome completo": "name",
  "lead título": "name",
  "nome do contato": "name",
  contato: "name",
  empresa: "company",
  "nome da empresa": "company",
  "razão social": "company",
  "nome fantasia": "company",
  email: "email",
  "e-mail": "email",
  "email comercial": "email",
  "email pessoal": "email",
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  fone: "phone",
  faturamento: "faturamento",
  "faixa de faturamento": "faturamento",
  segmento: "segment",
  setor: "segment",
  "segmento de atuação": "segment",
  prioridade: "rating",
  "prioridade do lead": "rating",
  origem: "origin",
  "público de origem": "origin",
  notas: "notes",
  observações: "notes",
  comentário: "notes",
  utm_campaign: "utm_campaign",
  "utm campaign": "utm_campaign",
  utm_source: "utm_source",
  "utm source": "utm_source",
  utm_medium: "utm_medium",
  "utm medium": "utm_medium",
  utm_content: "utm_content",
  "utm content": "utm_content",
  utm_term: "utm_term",
  "utm term": "utm_term",
  urgência: "urgency",
  "data compromisso": "compromisso_date",
  "compromisso": "compromisso_date",
  temperatura: "temperatura",
  "temperatura lead": "temperatura",
  calor: "temperatura",
  valor: "valor",
  "valor da proposta": "valor",
  "valor proposta": "valor",
  produto: "produto",
  "nome do produto": "produto",
  "data compromisso": "data_compromisso",
  "data do compromisso": "data_compromisso",
  "compromisso": "data_compromisso",
  "tempo c": "tempo_contrato",
  "tempo de contrato": "tempo_contrato",
  "duração contrato": "tempo_contrato",
  "observações etapa": "observacoes_etapa",
  "observacoes etapa": "observacoes_etapa",
  "observações": "observacoes_etapa",
  "obs etapa": "observacoes_etapa",
  // Etapa do funil (usada para mapear ao stage_key do pipeline)
  etapa: "stage",
  stage: "stage",
  estágio: "stage",
  "etapa (qualificação)": "stage",
  "etapa (propostas)": "stage",
  "etapa (confirmação)": "stage",
  fase: "stage",
  status: "stage",
  // Responsável / Time / Vendedor (mapeado ao membro da equipe)
  vendedor: "vendedor",
  responsável: "vendedor",
  responsavel: "vendedor",
  sdr: "vendedor",
  closer: "vendedor",
  time: "vendedor",
  equipe: "vendedor",
  "vendedor (qualificação)": "vendedor",
  "vendedor (propostas)": "vendedor",
  "vendedor (confirmação)": "vendedor",
  "atribuído a": "vendedor",
  "atribuido a": "vendedor",
};

export interface FilePreviewResult {
  columns: string[];
  sampleRows: Record<string, string>[];
  suggestedMapping: Record<string, string>;
  unmappedColumns: string[];
  knownFields: string[];
  totalRows: number;
}

export interface ColumnMappingOption {
  fileColumn: string;
  systemField: string;
  isCustomField?: boolean;
}

/** Lê CSV ou XLSX e retorna array de linhas (objetos chave = coluna). */
/** Retorna os nomes das abas de um arquivo Excel. Para CSV retorna ["CSV"]. */
export async function parseExcelSheetNames(file: File): Promise<string[]> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv")) return ["CSV"];
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) { resolve([]); return; }
          const wb = XLSX.read(data, { type: "binary" });
          resolve(wb.SheetNames);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsBinaryString(file);
    });
  }
  return [];
}

/** Lê CSV ou XLSX e retorna array de linhas. Para XLSX, pode escolher a aba pelo nome. */
export async function parseFileToRows(file: File, sheetName?: string): Promise<Record<string, string>[]> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv")) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: "UTF-8",
        complete: (r) => {
          const rows = (r.data || []) as Record<string, string>[];
          resolve(rows.map((row) => {
            const out: Record<string, string> = {};
            for (const k of Object.keys(row)) {
              const v = row[k];
              out[k] = v != null ? String(v).trim() : "";
            }
            return out;
          }));
        },
        error: (e) => reject(e),
      });
    });
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error("Arquivo vazio"));
            return;
          }
          const wb = XLSX.read(data, { type: "binary", cellDates: true });
          const targetSheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
          const sheet = wb.Sheets[targetSheet];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            header: 1,
            defval: "",
            raw: false,
          }) as unknown[][];
          if (json.length === 0) {
            resolve([]);
            return;
          }
          const headers = (json[0] || []).map((h) => String(h ?? "").trim());
          const rows: Record<string, string>[] = [];
          for (let i = 1; i < json.length; i++) {
            const arr = json[i] as unknown[] || [];
            const row: Record<string, string> = {};
            headers.forEach((h, j) => {
              const v = arr[j];
              row[h] = v != null ? String(v).trim() : "";
            });
            rows.push(row);
          }
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsBinaryString(file);
    });
  }
  return Promise.reject(new Error("Formato não suportado. Use CSV ou XLSX."));
}

const normalizeForPreview = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Faz preview do arquivo: colunas, amostra, sugestão de mapeamento e colunas não mapeadas.
 * Use antes de importar para notificar o usuário a mapear ou criar custom field.
 */
export function parseFilePreview(
  file: File,
  customFieldNames: string[] = []
): Promise<FilePreviewResult> {
  const knownFields = [...KNOWN_LEAD_FIELDS, ...customFieldNames];
  const customSet = new Set(customFieldNames.map(normalizeForPreview));

  return parseFileToRows(file).then((rows) => {
    if (rows.length === 0) {
      return {
        columns: [],
        sampleRows: [],
        suggestedMapping: {},
        unmappedColumns: [],
        knownFields: [...knownFields],
        totalRows: 0,
      };
    }
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(Boolean);
    const sampleRows = rows.slice(0, 10);
    const suggestedMapping: Record<string, string> = {};
    const mappedNormalized = new Set<string>();

    for (const col of columns) {
      const norm = normalizeForPreview(col);
      if (HEADER_TO_FIELD[norm]) {
        suggestedMapping[col] = HEADER_TO_FIELD[norm];
        mappedNormalized.add(norm);
      } else if (customSet.has(norm)) {
        const customName = customFieldNames.find((n) => normalizeForPreview(n) === norm);
        if (customName) suggestedMapping[col] = `custom:${customName}`;
        mappedNormalized.add(norm);
      }
    }

    const unmappedColumns = columns.filter((col) => !suggestedMapping[col]);

    return {
      columns,
      sampleRows,
      suggestedMapping,
      unmappedColumns,
      knownFields: [...knownFields],
      totalRows: rows.length,
    };
  });
}

interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  updated: number; // Leads that were updated with new data
  invalid: number;
  distribution?: Record<string, number>;
}

interface ParsedLead {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  faturamento?: string;
  segment?: string;
  notes?: string;
  kommoBlock?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
  rating?: number; // From "Prioridade do lead"
  origin?: string; // From "Público de origem"
  /** Nome da etapa na planilha (ex: "Novo", "Abordado"). Será mapeado para stage_key na importação. */
  stage?: string;
  /** Nome do vendedor/responsável na planilha. Será mapeado ao vendedor com nome mais parecido no sistema. */
  seller_name?: string;
  /** Temperatura/calor do lead (1-10). Usado no funil de propostas. */
  calor?: number;
  /** Valor da proposta em número. Usado no funil de propostas. */
  valor_proposta?: number;
  /** Nome do produto na planilha. Será mapeado ao produto com nome mais parecido no sistema. */
  product_name?: string;
  /** Data de compromisso (ISO ou DD/MM/YYYY). Usado em propostas/confirmação. */
  commitment_date?: string;
  /** Tempo de contrato em meses (número). Tempo C. */
  contract_duration?: number;
  /** Observações da etapa no funil (pipe_notes). */
  pipe_notes?: string;
}

export type FunnelDestination = "qualificacao" | "propostas" | "confirmacao";

export interface ImportLeadsToFunnelOptions {
  destination: FunnelDestination;
  /** Etapa padrão quando a linha não tem coluna Etapa ou o valor não corresponde a nenhuma etapa. */
  stageKey: string;
  /** Lista de etapas do funil para mapear nome (planilha) → stage_key. Se informada, cada lead usa a etapa da coluna Etapa quando existir. */
  stages?: { stage_key: string; name: string }[];
  /** Lista de vendedores (id, name) para mapear nome (planilha) → id. Se informada, cada lead usa o vendedor com nome mais parecido. */
  members?: { id: string; name: string }[];
  /** Lista de produtos (id, name) para mapear nome (planilha) → id. Usado no funil de propostas. */
  products?: { id: string; name: string }[];
  /** Mapeamento coluna do arquivo → campo do sistema (para parseCSV). */
  userColumnMapping?: Record<string, string>;
  sdrId?: string | null;
  closerId?: string | null;
  /** Período para métricas: mês (1-12) e ano. Quando informado, leads importados contam no mês/ano indicado em vez do mês atual. */
  metricsPeriodMonth?: number;
  metricsPeriodYear?: number;
}

/** Normaliza nome para comparação (lowercase, sem acentos, trim). */
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolve o nome do vendedor (planilha) para id usando a lista de membros.
 * Retorna o id do vendedor com nome mais parecido (exato, depois contém, depois mais próximo).
 */
export function resolveSellerToId(
  sellerName: string | undefined,
  members: { id: string; name: string }[],
  defaultId: string | null
): string | null {
  if (!sellerName || !sellerName.trim() || !members.length) return defaultId;
  const normalized = normalizeName(sellerName);
  if (!normalized) return defaultId;
  const withNorm = members.map((m) => ({ ...m, norm: normalizeName(m.name || "") })).filter((m) => m.norm);
  if (withNorm.length === 0) return defaultId;
  const exact = withNorm.find((m) => m.norm === normalized);
  if (exact) return exact.id;
  const contains = withNorm.find((m) => m.norm.includes(normalized) || normalized.includes(m.norm));
  if (contains) return contains.id;
  const byLength = [...withNorm].sort((a, b) => {
    const distA = Math.abs(a.norm.length - normalized.length);
    const distB = Math.abs(b.norm.length - normalized.length);
    return distA - distB;
  });
  const closest = byLength[0];
  return closest ? closest.id : defaultId;
}

/**
 * Resolve o nome do produto (planilha) para id usando a lista de produtos.
 * Vincula automaticamente quando o nome é igual ou corresponde (exato, contém, ou mais próximo).
 */
export function resolveProductToId(
  productName: string | undefined,
  products: { id: string; name: string }[],
  defaultId: string | null
): string | null {
  if (!products.length) return defaultId;
  const raw = (productName || "").trim();
  if (!raw) return defaultId;
  const normalized = normalizeName(raw);
  if (!normalized) return defaultId;
  const withNorm = products
    .map((p) => ({ ...p, norm: normalizeName((p.name || "").trim()) }))
    .filter((p) => p.norm);
  if (withNorm.length === 0) return defaultId;
  const exact = withNorm.find((p) => p.norm === normalized);
  if (exact) return exact.id;
  const startsWith = withNorm.find((p) => p.norm.startsWith(normalized) || normalized.startsWith(p.norm));
  if (startsWith) return startsWith.id;
  const contains = withNorm.find((p) => p.norm.includes(normalized) || normalized.includes(p.norm));
  if (contains) return contains.id;
  const byLength = [...withNorm].sort((a, b) => {
    const distA = Math.abs(a.norm.length - normalized.length);
    const distB = Math.abs(b.norm.length - normalized.length);
    return distA - distB;
  });
  const closest = byLength[0];
  return closest ? closest.id : defaultId;
}

/** Normaliza texto para comparação (lowercase, sem acentos, trim, sem ✓/✗ no final). */
function normalizeStageName(s: string): string {
  return s
    .replace(/\s*[✓✗📅]\s*$/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/-/g, " "); // "D-5" e "D5" comparáveis
}

/** Cria versão comparável: "confirmar_d5" e "confirmar d 5" e "confirmar d5" matcheiam. */
function stageComparable(str: string): string {
  const n = normalizeStageName(str)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  return n;
}

/** Resolve o nome da etapa (planilha) para stage_key usando a lista de etapas do sistema. */
export function resolveStageFromName(
  stageName: string | undefined,
  stages: { stage_key: string; name: string }[],
  defaultStageKey: string
): string {
  if (!stageName || !stageName.trim()) return defaultStageKey;
  const inputNorm = stageComparable(stageName);
  if (!inputNorm) return defaultStageKey;
  // 1) Match exato (nome ou stage_key)
  const exact = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return n === inputNorm || k === inputNorm;
  });
  if (exact) return exact.stage_key;
  // 2) Match por inclusão (ex: "reuniao marcada" em "reuniao marcada" ou "Reunião Marcada")
  const contains = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return n.includes(inputNorm) || inputNorm.includes(n) || k.includes(inputNorm) || inputNorm.includes(k);
  });
  if (contains) return contains.stage_key;
  // 3) Match por começa com (ex: "confirmar" para "confirmar_d5")
  const startsWith = stages.find((s) => {
    const n = stageComparable(s.name);
    const k = stageComparable(s.stage_key);
    return inputNorm.startsWith(n) || n.startsWith(inputNorm) || inputNorm.startsWith(k) || k.startsWith(inputNorm);
  });
  if (startsWith) return startsWith.stage_key;
  return defaultStageKey;
}

export interface ImportFunnelResult {
  total: number;
  imported: number;
  duplicates: number;
  updated: number;
  invalid: number;
}

export function useImportLeads() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { organizationId } = useOrganization();

  const KOMMO_BLOCK_START = "--- Kommo (campos) ---";
  const KOMMO_BLOCK_END = "--- /Kommo (campos) ---";

  const normalizeHeader = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const stripKommoBlock = (notes: string) => {
    if (!notes) return notes;
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `${escape(KOMMO_BLOCK_START)}[\\s\\S]*?${escape(KOMMO_BLOCK_END)}\\n?`,
      "g"
    );
    return notes.replace(re, "").trim();
  };

  // Normalize faturamento value for consistent storage
  const normalizeFaturamento = (value: string): string => {
    if (!value) return "";
    
    // Convert snake_case and clean up
    let normalized = value
      .replace(/_/g, " ")
      .replace(/r\$/gi, "R$")
      .replace(/\s+/g, " ")
      .trim();
    
    // Map common patterns to standardized format
    const lower = normalized.toLowerCase();
    
    if (lower.includes("+1") && lower.includes("milhão")) return "+1 Milhão";
    if (lower.includes("500") && lower.includes("1 milh")) return "R$500 mil a R$1 milhão";
    if (lower.includes("250") && lower.includes("500")) return "R$250 mil a R$500 mil";
    if (lower.includes("100") && lower.includes("250")) return "R$100 mil a R$250 mil";
    if (lower.includes("50") && lower.includes("100")) return "R$50 mil a R$100 mil";
    
    return normalized;
  };

  const chooseBestValue = (
    field: "name" | "company" | "email" | "phone" | "faturamento" | "segment" | "utm",
    values: string[]
  ): string | undefined => {
    const cleaned = values.map(v => v.trim()).filter(Boolean);
    if (cleaned.length === 0) return undefined;

    const score = (v: string) => {
      const lower = v.toLowerCase();
      const isPlaceholder = /^(?:-+|n\/a|na|nao informado|não informado|sem info|sem informação|0)$/.test(lower);
      const digits = v.replace(/\D/g, "");

      let s = 0;
      if (isPlaceholder) s -= 1000;

      if (field === "email") {
        s += (v.includes("@") ? 1000 : 0) + v.length;
      } else if (field === "phone") {
        s += digits.length * 10 + v.length;
      } else if (field === "faturamento") {
        // Prefer values with "R$" or currency indicators
        s += (v.toLowerCase().includes("r$") ? 500 : 0);
        // Prefer values that look like ranges
        s += (v.toLowerCase().includes("mil") ? 300 : 0);
        s += digits.length * 20 + v.length;
      } else {
        s += v.length;
      }

      return s;
    };

    const best = cleaned.reduce((best, cur) => (score(cur) > score(best) ? cur : best), cleaned[0]);
    
    // Normalize faturamento values before returning
    if (field === "faturamento" && best) {
      return normalizeFaturamento(best);
    }
    
    return best;
  };

  const collectFieldValues = (
    row: Record<string, string>,
    exactColumns: string[],
    patternsOnNormalizedHeader: RegExp[]
  ) => {
    const keys = Object.keys(row);
    const matchedKeys = new Set<string>();
    const values: string[] = [];

    const tryAdd = (key: string) => {
      const value = row[key]?.trim();
      if (!value) return;
      matchedKeys.add(key);
      if (!values.includes(value)) values.push(value);
    };

    // 1) Exact column matches (priority order)
    for (const col of exactColumns) {
      const target = normalizeHeader(col);
      const found = keys.find(k => normalizeHeader(k) === target);
      if (found) tryAdd(found);
    }

    // 2) Pattern matches
    for (const key of keys) {
      const normalized = normalizeHeader(key);
      if (patternsOnNormalizedHeader.some(p => p.test(normalized))) {
        tryAdd(key);
      }
    }

    return { values, matchedKeys: Array.from(matchedKeys) };
  };

  const buildKommoBlock = (input: {
    nameValues: string[];
    companyValues: string[];
    emailValues: string[];
    phoneValues: string[];
    faturamentoValues: string[];
    segmentValues: string[];
    utm: {
      utm_campaign?: string;
      utm_source?: string;
      utm_medium?: string;
      utm_content?: string;
      utm_term?: string;
    };
    otherFields: Array<{ key: string; value: string }>;
  }) => {
    const lines: string[] = [KOMMO_BLOCK_START];

    const addList = (label: string, values: string[]) => {
      const cleaned = values.map(v => v.trim()).filter(Boolean);
      if (cleaned.length === 0) return;
      lines.push(`${label}: ${cleaned.join(" | ")}`);
    };

    addList("Nome(s)", input.nameValues);
    addList("Empresa(s)", input.companyValues);
    addList("Email(s)", input.emailValues);
    addList("Telefone(s)", input.phoneValues);
    addList("Faturamento(s)", input.faturamentoValues);
    addList("Segmento(s)", input.segmentValues);

    const utmPairs = Object.entries(input.utm).filter(([, v]) => !!v);
    if (utmPairs.length > 0) {
      lines.push("UTM:");
      for (const [k, v] of utmPairs) lines.push(`- ${k}: ${v}`);
    }

    if (input.otherFields.length > 0) {
      lines.push("Outros campos:");
      for (const { key, value } of input.otherFields) {
        lines.push(`- ${key}: ${value}`);
      }
    }

    lines.push(KOMMO_BLOCK_END);
    return lines.join("\n");
  };

  const mergeNotes = (
    existingNotes?: string | null,
    rawNotes?: string,
    kommoBlock?: string
  ): string | undefined => {
    let out = stripKommoBlock((existingNotes || "").trim());

    if (rawNotes?.trim()) {
      const incoming = rawNotes.trim();
      if (!out.includes(incoming)) {
        out = out
          ? `${out}\n\n--- Notas Kommo ---\n\n${incoming}`
          : incoming;
      }
    }

    if (kommoBlock?.trim()) {
      const incomingBlock = kommoBlock.trim();
      out = out ? `${out}\n\n${incomingBlock}` : incomingBlock;
    }

    return out.trim() || undefined;
  };

  const shouldReplaceValue = (
    existingValue: string | null | undefined,
    incomingValue: string | undefined,
    field: "name" | "company" | "email" | "phone" | "faturamento" | "segment" | "utm"
  ) => {
    if (!incomingValue?.trim()) return false;

    const isEmptyLike = (v: string | null | undefined) => {
      if (!v) return true;
      const t = v.trim();
      if (!t) return true;
      return /^(?:-+|n\/a|na|nao informado|não informado|sem info|sem informação|0)$/i.test(t);
    };

    if (isEmptyLike(existingValue)) return true;

    const existing = (existingValue || "").trim();
    const incoming = incomingValue.trim();
    if (existing === incoming) return false;

    if (field === "email") return !existing.includes("@") && incoming.includes("@");
    if (field === "phone") return existing.replace(/\D/g, "").length < incoming.replace(/\D/g, "").length;
    if (field === "faturamento") {
      const eDigits = existing.replace(/\D/g, "").length;
      const iDigits = incoming.replace(/\D/g, "").length;
      return iDigits > eDigits || incoming.length > existing.length;
    }

    // Name/company/segment/utm: prefer the more complete value
    return incoming.length > existing.length;
  };

  const parseCSV = async (file: File, userColumnMapping?: Record<string, string>): Promise<ParsedLead[]> => {
    const rows = await parseFileToRows(file);
    const leads: ParsedLead[] = [];
    if (rows.length > 0) {
      console.log("Columns found:", Object.keys(rows[0]));
    }
    for (const row of rows) {
            const usedKeys = new Set<string>();
            const rowForParse: Record<string, string> = { ...row };
            if (userColumnMapping) {
              for (const [fileCol, field] of Object.entries(userColumnMapping)) {
                if (field && field !== "ignore" && row[fileCol] != null) {
                  rowForParse[field] = String(row[fileCol]).trim();
                }
              }
            }

            // NOME COMPLETO - prioriza "Nome completo" que é o nome real do lead
            const nomeCompletoField = collectFieldValues(
              rowForParse,
              ["Nome completo"],
              []
            );
            nomeCompletoField.matchedKeys.forEach(k => usedKeys.add(k));
            const nomeCompleto = chooseBestValue("name", nomeCompletoField.values);

            // LEAD TÍTULO - pode ser nome da pessoa ou código (Lead #xxx)
            const leadTituloField = collectFieldValues(
              rowForParse,
              ["Lead título"],
              []
            );
            leadTituloField.matchedKeys.forEach(k => usedKeys.add(k));
            const leadTitulo = chooseBestValue("name", leadTituloField.values);

            // EMPRESA - busca em múltiplas colunas
            const companyField = collectFieldValues(
              rowForParse,
              ["Nome da empresa", "Empresa", "Company", "Razão Social", "Nome fantasia", "Empresa lead 's"],
              [/empresa/, /\bcompany\b/, /razao/, /raz[aã]o/, /fantasia/]
            );
            companyField.matchedKeys.forEach(k => usedKeys.add(k));
            let company = chooseBestValue("company", companyField.values);

            // Lógica para determinar nome do lead e empresa:
            // 1. Se "Nome completo" existe e é diferente do "Lead título", nome completo é a pessoa
            // 2. Se "Lead título" parece código (Lead #xxx), ignorar para nome
            // 3. Se "Nome completo" contém "/" ou "|", separar nome/empresa
            let name: string | undefined;
            
            const isLeadCode = (v: string) => /^Lead\s*#\d+/i.test(v.trim());
            const looksLikeCompany = (v: string) => {
              const lower = v.toLowerCase();
              return /\b(ltda|eireli|me|epp|sa|s\.a\.|comercio|comércio|indústria|industria|distribuidora|fabrica|fábrica|loja|store|shop|consultoria|agência|agencia|clinic|clínica|restaurante|bar|padaria|mercado|supermercado|atacado|varejo|cosmet|alimentos|foods|sorvetes|beauty|gourmet)\b/i.test(lower);
            };

            // Função para separar nome/empresa de strings como "Adriano Paixao | Evoluxe Cosméticos"
            const splitNameCompany = (value: string): { personName?: string; companyName?: string } => {
              // Tenta separar por | ou /
              const separators = [' | ', '|', ' / ', '/'];
              for (const sep of separators) {
                if (value.includes(sep)) {
                  const parts = value.split(sep).map(p => p.trim()).filter(Boolean);
                  if (parts.length >= 2) {
                    // Primeiro geralmente é a pessoa, segundo é a empresa
                    const first = parts[0];
                    const second = parts[1];
                    
                    // Se o primeiro parece empresa, inverter
                    if (looksLikeCompany(first) && !looksLikeCompany(second)) {
                      return { personName: second, companyName: first };
                    }
                    return { personName: first, companyName: second };
                  }
                }
              }
              return {};
            };

            if (nomeCompleto) {
              // Verificar se Nome completo contém separador (nome | empresa)
              const parsed = splitNameCompany(nomeCompleto);
              if (parsed.personName) {
                name = parsed.personName;
                if (!company && parsed.companyName) {
                  company = parsed.companyName;
                }
              } else if (looksLikeCompany(nomeCompleto) && leadTitulo && !isLeadCode(leadTitulo) && !looksLikeCompany(leadTitulo)) {
                // Nome completo parece empresa, Lead título parece pessoa
                name = leadTitulo;
                company = company || nomeCompleto;
              } else {
                name = nomeCompleto;
              }
              
              // Se ainda não tem empresa, tentar usar Lead título
              if (!company && leadTitulo && !isLeadCode(leadTitulo) && leadTitulo !== name) {
                if (looksLikeCompany(leadTitulo)) {
                  company = leadTitulo;
                }
              }
            } else if (leadTitulo && !isLeadCode(leadTitulo)) {
              // Não tem Nome completo, usar Lead título
              const parsed = splitNameCompany(leadTitulo);
              if (parsed.personName) {
                name = parsed.personName;
                if (!company && parsed.companyName) {
                  company = parsed.companyName;
                }
              } else {
                name = leadTitulo;
              }
            } else {
              // Fallback: buscar em outras colunas de nome
              const nameField = collectFieldValues(
                rowForParse,
                ["Nome", "Nome do contato", "Contato"],
                [/\bnome\b/, /\bname\b/, /contato/]
              );
              nameField.matchedKeys.forEach(k => usedKeys.add(k));
              name = chooseBestValue("name", nameField.values);
            }

            if (!name) continue;

            // TELEFONE
            const phoneField = collectFieldValues(
              rowForParse,
              ["Celular", "Telefone comercial", "Telefone", "Telefone pessoal", "WhatsApp", "Fone"],
              [/celular/, /telefone/, /\bphone\b/, /whatsapp/, /\bfone\b/, /\btel\b/]
            );
            phoneField.matchedKeys.forEach(k => usedKeys.add(k));
            const phone = chooseBestValue("phone", phoneField.values);

            // EMAIL
            const emailField = collectFieldValues(
              rowForParse,
              [
                "Email comercial",
                "Email pessoal",
                "Email",
                "E-mail",
                "E-mail comercial",
                "E-mail pessoal",
              ],
              [/\bemail\b/, /e-mail/, /\bmail\b/]
            );
            emailField.matchedKeys.forEach(k => usedKeys.add(k));
            const email = chooseBestValue("email", emailField.values);

            // Skip if no contact info
            if (!phone && !email) continue;

            // FATURAMENTO - multiple columns, choose best
            const faturamentoField = collectFieldValues(
              rowForParse,
              [
                "Qual o faturamento atual?",
                "Faixa de faturamento (b2b)",
                "Faixa de faturamento (b2b)*",
                "Faixa $$",
                "Faixa de faturamento (vendas)",
                "Faturamento",
                "Faturamento atual",
                "Faturamento mensal",
                "Receita",
                "Receita mensal",
                "Qual é o faturamento mensal atual da sua empresa?",
                "Faixa de faturamento",
                "Revenue",
              ],
              [/faturamento/, /faixa.*faturamento/, /faixa.*\$/, /receita/, /revenue/, /billing/]
            );
            faturamentoField.matchedKeys.forEach(k => usedKeys.add(k));
            const faturamento = chooseBestValue("faturamento", faturamentoField.values);

            // SEGMENTO - also look for "Segmento de Atuação" and "Tipo de empresa"
            const segmentField = collectFieldValues(
              rowForParse,
              ["Segmento de Atuação", "Segmento", "Setor", "Ramo", "Área de atuação", "Nicho", "Tipo de empresa"],
              [/segmento/, /setor/, /ramo/, /nicho/, /area/, /área/, /tipo.*empresa/]
            );
            segmentField.matchedKeys.forEach(k => usedKeys.add(k));
            const segment = chooseBestValue("segment", segmentField.values);

            // PRIORIDADE → RATING (Máxima=10, Alta=8, Média=5, Baixa=2)
            const prioridadeField = collectFieldValues(
              rowForParse,
              ["Prioridade do lead", "Prioridade"],
              [/prioridade/]
            );
            prioridadeField.matchedKeys.forEach(k => usedKeys.add(k));
            const prioridadeValue = chooseBestValue("name", prioridadeField.values);
            let rating: number | undefined;
            if (prioridadeValue) {
              const pLower = prioridadeValue.toLowerCase();
              if (pLower.includes("máxima") || pLower.includes("maxima")) rating = 10;
              else if (pLower.includes("alta")) rating = 8;
              else if (pLower.includes("média") || pLower.includes("media")) rating = 5;
              else if (pLower.includes("baixa")) rating = 2;
            }

            // ORIGEM (Público de origem)
            const origemField = collectFieldValues(
              rowForParse,
              ["Público de origem"],
              [/publico.*origem/]
            );
            origemField.matchedKeys.forEach(k => usedKeys.add(k));
            const origemValue = chooseBestValue("name", origemField.values);

            // ETAPA (stage do funil/campanha - mapeada automaticamente às etapas do sistema)
            const etapaField = collectFieldValues(
              rowForParse,
              ["Etapa", "Stage", "Estágio", "Etapa (Qualificação)", "Etapa (Propostas)", "Etapa (Confirmação)", "Fase", "Status"],
              [/etapa/, /stage/, /est[aá]gio/, /fase/, /status/]
            );
            etapaField.matchedKeys.forEach(k => usedKeys.add(k));
            const stageValue = chooseBestValue("name", etapaField.values);

            // VENDEDOR / TIME (responsável - nome como na planilha; sistema associa ao membro mais parecido)
            const vendedorField = collectFieldValues(
              rowForParse,
              ["Vendedor", "Responsável", "SDR", "Closer", "Time", "Equipe", "Vendedor (Qualificação)", "Vendedor (Propostas)", "Vendedor (Confirmação)"],
              [/vendedor/, /respons[aá]vel/, /sdr/, /closer/, /time/, /equipe/, /atribuido|atribuído/]
            );
            vendedorField.matchedKeys.forEach(k => usedKeys.add(k));
            const sellerNameValue = chooseBestValue("name", vendedorField.values);

            // TEMPERATURA / CALOR (1-10), VALOR, PRODUTO, DATA COMPROMISSO, TEMPO CONTRATO, OBSERVAÇÕES ETAPA
            const temperaturaField = collectFieldValues(
              rowForParse,
              ["Temperatura", "Calor", "temperatura", "Temperatura (Propostas)"],
              [/temperatura/, /calor/]
            );
            temperaturaField.matchedKeys.forEach(k => usedKeys.add(k));
            const temperaturaStr = chooseBestValue("name", temperaturaField.values);
            let calor: number | undefined;
            if (temperaturaStr) {
              const n = parseInt(temperaturaStr.replace(/\D/g, ""), 10);
              if (!isNaN(n)) calor = Math.min(10, Math.max(1, n));
            }

            const valorField = collectFieldValues(
              rowForParse,
              ["Valor", "Valor da proposta", "Valor proposta", "Valor (Propostas)"],
              [/valor/, /proposta/]
            );
            valorField.matchedKeys.forEach(k => usedKeys.add(k));
            const valorStr = chooseBestValue("name", valorField.values);
            let valor_proposta: number | undefined;
            if (valorStr) {
              const cleaned = valorStr.replace(/R\$\s*/gi, "").replace(/\./g, "").replace(",", ".");
              const n = parseFloat(cleaned);
              if (!isNaN(n)) valor_proposta = n;
            }

            const produtoField = collectFieldValues(
              rowForParse,
              ["produto", "Produto", "Nome do produto", "Produto (Propostas)", "Product", "Produto 2", "Produto 3", "Product 2", "Product 3"],
              [/produto/, /product/]
            );
            produtoField.matchedKeys.forEach(k => usedKeys.add(k));
            // Coletar todos os produtos: múltiplas colunas (Produto, Produto 2, etc.) e valores separados por , ; ou quebra de linha
            const productNameParts = produtoField.values.flatMap((v) =>
              (v || "")
                .trim()
                .split(/[\n,;]+/)
                .map((s) => s.trim())
                .filter(Boolean)
            );
            const product_name = productNameParts.length > 0 ? productNameParts.join("; ") : undefined;

            const dataCompromissoField = collectFieldValues(
              rowForParse,
              ["Data Compromisso", "Data do Compromisso", "Data compromisso", "Compromisso"],
              [/data.*compromisso/, /compromisso/, /data.*reuniao/]
            );
            dataCompromissoField.matchedKeys.forEach(k => usedKeys.add(k));
            const commitmentDateStr = chooseBestValue("name", dataCompromissoField.values);
            let commitment_date: string | undefined;
            if (commitmentDateStr?.trim()) {
              const s = commitmentDateStr.trim();
              const ddmmyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s);
              if (ddmmyy) {
                const [, d, m, y] = ddmmyy;
                const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
                const date = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
                if (!isNaN(date.getTime())) commitment_date = date.toISOString();
              } else {
                const parsed = new Date(s);
                if (!isNaN(parsed.getTime())) commitment_date = parsed.toISOString();
              }
            }

            const tempoContratoField = collectFieldValues(
              rowForParse,
              ["Tempo C", "Tempo de contrato", "Duração contrato", "Tempo contrato"],
              [/tempo.*c/, /tempo.*contrato/, /dura[cç][aã]o.*contrato/]
            );
            tempoContratoField.matchedKeys.forEach(k => usedKeys.add(k));
            const tempoContratoStr = chooseBestValue("name", tempoContratoField.values);
            let contract_duration: number | undefined;
            if (tempoContratoStr) {
              const n = parseInt(tempoContratoStr.replace(/\D/g, ""), 10);
              if (!isNaN(n)) contract_duration = n;
            }

            const observacoesEtapaField = collectFieldValues(
              rowForParse,
              ["observacoes_etapa", "Observações etapa", "Observações", "Obs etapa", "Observações (etapa)"],
              [/observa[cç][oõ]es.*etapa/, /obs.*etapa/]
            );
            observacoesEtapaField.matchedKeys.forEach(k => usedKeys.add(k));
            const pipe_notes = chooseBestValue("name", observacoesEtapaField.values);

            // UTM (variações de header)
            const utm_campaign = chooseBestValue(
              "utm",
              collectFieldValues(rowForParse, ["utm_campaign", "UTM Campaign", "UTM campaign"], [/utm.*campaign/]).values
            );
            const utm_source = chooseBestValue(
              "utm",
              collectFieldValues(rowForParse, ["utm_source", "UTM Source", "UTM source"], [/utm.*source/]).values
            );
            const utm_medium = chooseBestValue(
              "utm",
              collectFieldValues(rowForParse, ["utm_medium", "UTM Medium", "UTM medium"], [/utm.*medium/]).values
            );
            const utm_content = chooseBestValue(
              "utm",
              collectFieldValues(rowForParse, ["utm_content", "UTM Content", "UTM content"], [/utm.*content/]).values
            );
            const utm_term = chooseBestValue(
              "utm",
              collectFieldValues(rowForParse, ["utm_term", "UTM Term", "UTM term"], [/utm.*term/]).values
            );

            // NOTES - concatena colunas de nota/observação
            const noteColumns = Object.keys(rowForParse).filter(key =>
              /nota|note|observa|comentario|comentário/.test(normalizeHeader(key))
            );
            noteColumns.forEach(k => usedKeys.add(k));
            const notes = noteColumns
              .map(col => rowForParse[col]?.trim())
              .filter(Boolean)
              .join("\n\n");

            // Outros campos: tudo o que tem valor e não foi mapeado acima
            const otherFields = Object.keys(rowForParse)
              .filter(key => {
                const value = rowForParse[key]?.trim();
                return !!value && !usedKeys.has(key);
              })
              .map(key => ({ key, value: rowForParse[key].trim() }));

            const kommoBlock = buildKommoBlock({
              nameValues: [nomeCompleto, leadTitulo, name].filter(Boolean) as string[],
              companyValues: companyField.values,
              emailValues: emailField.values,
              phoneValues: phoneField.values,
              faturamentoValues: faturamentoField.values,
              segmentValues: segmentField.values,
              utm: {
                utm_campaign,
                utm_source,
                utm_medium,
                utm_content,
                utm_term,
              },
              otherFields,
            });

            leads.push({
              name,
              company: company || undefined,
              phone: phone || undefined,
              email: email || undefined,
              faturamento: faturamento || undefined,
              segment: segment || undefined,
              notes: notes || undefined,
              kommoBlock,
              utm_campaign: utm_campaign || undefined,
              utm_source: utm_source || undefined,
              utm_medium: utm_medium || undefined,
              utm_content: utm_content || undefined,
              utm_term: utm_term || undefined,
              rating,
              origin: origemValue,
              stage: stageValue,
              seller_name: sellerNameValue,
              calor,
              valor_proposta,
              product_name: product_name || undefined,
              commitment_date,
              contract_duration,
              pipe_notes: pipe_notes || undefined,
            });
          }

    return leads;
  };

  const formatPhone = (phone: string): string => {
    // Remove all non-numeric characters
    const digits = phone.replace(/\D/g, "");
    
    // If starts with country code, keep it
    if (digits.startsWith("55") && digits.length >= 12) {
      return digits;
    }
    
    // Add Brazil country code if not present
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }
    
    return digits;
  };

  const importLeads = async (
    file: File,
    campanhaId: string,
    stageId: string,
    sdrId?: string,
    autoDistribute?: boolean,
    memberIds?: string[],
    /** Etapas da campanha (id, name) para mapear coluna Etapa da planilha → stage_id. Se informado, cada lead usa a etapa da coluna Etapa quando existir. */
    campaignStages?: { id: string; name: string }[],
    /** Modo de distribuição quando autoDistribute: round_robin (padrão) ou random */
    distributionMode?: "round_robin" | "random",
    closerMemberIds?: string[],
    closerDistributionMode?: "round_robin" | "random"
  ): Promise<ImportResult> => {
    setIsImporting(true);
    setProgress(0);
    setResult(null);

    try {
      // 1. Parse CSV
      const parsedLeads = await parseCSV(file);
      console.log(`Parsed ${parsedLeads.length} leads from CSV`);

      if (parsedLeads.length === 0) {
        throw new Error("Nenhum lead válido encontrado no arquivo");
      }

      // 2. Get existing leads by phone for duplicate check and potential update
      const phones = parsedLeads
        .filter(l => l.phone)
        .map(l => formatPhone(l.phone!));
      
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
        .in("phone", phones);

      // Create a map for quick lookup and update
      const existingLeadsMap = new Map<string, typeof existingLeads extends (infer T)[] ? T : never>();
      existingLeads?.forEach(l => {
        if (l.phone) existingLeadsMap.set(l.phone, l);
      });

      // 3. Create or get import tag
      const tagName = "Importação Kommo - Janeiro 2026";
      let tagId: string;

      const { data: existingTag } = await supabase
        .from("tags")
        .select("id")
        .eq("name", tagName)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag, error: tagError } = await supabase
          .from("tags")
          .insert({ name: tagName, color: "#f59e0b", organization_id: organizationId })
          .select("id")
          .single();

        if (tagError) throw tagError;
        tagId = newTag.id;
      }

      // 4. Import leads in batches
      const BATCH_SIZE = 25;
      let imported = 0;
      let duplicates = 0;
      let updated = 0;
      let invalid = 0;
      const distribution: Record<string, number> = {};
      let memberIndex = 0;
      const processedPhones = new Set<string>(); // Track phones processed in this import

      // Initialize distribution counter for all members; for round_robin, start from current campaign lead count so rotation continues
      if (autoDistribute && memberIds && memberIds.length > 0) {
        memberIds.forEach(id => {
          distribution[id] = 0;
        });
        if (distributionMode === "round_robin") {
          const { count } = await supabase
            .from("campanha_leads")
            .select("id", { count: "exact", head: true })
            .eq("campanha_id", campanhaId);
          memberIndex = count ?? 0;
        }
      }

      // Initialize closer distribution
      let closerIndex = 0;
      if (closerMemberIds && closerMemberIds.length > 0) {
        if (closerDistributionMode === "round_robin") {
          const { count } = await supabase
            .from("campanha_leads")
            .select("id", { count: "exact", head: true })
            .eq("campanha_id", campanhaId)
            .not("closer_id", "is", null);
          closerIndex = count ?? 0;
        }
      }

      for (let i = 0; i < parsedLeads.length; i += BATCH_SIZE) {
        const batch = parsedLeads.slice(i, i + BATCH_SIZE);

        for (const lead of batch) {
          const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;
          const stageIdForLead =
            campaignStages && campaignStages.length > 0
              ? resolveStageFromName(
                  lead.stage,
                  campaignStages.map((s) => ({ stage_key: s.id, name: s.name })),
                  stageId
                )
              : stageId;

          // Skip if already processed in this import
          if (formattedPhone && processedPhones.has(formattedPhone)) {
            duplicates++;
            continue;
          }

          // Check for existing lead
          const existingLead = formattedPhone ? existingLeadsMap.get(formattedPhone) : null;

          try {
            if (existingLead) {
              // Update existing lead with better/missing data
              const updates: Record<string, string | number | undefined> = {};

              if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
              if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
              if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
              if (shouldReplaceValue(existingLead.faturamento, lead.faturamento, "faturamento")) updates.faturamento = lead.faturamento;
              if (shouldReplaceValue(existingLead.segment, lead.segment, "segment")) updates.segment = lead.segment;

              if (shouldReplaceValue((existingLead as any).utm_campaign, lead.utm_campaign, "utm")) updates.utm_campaign = lead.utm_campaign;
              if (shouldReplaceValue((existingLead as any).utm_source, lead.utm_source, "utm")) updates.utm_source = lead.utm_source;
              if (shouldReplaceValue((existingLead as any).utm_medium, lead.utm_medium, "utm")) updates.utm_medium = lead.utm_medium;
              if (shouldReplaceValue((existingLead as any).utm_content, lead.utm_content, "utm")) updates.utm_content = lead.utm_content;
              if (shouldReplaceValue((existingLead as any).utm_term, lead.utm_term, "utm")) updates.utm_term = lead.utm_term;

              // Update rating if incoming is higher or existing is empty/0
              if (lead.rating && (!existingLead.rating || existingLead.rating < lead.rating)) {
                updates.rating = lead.rating;
              }

              // Merge notes (keeps existing notes + updates Kommo block without duplicating)
              const mergedNotes = mergeNotes(existingLead.notes, lead.notes, lead.kommoBlock);
              if (mergedNotes && mergedNotes !== (existingLead.notes || "")) {
                updates.notes = mergedNotes;
              }

              if (Object.keys(updates).length > 0) {
                await supabase
                  .from("leads")
                  .update(updates)
                  .eq("id", existingLead.id);
                updated++;
              } else {
                duplicates++;
              }

              // Check if lead is already in this campaign
              const { data: existingCampanhaLead } = await supabase
                .from("campanha_leads")
                .select("id")
                .eq("campanha_id", campanhaId)
                .eq("lead_id", existingLead.id)
                .maybeSingle();

              if (!existingCampanhaLead) {
                // Determine SDR for this lead
                let assignedSdrId: string | null = null;
                if (autoDistribute && memberIds && memberIds.length > 0) {
                  if (distributionMode === "random") {
                    assignedSdrId = memberIds[Math.floor(Math.random() * memberIds.length)];
                  } else {
                    assignedSdrId = memberIds[memberIndex % memberIds.length];
                    memberIndex++;
                  }
                  distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
                } else if (sdrId) {
                  assignedSdrId = sdrId;
                }

                // Determine Closer for this lead
                let assignedCloserId: string | null = null;
                if (closerMemberIds && closerMemberIds.length > 0) {
                  if (closerDistributionMode === "random") {
                    assignedCloserId = closerMemberIds[Math.floor(Math.random() * closerMemberIds.length)];
                  } else {
                    assignedCloserId = closerMemberIds[closerIndex % closerMemberIds.length];
                    closerIndex++;
                  }
                }

                // Add to campaign
                await supabase.from("campanha_leads").insert({
                  campanha_id: campanhaId,
                  lead_id: existingLead.id,
                  stage_id: stageIdForLead,
                  sdr_id: assignedSdrId,
                  closer_id: assignedCloserId,
                });

                if (assignedSdrId || assignedCloserId) {
                  const leadUpdates: Record<string, string> = {};
                  if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
                  if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
                  await supabase
                    .from("leads")
                    .update(leadUpdates)
                    .eq("id", existingLead.id);
                }

                // Add tag if not exists
                const { data: existingTagLink } = await supabase
                  .from("lead_tags")
                  .select("id")
                  .eq("lead_id", existingLead.id)
                  .eq("tag_id", tagId)
                  .maybeSingle();

                if (!existingTagLink) {
                  await supabase.from("lead_tags").insert({
                    lead_id: existingLead.id,
                    tag_id: tagId,
                  });
                }
              }

              if (formattedPhone) processedPhones.add(formattedPhone);
              continue;
            }

            // Insert new lead
            const { data: newLead, error: leadError } = await supabase
              .from("leads")
              .insert({
                name: lead.name,
                company: lead.company,
                phone: formattedPhone,
                email: lead.email,
                faturamento: lead.faturamento,
                segment: lead.segment,
                notes: mergeNotes(undefined, lead.notes, lead.kommoBlock),
                origin: "outro" as const,
                rating: lead.rating || 0,
                utm_campaign: lead.utm_campaign,
                utm_source: lead.utm_source,
                utm_medium: lead.utm_medium,
                utm_content: lead.utm_content,
                utm_term: lead.utm_term,
              })
              .select("id")
              .single();

            if (leadError) {
              console.error("Error inserting lead:", leadError);
              invalid++;
              continue;
            }

            // Determine SDR for this lead
            let assignedSdrId: string | null = null;
            if (autoDistribute && memberIds && memberIds.length > 0) {
              if (distributionMode === "random") {
                assignedSdrId = memberIds[Math.floor(Math.random() * memberIds.length)];
              } else {
                assignedSdrId = memberIds[memberIndex % memberIds.length];
                memberIndex++;
              }
              distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
            } else if (sdrId) {
              assignedSdrId = sdrId;
            }

            // Determine Closer for this lead
            let assignedCloserId: string | null = null;
            if (closerMemberIds && closerMemberIds.length > 0) {
              if (closerDistributionMode === "random") {
                assignedCloserId = closerMemberIds[Math.floor(Math.random() * closerMemberIds.length)];
              } else {
                assignedCloserId = closerMemberIds[closerIndex % closerMemberIds.length];
                closerIndex++;
              }
            }

            // Add to campaign
            await supabase.from("campanha_leads").insert({
              campanha_id: campanhaId,
              lead_id: newLead.id,
              stage_id: stageIdForLead,
              sdr_id: assignedSdrId,
              closer_id: assignedCloserId,
            });

            if (assignedSdrId || assignedCloserId) {
              const leadUpdates: Record<string, string> = {};
              if (assignedSdrId) leadUpdates.sdr_id = assignedSdrId;
              if (assignedCloserId) leadUpdates.closer_id = assignedCloserId;
              await supabase
                .from("leads")
                .update(leadUpdates)
                .eq("id", newLead.id);
            }

            // Add tag
            await supabase.from("lead_tags").insert({
              lead_id: newLead.id,
              tag_id: tagId,
            });

            // Add phone to processed set
            if (formattedPhone) {
              processedPhones.add(formattedPhone);
            }

            imported++;
          } catch (error) {
            console.error("Error processing lead:", error);
            invalid++;
          }
        }

        // Update progress
        const progressPercent = Math.round(((i + batch.length) / parsedLeads.length) * 100);
        setProgress(progressPercent);
      }

      const result: ImportResult = {
        total: parsedLeads.length,
        imported,
        duplicates,
        updated,
        invalid,
        distribution: autoDistribute ? distribution : undefined,
      };

      setResult(result);
      setProgress(100);
      
      return result;
    } catch (error) {
      console.error("Import error:", error);
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  const importLeadsToFunnel = async (
    file: File,
    options: ImportLeadsToFunnelOptions
  ): Promise<ImportFunnelResult> => {
    if (!organizationId) {
      throw new Error("Organização não encontrada");
    }
    setIsImporting(true);
    setProgress(0);
    setResult(null);

    try {
      const parsedLeads = await parseCSV(file, options.userColumnMapping);
      if (parsedLeads.length === 0) {
        throw new Error("Nenhum lead válido encontrado no arquivo");
      }

      const metricsPeriodAt =
        options.metricsPeriodMonth != null && options.metricsPeriodYear != null
          ? new Date(Date.UTC(options.metricsPeriodYear, options.metricsPeriodMonth - 1, 1)).toISOString()
          : undefined;

      let productsForPropostas = options.products ?? [];
      if (options.destination === "propostas" && productsForPropostas.length === 0) {
        const { data: productsFromDb } = await supabase
          .from("products")
          .select("id, name")
          .order("name");
        productsForPropostas = (productsFromDb || []).map((p) => ({ id: p.id, name: p.name || "" }));
      }

      const phones = parsedLeads
        .filter((l) => l.phone)
        .map((l) => formatPhone(l.phone!));
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("id, phone, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term")
        .eq("organization_id", organizationId)
        .in("phone", phones);

      const existingLeadsMap = new Map<string, (typeof existingLeads)[number]>();
      existingLeads?.forEach((l) => {
        if (l.phone) existingLeadsMap.set(l.phone, l);
      });

      let imported = 0;
      let duplicates = 0;
      let updated = 0;
      let invalid = 0;
      const processedPhones = new Set<string>();
      const BATCH_SIZE = 25;

      for (let i = 0; i < parsedLeads.length; i += BATCH_SIZE) {
        const batch = parsedLeads.slice(i, i + BATCH_SIZE);
        for (const lead of batch) {
          const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;
          if (formattedPhone && processedPhones.has(formattedPhone)) {
            duplicates++;
            continue;
          }
          const existingLead = formattedPhone ? existingLeadsMap.get(formattedPhone) : null;

          try {
            let leadId: string;
            if (existingLead) {
              leadId = existingLead.id;
              const updates: Record<string, unknown> = {};
              if (shouldReplaceValue(existingLead.name, lead.name, "name")) updates.name = lead.name;
              if (shouldReplaceValue(existingLead.company, lead.company, "company")) updates.company = lead.company;
              if (shouldReplaceValue(existingLead.email, lead.email, "email")) updates.email = lead.email;
              if (shouldReplaceValue(existingLead.faturamento, lead.faturamento, "faturamento")) updates.faturamento = lead.faturamento;
              if (shouldReplaceValue(existingLead.segment, lead.segment, "segment")) updates.segment = lead.segment;
              if (metricsPeriodAt != null) updates.metrics_period_at = metricsPeriodAt;
              if (Object.keys(updates).length > 0) {
                await supabase.from("leads").update(updates).eq("id", existingLead.id);
                updated++;
              } else {
                duplicates++;
              }
            } else {
              const leadInsert: Record<string, unknown> = {
                organization_id: organizationId,
                name: lead.name,
                company: lead.company,
                phone: formattedPhone,
                email: lead.email,
                faturamento: lead.faturamento,
                segment: lead.segment,
                notes: mergeNotes(undefined, lead.notes, lead.kommoBlock),
                origin: "outro" as const,
                rating: lead.rating || 0,
                utm_campaign: lead.utm_campaign,
                utm_source: lead.utm_source,
                utm_medium: lead.utm_medium,
                utm_content: lead.utm_content,
                utm_term: lead.utm_term,
              };
              if (metricsPeriodAt != null) leadInsert.metrics_period_at = metricsPeriodAt;
              const { data: newLead, error: leadError } = await supabase
                .from("leads")
                .insert(leadInsert)
                .select("id")
                .single();
              if (leadError) {
                invalid++;
                continue;
              }
              leadId = newLead.id;
              imported++;
            }

            const stageKeyForLead =
              options.stages && options.stages.length > 0
                ? resolveStageFromName(lead.stage, options.stages, options.stageKey)
                : options.stageKey;

            const members = options.members ?? [];
            const defaultSdrId = options.sdrId ?? null;
            const defaultCloserId = options.closerId ?? null;
            const assignedSdrId = (destination: "qualificacao" | "confirmacao") =>
              resolveSellerToId(lead.seller_name, members, destination === "qualificacao" ? defaultSdrId : defaultSdrId);
            const assignedCloserId = () =>
              resolveSellerToId(lead.seller_name, members, defaultCloserId);

            const sdrIdForLead = options.destination === "qualificacao" ? assignedSdrId("qualificacao") : options.destination === "confirmacao" ? assignedSdrId("confirmacao") : null;
            const closerIdForLead = options.destination === "propostas" ? assignedCloserId() : options.destination === "confirmacao" ? assignedCloserId() : null;
            if (sdrIdForLead !== null || closerIdForLead !== null) {
              const leadUpdates: Record<string, unknown> = {};
              if (sdrIdForLead !== null) leadUpdates.sdr_id = sdrIdForLead;
              if (closerIdForLead !== null) leadUpdates.closer_id = closerIdForLead;
              if (Object.keys(leadUpdates).length > 0) {
                await supabase.from("leads").update(leadUpdates).eq("id", leadId);
              }
            }

            if (options.destination === "qualificacao") {
              await supabase.from("pipe_whatsapp").insert({
                lead_id: leadId,
                status: stageKeyForLead,
                organization_id: organizationId,
                sdr_id: assignedSdrId("qualificacao"),
              });
            } else if (options.destination === "propostas") {
              const productNamesRaw = (lead.product_name || "").trim();
              const productNames = productNamesRaw
                ? productNamesRaw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
                : [];
              const productIds: string[] = [];
              for (const name of productNames) {
                const id = resolveProductToId(name, productsForPropostas, null);
                if (id) productIds.push(id);
              }
              const firstProductId = productIds.length > 0 ? productIds[0] : null;
              const totalValue = lead.valor_proposta ?? null;

              const propostaInsert: Record<string, unknown> = {
                lead_id: leadId,
                status: stageKeyForLead,
                organization_id: organizationId,
                closer_id: assignedCloserId(),
                sale_value: totalValue,
                calor: lead.calor ?? null,
                commitment_date: lead.commitment_date ?? null,
                contract_duration: lead.contract_duration ?? null,
                notes: lead.pipe_notes ?? null,
                product_id: firstProductId,
              };
              if (metricsPeriodAt != null) propostaInsert.metrics_period_at = metricsPeriodAt;
              const { data: newProposta, error: propostaError } = await supabase
                .from("pipe_propostas")
                .insert(propostaInsert)
                .select("id")
                .single();
              if (propostaError) {
                invalid++;
                continue;
              }
              const pipePropostaId = newProposta.id;
              if (productIds.length > 0) {
                const n = productIds.length;
                const valuePerItem = totalValue != null && n > 0 ? Math.floor(totalValue / n) : null;
                const remainder = totalValue != null && n > 0 ? totalValue - (valuePerItem ?? 0) * n : 0;
                const itemsToInsert = productIds.map((product_id, index) => ({
                  pipe_proposta_id: pipePropostaId,
                  product_id,
                  sale_value: totalValue != null && valuePerItem != null
                    ? (index < n - 1 ? valuePerItem : valuePerItem + remainder)
                    : null,
                }));
                await supabase.from("pipe_proposta_items").insert(itemsToInsert);
              }
            } else {
              const confirmacaoInsert: Record<string, unknown> = {
                lead_id: leadId,
                status: stageKeyForLead,
                organization_id: organizationId,
                sdr_id: assignedSdrId("confirmacao"),
                closer_id: assignedCloserId(),
                meeting_date: lead.commitment_date ?? null,
                notes: lead.pipe_notes ?? null,
              };
              if (metricsPeriodAt != null) confirmacaoInsert.metrics_period_at = metricsPeriodAt;
              await supabase.from("pipe_confirmacao").insert(confirmacaoInsert);
            }

            if (formattedPhone) processedPhones.add(formattedPhone);
          } catch (err) {
            console.error("Error processing lead:", err);
            invalid++;
          }
        }
        setProgress(Math.round(((i + batch.length) / parsedLeads.length) * 100));
      }

      const funnelResult: ImportFunnelResult = {
        total: parsedLeads.length,
        imported,
        duplicates,
        updated,
        invalid,
      };
      setProgress(100);
      setResult(funnelResult as ImportResult);
      return funnelResult;
    } catch (error) {
      console.error("Import funnel error:", error);
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  const resetImport = () => {
    setProgress(0);
    setResult(null);
  };

  // Função para corrigir leads existentes extraindo nome da pessoa do bloco Kommo
  const fixExistingLeadNames = async (campanhaId: string): Promise<{ fixed: number; errors: number }> => {
    let fixed = 0;
    let errors = 0;

    try {
      // Buscar todos os leads da campanha
      const { data: campanhaLeads, error: fetchError } = await supabase
        .from("campanha_leads")
        .select("lead_id, lead:leads(*)")
        .eq("campanha_id", campanhaId);

      if (fetchError || !campanhaLeads) {
        console.error("Error fetching campaign leads:", fetchError);
        return { fixed: 0, errors: 1 };
      }

      const looksLikeCompany = (v: string) => {
        const lower = v.toLowerCase();
        return /\b(ltda|eireli|me|epp|sa|s\.a\.|comercio|comércio|indústria|industria|distribuidora|fabrica|fábrica|loja|store|shop|consultoria|agência|agencia|clinic|clínica|restaurante|bar|padaria|mercado|supermercado|atacado|varejo|cosmet|alimentos|foods|sorvetes|beauty|gourmet|agroalimentos|panificadora|linguica|linguiça)\b/i.test(lower);
      };

      for (const cl of campanhaLeads) {
        const lead = cl.lead as any;
        if (!lead || !lead.notes) continue;

        // Extrair nome do bloco Kommo
        const kommoMatch = lead.notes.match(/--- Kommo \(campos\) ---[\s\S]*?Nome\(s\):\s*([^\n]+)/);
        if (!kommoMatch) continue;

        const namesLine = kommoMatch[1].trim();
        // Separar por | e pegar os nomes
        const names = namesLine.split('|').map((n: string) => n.trim()).filter(Boolean);
        
        if (names.length === 0) continue;

        // Encontrar o nome da pessoa (não é empresa)
        let personName: string | undefined;
        let companyName: string | undefined;

        for (const name of names) {
          if (looksLikeCompany(name)) {
            if (!companyName) companyName = name;
          } else {
            if (!personName) personName = name;
          }
        }

        // Se o nome atual parece empresa e encontramos um nome de pessoa, corrigir
        if (personName && looksLikeCompany(lead.name) && personName !== lead.name) {
          const updates: Record<string, string> = {
            name: personName,
          };
          
          // Se não tem empresa, usar o nome atual (que é a empresa)
          if (!lead.company) {
            updates.company = lead.name;
          }

          const { error: updateError } = await supabase
            .from("leads")
            .update(updates)
            .eq("id", lead.id);

          if (updateError) {
            console.error(`Error updating lead ${lead.id}:`, updateError);
            errors++;
          } else {
            console.log(`Fixed lead: ${lead.name} → ${personName} (company: ${updates.company || lead.company})`);
            fixed++;
          }
        }
      }

      return { fixed, errors };
    } catch (error) {
      console.error("Error fixing lead names:", error);
      return { fixed, errors: errors + 1 };
    }
  };

  return {
    parseCSV,
    importLeads,
    importLeadsToFunnel,
    resetImport,
    fixExistingLeadNames,
    isImporting,
    progress,
    result,
  };
}
