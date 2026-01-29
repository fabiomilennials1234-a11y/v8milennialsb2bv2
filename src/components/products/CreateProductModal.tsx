import { useState } from "react";
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
import { useCreateProduct, ProductType } from "@/hooks/useProducts";
import { Plus, X } from "lucide-react";

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProductModal({ open, onOpenChange }: CreateProductModalProps) {
  const createProduct = useCreateProduct();
  const [formData, setFormData] = useState({
    name: "",
    type: "mrr" as ProductType,
    ticket: "",
    ticket_minimo: "",
    entregaveis: "",
    materiais: "",
    links: [] as string[],
    logo_url: "",
    contrato_padrao_url: "",
    contrato_minimo_url: "",
    is_active: true,
  });
  const [newLink, setNewLink] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await createProduct.mutateAsync({
      name: formData.name,
      type: formData.type,
      ticket: formData.ticket ? parseFloat(formData.ticket) : null,
      ticket_minimo: formData.ticket_minimo ? parseFloat(formData.ticket_minimo) : null,
      entregaveis: formData.entregaveis || null,
      materiais: formData.materiais || null,
      links: formData.links.length > 0 ? formData.links : null,
      logo_url: formData.logo_url || null,
      contrato_padrao_url: formData.contrato_padrao_url || null,
      contrato_minimo_url: formData.contrato_minimo_url || null,
      is_active: formData.is_active,
    });

    setFormData({
      name: "",
      type: "mrr",
      ticket: "",
      ticket_minimo: "",
      entregaveis: "",
      materiais: "",
      links: [],
      logo_url: "",
      contrato_padrao_url: "",
      contrato_minimo_url: "",
      is_active: true,
    });
    onOpenChange(false);
  };

  const addLink = () => {
    if (newLink.trim()) {
      setFormData((prev) => ({
        ...prev,
        links: [...prev.links, newLink.trim()],
      }));
      setNewLink("");
    }
  };

  const removeLink = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      links: prev.links.filter((_, i) => i !== index),
    }));
  };

  // Usar Dialog (modal centralizado), não Sheet, para não abrir segunda sidebar ao lado da sidebar principal
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Novo Produto</DialogTitle>
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
                  <SelectItem value="mrr">MRR (Recorrente)</SelectItem>
                  <SelectItem value="projeto">Projeto</SelectItem>
                  <SelectItem value="unitario">Unitário (Pontual)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Pricing */}
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
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, ticket_minimo: e.target.value }))
                }
                placeholder="0,00"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <Label htmlFor="entregaveis">Entregáveis</Label>
            <Textarea
              id="entregaveis"
              value={formData.entregaveis}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, entregaveis: e.target.value }))
              }
              placeholder="Descreva os entregáveis do produto..."
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="materiais">Materiais</Label>
            <Textarea
              id="materiais"
              value={formData.materiais}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, materiais: e.target.value }))
              }
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
                  <div
                    key={index}
                    className="flex items-center gap-1 bg-muted px-2 py-1 rounded text-sm"
                  >
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
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, logo_url: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="contrato_padrao_url">URL Contrato Padrão</Label>
              <Input
                id="contrato_padrao_url"
                value={formData.contrato_padrao_url}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, contrato_padrao_url: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="contrato_minimo_url">URL Contrato Mínimo</Label>
              <Input
                id="contrato_minimo_url"
                value={formData.contrato_minimo_url}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, contrato_minimo_url: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
          </div>

          {/* Active */}
          <div className="flex items-center gap-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, is_active: checked }))
              }
            />
            <Label htmlFor="is_active">Produto ativo</Label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createProduct.isPending}>
              {createProduct.isPending ? "Criando..." : "Criar Produto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
