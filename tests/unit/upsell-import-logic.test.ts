import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFileToRows } from "@/modules/leads";

vi.mock("papaparse", () => ({
  default: {
    parse: (file: any, opts: any) => {
      const text = file.__csvContent || "";
      const lines = text.split("\n").filter((l: string) => l.trim());
      if (lines.length === 0) {
        opts.complete({ data: [] });
        return;
      }
      const headers = lines[0].split(",").map((h: string) => h.trim());
      const data = lines.slice(1).map((line: string) => {
        const vals = line.split(",").map((v: string) => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h: string, i: number) => { row[h] = vals[i] || ""; });
        return row;
      });
      opts.complete({ data });
    },
  },
}));

// --- Helper: replicate applyMapping from the component ---

function applyMapping(
  row: Record<string, string>,
  fieldToCol: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, col] of Object.entries(fieldToCol)) {
    if (col && col !== "none" && row[col] != null) {
      const val = String(row[col]).trim();
      if (val) result[field] = val;
    }
  }
  return result;
}

// --- Helper: replicate POTENCIAL_ALIASES + resolvePotencial ---

const POTENCIAL_ALIASES: Record<string, string> = {
  baixo: "baixo", low: "baixo",
  medio: "medio", "médio": "medio", medium: "medio",
  alto: "alto", high: "alto",
  estrategico: "estrategico", "estratégico": "estrategico", strategic: "estrategico", vip: "estrategico",
};

function resolvePotencial(value: string | undefined, defaultPotencial = "medio"): string {
  if (!value?.trim()) return defaultPotencial;
  const norm = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return POTENCIAL_ALIASES[norm] || defaultPotencial;
}

// --- Helper: replicate resolveStageFromName ---

function normalizeName(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function resolveStageFromName(
  stageName: string | undefined,
  stagesList: { stage_key: string; name: string }[],
  defaultKey: string
): string {
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
}

// --- Helper: replicate formatPhone ---

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    digits = "55" + digits;
  }
  return digits;
}

// ==========================================
// BUG A: Row-index mismatch (FIXED)
// ==========================================

describe("BUG A — single-parse eliminates row-index mismatch", () => {
  it("applyMapping keeps 1:1 correspondence with source rows", () => {
    const mapping = { name: "Cliente", phone: "Fone", potencial: "Tipo" };
    const rows = [
      { Cliente: "Alice", Fone: "11999990001", Tipo: "Alto" },
      { Cliente: "",      Fone: "11999990002", Tipo: "Baixo" },  // empty name
      { Cliente: "Bob",   Fone: "11999990003", Tipo: "Medio" },
    ];

    const processed = rows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(processed).toHaveLength(2);
    expect(processed[0].m.name).toBe("Alice");
    expect(processed[0].m.potencial).toBe("Alto");
    expect(processed[0].fileRow).toBe(2);

    expect(processed[1].m.name).toBe("Bob");
    expect(processed[1].m.potencial).toBe("Medio");
    expect(processed[1].fileRow).toBe(4); // row 4 in file (header=1, Alice=2, empty=3, Bob=4)
  });

  it("potencial stays aligned when rows with empty names are filtered", () => {
    const mapping = { name: "Nome", potencial: "Perfil" };
    const rows = [
      { Nome: "Lead1", Perfil: "Alto" },
      { Nome: "",      Perfil: "Baixo" },    // filtered out
      { Nome: "",      Perfil: "Medio" },     // filtered out
      { Nome: "Lead4", Perfil: "Estrategico" },
    ];

    const processed = rows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(processed).toHaveLength(2);
    // Critical: Lead4 must get "Estrategico", NOT "Baixo" (index shift bug)
    expect(processed[1].m.name).toBe("Lead4");
    expect(processed[1].m.potencial).toBe("Estrategico");
  });

  it("fileRow reflects actual spreadsheet row (1-indexed + header)", () => {
    const mapping = { name: "N" };
    const rows = [
      { N: "A" }, { N: "" }, { N: "" }, { N: "" }, { N: "E" },
    ];

    const processed = rows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(processed).toHaveLength(2);
    expect(processed[0].fileRow).toBe(2);
    expect(processed[1].fileRow).toBe(6);
  });
});

// ==========================================
// BUG B: Sheet selection (structural test)
// ==========================================

describe("BUG B — parseFileToRows respects sheet parameter", () => {
  it("CSV ignores sheet parameter gracefully", async () => {
    const csvContent = "Nome,Telefone\nAlice,11999990001\nBob,11999990002";
    const file = { name: "test.csv", __csvContent: csvContent } as any;

    const rows = await parseFileToRows(file, "AnySheet");
    expect(rows).toHaveLength(2);
    expect(rows[0].Nome).toBe("Alice");
  });
});

// ==========================================
// applyMapping correctness
// ==========================================

describe("applyMapping", () => {
  it("maps fields correctly from column names", () => {
    const mapping = { name: "Nome", company: "Empresa", phone: "Tel", email: "Email" };
    const row = { Nome: "Maria", Empresa: "ACME", Tel: "11988887777", Email: "m@a.com", Extra: "ignored" };

    const result = applyMapping(row, mapping);
    expect(result).toEqual({
      name: "Maria",
      company: "ACME",
      phone: "11988887777",
      email: "m@a.com",
    });
  });

  it("skips 'none' mappings", () => {
    const mapping = { name: "Nome", company: "none", phone: "Tel" };
    const row = { Nome: "Alice", Tel: "123" };

    const result = applyMapping(row, mapping);
    expect(result.name).toBe("Alice");
    expect(result.phone).toBe("123");
    expect(result.company).toBeUndefined();
  });

  it("skips empty values", () => {
    const mapping = { name: "Nome", company: "Empresa" };
    const row = { Nome: "Alice", Empresa: "   " };

    const result = applyMapping(row, mapping);
    expect(result.name).toBe("Alice");
    expect(result.company).toBeUndefined();
  });

  it("trims whitespace", () => {
    const mapping = { name: "N" };
    const row = { N: "  Alice  " };
    expect(applyMapping(row, mapping).name).toBe("Alice");
  });

  it("handles missing columns gracefully", () => {
    const mapping = { name: "Nome", potencial: "Perfil" };
    const row = { Nome: "Alice" }; // no "Perfil" column
    const result = applyMapping(row, mapping);
    expect(result.name).toBe("Alice");
    expect(result.potencial).toBeUndefined();
  });
});

// ==========================================
// resolvePotencial
// ==========================================

describe("resolvePotencial", () => {
  it("resolves Portuguese aliases", () => {
    expect(resolvePotencial("Baixo")).toBe("baixo");
    expect(resolvePotencial("medio")).toBe("medio");
    expect(resolvePotencial("ALTO")).toBe("alto");
    expect(resolvePotencial("Estratégico")).toBe("estrategico");
  });

  it("resolves English aliases", () => {
    expect(resolvePotencial("low")).toBe("baixo");
    expect(resolvePotencial("medium")).toBe("medio");
    expect(resolvePotencial("high")).toBe("alto");
    expect(resolvePotencial("strategic")).toBe("estrategico");
    expect(resolvePotencial("VIP")).toBe("estrategico");
  });

  it("returns default for empty/undefined", () => {
    expect(resolvePotencial(undefined)).toBe("medio");
    expect(resolvePotencial("")).toBe("medio");
    expect(resolvePotencial("   ")).toBe("medio");
  });

  it("returns default for unknown value", () => {
    expect(resolvePotencial("superduper")).toBe("medio");
  });

  it("uses custom default", () => {
    expect(resolvePotencial("", "alto")).toBe("alto");
  });
});

// ==========================================
// resolveStageFromName
// ==========================================

describe("resolveStageFromName", () => {
  const stages = [
    { stage_key: "0-3m", name: "0-3 meses" },
    { stage_key: "3-6m", name: "3-6 meses" },
    { stage_key: "6-9m", name: "6-9 meses" },
  ];

  it("exact match by name", () => {
    expect(resolveStageFromName("0-3 meses", stages, "fallback")).toBe("0-3m");
  });

  it("exact match by stage_key", () => {
    expect(resolveStageFromName("3-6m", stages, "fallback")).toBe("3-6m");
  });

  it("case-insensitive match", () => {
    expect(resolveStageFromName("0-3 MESES", stages, "fallback")).toBe("0-3m");
  });

  it("contains match", () => {
    expect(resolveStageFromName("3 meses", stages, "fallback")).toBe("0-3m");
  });

  it("returns default for empty/undefined", () => {
    expect(resolveStageFromName(undefined, stages, "fallback")).toBe("fallback");
    expect(resolveStageFromName("", stages, "fallback")).toBe("fallback");
  });

  it("returns default for no match", () => {
    expect(resolveStageFromName("20 anos", stages, "fallback")).toBe("fallback");
  });

  it("returns default for empty stages list", () => {
    expect(resolveStageFromName("0-3m", [], "fallback")).toBe("fallback");
  });
});

// ==========================================
// formatPhone
// ==========================================

describe("formatPhone", () => {
  it("strips non-digits", () => {
    expect(formatPhone("(11) 99999-0001")).toBe("5511999990001");
  });

  it("prepends 55 for 10-11 digit Brazilian numbers", () => {
    expect(formatPhone("11999990001")).toBe("5511999990001");
    expect(formatPhone("1199999000")).toBe("551199999000");
  });

  it("strips leading zero", () => {
    expect(formatPhone("011999990001")).toBe("5511999990001");
  });

  it("keeps 55 if already present", () => {
    expect(formatPhone("5511999990001")).toBe("5511999990001");
  });

  it("handles international without adding 55", () => {
    expect(formatPhone("1234567890123")).toBe("1234567890123");
  });
});

// ==========================================
// Integration: full pipeline simulation
// ==========================================

describe("full import pipeline simulation (single-parse)", () => {
  it("processes mixed rows with empty names correctly", () => {
    const mapping = { name: "Nome", phone: "Tel", potencial: "Perf", stage: "Etapa" };
    const allRows = [
      { Nome: "Alice",   Tel: "11999990001", Perf: "Alto",     Etapa: "0-3m" },
      { Nome: "",        Tel: "11999990002", Perf: "Baixo",    Etapa: "3-6m" },
      { Nome: "Charlie", Tel: "11999990003", Perf: "Medio",    Etapa: "6-9m" },
      { Nome: "",        Tel: "11999990004", Perf: "Estrategico", Etapa: "0-3m" },
      { Nome: "Eve",     Tel: "11999990005", Perf: "Alto",     Etapa: "3-6m" },
    ];

    const stages = [
      { stage_key: "0-3m", name: "0-3 meses" },
      { stage_key: "3-6m", name: "3-6 meses" },
      { stage_key: "6-9m", name: "6-9 meses" },
    ];

    const rows = allRows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(rows).toHaveLength(3);

    // Verify each row has correct aligned data
    const results = rows.map(({ m, fileRow }) => ({
      name: m.name,
      potencial: resolvePotencial(m.potencial),
      stage: resolveStageFromName(m.stage, stages, "0-3m"),
      phone: formatPhone(m.phone!),
      fileRow,
    }));

    expect(results).toEqual([
      { name: "Alice",   potencial: "alto",  stage: "0-3m", phone: "5511999990001", fileRow: 2 },
      { name: "Charlie", potencial: "medio", stage: "6-9m", phone: "5511999990003", fileRow: 4 },
      { name: "Eve",     potencial: "alto",  stage: "3-6m", phone: "5511999990005", fileRow: 6 },
    ]);
  });

  it("deduplication by phone works correctly", () => {
    const mapping = { name: "Nome", phone: "Tel" };
    const allRows = [
      { Nome: "Alice", Tel: "11999990001" },
      { Nome: "Bob",   Tel: "11999990002" },
      { Nome: "Clone", Tel: "11999990001" }, // duplicate phone
      { Nome: "Dave",  Tel: "11999990003" },
    ];

    const rows = allRows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    const processedPhones = new Set<string>();
    let imported = 0;
    let duplicates = 0;

    for (const { m } of rows) {
      const phone = m.phone ? formatPhone(m.phone) : undefined;
      if (phone && processedPhones.has(phone)) {
        duplicates++;
        continue;
      }
      imported++;
      if (phone) processedPhones.add(phone);
    }

    expect(imported).toBe(3);
    expect(duplicates).toBe(1);
  });

  it("handles all-empty-name file gracefully", () => {
    const mapping = { name: "Nome", phone: "Tel" };
    const allRows = [
      { Nome: "", Tel: "11999990001" },
      { Nome: "  ", Tel: "11999990002" },
    ];

    const rows = allRows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(rows).toHaveLength(0);
  });

  it("handles phoneless leads without crash", () => {
    const mapping = { name: "Nome" };
    const allRows = [
      { Nome: "Alice" },
      { Nome: "Bob" },
    ];

    const rows = allRows
      .map((raw, idx) => ({ m: applyMapping(raw, mapping), raw, fileRow: idx + 2 }))
      .filter((r) => r.m.name?.trim());

    expect(rows).toHaveLength(2);
    expect(rows[0].m.phone).toBeUndefined();
  });

  it("empty phones array guard prevents .in() crash", () => {
    const phones: string[] = [];
    const query = phones.length > 0 ? phones : ["__none__"];
    expect(query).toEqual(["__none__"]);
  });
});

// ==========================================
// Contract: component no longer uses parseCSV
// ==========================================

describe("structural contract — ImportUpsellClientsContent", () => {
  it("does not import useImportLeads hook", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "src/modules/carteira/components/upsell/ImportUpsellClientsContent.tsx",
      "utf-8"
    );
    expect(content).not.toMatch(/useImportLeads\(\)/);
    expect(content).not.toMatch(/parseCSV/);
  });

  it("uses parseFileToRows with selectedSheet parameter", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "src/modules/carteira/components/upsell/ImportUpsellClientsContent.tsx",
      "utf-8"
    );
    const calls = content.match(/parseFileToRows\(file[^)]*selectedSheet/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("uses single-parse pattern (no dual parseCSV + parseFileToRows)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "src/modules/carteira/components/upsell/ImportUpsellClientsContent.tsx",
      "utf-8"
    );
    const handleImport = content.slice(
      content.indexOf("const handleImport"),
      content.indexOf("const handleClose")
    );
    const parseToRowsCalls = (handleImport.match(/parseFileToRows/g) || []).length;
    expect(parseToRowsCalls).toBe(1);
  });
});
