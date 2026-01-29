/**
 * Página de gerenciamento de planos pelo Master
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CreditCard,
  Plus,
  Edit,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";

interface Plan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  is_active: boolean;
  is_default: boolean;
  position: number;
}

export default function MasterPlans() {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    display_name: "",
    description: "",
    price_monthly: 0,
    price_yearly: 0,
    is_active: true,
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ["master-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("position");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const updatePlan = useMutation({
    mutationFn: async (data: Partial<Plan> & { id: string }) => {
      const { error } = await supabase
        .from("subscription_plans")
        .update(data)
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-plans"] });
      toast.success("Plano atualizado!");
      setEditOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handleEdit = (plan: Plan) => {
    setSelectedPlan(plan);
    setFormData({
      name: plan.name,
      display_name: plan.display_name,
      description: plan.description || "",
      price_monthly: plan.price_monthly,
      price_yearly: plan.price_yearly,
      is_active: plan.is_active,
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    if (!selectedPlan) return;
    updatePlan.mutate({
      id: selectedPlan.id,
      display_name: formData.display_name,
      description: formData.description || null,
      price_monthly: formData.price_monthly,
      price_yearly: formData.price_yearly,
      is_active: formData.is_active,
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="w-6 h-6" />
          Planos de Assinatura
        </h1>
        <p className="text-muted-foreground">
          Gerencie os planos disponíveis no sistema
        </p>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <div className="col-span-4 text-center py-8 text-muted-foreground">
            Carregando...
          </div>
        ) : (
          plans?.map((plan) => (
            <Card key={plan.id} className={!plan.is_active ? "opacity-60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{plan.display_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{plan.name}</p>
                  </div>
                  <div className="flex gap-1">
                    {plan.is_default && (
                      <Badge variant="outline" className="text-xs">Padrão</Badge>
                    )}
                    {!plan.is_active && (
                      <Badge variant="secondary" className="text-xs">Inativo</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Prices */}
                <div>
                  <p className="text-2xl font-bold">
                    {formatCurrency(plan.price_monthly)}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ou {formatCurrency(plan.price_yearly)}/ano
                  </p>
                </div>

                {/* Description */}
                {plan.description && (
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                )}

                {/* Features */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Features:</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(plan.features).map(([key, value]) => (
                      <Badge
                        key={key}
                        variant={value ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {value ? <Check className="w-3 h-3 mr-1" /> : <X className="w-3 h-3 mr-1" />}
                        {key}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Limits */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Limites:</p>
                  <div className="text-xs space-y-0.5">
                    {Object.entries(plan.limits).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="capitalize">{key}:</span>
                        <span className="font-medium">
                          {value === -1 ? "Ilimitado" : value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleEdit(plan)}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Plano - {selectedPlan?.display_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome de Exibição</Label>
              <Input
                value={formData.display_name}
                onChange={(e) =>
                  setFormData({ ...formData, display_name: e.target.value })
                }
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preço Mensal (R$)</Label>
                <Input
                  type="number"
                  value={formData.price_monthly}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      price_monthly: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Preço Anual (R$)</Label>
                <Input
                  type="number"
                  value={formData.price_yearly}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      price_yearly: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Plano Ativo</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={updatePlan.isPending}>
              {updatePlan.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
