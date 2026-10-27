/**
 * CSV da Lista Fria. Separador `;` e BOM para o Excel brasileiro abrir os
 * acentos certos.
 *
 * Célula que começa com `=`, `+`, `-` ou `@` vira fórmula no Excel/Sheets: o
 * nome de um negócio no Maps é texto de terceiro, então entra com apóstrofo na
 * frente (CSV injection). Telefone entra como texto, sem formatação.
 */
import { ROTULO_QUALIDADE, type Resultado } from "./tipos";

const BOM = "﻿";
const CABECALHO = ["Nome", "Categoria", "Telefone", "E-mail", "Site", "Bairro", "Qualidade", "Situação"] as const;

function celula(valor: unknown): string {
  let s = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function montarCsv(linhas: readonly Resultado[]): string {
  const corpo = linhas.map((r) =>
    [
      r.nome,
      r.categoria,
      r.telefone,
      r.email,
      r.site,
      r.bairro,
      ROTULO_QUALIDADE[r.qualidade],
      r.jaELead ? "Já é lead" : r.importado ? "Importado" : "Novo",
    ]
      .map(celula)
      .join(";"),
  );
  return BOM + [CABECALHO.map(celula).join(";"), ...corpo].join("\r\n");
}

export function nomeDoArquivo(titulo: string, quando: Date = new Date()): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `lista-fria-${base || "busca"}-${quando.toISOString().slice(0, 10)}.csv`;
}
