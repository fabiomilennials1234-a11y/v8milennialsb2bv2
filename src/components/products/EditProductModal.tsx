import { useState, useEffect } from "react";
import { ProductMaterialsSection } from "./ProductMaterialsSection";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUpdateProduct, Product, ProductType, ProductVariant } from "@/hooks/useProducts";
import {
  useProductVariants,
  useCreateProductVariant,
  useUpdateProductVariant,
  useDeleteProductVariant,
} from "@/hooks/useProductVariants";
import { useOrganization } from "@/modules/identity";
import { Plus, X, Wand2, Trash2, GripVertical, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  ticket: string;
  ticket_minimo: string;
  weight: string;
  grammage: string;
  dimensions: string;
  color: string;
  size: string;
  is_new?: boolean;
}

const SKU_PREFIXES: Record<ProductType, string> = {
  mrr: "REC",
  projeto: "PRJ",
  unitario: "UNI",
};

interface EditProductModalProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProductModal({ product, open, onOpenChange }: EditProductModalProps) {
  const { organizationId } = useOrganization();
  const updateProduct = useUpdateProduct();
  const { data: existingVariants } = useProductVariants(open ? product.id : undefined);
  const createVariant = useCreateProductVariant();
  const updateVariant = useUpdateProductVariant();
  const deleteVariant = useDeleteProductVariant();

  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    description: "",
    type: "mrr" as ProductType,
    base_unit: "",
    ticket: "",
    ticket_minimo: "",
    has_variants: false,
    entregaveis: "",
    materiais: "",
    links: [] as string[],
    logo_url: "",
    contrato_padrao_url: "",
    contrato_minimo_url: "",
    is_active: true,
  });
  const [variants, setVariants] = useState<VariantForm[]>([]);
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [newLink, setNewLink] = useState("");

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        sku: product.sku || "",
        description: product.description || "",
        type: product.type,
        base_unit: product.base_unit || "",
        ticket: product.ticket?.toString() || "",
        ticket_minimo: product.ticket_minimo?.toString() || "",
        has_variants: product.has_variants ?? false,
        entregaveis: product.entregaveis || "",
        materiais: product.materiais || "",
        links: product.links || [],
        logo_url: product.logo_url || "",
        contrato_padrao_url: product.contrato_padrao_url || "",
        contrato_minimo_url: product.contrato_minimo_url || "",
        is_active: product.is_active,
      });
      setDeletedVariantIds([]);
    }
  }, [product]);

  useEffect(() => {
    if (existingVariants) {
      setVariants(
        existingVariants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku || "",
          ticket: v.ticket?.toString() || "",
          ticket_minimo: v.ticket_minimo?.toString() || "",
          weight: v.weight?.toString() || "",
          grammage: v.grammage?.toString() || "",
          dimensions: v.dimensions || "",
          color: v.color || "",
          size: v.size || "",
        }))
      );
    }
  }, [existingVariants]);

  const generateSku = () => {
    const prefix = SKU_PREFIXES[formData.type];
    const random = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
    setFormData((prev) => ({ ...prev, sku: `${prefix}-${random}` }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) return;

    if (formData.has_variants && variants.length === 0) {
      toast.error("Adicione pelo menos uma variação ou desative a opção de variações.");
      return;
    }

    // Update product
    await updateProduct.mutateAsync({
      id: product.id,
      name: formData.name,
      sku: formData.sku || null,
      description: formData.description || null,
      type: formData.type,
      base_unit: formData.base_unit || null,
      has_variants: formData.has_variants,
      ticket: formData.has_variants ? null : (formData.ticket ? parseFloat(formData.ticket) : null),
      ticket_minimo: formData.has_variants ? null : (formData.ticket_minimo ? parseFloat(formData.ticket_minimo) : null),
      entregaveis: formData.entregaveis || null,
      materiais: formData.materiais || null,
      links: formData.links.length > 0 ? formData.links : null,
      logo_url: formData.logo_url || null,
      contrato_padrao_url: formData.contrato_padrao_url || null,
      contrato_minimo_url: formData.contrato_minimo_url || null,
      is_active: formData.is_active,
    });

    // Handle variant changes
    if (formData.has_variants) {
      // Delete removed variants
      for (const id of deletedVariantIds) {
        await deleteVariant.mutateAsync({ id, productId: product.id });
      }

      // Create/update variants
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const payload = {
          product_id: product.id,
          sku: v.sku || null,
          name: v.name,
          ticket: v.ticket ? parseFloat(v.ticket) : null,
          ticket_minimo: v.ticket_minimo ? parseFloat(v.ticket_minimo) : null,
          weight: v.weight ? parseFloat(v.weight) : null,
          grammage: v.grammage ? parseFloat(v.grammage) : null,
          dimensions: v.dimensions || null,
          color: v.color || null,
          size: v.size || null,
          custom_attributes: {},
          sort_order: i,
          is_active: true,
          organization_id: organizationId,
        };

        if (v.id && !v.is_new) {
          await updateVariant.mutateAsync({ id: v.id, ...payload });
        } else {
          await createVariant.mutateAsync(payload);
        }
      }
    }

    onOpenChange(false);
  };

  const addLink = () => {
    if (newLink.trim()) {
      setFormData((prev) => ({ ...prev, links: [...prev.links, newLink.trim()] }));
      setNewLink("");
    }
  };

  const removeLink = (index: number) => {
    setFormData((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }));
  };

  const addVariant = () => {
    setVariants((prev) => [...prev, { name: "", sku: "", ticket: "", ticket_minimo: "", weight: "", grammage: "", dimensions: "", color: "", size: "", is_new: true }]);
  };

  const updateVariantField = (index: number, field: keyof VariantForm, value: string) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  const removeVariant = (index: number) => {
    const v = variants[index];
    if (v.id && !v.is_new) {
      setDeletedVariantIds((prev) => [...prev, v.id!]);
    }
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const isPending = updateProduct.isPending || createVariant.isPending || updateVariant.isPending || deleteVariant.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Editar Produto</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="name">Nome do Produto *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="sku">SKU</Label>
              <div className="flex gap-2">
                <Input
                  id="sku"
                  value={formData.sku}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sku: e.target.value }))}
                  placeholder="Ex: REC-0001"
                />
                <Button type="button" variant="outline" size="icon" onClick={generateSku} title="Gerar SKU automático">
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="type">Tipo *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: ProductType) =>
                  setFormData((prev) => ({ ...prev, type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mrr">Recorrência</SelectItem>
                  <SelectItem value="projeto">Projeto</SelectItem>
                  <SelectItem value="unitario">Unitário (Pontual)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="base_unit">Unidade Base</Label>
              <Input
                id="base_unit"
                value={formData.base_unit}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_unit: e.target.value }))}
                placeholder="Ex: licença, hora, projeto, unidade"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Descrição detalhada do produto..."
              rows={2}
            />
          </div>

          {/* Variants toggle */}
          <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
            <Switch
              id="has_variants"
              checked={formData.has_variants}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, has_variants: checked }))
              }
            />
            <Label htmlFor="has_variants" className="font-medium">
              Este produto possui variações
            </Label>
            <span className="text-xs text-muted-foreground ml-auto">
              (planos, tamanhos, pacotes, etc.)
            </span>
          </div>

          {/* Pricing - only when no variants */}
          {!formData.has_variants && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="ticket">Ticket (R$)</Label>
                <Input
                  id="ticket"
                  type="number"
                  step="0.01"
                  value={formData.ticket}
                  onChange={(e) => setFormData((prev) => ({ ...prev, ticket: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label htmlFor="ticket_minimo">Ticket Mínimo (R$)</Label>
                <Input
                  id="ticket_minimo"
                  type="number"
                  step="0.01"
                  value={formData.ticket_minimo}
                  onChange={(e) => setFormData((prev) => ({ ...prev, ticket_minimo: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
            </div>
          )}

          {/* Variants section */}
          {formData.has_variants && (
            <div className="space-y-3 border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">
                  Variações <Badge variant="secondary">{variants.length}</Badge>
                </h3>
                <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Variação
                </Button>
              </div>

              {variants.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma variação adicionada. Clique em "Adicionar Variação" para começar.
                </p>
              )}

              {variants.map((variant, index) => (
                <div key={variant.id || `new-${index}`} className="border rounded-md p-3 space-y-3 bg-background">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Variação {index + 1}
                        {variant.is_new && <Badge variant="outline" className="ml-2 text-xs">Nova</Badge>}
                      </span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeVariant(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Nome *</Label>
                      <Input
                        value={variant.name}
                        onChange={(e) => updateVariantField(index, "name", e.target.value)}
                        placeholder="Ex: Plano Pro, 500g, Azul"
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-xs">SKU</Label>
                      <Input
                        value={variant.sku}
                        onChange={(e) => updateVariantField(index, "sku", e.target.value)}
                        placeholder="Ex: REC-0001-01"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Ticket (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={variant.ticket}
                        onChange={(e) => updateVariantField(index, "ticket", e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Ticket Mínimo (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={variant.ticket_minimo}
                        onChange={(e) => updateVariantField(index, "ticket_minimo", e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Peso (kg)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={variant.weight}
                        onChange={(e) => updateVariantField(index, "weight", e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Gramatura (g/m²)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={variant.grammage}
                        onChange={(e) => updateVariantField(index, "grammage", e.target.value)}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Tamanho</Label>
                      <Input
                        value={variant.size}
                        onChange={(e) => updateVariantField(index, "size", e.target.value)}
                        placeholder="Ex: P, M, G, 500ml"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Cor</Label>
                      <Input
                        value={variant.color}
                        onChange={(e) => updateVariantField(index, "color", e.target.value)}
                        placeholder="Ex: Azul, Vermelho"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Dimensões</Label>
                      <Input
                        value={variant.dimensions}
                        onChange={(e) => updateVariantField(index, "dimensions", e.target.value)}
                        placeholder="Ex: 30x20x10 cm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          <div>
            <Label htmlFor="entregaveis">Entregáveis</Label>
            <Textarea
              id="entregaveis"
              value={formData.entregaveis}
              onChange={(e) => setFormData((prev) => ({ ...prev, entregaveis: e.target.value }))}
              placeholder="Descreva os entregáveis do produto..."
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="materiais">Materiais</Label>
            <Textarea
              id="materiais"
              value={formData.materiais}
              onChange={(e) => setFormData((prev) => ({ ...prev, materiais: e.target.value }))}
              placeholder="Materiais sobre o produto..."
              rows={3}
            />
          </div>

          {/* Links */}
          <div>
            <Label>Links</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={newLink}
                onChange={(e) => setNewLink(e.target.value)}
                placeholder="https://..."
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())}
              />
              <Button type="button" variant="outline" onClick={addLink}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {formData.links.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.links.map((link, index) => (
                  <div key={index} className="flex items-center gap-1 bg-muted px-2 py-1 rounded text-sm">
                    <span className="truncate max-w-[200px]">{link}</span>
                    <button type="button" onClick={() => removeLink(index)}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* URLs */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="logo_url">URL do Logo</Label>
              <Input
                id="logo_url"
                value={formData.logo_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, logo_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="contrato_padrao_url">URL Contrato Padrão</Label>
              <Input
                id="contrato_padrao_url"
                value={formData.contrato_padrao_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, contrato_padrao_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="contrato_minimo_url">URL Contrato Mínimo</Label>
              <Input
                id="contrato_minimo_url"
                value={formData.contrato_minimo_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, contrato_minimo_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
          </div>

          {/* Materials (only when editing existing product) */}
          {product?.id && (
            <div className="border-t border-border pt-4">
              <ProductMaterialsSection productId={product.id} />
            </div>
          )}

          {/* Active */}
          <div className="flex items-center gap-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_active: checked }))}
            />
            <Label htmlFor="is_active">Produto ativo</Label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
