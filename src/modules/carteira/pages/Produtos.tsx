import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { Plus, Edit2, Trash2, Package, FileText, Link as LinkIcon, FileSpreadsheet, Layers, Barcode, Bot, Search, X, Download } from "lucide-react";
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

/** Tom do tipo — o mesmo dado do badge de antes, agora em tom de token. */
const TYPE_BADGE: Record<string, { variant: "gold" | "info" | "soft"; label: string }> = {
  mrr: { variant: "gold", label: "Recorrência" },
  projeto: { variant: "info", label: "Projeto" },
  unitario: { variant: "soft", label: "Unitário" },
};

/**
 * Colunas pela largura disponível, não pela tela: com o Pitstop aberto ao lado
 * a área encolhe ~280px e três colunas espremiam nome e preço.
 */
const PRODUCT_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4";

const microLabel = "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground";
/** Rótulo de valor nos sub-blocos estreitos do cartão — sem caixa-alta, que quebrava a linha. */
const tileLabel = "truncate text-[11px] font-semibold text-muted-foreground";
const tileValue = "mt-0.5 truncate text-[15px] font-extrabold tabular-nums tracking-[-0.02em]";

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
          subtitle="Gerencie seus produtos, variações e catálogo B2B"
          actions={
            <>
              <Button asChild variant="ghost" className="text-muted-foreground">
                <a href="/products_import_template.xlsx" download="products_import_template.xlsx">
                  <Download />
                  Baixar modelo
                </a>
              </Button>
              <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                <FileSpreadsheet />
                Importar
              </Button>
              <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canCreateProduct}>
                <Plus />
                Novo produto
              </Button>
            </>
          }
        />

        {/* Search & Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
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
          {/* Filtro por tipo — mesmos quatro botões, forma de segmentado. */}
          <div className="inline-flex items-center gap-0.5 self-start rounded-full bg-muted p-[3px] sm:self-auto">
            {TYPE_FILTERS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={typeFilter === opt.value}
                onClick={() => setTypeFilter(opt.value)}
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  typeFilter === opt.value
                    ? "bg-card text-foreground shadow-relevo"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

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
              const typeBadge = TYPE_BADGE[product.type] ?? TYPE_BADGE.projeto;
              const materials = materialCounts.get(product.id) || 0;
              return (
              <Card
                key={product.id}
                role="button"
                tabIndex={0}
                className="group flex cursor-pointer flex-col transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-relevo-alto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                onClick={() => setEditingProduct(product)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditingProduct(product);
                  }
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {product.logo_url ? (
                        <img
                          src={product.logo_url}
                          alt={product.name}
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                          <Package className="h-6 w-6" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <CardTitle className="line-clamp-2 text-[17px] tracking-[-0.02em]">{product.name}</CardTitle>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
                          {product.has_variants && product.variants && product.variants.length > 0 && (
                            <Badge variant="soft" className="gap-1">
                              <Layers className="h-3 w-3" />
                              {product.variants.length} var.
                            </Badge>
                          )}
                          {materials > 0 && (
                            <Badge variant="info" className="gap-1">
                              <Bot className="h-3 w-3" />
                              {materials} {materials === 1 ? "material" : "materiais"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${product.name}`}
                        className="h-8 w-8"
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
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={!canDeleteProduct}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProductId(product.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  {/* SKU */}
                  {product.sku && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Barcode className="h-3 w-3" />
                      <span className="font-mono">{product.sku}</span>
                    </div>
                  )}

                  {/* Description */}
                  {product.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
                  )}

                  {/* Tickets - show only for products without variants */}
                  {!product.has_variants && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 rounded-xl bg-sunken px-3 py-2.5">
                        <p className={tileLabel}>Ticket</p>
                        <p className={tileValue}>{formatCurrency(product.ticket)}</p>
                      </div>
                      <div className="min-w-0 rounded-xl bg-sunken px-3 py-2.5">
                        <p className={tileLabel}>Ticket mínimo</p>
                        <p className={tileValue}>{formatCurrency(product.ticket_minimo)}</p>
                      </div>
                    </div>
                  )}

                  {/* Variant price range */}
                  {product.has_variants && product.variants && product.variants.length > 0 && (
                    <div className="rounded-xl bg-sunken px-3 py-2.5">
                      <p className={tileLabel}>Faixa de preço (variações)</p>
                      <p className="mt-0.5 text-[15px] font-extrabold tabular-nums tracking-[-0.02em]">
                        {(() => {
                          const tickets = product.variants
                            .map((v) => v.ticket)
                            .filter((t): t is number => t != null);
                          if (tickets.length === 0) return "—";
                          const min = Math.min(...tickets);
                          const max = Math.max(...tickets);
                          if (min === max) return formatCurrency(min);
                          return `${formatCurrency(min)} — ${formatCurrency(max)}`;
                        })()}
                      </p>
                    </div>
                  )}

                  {/* Entregáveis */}
                  {product.entregaveis && (
                    <div>
                      <p className={cn(microLabel, "mb-1")}>Entregáveis</p>
                      <p className="line-clamp-2 text-sm">{product.entregaveis}</p>
                    </div>
                  )}

                  {/* Links & Documents */}
                  <div className="mt-auto flex flex-wrap gap-x-3 gap-y-2 border-t border-border/70 pt-3" onClick={(e) => e.stopPropagation()}>
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
                    {product.base_unit && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        Unidade: {product.base_unit}
                      </span>
                    )}
                  </div>

                  {/* Active Status */}
                  {!product.is_active && (
                    <Badge variant="soft" className="self-start">
                      Inativo
                    </Badge>
                  )}
                </CardContent>
              </Card>
              );
            })}
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
