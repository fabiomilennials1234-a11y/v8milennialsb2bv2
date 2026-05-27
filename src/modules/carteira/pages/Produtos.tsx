import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Edit2, Trash2, Package, FileText, Link as LinkIcon, FileSpreadsheet, Layers, Barcode, Bot, Search, X } from "lucide-react";
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
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Produtos</h1>
            <p className="text-muted-foreground">
              Gerencie seus produtos, variações e catálogo B2B
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/products_import_template.xlsx"
              download="products_import_template.xlsx"
              className="text-sm text-muted-foreground hover:text-primary hover:underline"
            >
              Baixar modelo
            </a>
            <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Importar
            </Button>
            <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canCreateProduct}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Produto
            </Button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, SKU ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {([
              { value: "all" as const, label: "Todos" },
              { value: "mrr" as const, label: "Recorrência" },
              { value: "projeto" as const, label: "Projeto" },
              { value: "unitario" as const, label: "Unitário" },
            ]).map((opt) => (
              <Button
                key={opt.value}
                variant={typeFilter === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(opt.value)}
                className="text-xs"
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="h-24 bg-muted/50" />
                <CardContent className="h-40" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((product) => (
              <Card
                key={product.id}
                role="button"
                tabIndex={0}
                className="group hover:shadow-lg transition-shadow cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setEditingProduct(product)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditingProduct(product);
                  }
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {product.logo_url ? (
                        <img
                          src={product.logo_url}
                          alt={product.name}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Package className="h-6 w-6 text-primary" />
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-lg">{product.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            variant={product.type === "mrr" ? "default" : product.type === "unitario" ? "outline" : "secondary"}
                          >
                            {product.type === "mrr" ? "Recorrência" : product.type === "unitario" ? "Unitário" : "Projeto"}
                          </Badge>
                          {product.has_variants && product.variants && product.variants.length > 0 && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Layers className="h-3 w-3" />
                              {product.variants.length} var.
                            </Badge>
                          )}
                          {(materialCounts.get(product.id) || 0) > 0 && (
                            <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                              <Bot className="h-3 w-3" />
                              {materialCounts.get(product.id)} {materialCounts.get(product.id) === 1 ? "material" : "materiais"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canEditProduct}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProduct(product);
                        }}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canDeleteProduct}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProductId(product.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* SKU */}
                  {product.sku && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Barcode className="h-3 w-3" />
                      <span className="font-mono">{product.sku}</span>
                    </div>
                  )}

                  {/* Description */}
                  {product.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
                  )}

                  {/* Tickets - show only for products without variants */}
                  {!product.has_variants && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Ticket</p>
                        <p className="font-semibold">{formatCurrency(product.ticket)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Ticket Mínimo</p>
                        <p className="font-semibold">{formatCurrency(product.ticket_minimo)}</p>
                      </div>
                    </div>
                  )}

                  {/* Variant price range */}
                  {product.has_variants && product.variants && product.variants.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Faixa de Preço (Variações)</p>
                      <p className="font-semibold text-sm">
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
                      <p className="text-xs text-muted-foreground mb-1">Entregáveis</p>
                      <p className="text-sm line-clamp-2">{product.entregaveis}</p>
                    </div>
                  )}

                  {/* Links & Documents */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                    {product.contrato_padrao_url && (
                      <a
                        href={product.contrato_padrao_url}
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        Contrato Padrão
                      </a>
                    )}
                    {product.contrato_minimo_url && (
                      <a
                        href={product.contrato_minimo_url}
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        Contrato Mínimo
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
                    <Badge variant="outline" className="text-muted-foreground">
                      Inativo
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State — no products at all */}
        {!isLoading && products?.length === 0 && (
          <Card className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum produto cadastrado</h3>
            <p className="text-muted-foreground mb-4">
              Comece cadastrando seu primeiro produto
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Importar
              </Button>
              <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canCreateProduct}>
                <Plus className="mr-2 h-4 w-4" />
                Novo Produto
              </Button>
            </div>
          </Card>
        )}

        {/* Empty State — search/filter returned nothing */}
        {!isLoading && (products?.length ?? 0) > 0 && filteredProducts.length === 0 && (
          <Card className="p-12 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum produto encontrado</h3>
            <p className="text-muted-foreground mb-4">
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
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
