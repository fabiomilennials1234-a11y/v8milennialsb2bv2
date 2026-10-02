import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { Plus, Edit2, Trash2, Package, FileText, Link as LinkIcon, FileSpreadsheet, Layers, Bot, Search, X, Download, Upload, CircleDollarSign, Receipt, ListChecks } from "lucide-react";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { useProductRanking } from "@/modules/carteira/hooks/useProductRanking";
import { CurvaAbcHero, TIPO_PRODUTO, brlCompacto, curvaAbc, type ClasseAbc } from "@/modules/carteira/components/produtos/CurvaAbc";
import type { ProductType } from "@/modules/carteira/hooks/useProducts";
import { useProductsWithVariants, useDeleteProduct, Product } from "@/modules/carteira/hooks/useProducts";
import { useProductMaterialCounts } from "@/modules/carteira/hooks/useProductMaterials";
import { CreateProductModal } from "@/modules/carteira/components/product/CreateProductModal";
import { EditProductModal } from "@/modules/carteira/components/product/EditProductModal";
import { ProductImportModal } from "@/modules/carteira/components/product/ProductImportModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeaturePermission } from "@/modules/identity";

const TYPE_FILTERS = [
  { value: "all" as const, label: "Todos" },
  { value: "mrr" as const, label: "Recorrência" },
  { value: "projeto" as const, label: "Projeto" },
  { value: "unitario" as const, label: "Unitário" },
];

/**
 * Colunas pela largura disponível, não pela tela: três no desktop (o mockup),
 * duas quando um painel lateral espreme a área, uma no celular.
 */
const PRODUCT_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4";

/** Selo da classe ABC no canto do cartão: A em ouro, B em tinta, C contorno. */
const CLASSE_CHIP: Record<ClasseAbc, string> = {
  A: "bg-primary text-primary-foreground",
  B: "bg-tinta text-tinta-foreground dark:bg-foreground dark:text-background",
  C: "border border-input text-muted-foreground",
};

/** Período da curva: 90 dias até hoje, fixado na montagem (a chave da query não pode mudar a cada render). */
function ultimos90Dias() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

/** Rótulo de valor nos sub-blocos estreitos do cartão — sem caixa-alta, que quebrava a linha. */
const tileLabel = "truncate text-[11px] font-semibold text-muted-foreground";

export default function Produtos() {
  const { data: products, isLoading } = useProductsWithVariants();
  const deleteProduct = useDeleteProduct();
  const { data: materialCounts = new Map() } = useProductMaterialCounts();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProductType | "all">("all");
  const { allowed: canCreateProduct } = useFeaturePermission("products.create");
  const { allowed: canEditProduct } = useFeaturePermission("products.edit");
  const { allowed: canDeleteProduct } = useFeaturePermission("products.delete");
  const [periodo] = useState(ultimos90Dias);
  const { data: ranking = [], isLoading: rankingLoading } = useProductRanking(undefined, undefined, periodo);
  const abc = useMemo(() => curvaAbc(ranking), [ranking]);
  const abcPorProduto = useMemo(() => new Map(abc.map((i) => [i.product_id, i])), [abc]);
  const receita90 = abc.reduce((s, i) => s + Number(i.total_value), 0);
  const vendas90 = abc.reduce((s, i) => s + Number(i.qty_sold), 0);
  const ativos = (products ?? []).filter((p) => p.is_active);
  const contagemTipo = {
    all: products?.length ?? 0,
    mrr: products?.filter((p) => p.type === "mrr").length ?? 0,
    projeto: products?.filter((p) => p.type === "projeto").length ?? 0,
    unitario: products?.filter((p) => p.type === "unitario").length ?? 0,
  };

  const baixarModelo = () => {
    const a = document.createElement("a");
    a.href = "/products_import_template.xlsx";
    a.download = "products_import_template.xlsx";
    a.click();
  };

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => {
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      );
    });
  }, [products, searchTerm, typeFilter]);

  const formatCurrency = (value: number | null) => {
    if (!value) return "—";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const handleDelete = async () => {
    if (deletingProductId) {
      await deleteProduct.mutateAsync(deletingProductId);
      setDeletingProductId(null);
    }
  };

  return (
    <>
    <div className="space-y-5">
        <PageHeader
          title="Produtos"
          subtitle="Catálogo que alimenta negócios, propostas e a curva ABC"
          secondaryActions={[
            { label: "Importar", icon: Upload, onSelect: () => setIsImportModalOpen(true) },
            { label: "Baixar modelo", icon: Download, onSelect: baixarModelo },
          ]}
          actions={
            <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canCreateProduct}>
              <Plus />
              Novo produto
            </Button>
          }
        />

        <KpiRow cols={3}>
          <KpiTile
            label="Produtos ativos"
            value={ativos.length}
            icon={Package}
            tone="gold"
            loading={isLoading}
          >
            <div className="flex flex-wrap gap-1.5">
              {(["mrr", "projeto", "unitario"] as const).map((t) =>
                contagemTipo[t] > 0 ? (
                  <Badge key={t} variant={TIPO_PRODUTO[t].variant} className="px-2 py-0 text-[11px]">
                    {contagemTipo[t]} {t === "mrr" ? (contagemTipo[t] === 1 ? "recorrência" : "recorrências") : t === "projeto" ? (contagemTipo[t] === 1 ? "projeto" : "projetos") : contagemTipo[t] === 1 ? "unitário" : "unitários"}
                  </Badge>
                ) : null,
              )}
            </div>
          </KpiTile>
          <KpiTile
            label="Receita · 90 dias"
            value={brlCompacto(receita90)}
            icon={CircleDollarSign}
            tone="good"
            loading={rankingLoading}
            note="vendas com produto no negócio"
          />
          <KpiTile
            label="Ticket médio realizado"
            value={vendas90 > 0 ? brlCompacto(receita90 / vendas90) : "—"}
            icon={Receipt}
            tone="info"
            loading={rankingLoading}
            note={`${vendas90} ${vendas90 === 1 ? "venda" : "vendas"} em 90 dias`}
          />
        </KpiRow>

        {/* Search & Filters */}
        <div className="flex flex-col-reverse gap-3 lg:flex-row-reverse lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar produtos"
              placeholder="Buscar por nome, SKU ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-full pl-9 pr-9"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* Filtro por tipo — mesmos quatro botões (aria-pressed), agora em
              chips com ícone e contagem. */}
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
            <span className="shrink-0 text-[12.5px] font-semibold text-muted-foreground">Tipo</span>
            {TYPE_FILTERS.map((opt) => {
              const ativo = typeFilter === opt.value;
              const Icone = opt.value === "all" ? null : TIPO_PRODUTO[opt.value].icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setTypeFilter(opt.value)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo
                      ? "bg-tinta text-tinta-foreground dark:bg-foreground dark:text-background"
                      : "border border-input bg-card text-foreground/80 shadow-relevo hover:text-foreground",
                  )}
                >
                  {Icone && <Icone className="h-3.5 w-3.5" aria-hidden />}
                  {opt.label}
                  <span
                    className={cn(
                      "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                      ativo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {contagemTipo[opt.value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <CurvaAbcHero
          itens={abc}
          produtos={products ?? []}
          carregando={rankingLoading}
          onAbrir={(p) => setEditingProduct(p)}
        />

        {/* Products Grid */}
        {isLoading ? (
          <div className={PRODUCT_GRID}>
            {[1, 2, 3].map((i) => (
              <Card key={i} className="h-64 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className={PRODUCT_GRID}>
            {filteredProducts.map((product) => {
              const tipo = TIPO_PRODUTO[product.type] ?? TIPO_PRODUTO.projeto;
              const TipoIcon = tipo.icon;
              const materials = materialCounts.get(product.id) || 0;
              const curva = abcPorProduto.get(product.id);
              const tickets = (product.variants ?? []).map((v) => v.ticket).filter((t): t is number => t != null);
              const temVariacoes = product.has_variants && (product.variants?.length ?? 0) > 0;
              return (
              <Card
                key={product.id}
                role="button"
                tabIndex={0}
                className="group flex cursor-pointer flex-col gap-3 p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-relevo-alto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                onClick={() => setEditingProduct(product)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditingProduct(product);
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <Badge variant={tipo.variant} className="gap-1">
                      <TipoIcon className="h-3 w-3" />
                      {tipo.label}
                    </Badge>
                    {!product.is_active && <Badge variant="soft">Inativo</Badge>}
                  </div>
                  <div
                    className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${product.name}`}
                      className="h-7 w-7"
                      disabled={!canEditProduct}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProduct(product);
                      }}
                    >
                      <Edit2 />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir ${product.name}`}
                      className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={!canDeleteProduct}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProductId(product.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {curva && (
                    <span
                      className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-extrabold", CLASSE_CHIP[curva.classe])}
                      title={`Classe ${curva.classe} na curva ABC dos últimos 90 dias`}
                    >
                      {curva.classe}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 items-center gap-3">
                  {product.logo_url && (
                    <img src={product.logo_url} alt={product.name} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                  )}
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-[1.05rem] font-bold leading-snug tracking-[-0.02em]">{product.name}</h3>
                    {product.sku && <p className="truncate font-mono text-[11.5px] text-muted-foreground">{product.sku}</p>}
                  </div>
                </div>

                {temVariacoes ? (
                  <div>
                    <p className={tileLabel}>Faixa de preço (variações)</p>
                    <p className="text-[1.45rem] font-extrabold leading-tight tracking-[-0.035em] tabular-nums">
                      {tickets.length === 0
                        ? "—"
                        : Math.min(...tickets) === Math.max(...tickets)
                          ? formatCurrency(Math.min(...tickets))
                          : `${formatCurrency(Math.min(...tickets))} — ${formatCurrency(Math.max(...tickets))}`}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className={tileLabel}>Ticket</p>
                    <p className="text-[1.6rem] font-extrabold leading-tight tracking-[-0.04em] tabular-nums">
                      {formatCurrency(product.ticket)}
                      {product.base_unit && (
                        <small className="ml-1 text-[12px] font-semibold tracking-normal text-muted-foreground">/{product.base_unit}</small>
                      )}
                    </p>
                    {product.ticket_minimo ? (
                      <p className="text-[11.5px] text-muted-foreground tabular-nums">mínimo {formatCurrency(product.ticket_minimo)}</p>
                    ) : null}
                  </div>
                )}

                {(product.contrato_padrao_url || product.contrato_minimo_url || (product.links?.length ?? 0) > 0) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1" onClick={(e) => e.stopPropagation()}>
                    {product.contrato_padrao_url && (
                      <a
                        href={product.contrato_padrao_url}
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-soft-foreground hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        Contrato padrão
                      </a>
                    )}
                    {product.contrato_minimo_url && (
                      <a
                        href={product.contrato_minimo_url}
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-soft-foreground hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        Contrato mínimo
                      </a>
                    )}
                    {product.links && product.links.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <LinkIcon className="h-3 w-3" />
                        {product.links.length} links
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-dashed border-border/80 pt-3">
                  {temVariacoes && (
                    <Badge variant="soft" className="gap-1">
                      <Layers className="h-3 w-3" />
                      {product.variants!.length} {product.variants!.length === 1 ? "variação" : "variações"}
                    </Badge>
                  )}
                  {product.entregaveis && (
                    <Badge variant="soft" className="gap-1" title={product.entregaveis}>
                      <ListChecks className="h-3 w-3" />
                      Entregáveis
                    </Badge>
                  )}
                  {materials > 0 && (
                    <Badge variant="info" className="gap-1">
                      <Bot className="h-3 w-3" />
                      {materials} {materials === 1 ? "material" : "materiais"}
                    </Badge>
                  )}
                  <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">
                    {curva ? `${curva.qty_sold} ${curva.qty_sold === 1 ? "venda" : "vendas"} · 90 d` : "sem venda em 90 d"}
                  </span>
                </div>
              </Card>
              );
            })}
            {canCreateProduct && filteredProducts.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <Plus className="h-5 w-5" />
                Novo produto
              </button>
            )}
          </div>
        )}

        {/* Empty State — no products at all */}
        {!isLoading && products?.length === 0 && (
          <Card className="flex flex-col items-center p-12 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
              <Package className="h-7 w-7" />
            </span>
            <h3 className="mb-1 text-lg font-bold tracking-[-0.02em]">Nenhum produto cadastrado</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Comece cadastrando seu primeiro produto
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                <FileSpreadsheet />
                Importar
              </Button>
              <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canCreateProduct}>
                <Plus />
                Novo produto
              </Button>
            </div>
          </Card>
        )}

        {/* Empty State — search/filter returned nothing */}
        {!isLoading && (products?.length ?? 0) > 0 && filteredProducts.length === 0 && (
          <Card className="flex flex-col items-center p-12 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Search className="h-7 w-7" />
            </span>
            <h3 className="mb-1 text-lg font-bold tracking-[-0.02em]">Nenhum produto encontrado</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Tente ajustar a busca ou os filtros
            </p>
            <Button
              variant="outline"
              onClick={() => { setSearchTerm(""); setTypeFilter("all"); }}
            >
              Limpar filtros
            </Button>
          </Card>
        )}
      </div>

      {/* Modals */}
      <CreateProductModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />

      <ProductImportModal
        open={isImportModalOpen}
        onOpenChange={setIsImportModalOpen}
      />

      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          open={!!editingProduct}
          onOpenChange={(open) => !open && setEditingProduct(null)}
        />
      )}

      <AlertDialog
        open={!!deletingProductId}
        onOpenChange={(open) => !open && setDeletingProductId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Propostas, metas e variações vinculadas
              a este produto serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
