/**
 * Página de gerenciamento de Feature Flags pelo Master
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  Plus,
  Edit,
  Trash2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MasterPageHeader } from "../components/MasterPageHeader";
import { notifyError } from "@/shared/errors";

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  default_enabled: boolean;
  requires_plan: string[];
  created_at: string;
}

export default function MasterFeatures() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<FeatureFlag | null>(null);

  const [formData, setFormData] = useState({
    key: "",
    name: "",
    description: "",
    category: "general",
    default_enabled: false,
  });

  const { data: features, isLoading } = useQuery({
    queryKey: ["master-features"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("*")
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as FeatureFlag[];
    },
  });

  const createFeature = useMutation({
    mutationFn: async (data: TablesInsert<"feature_catalog">) => {
      const { error } = await supabase.from("feature_catalog").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-features"] });
      toast.success("Feature criada!");
      setCreateOpen(false);
      resetForm();
    },
    onError: (error: unknown) => {
      notifyError(error, { fallback: "Não foi possível criar a feature." });
    },
  });

  const updateFeature = useMutation({
    mutationFn: async ({ id, ...data }: Partial<FeatureFlag> & { id: string }) => {
      const { error } = await supabase
        .from("feature_catalog")
        .update(data)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-features"] });
      toast.success("Feature atualizada!");
      setEditOpen(false);
    },
    onError: (error: unknown) => {
      notifyError(error, { fallback: "Não foi possível atualizar a feature." });
    },
  });

  const deleteFeature = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("feature_catalog").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-features"] });
      toast.success("Feature excluída!");
    },
    onError: (error: unknown) => {
      notifyError(error, { fallback: "Não foi possível excluir a feature." });
    },
  });

  const resetForm = () => {
    setFormData({
      key: "",
      name: "",
      description: "",
      category: "general",
      default_enabled: false,
    });
  };

  const handleEdit = (feature: FeatureFlag) => {
    setSelectedFeature(feature);
    setFormData({
      key: feature.key,
      name: feature.name,
      description: feature.description || "",
      category: feature.category,
      default_enabled: feature.default_enabled,
    });
    setEditOpen(true);
  };

  const filteredFeatures = features?.filter(
    (f) =>
      f.key.toLowerCase().includes(search.toLowerCase()) ||
      f.name.toLowerCase().includes(search.toLowerCase())
  );

  const getCategoryBadge = (category: string) => {
    // Paleta categórica em tons do V5 (não é status): só distingue a categoria.
    const tones: Record<string, BadgeProps["variant"]> = {
      ai: "gold",
      integrations: "info",
      analytics: "success",
      sales: "warning",
      engagement: "ink",
      branding: "outline",
    };
    return <Badge variant={tones[category] ?? "soft"}>{category}</Badge>;
  };

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Feature flags"
        subtitle="Gerencie as features disponíveis no sistema"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            Nova feature
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar features..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table — carga e vazio ficam FORA da tabela, centrados no cartão: dentro
          dela, no celular, o texto seguia a largura das colunas e ia parar na
          borda. Key e categoria sobem para baixo do nome quando a coluna some;
          planos só a partir de lg. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : !filteredFeatures?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma feature encontrada</p>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="max-md:hidden">Key</TableHead>
                <TableHead className="max-sm:hidden">Categoria</TableHead>
                <TableHead>Padrão</TableHead>
                <TableHead className="max-lg:hidden">Planos</TableHead>
                <TableHead className="w-[100px]">
                  <span className="max-sm:sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFeatures.map((feature) => (
                  <TableRow key={feature.id}>
                    <TableCell className="max-md:w-full max-md:max-w-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{feature.name}</p>
                        {feature.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {feature.description}
                          </p>
                        )}
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 md:hidden">
                          <code className="truncate rounded bg-muted px-1 py-0.5 text-xs">{feature.key}</code>
                          <div className="sm:hidden">{getCategoryBadge(feature.category)}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-md:hidden">
                      <code className="text-sm bg-muted px-1 py-0.5 rounded">
                        {feature.key}
                      </code>
                    </TableCell>
                    <TableCell className="max-sm:hidden">{getCategoryBadge(feature.category)}</TableCell>
                    <TableCell>
                      {feature.default_enabled ? (
                        <Badge variant="success">Ativo</Badge>
                      ) : (
                        <Badge variant="soft">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-lg:hidden">
                      <div className="flex flex-wrap gap-1">
                        {feature.requires_plan?.map((plan) => (
                          <Badge key={plan} variant="outline" className="text-xs">
                            {plan}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${feature.name}`}
                          onClick={() => handleEdit(feature)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label={`Excluir ${feature.name}`}
                          onClick={() => {
                            if (confirm("Excluir esta feature?")) {
                              deleteFeature.mutate(feature.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova feature flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Key (identificador único)</Label>
              <Input
                value={formData.key}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    key: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                  })
                }
                placeholder="feature_key"
              />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nome da feature"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={formData.category}
                onValueChange={(v) => setFormData({ ...formData, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Geral</SelectItem>
                  <SelectItem value="ai">IA</SelectItem>
                  <SelectItem value="integrations">Integrações</SelectItem>
                  <SelectItem value="analytics">Analytics</SelectItem>
                  <SelectItem value="sales">Vendas</SelectItem>
                  <SelectItem value="engagement">Engajamento</SelectItem>
                  <SelectItem value="branding">Branding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo por padrão</Label>
              <Switch
                checked={formData.default_enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, default_enabled: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createFeature.mutate(formData)}
              disabled={!formData.key || !formData.name || createFeature.isPending}
            >
              {createFeature.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar feature - {selectedFeature?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Key (não editável)</Label>
              <Input value={formData.key} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={formData.category}
                onValueChange={(v) => setFormData({ ...formData, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Geral</SelectItem>
                  <SelectItem value="ai">IA</SelectItem>
                  <SelectItem value="integrations">Integrações</SelectItem>
                  <SelectItem value="analytics">Analytics</SelectItem>
                  <SelectItem value="sales">Vendas</SelectItem>
                  <SelectItem value="engagement">Engajamento</SelectItem>
                  <SelectItem value="branding">Branding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo por padrão</Label>
              <Switch
                checked={formData.default_enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, default_enabled: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                updateFeature.mutate({
                  id: selectedFeature!.id,
                  name: formData.name,
                  description: formData.description || null,
                  category: formData.category,
                  default_enabled: formData.default_enabled,
                })
              }
              disabled={updateFeature.isPending}
            >
              {updateFeature.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
