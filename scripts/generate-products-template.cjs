/**
 * Gera public/products_import_template.xlsx com cabeçalhos e linhas de exemplo.
 * Inclui produtos e variações.
 * Executar: node scripts/generate-products-template.cjs
 */
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const headers = [
  "sku",
  "parent_sku",
  "name",
  "type",
  "description",
  "base_unit",
  "ticket",
  "ticket_minimo",
  "entregaveis",
  "materiais",
  "links",
  "logo_url",
  "contrato_padrao_url",
  "contrato_minimo_url",
  "weight",
  "grammage",
  "dimensions",
  "color",
  "size",
  "is_active",
];

const exampleRows = [
  // Produto 1 — sem variações
  [
    "MRR-0001",
    "",
    "Software CRM",
    "mrr",
    "Sistema de gestão de clientes",
    "licença",
    200,
    100,
    "Acesso ao sistema + suporte",
    "Manual do usuário",
    "https://exemplo.com;https://docs.exemplo.com",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "sim",
  ],
  // Produto 2 — com variações
  [
    "PRJ-0001",
    "",
    "Consultoria Empresarial",
    "projeto",
    "Pacote de consultoria personalizada",
    "hora",
    "",
    "",
    "Relatório final + plano de ação",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "sim",
  ],
  // Variação 1 do PRJ-0001
  [
    "PRJ-0001-01",
    "PRJ-0001",
    "Pacote Básico (10h)",
    "",
    "",
    "",
    5000,
    3000,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "sim",
  ],
  // Variação 2 do PRJ-0001
  [
    "PRJ-0001-02",
    "PRJ-0001",
    "Pacote Premium (40h)",
    "",
    "",
    "",
    18000,
    12000,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "sim",
  ],
  // Produto 3 — unitário com variações físicas
  [
    "UNI-0001",
    "",
    "Material Impresso",
    "unitario",
    "Material impresso personalizado",
    "unidade",
    "",
    "",
    "Impressão + acabamento",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "sim",
  ],
  // Variação com atributos físicos
  [
    "UNI-0001-01",
    "UNI-0001",
    "Flyer A5 - 150g",
    "",
    "",
    "",
    2.5,
    1.5,
    "",
    "",
    "",
    "",
    "",
    "",
    0.01,
    150,
    "21x14.8 cm",
    "",
    "A5",
    "sim",
  ],
  [
    "UNI-0001-02",
    "UNI-0001",
    "Flyer A4 - 300g",
    "",
    "",
    "",
    5,
    3,
    "",
    "",
    "",
    "",
    "",
    "",
    0.02,
    300,
    "29.7x21 cm",
    "",
    "A4",
    "sim",
  ],
];

const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);

// Ajustar largura das colunas
ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Produtos");

const outDir = path.join(__dirname, "..", "public");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const xlsxPath = path.join(outDir, "products_import_template.xlsx");
XLSX.writeFile(wb, xlsxPath);
console.log("Template XLSX gerado:", xlsxPath);

// Gerar CSV também
const csvPath = path.join(outDir, "products_import_template.csv");
const csvContent = XLSX.utils.sheet_to_csv(ws);
fs.writeFileSync(csvPath, csvContent, "utf-8");
console.log("Template CSV gerado:", csvPath);
