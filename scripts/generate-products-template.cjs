/**
 * Gera public/products_import_template.xlsx com cabeçalhos e uma linha de exemplo.
 * Executar: node scripts/generate-products-template.cjs
 */
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const headers = [
  "name",
  "type",
  "ticket",
  "ticket_minimo",
  "entregaveis",
  "materiais",
  "links",
  "logo_url",
  "contrato_padrao_url",
  "contrato_minimo_url",
  "is_active",
];

const exampleRow = [
  "Exemplo MRR",
  "mrr",
  100,
  50,
  "Descrição dos entregáveis",
  "Materiais de apoio",
  "https://exemplo.com;https://outro.com",
  "",
  "",
  "",
  true,
];

const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Produtos");

const outDir = path.join(__dirname, "..", "public");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "products_import_template.xlsx");
XLSX.writeFile(wb, outPath);
console.log("Template gerado:", outPath);
