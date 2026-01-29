/**
 * Modal para Override de Billing pelo Master Admin
 * Permite liberar planos e features manualmente para organizações
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, CreditCard, Flag, Calendar } from "lucide-react";
import { useMasterBillingOverride } from "@/hooks/useMasterOrganizations";
import { toast } from "sonner";

interface BillingOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    name: string;
    subscription_plan: string | null;
    subscription_status: string;
    billing_override: boolean;
  } | null;
}

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
}

export function BillingOverrideModal({
  open,
  onOpenChange,
  organization,
}: BillingOverrideModalProps) {
  const [activeTab, setActiveTab] = useState("plan");
  const [selectedPlan, setSelectedPlan] = useState("pro");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState<Record<string, boolean>>({});
  const [featureReason, setFeatureReason] = useState("");

  const billingOverride = useMasterBillingOverride();

  // Fetch available plans
  const { data: plans } = useQuery({
    queryKey: ["master-subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  // Fetch available features
  const { data: features } = useQuery({
    queryKey: ["master-feature-flags"],
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

  // Fetch current organization features
  const { data: orgFeatures } = useQuery({
    queryKey: ["master-org-features", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("organization_features")
        .select("*")
        .eq("organization_id", organization.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const handlePlanOverride = async () => {
    if (!organization || !reason) {
      toast.error("Informe o motivo do override");
      return;
    }

    await billingOverride.mutateAsync({
      orgId: organization.id,
      plan: selectedPlan,
      reason,
      expiresAt: expiresAt || undefined,
    });

    setReason("");
    setExpiresAt("");
    onOpenChange(false);
  };

  const handleFeatureOverride = async () => {
    if (!organization || !featureReason) {
      toast.error("Informe o motivo do override");
      return;
    }

    try {
      for (const [featureKey, enabled] of Object.entries(selectedFeatures)) {
        if (enabled) {
          const { error } = await supabase.rpc("master_enable_feature", {
            _org_id: organization.id,
            _feature_key: featureKey,
            _reason: featureReason,
            _expires_at: expiresAt || null,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("master_disable_feature", {
            _org_id: organization.id,
            _feature_key: featureKey,
            _reason: featureReason,
          });
          if (error) throw error;
        }
      }

      toast.success("Features atualizadas com sucesso!");
      setSelectedFeatures({});
      setFeatureReason("");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar features");
    }
  };

  const toggleFeature = (key: string) => {
    setSelectedFeatures((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const isFeatureEnabled = (key: string) => {
    if (key in selectedFeatures) {
      return selectedFeatures[key];
    }
    return orgFeatures?.some((of) => of.feature_key === key && of.enabled) || false;
  };

  if (!organization) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Billing Override - {organization.name}
          </DialogTitle>
          <DialogDescription>
            Libere planos ou features manualmente para esta organização
          </DialogDescription>
        </DialogHeader>

        {/* Current Status */}
        <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Status Atual</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant={organization.subscription_status === "active" ? "default" : "secondary"}
              >
                {organization.subscription_status}
              </Badge>
              <span className="font-medium capitalize">
                {organization.subscription_plan || "free"}
              </span>
              {organization.billing_override && (
                <Badge className="bg-purple-500">Override Ativo</Badge>
              )}
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="plan" className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Plano
            </TabsTrigger>
            <TabsTrigger value="features" className="flex items-center gap-2">
              <Flag className="w-4 h-4" />
              Features
            </TabsTrigger>
          </TabsList>

          {/* Plan Override */}
          <TabsContent value="plan" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Plano</Label>
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans?.map((plan) => (
                    <SelectItem key={plan.id} value={plan.name}>
                      <div className="flex items-center justify-between w-full">
                        <span>{plan.display_name}</span>
                        <span className="text-muted-foreground ml-4">
                          R$ {plan.price_monthly}/mês
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Expira em (opcional)</Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
              <p className="text-xs text-muted-foreground">
                Deixe vazio para acesso permanente
              </p>
            </div>

            <div className="space-y-2">
              <Label>Motivo do Override *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: Parceria estratégica, período de teste especial, migração de plataforma..."
                rows={3}
              />
            </div>

            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Esta ação será registrada no log de auditoria. O plano será
                liberado imediatamente e a organização terá acesso a todas as
                features do plano selecionado.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handlePlanOverride}
                disabled={!reason || billingOverride.isPending}
              >
                {billingOverride.isPending ? "Liberando..." : "Liberar Plano"}
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* Features Override */}
          <TabsContent value="features" className="space-y-4 mt-4">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {features?.map((feature) => (
                <div
                  key={feature.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">{feature.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {feature.description || feature.key}
                    </p>
                    <Badge variant="outline" className="mt-1 text-xs">
                      {feature.category}
                    </Badge>
                  </div>
                  <Switch
                    checked={isFeatureEnabled(feature.key)}
                    onCheckedChange={() => toggleFeature(feature.key)}
                  />
                </div>
              ))}
            </div>

            {Object.keys(selectedFeatures).length > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Motivo das alterações *</Label>
                  <Textarea
                    value={featureReason}
                    onChange={(e) => setFeatureReason(e.target.value)}
                    placeholder="Ex: Teste de nova funcionalidade, necessidade específica do cliente..."
                    rows={2}
                  />
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setSelectedFeatures({})}>
                    Cancelar Alterações
                  </Button>
                  <Button onClick={handleFeatureOverride} disabled={!featureReason}>
                    Salvar Features ({Object.keys(selectedFeatures).length})
                  </Button>
                </DialogFooter>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
