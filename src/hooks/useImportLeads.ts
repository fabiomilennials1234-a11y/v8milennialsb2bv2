import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Papa from "papaparse";

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
}

export function useImportLeads() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

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

  const parseCSV = (file: File): Promise<ParsedLead[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: "UTF-8",
        complete: (results) => {
          const leads: ParsedLead[] = [];
          
          // Log column names for debugging
          if (results.data.length > 0) {
            console.log("CSV Columns found:", Object.keys(results.data[0] as Record<string, string>));
          }
          
          for (const row of results.data as Record<string, string>[]) {
            const usedKeys = new Set<string>();

            // NOME COMPLETO - prioriza "Nome completo" que é o nome real do lead
            const nomeCompletoField = collectFieldValues(
              row,
              ["Nome completo"],
              []
            );
            nomeCompletoField.matchedKeys.forEach(k => usedKeys.add(k));
            const nomeCompleto = chooseBestValue("name", nomeCompletoField.values);

            // LEAD TÍTULO - pode ser nome da pessoa ou código (Lead #xxx)
            const leadTituloField = collectFieldValues(
              row,
              ["Lead título"],
              []
            );
            leadTituloField.matchedKeys.forEach(k => usedKeys.add(k));
            const leadTitulo = chooseBestValue("name", leadTituloField.values);

            // EMPRESA - busca em múltiplas colunas
            const companyField = collectFieldValues(
              row,
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
                row,
                ["Nome", "Nome do contato", "Contato"],
                [/\bnome\b/, /\bname\b/, /contato/]
              );
              nameField.matchedKeys.forEach(k => usedKeys.add(k));
              name = chooseBestValue("name", nameField.values);
            }

            if (!name) continue;

            // TELEFONE
            const phoneField = collectFieldValues(
              row,
              ["Celular", "Telefone comercial", "Telefone", "Telefone pessoal", "WhatsApp", "Fone"],
              [/celular/, /telefone/, /\bphone\b/, /whatsapp/, /\bfone\b/, /\btel\b/]
            );
            phoneField.matchedKeys.forEach(k => usedKeys.add(k));
            const phone = chooseBestValue("phone", phoneField.values);

            // EMAIL
            const emailField = collectFieldValues(
              row,
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
              row,
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
              row,
              ["Segmento de Atuação", "Segmento", "Setor", "Ramo", "Área de atuação", "Nicho", "Tipo de empresa"],
              [/segmento/, /setor/, /ramo/, /nicho/, /area/, /área/, /tipo.*empresa/]
            );
            segmentField.matchedKeys.forEach(k => usedKeys.add(k));
            const segment = chooseBestValue("segment", segmentField.values);

            // PRIORIDADE → RATING (Máxima=10, Alta=8, Média=5, Baixa=2)
            const prioridadeField = collectFieldValues(
              row,
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
              row,
              ["Público de origem"],
              [/publico.*origem/]
            );
            origemField.matchedKeys.forEach(k => usedKeys.add(k));
            const origemValue = chooseBestValue("name", origemField.values);

            // UTM (variações de header)
            const utm_campaign = chooseBestValue(
              "utm",
              collectFieldValues(row, ["utm_campaign", "UTM Campaign", "UTM campaign"], [/utm.*campaign/]).values
            );
            const utm_source = chooseBestValue(
              "utm",
              collectFieldValues(row, ["utm_source", "UTM Source", "UTM source"], [/utm.*source/]).values
            );
            const utm_medium = chooseBestValue(
              "utm",
              collectFieldValues(row, ["utm_medium", "UTM Medium", "UTM medium"], [/utm.*medium/]).values
            );
            const utm_content = chooseBestValue(
              "utm",
              collectFieldValues(row, ["utm_content", "UTM Content", "UTM content"], [/utm.*content/]).values
            );
            const utm_term = chooseBestValue(
              "utm",
              collectFieldValues(row, ["utm_term", "UTM Term", "UTM term"], [/utm.*term/]).values
            );

            // NOTES - concatena colunas de nota/observação
            const noteColumns = Object.keys(row).filter(key =>
              /nota|note|observa|comentario|comentário/.test(normalizeHeader(key))
            );
            noteColumns.forEach(k => usedKeys.add(k));
            const notes = noteColumns
              .map(col => row[col]?.trim())
              .filter(Boolean)
              .join("\n\n");

            // Outros campos: tudo o que tem valor e não foi mapeado acima
            const otherFields = Object.keys(row)
              .filter(key => {
                const value = row[key]?.trim();
                return !!value && !usedKeys.has(key);
              })
              .map(key => ({ key, value: row[key].trim() }));

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
            });
          }

          resolve(leads);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
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
    memberIds?: string[]
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
        .maybeSingle();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag, error: tagError } = await supabase
          .from("tags")
          .insert({ name: tagName, color: "#f59e0b" })
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

      // Initialize distribution counter for all members
      if (autoDistribute && memberIds && memberIds.length > 0) {
        memberIds.forEach(id => {
          distribution[id] = 0;
        });
      }

      for (let i = 0; i < parsedLeads.length; i += BATCH_SIZE) {
        const batch = parsedLeads.slice(i, i + BATCH_SIZE);
        
        for (const lead of batch) {
          const formattedPhone = lead.phone ? formatPhone(lead.phone) : undefined;
          
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
                  assignedSdrId = memberIds[memberIndex % memberIds.length];
                  memberIndex++;
                  distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
                } else if (sdrId) {
                  assignedSdrId = sdrId;
                }

                // Add to campaign
                await supabase.from("campanha_leads").insert({
                  campanha_id: campanhaId,
                  lead_id: existingLead.id,
                  stage_id: stageId,
                  sdr_id: assignedSdrId,
                });

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
              assignedSdrId = memberIds[memberIndex % memberIds.length];
              memberIndex++;
              distribution[assignedSdrId] = (distribution[assignedSdrId] || 0) + 1;
            } else if (sdrId) {
              assignedSdrId = sdrId;
            }

            // Add to campaign
            await supabase.from("campanha_leads").insert({
              campanha_id: campanhaId,
              lead_id: newLead.id,
              stage_id: stageId,
              sdr_id: assignedSdrId,
            });

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
    resetImport,
    fixExistingLeadNames,
    isImporting,
    progress,
    result,
  };
}
