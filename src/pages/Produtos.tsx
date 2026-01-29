import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, Package, FileText, Link as LinkIcon, ExternalLink } from "lucide-react";
import { useProducts, useDeleteProduct, Product } from "@/hooks/useProducts";
import { CreateProductModal } from "@/components/products/CreateProductModal";
import { EditProductModal } from "@/components/products/EditProductModal";
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

export default function Produtos() {
  const { data: products, isLoading } = useProducts();
  const deleteProduct = useDeleteProduct();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

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
              Gerencie seus produtos de MRR e Projetos
            </p>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Produto
          </Button>
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
            {products?.map((product) => (
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
                        <Badge
                          variant={product.type === "mrr" ? "default" : product.type === "unitario" ? "outline" : "secondary"}
                          className="mt-1"
                        >
                          {product.type === "mrr" ? "MRR" : product.type === "unitario" ? "Unitário" : "Projeto"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
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
                  {/* Tickets */}
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

                  {/* Entregáveis */}
                  {product.entregaveis && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Entregáveis</p>
                      <p className="text-sm line-clamp-2">{product.entregaveis}</p>
                    </div>
                  )}

                  {/* Links & Documents - stopPropagation para não abrir o modal ao clicar no link */}
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

        {/* Empty State */}
        {!isLoading && products?.length === 0 && (
          <Card className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum produto cadastrado</h3>
            <p className="text-muted-foreground mb-4">
              Comece cadastrando seu primeiro produto
            </p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Produto
            </Button>
          </Card>
        )}
      </div>

      {/* Modals */}
      <CreateProductModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
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
              Esta ação não pode ser desfeita. Propostas e metas vinculadas a este
              produto ficarão sem produto associado.
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
