/**
 * PlanEditor — editor visual de plano com 5 tabs:
 * Geral | Módulos | Campanhas | IA & Integrações | Limites
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Loader2 } from "lucide-react";
import { PlanFeatureCard } from "./PlanFeatureCard";
import { useUpdatePlan, type Plan } from "../hooks/useMasterPlans";
import {
  FEATURES,
  LIMITS,
  getFeaturesByCategory,
} from "@/modules/platform/lib/feature-registry";

interface PlanEditorProps {
  plan: Plan;
  // NOTE: accepted for API compat (MasterPlans passes it) but the editor
  // auto-saves on debounce and currently has no explicit close/cancel control,
  // so it is never invoked. Follow-up: wire a close affordance or drop the prop.
  onClose?: () => void;
}

export function PlanEditor({ plan }: PlanEditorProps) {
  const updatePlan = useUpdatePlan();

  // Local state (cópia editável)
  const [displayName, setDisplayName] = useState(plan.display_name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [pricePerUserMonthly, setPricePerUserMonthly] = useState<number | null>(plan.price_per_user_monthly);
  const [basePriceMonthly, setBasePriceMonthly] = useState<number | null>(plan.base_price_monthly);
  const [minUsers, setMinUsers] = useState(plan.min_users);
  const [includedUsers, setIncludedUsers] = useState(plan.included_users);
  const [includedCopilots, setIncludedCopilots] = useState(plan.included_copilots);
  const [extraUserPrice, setExtraUserPrice] = useState(plan.extra_user_price);
  const [discountSemesterPct, setDiscountSemesterPct] = useState(plan.discount_semester_pct);
  const [discountAnnualPct, setDiscountAnnualPct] = useState(plan.discount_annual_pct);
  const [discountVolumePct, setDiscountVolumePct] = useState(plan.discount_volume_pct);
  const [discountVolumeMin, setDiscountVolumeMin] = useState(plan.discount_volume_min);
  const [isActive, setIsActive] = useState(plan.is_active);
  const [features, setFeatures] = useState<Record<string, boolean>>(plan.features);
  const [limits, setLimits] = useState<Record<string, number>>(plan.limits);
  const [dirty, setDirty] = useState(false);

  // Debounce auto-save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDisplayName(plan.display_name);
    setDescription(plan.description ?? "");
    setPricePerUserMonthly(plan.price_per_user_monthly);
    setBasePriceMonthly(plan.base_price_monthly);
    setMinUsers(plan.min_users);
    setIncludedUsers(plan.included_users);
    setIncludedCopilots(plan.included_copilots);
    setExtraUserPrice(plan.extra_user_price);
    setDiscountSemesterPct(plan.discount_semester_pct);
    setDiscountAnnualPct(plan.discount_annual_pct);
    setDiscountVolumePct(plan.discount_volume_pct);
    setDiscountVolumeMin(plan.discount_volume_min);
    setIsActive(plan.is_active);
    setFeatures(plan.features);
    setLimits(plan.limits);
    setDirty(false);
  }, [plan.id]);

  const markDirty = useCallback(() => {
    setDirty(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // auto-save indicator
    }, 2000);
  }, []);

  const handleFeatureToggle = (key: string, value: boolean) => {
    setFeatures((prev) => ({ ...prev, [key]: value }));
    markDirty();
  };

  const handleLimitChange = (key: string, value: number) => {
    setLimits((prev) => ({ ...prev, [key]: value }));
    markDirty();
  };

  const handleSave = () => {
    updatePlan.mutate({
      id: plan.id,
      display_name: displayName,
      description: description || null,
      is_active: isActive,
      features,
      limits,
      price_per_user_monthly: pricePerUserMonthly,
      base_price_monthly: basePriceMonthly,
      min_users: minUsers,
      included_users: includedUsers,
      included_copilots: includedCopilots,
      extra_user_price: extraUserPrice,
      price_monthly: basePriceMonthly ?? (pricePerUserMonthly ?? 0) * minUsers,
      price_yearly: 0,
      discount_semester_pct: discountSemesterPct,
      discount_annual_pct: discountAnnualPct,
      discount_volume_pct: discountVolumePct,
      discount_volume_min: discountVolumeMin,
    });
    setDirty(false);
  };

  const moduleFeatures = getFeaturesByCategory("modules");
  const campaignFeatures = getFeaturesByCategory("campaigns");
  // "Avançado" é tudo o que não é módulo nem campanha, e não a categoria literal
  // "advanced". O catálogo veio do banco e traz categorias que este editor não conhece
  // (`features`, `integrations`, ...); filtrar pela literal esconderia features vendáveis
  // como customer_portfolio e external_cadastro.
  const advancedFeatures = FEATURES.filter(
    (f) => f.category !== "modules" && f.category !== "campaigns",
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{plan.display_name}</h2>
          <p className="text-sm text-muted-foreground">Plano: {plan.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-amber-500 font-medium">Alterações não salvas</span>
          )}
          <Button onClick={handleSave} disabled={updatePlan.isPending || !dirty}>
            {updatePlan.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="geral" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="modulos">Módulos</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="avancado">IA & Integrações</TabsTrigger>
          <TabsTrigger value="limites">Limites</TabsTrigger>
        </TabsList>

        {/* TAB: Geral */}
        <TabsContent value="geral" className="space-y-4 mt-4">
          {/* Name & Slug */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome de Exibição</Label>
              <Input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (não editável)</Label>
              <Input value={plan.name} disabled />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty(); }}
              rows={2}
            />
          </div>

          {/* Pricing Model */}
          <div className="rounded-lg border p-4 space-y-4">
            <h3 className="text-sm font-semibold">Modelo de Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preço por Usuário/mês (R$)</Label>
                <Input
                  type="number"
                  placeholder="NULL = não é per-seat"
                  value={pricePerUserMonthly ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPricePerUserMonthly(v === "" ? null : parseFloat(v) || 0);
                    markDirty();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Preço Base Mensal (R$)</Label>
                <Input
                  type="number"
                  placeholder="NULL = não é package"
                  value={basePriceMonthly ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBasePriceMonthly(v === "" ? null : parseFloat(v) || 0);
                    markDirty();
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Mín. Usuários</Label>
                <Input
                  type="number"
                  value={minUsers}
                  onChange={(e) => { setMinUsers(parseInt(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Incluídos</Label>
                <Input
                  type="number"
                  value={includedUsers}
                  onChange={(e) => { setIncludedUsers(parseInt(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Copilots Incl.</Label>
                <Input
                  type="number"
                  value={includedCopilots}
                  onChange={(e) => { setIncludedCopilots(parseInt(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Extra/Usuário (R$)</Label>
                <Input
                  type="number"
                  value={extraUserPrice}
                  onChange={(e) => { setExtraUserPrice(parseFloat(e.target.value) || 0); markDirty(); }}
                />
              </div>
            </div>
          </div>

          {/* Discounts */}
          <div className="rounded-lg border p-4 space-y-4">
            <h3 className="text-sm font-semibold">Descontos</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Semestral (%)</Label>
                <Input
                  type="number"
                  value={discountSemesterPct}
                  onChange={(e) => { setDiscountSemesterPct(parseFloat(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Anual (%)</Label>
                <Input
                  type="number"
                  value={discountAnnualPct}
                  onChange={(e) => { setDiscountAnnualPct(parseFloat(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Volume (%)</Label>
                <Input
                  type="number"
                  value={discountVolumePct}
                  onChange={(e) => { setDiscountVolumePct(parseFloat(e.target.value) || 0); markDirty(); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Volume Mín. Users</Label>
                <Input
                  type="number"
                  value={discountVolumeMin}
                  onChange={(e) => { setDiscountVolumeMin(parseInt(e.target.value) || 0); markDirty(); }}
                />
              </div>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="text-sm font-medium">Plano Ativo</p>
              <p className="text-xs text-muted-foreground">Organizações podem usar este plano</p>
            </div>
            <Switch checked={isActive} onCheckedChange={(v) => { setIsActive(v); markDirty(); }} />
          </div>
        </TabsContent>

        {/* TAB: Módulos */}
        <TabsContent value="modulos" className="space-y-3 mt-4">
          <p className="text-sm text-muted-foreground">
            Módulos da sidebar — quando desativado, o item aparece com cadeado para o usuário.
          </p>
          {moduleFeatures.map((f) => (
            <PlanFeatureCard
              key={f.key}
              feature={f}
              enabled={features[f.key] ?? false}
              onToggle={handleFeatureToggle}
            />
          ))}
        </TabsContent>

        {/* TAB: Campanhas */}
        <TabsContent value="campanhas" className="space-y-3 mt-4">
          <p className="text-sm text-muted-foreground">
            Tipos de campanha — quando desativado, a opção fica oculta na criação de campanha.
          </p>
          {campaignFeatures.map((f) => (
            <PlanFeatureCard
              key={f.key}
              feature={f}
              enabled={features[f.key] ?? false}
              onToggle={handleFeatureToggle}
            />
          ))}
        </TabsContent>

        {/* TAB: IA & Integrações */}
        <TabsContent value="avancado" className="space-y-3 mt-4">
          <p className="text-sm text-muted-foreground">
            Features avançadas — sub-recursos que complementam os módulos.
          </p>
          {advancedFeatures.map((f) => (
            <PlanFeatureCard
              key={f.key}
              feature={f}
              enabled={features[f.key] ?? false}
              onToggle={handleFeatureToggle}
            />
          ))}
        </TabsContent>

        {/* TAB: Limites */}
        <TabsContent value="limites" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Limites numéricos — use <strong>-1</strong> para ilimitado.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {LIMITS.map((lim) => (
              <div key={lim.key} className="p-3 rounded-lg border space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{lim.label}</p>
                    <p className="text-xs text-muted-foreground">{lim.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-28"
                    value={limits[lim.key] ?? 0}
                    onChange={(e) => handleLimitChange(lim.key, parseInt(e.target.value) || 0)}
                  />
                  <span className="text-xs text-muted-foreground">{lim.unit}</span>
                  {(limits[lim.key] ?? 0) === -1 && (
                    <span className="text-xs font-medium text-primary">Ilimitado</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
