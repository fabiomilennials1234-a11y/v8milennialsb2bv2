---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-27-funis-campanhas-redesign.md
---

# Funis + Campanhas Temporárias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "Campanhas" concept with two clear concepts: Structural Funnels (permanent) and Temporary Campaigns (with deadline, goals, incentives). Rename default pipes, adapt by quiz, prepare plan gates.

**Architecture:** Additive approach - new `pipeline_display_config` table controls funnel naming/visibility per org. `campanhas` table gets new status/template columns. Sidebar reads display config dynamically. No existing tables/routes broken.

**Tech Stack:** React + TypeScript, Tailwind CSS, Framer Motion, Supabase (plpgsql RPCs, RLS), @tanstack/react-query, shadcn/ui, Lucide icons.

**Branch:** `feature-funis` (already created from main)
**Database:** DEV only (`bcfadphgsibjzivtbjvc`)

---

## File Structure

### New Files (Migrations)
- `supabase/migrations/20260327200000_pipeline_display_config.sql` - New table + seed for existing orgs
- `supabase/migrations/20260327200001_campanhas_status_evolution.sql` - Add status, template_type, started_at, ended_at, end_action to campanhas
- `supabase/migrations/20260327200002_feature_keys_funis_campanhas.sql` - New feature/limit keys

### New Files (Frontend)
- `src/hooks/usePipelineDisplayConfig.ts` - Hook to read/update pipeline_display_config
- `src/components/shared/CreateNewModal.tsx` - "Criar novo" modal (Funil vs Campanha choice)
- `src/components/campanhas/CampaignTemplateSelector.tsx` - Campaign template selection step
- `src/components/campanhas/CampaignEndModal.tsx` - End campaign modal (move leads or freeze)

### Modified Files
- `src/components/layout/Sidebar.tsx` - Dynamic labels from display config, Carteira in Funis group, "Criar novo" modal, rename labels
- `src/lib/feature-registry.ts` - Add new FeatureKeys and LimitKeys
- `src/contexts/OrgFeaturesContext.tsx` - Add `canCreateFunnel()` helper
- `src/pages/Campanhas.tsx` - Filter by status, show badges, support read-only for ended
- `src/hooks/useCampanhas.ts` - Add status field support, deprecate objective references

---

## Task 1: Backend - pipeline_display_config table

**Files:**
- Create: `supabase/migrations/20260327200000_pipeline_display_config.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Pipeline display configuration: controls naming and visibility of default funnels per org
CREATE TABLE IF NOT EXISTS public.pipeline_display_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas', 'upsell')),
  display_name TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, pipe_type)
);

CREATE INDEX idx_pipeline_display_config_org ON pipeline_display_config(organization_id);

-- RLS
ALTER TABLE pipeline_display_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org pipeline config"
  ON pipeline_display_config FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can update own org pipeline config"
  ON pipeline_display_config FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Admins can insert own org pipeline config"
  ON pipeline_display_config FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Seed defaults for ALL existing organizations
INSERT INTO pipeline_display_config (organization_id, pipe_type, display_name, is_visible, position)
SELECT o.id, cfg.pipe_type, cfg.display_name, cfg.is_visible, cfg.position
FROM organizations o
CROSS JOIN (VALUES
  ('whatsapp', 'Oportunidades', true, 1),
  ('confirmacao', 'Agendamentos', true, 2),
  ('propostas', 'Orçamentos', true, 3),
  ('upsell', 'Carteira', true, 4)
) AS cfg(pipe_type, display_name, is_visible, position)
ON CONFLICT (organization_id, pipe_type) DO NOTHING;

-- RPC to ensure config exists for an org (called during onboarding or first sidebar load)
CREATE OR REPLACE FUNCTION public.ensure_pipeline_display_config(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pipeline_display_config (organization_id, pipe_type, display_name, is_visible, position)
  VALUES
    (p_org_id, 'whatsapp', 'Oportunidades', true, 1),
    (p_org_id, 'confirmacao', 'Agendamentos', true, 2),
    (p_org_id, 'propostas', 'Orçamentos', true, 3),
    (p_org_id, 'upsell', 'Carteira', true, 4)
  ON CONFLICT (organization_id, pipe_type) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_pipeline_display_config(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_pipeline_display_config(UUID) TO service_role;
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327200000_pipeline_display_config.sql
git commit -m "feat(db): add pipeline_display_config table with seed for existing orgs"
```

---

## Task 2: Backend - Evolve campanhas table

**Files:**
- Create: `supabase/migrations/20260327200001_campanhas_status_evolution.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Create campaign_status enum
DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create campaign_template_type enum
DO $$ BEGIN
  CREATE TYPE campaign_template_type AS ENUM ('indicacao', 'prospeccao', 'reativacao', 'livre');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to campanhas (additive, no breaking changes)
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS status campaign_status NOT NULL DEFAULT 'draft';
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS template_type campaign_template_type NOT NULL DEFAULT 'livre';
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS end_action JSONB;

-- Migrate existing data: active campaigns → status='active', inactive → status='ended'
UPDATE campanhas SET status = 'active', started_at = created_at WHERE is_active = true AND status = 'draft';
UPDATE campanhas SET status = 'ended', ended_at = COALESCE(updated_at, now()) WHERE is_active = false AND status = 'draft';

-- All existing campaigns are 'livre' template type (already defaulted above)

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_campanhas_status ON campanhas(status);
CREATE INDEX IF NOT EXISTS idx_campanhas_org_status ON campanhas(organization_id, status);
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327200001_campanhas_status_evolution.sql
git commit -m "feat(db): add status, template_type, started_at, ended_at, end_action to campanhas"
```

---

## Task 3: Backend - New feature/limit keys

**Files:**
- Create: `supabase/migrations/20260327200002_feature_keys_funis_campanhas.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Add new feature keys to all plans (enabled=true for now, no real gating)
-- This uses the existing plan_features table structure

-- Insert new features for all existing plans
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT p.id, f.feature_key, true
FROM subscription_plans p
CROSS JOIN (VALUES
  ('funnels_custom'),
  ('carteira'),
  ('campaigns_indicacao'),
  ('campaigns_prospeccao'),
  ('campaigns_reativacao')
) AS f(feature_key)
WHERE NOT EXISTS (
  SELECT 1 FROM plan_features pf
  WHERE pf.plan_id = p.id AND pf.feature_key = f.feature_key
);

-- Add new limits for all existing plans (high values = no real restriction)
INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, l.limit_key, l.limit_value
FROM subscription_plans p
CROSS JOIN (VALUES
  ('max_active_campaigns', 999)
) AS l(limit_key, limit_value)
WHERE NOT EXISTS (
  SELECT 1 FROM plan_limits pl
  WHERE pl.plan_id = p.id AND pl.limit_key = l.limit_key
);
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327200002_feature_keys_funis_campanhas.sql
git commit -m "feat(db): add new feature and limit keys for funnels and campaigns"
```

---

## Task 4: Frontend - usePipelineDisplayConfig hook

**Files:**
- Create: `src/hooks/usePipelineDisplayConfig.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface PipelineDisplayConfig {
  id: string;
  organization_id: string;
  pipe_type: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  display_name: string;
  is_visible: boolean;
  position: number;
}

const PIPE_TYPE_MAP: Record<string, string> = {
  "/pipe-whatsapp": "whatsapp",
  "/pipe-confirmacao": "confirmacao",
  "/pipe-propostas": "propostas",
  "/upsell": "upsell",
};

const DEFAULT_CONFIG: PipelineDisplayConfig[] = [
  { id: "", organization_id: "", pipe_type: "whatsapp", display_name: "Oportunidades", is_visible: true, position: 1 },
  { id: "", organization_id: "", pipe_type: "confirmacao", display_name: "Agendamentos", is_visible: true, position: 2 },
  { id: "", organization_id: "", pipe_type: "propostas", display_name: "Orçamentos", is_visible: true, position: 3 },
  { id: "", organization_id: "", pipe_type: "upsell", display_name: "Carteira", is_visible: true, position: 4 },
];

export function usePipelineDisplayConfig() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline-display-config", organizationId],
    queryFn: async (): Promise<PipelineDisplayConfig[]> => {
      if (!organizationId) return DEFAULT_CONFIG;

      // Ensure config exists
      await supabase.rpc("ensure_pipeline_display_config", { p_org_id: organizationId });

      const { data, error } = await supabase
        .from("pipeline_display_config")
        .select("*")
        .eq("organization_id", organizationId)
        .order("position");

      if (error || !data?.length) return DEFAULT_CONFIG;
      return data as PipelineDisplayConfig[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
}

/** Get display name for a given route path */
export function useDisplayName(path: string): string {
  const { data: configs } = usePipelineDisplayConfig();
  const pipeType = PIPE_TYPE_MAP[path];
  if (!pipeType || !configs) return "";
  const config = configs.find((c) => c.pipe_type === pipeType);
  return config?.display_name ?? "";
}

/** Check if a pipe is visible */
export function usePipeVisibility(pipeType: string): boolean {
  const { data: configs } = usePipelineDisplayConfig();
  if (!configs) return true; // default visible while loading
  const config = configs.find((c) => c.pipe_type === pipeType);
  return config?.is_visible ?? true;
}

/** Get hidden default pipes (for "Criar novo" template list) */
export function useHiddenDefaultPipes() {
  const { data: configs } = usePipelineDisplayConfig();
  if (!configs) return [];
  return configs.filter((c) => !c.is_visible && c.pipe_type !== "upsell");
}

/** Toggle pipe visibility */
export function useTogglePipeVisibility() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ pipeType, visible }: { pipeType: string; visible: boolean }) => {
      if (!organizationId) throw new Error("No org");
      const { error } = await supabase
        .from("pipeline_display_config")
        .update({ is_visible: visible, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-display-config"] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePipelineDisplayConfig.ts
git commit -m "feat: add usePipelineDisplayConfig hook for dynamic funnel naming"
```

---

## Task 5: Frontend - Update feature-registry.ts

**Files:**
- Modify: `src/lib/feature-registry.ts`

- [ ] **Step 1: Add new FeatureKeys and LimitKeys**

Add to the `FeatureKey` type union (after line 33, before the semicolon):

```typescript
  // Funnels & Campaigns v2
  | "funnels_custom"
  | "carteira"
  | "campaigns_indicacao"
  | "campaigns_prospeccao"
  | "campaigns_reativacao"
```

Add to the `LimitKey` type union (after line 42, before the semicolon):

```typescript
  | "max_active_campaigns"
```

Add to the `FEATURES` array (after line 91):

```typescript
  // Funnels & Campaigns v2
  { key: "funnels_custom", label: "Funis Customizados", description: "Criar funis personalizados", icon: "GitBranch", category: "modules" },
  { key: "carteira", label: "Carteira", description: "Gestão de carteira de clientes", icon: "TrendingUp", category: "modules", sidebarPath: "/upsell" },
  { key: "campaigns_indicacao", label: "Campanha de Indicação", description: "Campanhas de indicação com templates", icon: "Heart", category: "campaigns" },
  { key: "campaigns_prospeccao", label: "Campanha de Prospecção", description: "Campanhas de prospecção ativa", icon: "Target", category: "campaigns" },
  { key: "campaigns_reativacao", label: "Campanha de Reativação", description: "Campanhas de reativação de base", icon: "RefreshCw", category: "campaigns" },
```

Add to the `LIMITS` array (after line 103):

```typescript
  { key: "max_active_campaigns", label: "Campanhas Ativas", description: "Número máximo de campanhas ativas simultâneas", unit: "campanhas" },
```

Add upsell to SIDEBAR_FEATURE_MAP (after line 117):

```typescript
SIDEBAR_FEATURE_MAP["/upsell"] = "carteira";
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/feature-registry.ts
git commit -m "feat: add new feature/limit keys for funnels and campaigns v2"
```

---

## Task 6: Frontend - CreateNewModal (Funil vs Campanha choice)

**Files:**
- Create: `src/components/shared/CreateNewModal.tsx`

- [ ] **Step 1: Create the modal component**

```typescript
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Target, Plus, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { CreatePipelineModal } from "@/components/custom-pipelines/CreatePipelineModal";
import { useHiddenDefaultPipes, useTogglePipeVisibility } from "@/hooks/usePipelineDisplayConfig";
import { toast } from "sonner";

interface CreateNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PIPE_ROUTES: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
};

export function CreateNewModal({ open, onOpenChange }: CreateNewModalProps) {
  const [step, setStep] = useState<"choice" | "funnel-templates" | "create-pipeline">("choice");
  const navigate = useNavigate();
  const hiddenPipes = useHiddenDefaultPipes();
  const toggleVisibility = useTogglePipeVisibility();

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => setStep("choice"), 200);
  };

  const handleActivateHiddenPipe = async (pipeType: string) => {
    try {
      await toggleVisibility.mutateAsync({ pipeType, visible: true });
      toast.success("Funil ativado com sucesso!");
      const route = PIPE_ROUTES[pipeType];
      if (route) navigate(route);
      handleClose();
    } catch {
      toast.error("Erro ao ativar funil");
    }
  };

  const handleCreateCampaign = () => {
    navigate("/campanhas?create=true");
    handleClose();
  };

  return (
    <>
      <Dialog open={open && step !== "create-pipeline"} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <AnimatePresence mode="wait">
            {step === "choice" && (
              <motion.div key="choice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DialogHeader>
                  <DialogTitle>Criar novo</DialogTitle>
                </DialogHeader>
                <div className="flex gap-4 mt-4">
                  <button
                    onClick={() => setStep("funnel-templates")}
                    className="flex-1 bg-primary/5 border border-primary/20 rounded-xl p-5 text-center hover:border-primary/40 transition-colors"
                  >
                    <GitBranch className="w-7 h-7 text-primary mx-auto mb-2" />
                    <p className="font-semibold text-sm">Funil</p>
                    <p className="text-xs text-muted-foreground mt-1">Permanente</p>
                  </button>
                  <button
                    onClick={handleCreateCampaign}
                    className="flex-1 bg-orange-500/5 border border-orange-500/20 rounded-xl p-5 text-center hover:border-orange-500/40 transition-colors"
                  >
                    <Target className="w-7 h-7 text-orange-500 mx-auto mb-2" />
                    <p className="font-semibold text-sm">Campanha</p>
                    <p className="text-xs text-muted-foreground mt-1">Temporária</p>
                  </button>
                </div>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground text-center">
                    <strong className="text-primary">Funil</strong> = processo contínuo da operação &nbsp;|&nbsp;
                    <strong className="text-orange-500">Campanha</strong> = ação com prazo, meta e incentivos
                  </p>
                </div>
              </motion.div>
            )}

            {step === "funnel-templates" && (
              <motion.div key="templates" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setStep("choice")}>
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <DialogTitle>Criar Funil</DialogTitle>
                  </div>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {/* Em branco */}
                  <button
                    onClick={() => { handleClose(); setStep("create-pipeline"); }}
                    className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-left hover:border-primary/40 transition-colors"
                  >
                    <Plus className="w-5 h-5 text-primary mb-2" />
                    <p className="font-semibold text-sm">Em branco</p>
                    <p className="text-xs text-muted-foreground mt-1">Stages personalizados</p>
                  </button>

                  {/* Hidden default pipes as reactivation options */}
                  {hiddenPipes.map((pipe) => (
                    <button
                      key={pipe.pipe_type}
                      onClick={() => handleActivateHiddenPipe(pipe.pipe_type)}
                      className="bg-muted/30 border border-border rounded-lg p-4 text-left hover:border-primary/30 transition-colors"
                    >
                      <p className="font-semibold text-sm">{pipe.display_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Oculto no seu perfil</p>
                      <p className="text-xs text-primary mt-1">Clique para ativar</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      {/* CreatePipelineModal reused for "Em branco" */}
      <CreatePipelineModal
        open={step === "create-pipeline"}
        onOpenChange={(v) => { if (!v) { setStep("choice"); } }}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/CreateNewModal.tsx
git commit -m "feat: add CreateNewModal for Funil vs Campanha choice"
```

---

## Task 7: Frontend - Update Sidebar

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

This is the most impactful UI change. Key changes:
1. Replace hardcoded `funisSubItems` labels with dynamic `pipeline_display_config`
2. Filter out `is_visible=false` items
3. Move Carteira inside Funis group (already there, just needs display config awareness)
4. Rename "Combustível" → "Leads"
5. Rename "Central de Comando" → "Central de Comandos"
6. Rename "Pilotos" → "Equipe"
7. Rename "Pitstop" → "Configuraçoes"
8. Replace `CreatePipelineModal` with `CreateNewModal` for the "+" button in Funis
9. Add `usePipelineDisplayConfig` hook

- [ ] **Step 1: Update imports and hook usage**

At the top of Sidebar.tsx, replace the `CreatePipelineModal` import with `CreateNewModal`:

```typescript
// Replace:
import { CreatePipelineModal } from "@/components/custom-pipelines/CreatePipelineModal";
// With:
import { CreateNewModal } from "@/components/shared/CreateNewModal";
```

Add the display config hook import:

```typescript
import { usePipelineDisplayConfig } from "@/hooks/usePipelineDisplayConfig";
```

- [ ] **Step 2: Replace hardcoded funisSubItems with dynamic config**

Replace the static `funisSubItems` array (lines 75-80) and the `navItems` array (lines 82-96) with dynamic versions. Inside the Sidebar component, use the hook:

```typescript
const { data: displayConfig } = usePipelineDisplayConfig();
```

Build funisSubItems dynamically:

```typescript
const PIPE_ICON_MAP: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  confirmacao: Calendar,
  propostas: Kanban,
  upsell: TrendingUp,
};

const PIPE_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

const dynamicFunisSubItems: NavItem[] = (displayConfig ?? [])
  .filter((c) => c.is_visible)
  .sort((a, b) => a.position - b.position)
  .map((c) => ({
    label: c.display_name,
    icon: PIPE_ICON_MAP[c.pipe_type] ?? GitBranch,
    path: PIPE_PATH_MAP[c.pipe_type] ?? "/",
  }));
```

- [ ] **Step 3: Rename labels in navItems**

Update the static navItems:

```typescript
const navItems: NavItemWithChildren[] = [
  { label: "Central de Comandos", icon: Gauge, path: "/" },
  { label: "Campanhas", icon: Target, path: "/campanhas" },
  { label: "Marketing", icon: BarChart2, path: "/marketing" },
  { label: "Analytics", icon: BarChart3, path: "/analytics", masterOnly: true },
  { label: "Chat", icon: Zap, path: "/chat" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: [] }, // children set dynamically
  { label: "Agenda", icon: CalendarDays, path: "/agenda" },
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
  { label: "Leads", icon: Fuel, path: "/leads" },              // was "Combustível"
  { label: "Pódio", icon: Trophy, path: "/performance" },
  { label: "Comissoes", icon: DollarSign, path: "/comissoes" },
  { label: "Copilot", icon: Bot, path: "/copilot" },
  { label: "Automaçoes", icon: Workflow, path: "/automacoes" },
];
```

And rename admin/bottom items:

```typescript
const adminNavItems: NavItem[] = [
  { label: "Equipe", icon: Flag, path: "/equipe" },           // was "Pilotos"
  { label: "Produtos", icon: Package, path: "/produtos" },
  { label: "TV Dashboard", icon: Tv, path: "/tv" },
];

const bottomNavItems: NavItem[] = [
  { label: "Configuraçoes", icon: Settings, path: "/configuracoes" }, // was "Pitstop"
];
```

- [ ] **Step 4: Replace CreatePipelineModal with CreateNewModal in the "+" button**

Find the section that renders the "+" button for creating funnels (the button inside Funis submenu) and change:

```typescript
// Replace CreatePipelineModal state and usage:
const [createNewOpen, setCreateNewOpen] = useState(false);

// In the render, replace:
// <CreatePipelineModal open={createPipeOpen} onOpenChange={setCreatePipeOpen} />
// With:
<CreateNewModal open={createNewOpen} onOpenChange={setCreateNewOpen} />
```

- [ ] **Step 5: Inject dynamic children into Funis nav item**

Before rendering, override the children of the "Funis" item:

```typescript
// Combine dynamic default pipes + custom pipes + "Criar novo" button
const funisItem = navItems.find((n) => n.path === "/funis");
if (funisItem) {
  funisItem.children = dynamicFunisSubItems;
}
```

Custom pipes are already appended dynamically in the existing code - verify they continue to work.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: dynamic sidebar labels from pipeline_display_config, rename Combustível→Leads, Pilotos→Equipe"
```

---

## Task 8: Frontend - Update Campanhas page for status model

**Files:**
- Modify: `src/pages/Campanhas.tsx`
- Modify: `src/hooks/useCampanhas.ts`

- [ ] **Step 1: Add CampaignStatus type to useCampanhas.ts**

Add after the existing types (around line 73):

```typescript
export type CampaignStatus = "draft" | "active" | "paused" | "ended";
export type CampaignTemplateType = "indicacao" | "prospeccao" | "reativacao" | "livre";
```

Add to the `Campanha` interface (after `is_active` on line 95):

```typescript
  status: CampaignStatus;
  template_type: CampaignTemplateType;
  started_at: string | null;
  ended_at: string | null;
  end_action: { type: "move_to_funnel"; pipeline_id: string; stage_id: string } | { type: "freeze" } | null;
```

- [ ] **Step 2: Update Campanhas.tsx to filter by status**

Replace the active/inactive filter logic:

```typescript
// Replace:
const activeCampanhas = campanhas?.filter((c) => c.is_active) || [];
const inactiveCampanhas = campanhas?.filter((c) => !c.is_active) || [];

// With:
const draftCampanhas = campanhas?.filter((c) => c.status === "draft") || [];
const activeCampanhas = campanhas?.filter((c) => c.status === "active") || [];
const pausedCampanhas = campanhas?.filter((c) => c.status === "paused") || [];
const endedCampanhas = campanhas?.filter((c) => c.status === "ended") || [];
```

Update the subtitle text:

```typescript
<p className="text-muted-foreground">
  Gerencie suas campanhas temporárias com metas, prazos e incentivos
</p>
```

Add sections for each status group (draft with gray badges, active with green, paused with yellow, ended with red/muted).

- [ ] **Step 3: Handle ?create=true query param**

Add URL param detection to auto-open create modal when coming from CreateNewModal:

```typescript
const [searchParams] = useSearchParams();
useEffect(() => {
  if (searchParams.get("create") === "true") {
    setCreateOpen(true);
  }
}, [searchParams]);
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Campanhas.tsx src/hooks/useCampanhas.ts
git commit -m "feat: update Campanhas page for status-based filtering (draft/active/paused/ended)"
```

---

## Task 9: Frontend - CampaignEndModal

**Files:**
- Create: `src/components/campanhas/CampaignEndModal.tsx`

- [ ] **Step 1: Create the end campaign modal**

```typescript
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, Snowflake } from "lucide-react";
import { useCustomPipelines } from "@/hooks/useCustomPipelines";
import { usePipelineDisplayConfig } from "@/hooks/usePipelineDisplayConfig";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface CampaignEndModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignName: string;
  leadsCount: number;
}

export function CampaignEndModal({ open, onOpenChange, campaignId, campaignName, leadsCount }: CampaignEndModalProps) {
  const [action, setAction] = useState<"move" | "freeze">("freeze");
  const [targetPipeline, setTargetPipeline] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const { data: customPipes } = useCustomPipelines();
  const { data: displayConfig } = usePipelineDisplayConfig();

  const visiblePipes = (displayConfig ?? []).filter((c) => c.is_visible);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const endAction = action === "freeze"
        ? { type: "freeze" as const }
        : { type: "move_to_funnel" as const, pipeline_id: targetPipeline, stage_id: "" };

      const { error } = await supabase
        .from("campanhas")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          end_action: endAction,
          is_active: false,
        })
        .eq("id", campaignId);

      if (error) throw error;

      toast.success("Campanha encerrada com sucesso");
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao encerrar campanha: " + (err?.message || ""));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Encerrar Campanha
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            A campanha <strong>"{campaignName}"</strong> será encerrada.
            {leadsCount > 0 && (
              <> O que fazer com os <strong>{leadsCount} leads</strong> restantes?</>
            )}
          </p>

          {leadsCount > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setAction("freeze")}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${action === "freeze" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <Snowflake className="w-4 h-4" />
                  <span className="font-medium text-sm">Manter na campanha</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leads ficam congelados. A campanha fica acessível em modo leitura.</p>
              </button>

              <button
                onClick={() => setAction("move")}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${action === "move" ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-medium text-sm">Mover para um funil</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leads são movidos para um funil estrutural da sua operação.</p>
              </button>

              {action === "move" && (
                <Select value={targetPipeline} onValueChange={setTargetPipeline}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {visiblePipes.map((p) => (
                      <SelectItem key={p.pipe_type} value={p.pipe_type}>{p.display_name}</SelectItem>
                    ))}
                    {(customPipes ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || (action === "move" && !targetPipeline)}
          >
            {isSubmitting ? "Encerrando..." : "Encerrar Campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/campanhas/CampaignEndModal.tsx
git commit -m "feat: add CampaignEndModal with move-to-funnel or freeze options"
```

---

## Task 10: Frontend - CampaignTemplateSelector

**Files:**
- Create: `src/components/campanhas/CampaignTemplateSelector.tsx`

- [ ] **Step 1: Create the template selector component**

```typescript
import { motion } from "framer-motion";
import { Handshake, Search, RefreshCw, FileText, Lock } from "lucide-react";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import type { CampaignTemplateType } from "@/hooks/useCampanhas";

interface Template {
  type: CampaignTemplateType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  borderColor: string;
  stagesCount: number;
  featureKey: string;
}

const TEMPLATES: Template[] = [
  {
    type: "indicacao",
    label: "Indicação",
    description: "Ative sua rede de clientes e parceiros para gerar novos leads",
    icon: Handshake,
    color: "text-orange-500",
    borderColor: "border-orange-500/20 hover:border-orange-500/40",
    stagesCount: 4,
    featureKey: "campaigns_indicacao",
  },
  {
    type: "prospeccao",
    label: "Prospecção",
    description: "Importe listas externas e trabalhe prospecção ativa",
    icon: Search,
    color: "text-blue-500",
    borderColor: "border-blue-500/20 hover:border-blue-500/40",
    stagesCount: 5,
    featureKey: "campaigns_prospeccao",
  },
  {
    type: "reativacao",
    label: "Reativação",
    description: "Recupere clientes inativos e oportunidades perdidas",
    icon: RefreshCw,
    color: "text-purple-500",
    borderColor: "border-purple-500/20 hover:border-purple-500/40",
    stagesCount: 4,
    featureKey: "campaigns_reativacao",
  },
  {
    type: "livre",
    label: "Campanha livre",
    description: "Comece do zero com stages personalizados",
    icon: FileText,
    color: "text-muted-foreground",
    borderColor: "border-border hover:border-primary/30",
    stagesCount: 3,
    featureKey: "",
  },
];

interface Props {
  onSelect: (type: CampaignTemplateType) => void;
}

export function CampaignTemplateSelector({ onSelect }: Props) {
  const { hasFeature } = useOrgFeatures();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Escolha um template como ponto de partida. Você poderá editar tudo antes de confirmar.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TEMPLATES.map((t, i) => {
          const Icon = t.icon;
          const locked = t.featureKey && !hasFeature(t.featureKey as any);

          return (
            <motion.button
              key={t.type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => !locked && onSelect(t.type)}
              disabled={locked}
              className={`relative p-4 rounded-lg border text-left transition-colors ${t.borderColor} ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {locked && (
                <div className="absolute top-3 right-3">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <Icon className={`w-6 h-6 ${t.color} mb-2`} />
              <p className="font-semibold text-sm">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
              <p className="text-xs text-muted-foreground mt-2">{t.stagesCount} stages sugeridos</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/** Returns default stages for a campaign template type */
export function getTemplateStages(type: CampaignTemplateType): string[] {
  switch (type) {
    case "indicacao": return ["Indicado", "Contatado", "Qualificado", "Convertido"];
    case "prospeccao": return ["Importado", "Pesquisado", "Abordado", "Respondeu", "Qualificado"];
    case "reativacao": return ["Selecionado", "Abordado", "Reengajado", "Reativado"];
    case "livre": return ["Novo", "Em andamento", "Concluído"];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/campanhas/CampaignTemplateSelector.tsx
git commit -m "feat: add CampaignTemplateSelector with 4 template types and stage defaults"
```

---

## Task 11: Build verification and final commit

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

- [ ] **Step 3: Fix any errors found**

- [ ] **Step 4: Final commit with all fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from funis/campanhas refactoring"
```

---

## Dependencies Between Tasks

```
Task 1 (pipeline_display_config) ──┐
Task 2 (campanhas evolution) ──────┤──→ Task 4 (hook) ──→ Task 7 (sidebar) ──→ Task 11 (build)
Task 3 (feature keys) ────────────┘         │
                                            ├──→ Task 6 (CreateNewModal) ──→ Task 7
                                            ├──→ Task 8 (Campanhas page)
                                            ├──→ Task 9 (CampaignEndModal)
                                            └──→ Task 10 (TemplateSelector)

Task 5 (feature-registry) ──→ Task 10 (TemplateSelector)
```

**Parallelizable:**
- Tasks 1, 2, 3 (all backend migrations, independent)
- Tasks 5, 6, 9, 10 (independent frontend components)
- Task 7 depends on Tasks 4, 6
- Task 8 depends on Task 2 (status fields)
- Task 11 is always last


## Links relacionados

- [[Funis Hub]]
- [[Pipelines Customizados]]

- [[Produtos]]

- [[Visao Geral]]

- [[TV Dashboard]]

- [[Metas]]

- [[Gestao de Time]]

- [[Comissoes]]

- [[Onboarding]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Upsell]]

- [[Campanhas]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
