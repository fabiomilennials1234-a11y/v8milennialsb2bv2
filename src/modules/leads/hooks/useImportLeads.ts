import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Papa from "papaparse";
import { useOrganization } from "@/modules/identity";
/** Campos conhecidos do sistema (leads + UTM + funil). Custom fields são passados separadamente. */
export const KNOWN_LEAD_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "faturamento",
  "segment",
  "notes",
  "origin",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
  "urgency",
  "compromisso_date",
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
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);
    return workbook.worksheets.map((ws) => ws.name);
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
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(arrayBuffer);

    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    const targetSheetName = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
    const worksheet = workbook.getWorksheet(targetSheetName);
    if (!worksheet || worksheet.rowCount === 0) return [];

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? "").trim();
    });

    const rows: Record<string, string>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowObj: Record<string, string> = {};
      headers.forEach((h, j) => {
        const cell = row.getCell(j + 1);
        const v = cell.value;
        rowObj[h] = v != null ? String(v).trim() : "";
      });
      rows.push(rowObj);
    });

    return rows;
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
 * Lookup de alias normalizado (sem acento). `HEADER_TO_FIELD` tem chaves acentuadas
 * (ex. "p\u00fablico de origem"), mas o header de entrada chega sem acento via
 * `normalizeForPreview`. Sem este mapa, toda chave acentuada nunca casava e a coluna
 * aparecia como "n\u00e3o reconhecida" no modal de mapeamento.
 */
const HEADER_TO_FIELD_NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(HEADER_TO_FIELD).map(([key, field]) => [normalizeForPreview(key), field])
);

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
      if (HEADER_TO_FIELD_NORMALIZED[norm]) {
        suggestedMapping[col] = HEADER_TO_FIELD_NORMALIZED[norm];
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
  /** Leads importados sem telefone e sem email. */
  incomplete?: number;
  distribution?: Record<string, number>;
}

/** Relatório retornado pela Edge Function import-leads */
export interface EdgeFunctionReport {
  total: number;
  created: number;
  updated: number;
  rejected: number;
  /** Leads importados sem telefone e sem email. */
  incomplete?: number;
  errors: { row: number; reason: string }[];
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
  origin?: string; // From "Público de origem"
  /** Nome da etapa na planilha (ex: "Novo", "Abordado"). Será mapeado para stage_key na importação. */
  stage?: string;
  /** Nome do vendedor/responsável na planilha. Será mapeado ao vendedor com nome mais parecido no sistema. */
  seller_name?: string;
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
  /** Valores de campos personalizados (nome do campo → valor). Gravados em lead_custom_field_values pela edge. */
  customFields?: Record<string, string>;
}

export type FunnelDestination = "qualificacao" | "propostas" | "confirmacao";

export interface ImportLeadsToCustomPipelineOptions {
  pipelineId: string;
  /** ID da etapa padrão quando a coluna Etapa estiver vazia */
  stageId: string;
  /** Lista de etapas do pipeline para mapear nome → id */
  stages?: { id: string; name: string }[];
  /** Lista de vendedores para mapear nome → id */
  members?: { id: string; name: string }[];
  userColumnMapping?: Record<string, string>;
  sdrId?: string | null;
}

/**
 * Destino canônico unificado (SCRUM-635): QUALQUER funil por `pipelines.id`.
 * É o formato que a UI unificada (`/funil/:slug`) usa; os dois formatos
 * legados acima seguem aceitos pela edge até a W6.
 */
export interface ImportLeadsToPipelineOptions {
  /** `pipelines.id` do funil de destino (sistema ou custom). */
  pipelineId: string;
  /** Etapa padrão: uuid de `pipeline_stages` OU stage_key. */
  stage: string;
  /** Vendedores para mapear a coluna Vendedor (nome → id). */
  members?: { id: string; name: string }[];
  /** Produtos (nome → id) — usados quando o destino é o funil de Orçamentos. */
  products?: { id: string; name: string }[];
  userColumnMapping?: Record<string, string>;
  sdrId?: string | null;
  closerId?: string | null;
  metricsPeriodMonth?: number;
  metricsPeriodYear?: number;
}

/**
 * Importação SEM funil (tela de Leads): cria/atualiza a pessoa e para aí.
 *
 * Não há etapa a escolher porque não há funil — é a diferença inteira em
 * relação a `ImportLeadsToPipelineOptions`. O vendedor continua existindo: a
 * coluna Vendedor da planilha grava `responsible_id`/`sdr_id` no próprio lead,
 * que é onde a tela de Leads lê o responsável.
 */
export interface ImportLeadsOnlyOptions {
  /** Vendedores para mapear a coluna Vendedor (nome → id). */
  members?: { id: string; name: string }[];
  userColumnMapping?: Record<string, string>;
  /** Responsável usado quando a coluna Vendedor está vazia ou não casa ninguém. */
  responsibleId?: string | null;
  /** Mês (1-12) e ano em que estes leads devem contar nas métricas. */
  metricsPeriodMonth?: number;
  metricsPeriodYear?: number;
}

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

/**
 * Extrai UM telefone limpo de uma célula que pode conter vários números, prefixos
 * ou texto solto. Export Cauta/ERP traz coisas como:
 *   "(16)3234-1290 /(16)99778-0380 Bruno"  → dois números + nome
 *   "(15)3282-2223 (marcio)"               → número + nome
 *   "7,1994E+10"                            → notação científica do Excel
 *
 * Sem este passo, `parseCSV` mandava a célula crua como `phone`. A edge `import-leads`
 * tira todos os não-dígitos e gera string de 20+ dígitos → `validatePhone` (10-13)
 * REJEITA o lead inteiro ("telefone inválido") → lead some, com email e tudo.
 *
 * Estratégia: normaliza sci-notation, quebra em candidatos por separadores comuns
 * (/, ;, |, vírgula, quebra de linha, " e ", " ou "), reduz cada um a dígitos, mantém
 * só os com 10-11 dígitos locais (DDD + número; remove código país 55 quando presente)
 * e devolve o melhor (celular 11 dígitos > fixo 10). Sem candidato válido → undefined
 * (lead importa como incompleto em vez de ser rejeitado).
 */
export function pickBestPhone(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;

  // Notação científica do Excel (ponto ou vírgula pt-BR): "5.51E+12" / "7,1994E+10"
  let work = String(raw).trim();
  const dotted = work.replace(",", ".");
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(dotted)) {
    const num = Number(dotted);
    if (!isNaN(num) && num > 0) work = Math.round(num).toString();
  }

  const chunks = work.split(/[/;,|\n]|\s+ou\s+|\s+e\s+/i);
  const candidates: string[] = [];
  for (const chunk of chunks) {
    let digits = chunk.replace(/\D/g, "");
    if (!digits) continue;
    // Remove código de país BR quando vier junto (55 + 10/11 dígitos locais)
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2);
    }
    if (digits.length === 10 || digits.length === 11) candidates.push(digits);
  }
  if (candidates.length === 0) return undefined;

  // Prefere celular (11 dígitos) a fixo (10); empate mantém ordem de aparição.
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/**
 * Limpa célula de email: extrai o primeiro endereço com "@" válido. Export Cauta às
 * vezes traz "Email:foo@bar.com" (prefixo) ou "CNPJ:123..." (coluna desalinhada).
 * Sem "@" → undefined (não grava lixo no campo email do lead).
 */
export function cleanEmail(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const match = String(raw).match(/[^\s,;:|<>()]+@[^\s,;:|<>()]+\.[^\s,;:|<>()]+/);
  return match ? match[0].trim().toLowerCase() : undefined;
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
  /** Leads importados sem telefone e sem email. */
  incomplete?: number;
}

export function useImportLeads() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [lastReport, setLastReport] = useState<EdgeFunctionReport | null>(null);
  const { organizationId } = useOrganization();

  const KOMMO_BLOCK_START = "--- Kommo (campos) ---";
  const KOMMO_BLOCK_END = "--- /Kommo (campos) ---";

  const normalizeHeader = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

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
    const lines: string[] = [];

    // Campos estruturados só entram no bloco quando há MAIS DE UM valor distinto —
    // o valor único já está na coluna dedicada do lead (phone/email/company/...), então
    // repeti-lo na observação é puro ruído. Multi-valor (típico de export Kommo real,
    // ex. "Email(s): a | b") é preservado porque a coluna dedicada só guarda um.
    const addListIfMultiple = (label: string, values: string[]) => {
      const cleaned = [...new Set(values.map(v => v.trim()).filter(Boolean))];
      if (cleaned.length <= 1) return;
      lines.push(`${label}: ${cleaned.join(" | ")}`);
    };

    addListIfMultiple("Nome(s)", input.nameValues);
    addListIfMultiple("Empresa(s)", input.companyValues);
    addListIfMultiple("Email(s)", input.emailValues);
    addListIfMultiple("Telefone(s)", input.phoneValues);
    addListIfMultiple("Faturamento(s)", input.faturamentoValues);
    addListIfMultiple("Segmento(s)", input.segmentValues);

    // UTM omitido de propósito: já gravado em colunas dedicadas (utm_campaign/source/...).

    if (input.otherFields.length > 0) {
      lines.push("Outros campos:");
      for (const { key, value } of input.otherFields) {
        lines.push(`- ${key}: ${value}`);
      }
    }

    // Sem conteúdo → não envolver em marcadores (evita bloco vazio na observação).
    if (lines.length === 0) return "";
    return [KOMMO_BLOCK_START, ...lines, KOMMO_BLOCK_END].join("\n");
  };

  const parseCSV = async (file: File, userColumnMapping?: Record<string, string>): Promise<ParsedLead[]> => {
    const rows = await parseFileToRows(file);
    const leads: ParsedLead[] = [];
    if (rows.length > 0) {
      console.log("Columns found:", Object.keys(rows[0]));
    }
    for (const row of rows) {
            const usedKeys = new Set<string>();
            const customFieldValues: Record<string, string> = {};
            const rowForParse: Record<string, string> = { ...row };
            if (userColumnMapping) {
              for (const [fileCol, field] of Object.entries(userColumnMapping)) {
                if (field && field !== "ignore" && row[fileCol] != null) {
                  const value = String(row[fileCol]).trim();
                  // Campo personalizado (custom:<nome>): coleta pelo NOME (sem o prefixo) e
                  // consome a coluna de origem. A edge import-leads persiste em
                  // lead_custom_field_values. Antes, o valor vazava para "Outros campos"
                  // da observação (a UI oferecia o mapeamento mas nada gravava no campo).
                  if (field.startsWith("custom:")) {
                    const fieldName = field.slice("custom:".length);
                    if (fieldName && value) customFieldValues[fieldName] = value;
                    usedKeys.add(fileCol);
                    continue;
                  }
                  rowForParse[field] = value;
                  // Toda coluna mapeada explicitamente para um campo do sistema é consumida:
                  // seu valor vai para a coluna dedicada (ou metadata de etapa), nunca para
                  // "Outros campos" da observação. Sem isso, campos cujo nome não casa o
                  // próprio coletor (segment/origin/...) vazavam para o notes.
                  // Exceção: "notes" é capturado depois via noteColumns (lê pela chave),
                  // então consumi-lo aqui esvaziaria a observação legítima.
                  if (field !== "notes") {
                    usedKeys.add(field);
                    usedKeys.add(fileCol);
                  }
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
            // Extrai UM telefone válido por célula (multi-número, sci-notation, texto solto).
            // Ver pickBestPhone: sem isso a célula crua virava 20+ dígitos e a edge rejeitava o lead.
            const phoneCandidates = phoneField.values
              .map((v) => pickBestPhone(v))
              .filter((v): v is string => !!v);
            const phone = chooseBestValue("phone", phoneCandidates);

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
            // Extrai endereço com "@" válido por célula (corta prefixo "Email:" e células desalinhadas com CNPJ).
            const emailCandidates = emailField.values
              .map((v) => cleanEmail(v))
              .filter((v): v is string => !!v);
            const email = chooseBestValue("email", emailCandidates);

            // Leads sem telefone e sem email são permitidos (importados como incompletos)

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

            // PRIORIDADE — o campo saiu da interface (calor/rating, 2026-09-03).
            // A coluna continua sendo CONSUMIDA de propósito: sem marcar as
            // chaves em `usedKeys`, "Prioridade do lead" voltaria a vazar para
            // "Outros campos" da observação.
            collectFieldValues(
              rowForParse,
              ["Prioridade do lead", "Prioridade"],
              [/prioridade/]
            ).matchedKeys.forEach(k => usedKeys.add(k));

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

            // TEMPERATURA / CALOR saiu da interface (2026-09-03) — só consumimos
            // as chaves para que não vazem para a observação. VALOR, PRODUTO,
            // DATA COMPROMISSO, TEMPO CONTRATO e OBSERVAÇÕES ETAPA seguem.
            collectFieldValues(
              rowForParse,
              ["Temperatura", "Calor", "temperatura", "Temperatura (Propostas)"],
              [/temperatura/, /calor/]
            ).matchedKeys.forEach(k => usedKeys.add(k));

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

            // UTM (variações de header). Marca as colunas como consumidas (usedKeys) para
            // não vazarem em "Outros campos" da observação — já vão para colunas dedicadas.
            const collectUtm = (exact: string[], patterns: RegExp[]) => {
              const f = collectFieldValues(rowForParse, exact, patterns);
              f.matchedKeys.forEach(k => usedKeys.add(k));
              return chooseBestValue("utm", f.values);
            };
            const utm_campaign = collectUtm(["utm_campaign", "UTM Campaign", "UTM campaign"], [/utm.*campaign/]);
            const utm_source = collectUtm(["utm_source", "UTM Source", "UTM source"], [/utm.*source/]);
            const utm_medium = collectUtm(["utm_medium", "UTM Medium", "UTM medium"], [/utm.*medium/]);
            const utm_content = collectUtm(["utm_content", "UTM Content", "UTM content"], [/utm.*content/]);
            const utm_term = collectUtm(["utm_term", "UTM Term", "UTM term"], [/utm.*term/]);

            // NOTES - concatena colunas de nota/observação ainda não consumidas.
            // Exclui usedKeys: "Observações etapa" já virou pipe_notes; sem isso ela
            // duplicava na observação principal. Dedup de valores evita repetição quando
            // a coluna original e a chave mapeada (ex. "Notas" + "notes") coexistem.
            const noteColumns = Object.keys(rowForParse).filter(key =>
              !usedKeys.has(key) && /nota|note|observa|comentario|comentário/.test(normalizeHeader(key))
            );
            noteColumns.forEach(k => usedKeys.add(k));
            const notes = [...new Set(
              noteColumns.map(col => rowForParse[col]?.trim()).filter(Boolean)
            )].join("\n\n");

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
              origin: origemValue,
              stage: stageValue,
              seller_name: sellerNameValue,
              valor_proposta,
              product_name: product_name || undefined,
              commitment_date,
              contract_duration,
              pipe_notes: pipe_notes || undefined,
              customFields: Object.keys(customFieldValues).length ? customFieldValues : undefined,
            });
          }

    return leads;
  };

  /** Chama a Edge Function import-leads e retorna o relatório. */
  const callImportEdgeFunction = async (
    parsedLeads: ParsedLead[],
    payload: Record<string, unknown>,
  ): Promise<{ report: EdgeFunctionReport }> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const functionUrl = `${supabaseUrl}/functions/v1/import-leads`;

    // Get user JWT for authenticated request
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": anonKey,
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...payload,
        leads: parsedLeads,
        organization_id: organizationId,
      }),
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("Resposta inválida da função de importação");
    }

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Erro ${response.status} na importação`);
    }

    if (!data?.success) throw new Error(data?.error || "Erro desconhecido na importação");
    return { report: data.report as EdgeFunctionReport };
  };

  const importLeads = async (
    file: File,
    campanhaId: string,
    stageId: string,
    sdrId?: string,
    autoDistribute?: boolean,
    memberIds?: string[],
    campaignStages?: { id: string; name: string }[],
    distributionMode?: "round_robin" | "random",
    closerMemberIds?: string[],
    closerDistributionMode?: "round_robin" | "random",
    userColumnMapping?: Record<string, string>
  ): Promise<ImportResult> => {
    setIsImporting(true);
    setProgress(0);
    setResult(null);

    try {
      // 1. Parse file locally
      const parsedLeads = await parseCSV(file, userColumnMapping);
      console.log(`Parsed ${parsedLeads.length} leads from file`);

      if (parsedLeads.length === 0) {
        throw new Error("Nenhum lead válido encontrado no arquivo");
      }

      setProgress(20); // Parse done

      // 2. Send to Edge Function
      const { report } = await callImportEdgeFunction(parsedLeads, {
        destination: "campaign",
        campanha_id: campanhaId,
        stage_id: stageId,
        responsible_id: sdrId,
        sdr_id: sdrId,
        auto_distribute: autoDistribute,
        member_ids: memberIds,
        distribution_mode: distributionMode,
        closer_member_ids: closerMemberIds,
        closer_distribution_mode: closerDistributionMode,
        campaign_stages: campaignStages,
      });

      setLastReport(report);

      const duplicatePattern = /duplicado|ja existe|já existe|sem dados novos/i;
      const duplicatesCount = report.errors.filter((e) => duplicatePattern.test(e.reason)).length;
      const invalidCount = report.rejected - duplicatesCount;

      const result: ImportResult = {
        total: report.total,
        imported: report.created,
        duplicates: duplicatesCount,
        updated: report.updated,
        invalid: invalidCount < 0 ? report.rejected : invalidCount,
        incomplete: report.incomplete ?? 0,
        distribution: report.distribution,
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

      setProgress(20); // Parse done

      const { report } = await callImportEdgeFunction(parsedLeads, {
        destination: "funnel",
        funnel_destination: options.destination,
        stage_key: options.stageKey,
        stages: options.stages,
        members: options.members,
        products: options.products,
        responsible_id: options.sdrId || options.closerId,
        sdr_id: options.sdrId,
        closer_id: options.closerId,
        metrics_period_month: options.metricsPeriodMonth,
        metrics_period_year: options.metricsPeriodYear,
      });

      setLastReport(report);

      const duplicatePatternFunnel = /duplicado|ja existe|já existe|sem dados novos/i;
      const duplicatesFunnel = report.errors.filter((e) => duplicatePatternFunnel.test(e.reason)).length;
      const invalidFunnel = report.rejected - duplicatesFunnel;

      const funnelResult: ImportFunnelResult = {
        total: report.total,
        imported: report.created,
        duplicates: duplicatesFunnel,
        updated: report.updated,
        invalid: invalidFunnel < 0 ? report.rejected : invalidFunnel,
        incomplete: report.incomplete ?? 0,
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

  const importLeadsToCustomPipeline = async (
    file: File,
    options: ImportLeadsToCustomPipelineOptions,
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

      setProgress(20);

      const { report } = await callImportEdgeFunction(parsedLeads, {
        destination: "custom_pipeline",
        custom_pipeline_id: options.pipelineId,
        custom_stage_id: options.stageId,
        custom_stages: options.stages,
        members: options.members,
        sdr_id: options.sdrId,
      });

      setLastReport(report);

      const duplicatePattern = /duplicado|ja existe|já existe|sem dados novos/i;
      const duplicates = report.errors.filter((e) => duplicatePattern.test(e.reason)).length;
      const invalid = report.rejected - duplicates;

      const importResult: ImportFunnelResult = {
        total: report.total,
        imported: report.created,
        duplicates,
        updated: report.updated,
        invalid: invalid < 0 ? report.rejected : invalid,
        incomplete: report.incomplete ?? 0,
      };

      setProgress(100);
      setResult(importResult as ImportResult);
      return importResult;
    } catch (error) {
      console.error("Import custom pipeline error:", error);
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  /**
   * Caminho CANÔNICO (SCRUM-635): importa para QUALQUER funil por
   * `pipelines.id`. `importLeadsToFunnel` e `importLeadsToCustomPipeline`
   * seguem enviando os formatos legados (a edge colapsa os três no mesmo
   * motor `importToPipeline`) — este é o que a UI unificada consome.
   */
  const importLeadsToPipeline = async (
    file: File,
    options: ImportLeadsToPipelineOptions,
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

      setProgress(20);

      const { report } = await callImportEdgeFunction(parsedLeads, {
        destination: "pipeline",
        pipeline_id: options.pipelineId,
        pipeline_stage: options.stage,
        members: options.members,
        products: options.products,
        sdr_id: options.sdrId,
        closer_id: options.closerId,
        metrics_period_month: options.metricsPeriodMonth,
        metrics_period_year: options.metricsPeriodYear,
      });

      setLastReport(report);

      const duplicatePattern = /duplicado|ja existe|já existe|sem dados novos/i;
      const duplicates = report.errors.filter((e) => duplicatePattern.test(e.reason)).length;
      const invalid = report.rejected - duplicates;

      const importResult: ImportFunnelResult = {
        total: report.total,
        imported: report.created,
        duplicates,
        updated: report.updated,
        invalid: invalid < 0 ? report.rejected : invalid,
        incomplete: report.incomplete ?? 0,
      };

      setProgress(100);
      setResult(importResult as ImportResult);
      return importResult;
    } catch (error) {
      console.error("Import pipeline error:", error);
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  /**
   * Importa SÓ as pessoas — nenhum negócio é aberto.
   *
   * É o caminho da tela de Leads. A planilha é a mesma do funil (o parser, os
   * apelidos de coluna e o modelo baixável não mudam); o que muda é o destino:
   * a edge para depois de gravar o lead, sem tocar `pipeline_entries`. Colunas
   * de funil que venham na planilha (Etapa, Valor, Produto) são simplesmente
   * ignoradas aqui — não há onde gravá-las sem inventar um negócio.
   */
  const importLeadsOnly = async (
    file: File,
    options: ImportLeadsOnlyOptions = {},
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

      setProgress(20);

      const { report } = await callImportEdgeFunction(parsedLeads, {
        destination: "leads",
        members: options.members,
        responsible_id: options.responsibleId || undefined,
        sdr_id: options.responsibleId || undefined,
        metrics_period_month: options.metricsPeriodMonth,
        metrics_period_year: options.metricsPeriodYear,
      });

      setLastReport(report);

      const duplicatePattern = /duplicado|ja existe|já existe|sem dados novos/i;
      const duplicates = report.errors.filter((e) => duplicatePattern.test(e.reason)).length;
      const invalid = report.rejected - duplicates;

      const importResult: ImportFunnelResult = {
        total: report.total,
        imported: report.created,
        duplicates,
        updated: report.updated,
        invalid: invalid < 0 ? report.rejected : invalid,
        incomplete: report.incomplete ?? 0,
      };

      setProgress(100);
      setResult(importResult as ImportResult);
      return importResult;
    } catch (error) {
      console.error("Import leads-only error:", error);
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  const resetImport = () => {
    setProgress(0);
    setResult(null);
    setLastReport(null);
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
    importLeadsToCustomPipeline,
    importLeadsToPipeline,
    importLeadsOnly,
    resetImport,
    fixExistingLeadNames,
    isImporting,
    progress,
    result,
    /** Relatório detalhado da última importação (com erros por linha) */
    lastReport,
  };
}
