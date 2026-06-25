// @vitest-environment node
/**
 * spreadsheet-parse — client CSV parse + column auto-detection for the "Subir
 * planilha" blast source (ADR-0014, #906).
 *
 * Pure twin of the upload flow: detect which header is phone/name/company/email
 * (accent- and case-insensitively), map the grid to `{ phone, name?, ... }`
 * rows, and parse raw CSV text (quotes + `;`/`,` delimiters via papaparse). The
 * edge function owns the upsert; these are the client-side mapping decisions.
 */
import { describe, it, expect } from "vitest";
import {
  detectColumnMap,
  mapGridToRows,
  normalizeHeader,
  parseSpreadsheetText,
} from "@/modules/campaigns/components/disparo-wizard/spreadsheet-parse";

describe("normalizeHeader", () => {
  it("lowercases, strips accents, collapses separators", () => {
    expect(normalizeHeader("Razão Social")).toBe("razao social");
    expect(normalizeHeader("  Telefone/Celular  ")).toBe("telefone celular");
    expect(normalizeHeader("E-mail")).toBe("e mail");
  });
});

describe("detectColumnMap", () => {
  it("detects telefone + nome headers", () => {
    const map = detectColumnMap(["Nome", "Telefone"]);
    expect(map.name).toBe(0);
    expect(map.phone).toBe(1);
  });

  it("detects celular / whatsapp variants for phone", () => {
    expect(detectColumnMap(["Celular"]).phone).toBe(0);
    expect(detectColumnMap(["WhatsApp"]).phone).toBe(0);
    expect(detectColumnMap(["Fone"]).phone).toBe(0);
  });

  it("is accent- and case-insensitive (Razão Social → company, E-MAIL → email)", () => {
    const map = detectColumnMap(["Razão Social", "E-MAIL"]);
    expect(map.company).toBe(0);
    expect(map.email).toBe(1);
  });

  it("claims each header once; phone wins a 'telefone comercial' over company", () => {
    const map = detectColumnMap(["Empresa", "Telefone Comercial"]);
    expect(map.company).toBe(0);
    expect(map.phone).toBe(1);
  });

  it("returns -1 for fields with no matching header", () => {
    const map = detectColumnMap(["Coluna A", "Coluna B"]);
    expect(map).toEqual({ phone: -1, name: -1, company: -1, email: -1 });
  });
});

describe("mapGridToRows", () => {
  it("maps cells via the column map and drops empty fields", () => {
    const rows = mapGridToRows(
      [["João", "11987654321", "Acme"]],
      { phone: 1, name: 0, company: 2, email: -1 },
    );
    expect(rows).toEqual([{ phone: "11987654321", name: "João", company: "Acme", email: undefined }]);
  });

  it("keeps a row with no phone column (becomes invalid downstream)", () => {
    const rows = mapGridToRows([["Sem Telefone"]], { phone: -1, name: 0, company: -1, email: -1 });
    expect(rows).toEqual([{ phone: "", name: "Sem Telefone", company: undefined, email: undefined }]);
  });

  it("skips wholly empty rows", () => {
    const rows = mapGridToRows(
      [["", "", ""], ["Maria", "11999998888", ""]],
      { phone: 1, name: 0, company: 2, email: -1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Maria");
  });
});

describe("parseSpreadsheetText — end to end", () => {
  it("parses a comma CSV with a header and detects columns", () => {
    const text = "Nome,Telefone,Empresa\nJoão,11987654321,Acme\nMaria,11999998888,Beta";
    const parsed = parseSpreadsheetText(text);
    expect(parsed.map.name).toBe(0);
    expect(parsed.map.phone).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ phone: "11987654321", name: "João", company: "Acme" });
  });

  it("handles a semicolon delimiter (papaparse auto-detect)", () => {
    const text = "Nome;Telefone\nJoão;11987654321";
    const parsed = parseSpreadsheetText(text);
    expect(parsed.map.phone).toBe(1);
    expect(parsed.rows[0]).toMatchObject({ phone: "11987654321", name: "João" });
  });

  it("respects quoted fields containing the delimiter", () => {
    const text = 'Nome,Telefone\n"Silva, João",11987654321';
    const parsed = parseSpreadsheetText(text);
    expect(parsed.rows[0].name).toBe("Silva, João");
    expect(parsed.rows[0].phone).toBe("11987654321");
  });

  it("returns empty everything for a header-only file", () => {
    const parsed = parseSpreadsheetText("Nome,Telefone");
    expect(parsed.rows).toEqual([]);
    expect(parsed.dataRows).toEqual([]);
  });
});
