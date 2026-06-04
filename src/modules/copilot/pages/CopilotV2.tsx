/**
 * CopilotV2 — Slice 12b wizard ROUTE (Copilot v2 cutover).
 *
 * The Slice 8 CopilotV2Wizard shipped as an unrouted component; this page wires
 * it to a real route and supplies the two pieces it needs to be operable:
 *   • a get-or-create agent flow (one v2 agent per archetype per org), and
 *   • the "Pré-preencher do v1" seed (admin-gated edge fn → tested pure transform).
 *
 * Two routes render this one component:
 *   /copilot/v2             → landing: one card per archetype (status + open).
 *   /copilot/v2/:archetype  → editor: get-or-create the agent, host the wizard.
 *
 * Gating is UX-only (admin via useCanManageCopilot, rollout via the copilot_v2
 * feature flag); the create/save/activate RPCs are the authoritative server-side
 * admin gate. The flag keeps the surface dark for orgs not yet in the cutover.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Lock, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { toast } from "sonner";
import { useFeatureFlag } from "@/modules/platform";
import { useCanManageCopilot } from "@/modules/identity";
import { CopilotV2Wizard } from "../components/v2-wizard/CopilotV2Wizard";
import { useCopilotV2Config } from "../hooks/useCopilotV2Config";
import {
  useCopilotV2Agents,
  useCreateCopilotV2Agent,
  usePrefillCandidates,
  usePrefillFromV1,
  type CopilotV2AgentRow,
  type PrefillCandidate,
} from "../hooks/useCopilotV2Agents";
import type { Archetype, CopilotV2Config } from "../lib/copilot-v2-config";

const ARCHETYPES: { key: Archetype; title: string; blurb: string }[] = [
  { key: "qualificador", title: "Qualificador", blurb: "Qualifica e pontua leads na entrada (rubrica + tiers)." },
  { key: "vendedor", title: "Vendedor", blurb: "Conduz a conversa comercial até o objetivo (fechar/reunião)." },
  { key: "carteira", title: "Carteira", blurb: "Pós-venda: recompra, upsell e relacionamento (com handoff)." },
];

const isArchetype = (v: string | undefined): v is Archetype =>
  v === "qualificador" || v === "vendedor" || v === "carteira";

export default function CopilotV2() {
  const { archetype } = useParams();
  const navigate = useNavigate();
  const { enabled: flagEnabled, isLoading: flagLoading } = useFeatureFlag("copilot_v2");
  const { canManage, isLoading: canManageLoading } = useCanManageCopilot();

  // Gate on BOTH so the lock screen never flashes before permissions resolve.
  if (flagLoading || canManageLoading) return <TorqueLoader variant="full" />;

  if (!flagEnabled || !canManage) {
    return (
      <div className="p-6">
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Copilot v2 em rollout controlado</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {flagEnabled
                ? "Apenas administradores podem configurar agentes v2."
                : "Este motor está sendo habilitado por organização. Fale com o time se precisa de acesso antecipado."}
            </p>
            <Button variant="outline" onClick={() => navigate("/copilot")}>
              Voltar para Copilot
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (archetype && !isArchetype(archetype)) {
    navigate("/copilot/v2", { replace: true });
    return null;
  }

  return isArchetype(archetype) ? (
    <ArchetypeEditor archetype={archetype} />
  ) : (
    <ArchetypeLanding />
  );
}

// ── Landing: one card per archetype ──────────────────────────────────────────
function ArchetypeLanding() {
  const navigate = useNavigate();
  const { data: agents = [], isLoading } = useCopilotV2Agents();

  const byArchetype = useMemo(() => {
    const map = new Map<Archetype, CopilotV2AgentRow>();
    for (const a of agents) map.set(a.archetype, a);
    return map;
  }, [agents]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Copilot v2 — Agentes</h1>
          <p className="text-sm text-muted-foreground">
            Configure um agente por arquétipo. O server valida tudo antes de ativar.
          </p>
        </div>
      </div>

      {isLoading ? (
        <TorqueLoader variant="inline" />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {ARCHETYPES.map((a) => {
            const agent = byArchetype.get(a.key);
            return (
              <Card
                key={a.key}
                className="flex h-full cursor-pointer flex-col border-border/60 transition-colors hover:border-primary/50"
                onClick={() => navigate(`/copilot/v2/${a.key}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{a.title}</CardTitle>
                    </div>
                    {agent ? (
                      agent.is_active ? (
                        <Badge className="bg-success text-success-foreground">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Rascunho</Badge>
                      )
                    ) : (
                      <Badge variant="outline">Não criado</Badge>
                    )}
                  </div>
                  <CardDescription>{a.blurb}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Button variant={agent ? "outline" : "default"} className="w-full">
                    {agent ? "Configurar" : "Criar e configurar"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Editor: get-or-create the agent, host the wizard ─────────────────────────
function ArchetypeEditor({ archetype }: { archetype: Archetype }) {
  const navigate = useNavigate();
  const createAgent = useCreateCopilotV2Agent();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [createError, setCreateError] = useState(false);

  // Seed override from the v1 prefill (create-time only).
  const [seed, setSeed] = useState<CopilotV2Config | null>(null);
  const [seedVersion, setSeedVersion] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { mutateAsync: doCreate } = createAgent;

  // Get-or-create the (org, archetype) agent once on mount.
  useEffect(() => {
    let cancelled = false;
    doCreate(archetype)
      .then((row) => {
        if (!cancelled) setAgentId(row.id);
      })
      .catch(() => {
        if (!cancelled) setCreateError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [archetype, doCreate]);

  const { data: loaded, isLoading: configLoading, isError: configError, refetch: refetchConfig } =
    useCopilotV2Config(agentId ?? undefined);

  const isConfigured = useMemo(() => {
    const c = loaded?.config;
    return !!(c?.company?.name || c?.icp || (c?.products && c.products.length > 0));
  }, [loaded]);

  const onSeed = (config: CopilotV2Config) => {
    setSeed(config);
    setSeedVersion((v) => v + 1);
    setPickerOpen(false);
    toast.success("Rascunho pré-preenchido do v1 — revise os campos faltantes.");
  };

  const header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/copilot/v2")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold capitalize">Copilot v2 — {archetype}</h1>
          <p className="text-xs text-muted-foreground">
            {isConfigured ? "Editando configuração" : "Nova configuração"}
          </p>
        </div>
      </div>
      {!isConfigured && (
        <Button variant="outline" onClick={() => setPickerOpen(true)} className="border-primary/40 text-primary hover:bg-primary/10">
          <Wand2 className="mr-2 h-4 w-4" />
          Pré-preencher do v1
        </Button>
      )}
    </div>
  );

  if (createError) {
    return (
      <div className="space-y-6 p-6">
        {header}
        <Card className="border-destructive/40">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Não foi possível abrir o agente {archetype}. Verifique se você é administrador desta organização.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (agentId && configError) {
    return (
      <div className="space-y-6 p-6">
        {header}
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            Não foi possível carregar a configuração deste agente.
            <Button variant="outline" size="sm" onClick={() => refetchConfig()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!agentId || configLoading || !loaded) {
    return (
      <div className="space-y-6 p-6">
        {header}
        <TorqueLoader variant="inline" />
      </div>
    );
  }

  const initialConfig = seed ?? loaded.config;
  // Prefill is a create-time action → walk the stepper so gaps are explicit.
  const mode: "create" | "edit" = seed ? "create" : isConfigured ? "edit" : "create";

  return (
    <div className="space-y-6 p-6">
      {header}
      <CopilotV2Wizard
        key={`${agentId}:${seedVersion}`}
        agentId={agentId}
        archetype={archetype}
        mode={mode}
        initialConfig={initialConfig}
        initialRubric={loaded.rubricRules}
        onSaved={(activated) => {
          if (activated) navigate("/copilot/v2");
        }}
      />

      <V1PrefillPicker
        open={pickerOpen}
        archetype={archetype}
        onOpenChange={setPickerOpen}
        onSeed={onSeed}
      />
    </div>
  );
}

// ── Dialog: pick a v1 agent to seed from ─────────────────────────────────────
function V1PrefillPicker({
  open,
  archetype,
  onOpenChange,
  onSeed,
}: {
  open: boolean;
  archetype: Archetype;
  onOpenChange: (v: boolean) => void;
  onSeed: (config: CopilotV2Config) => void;
}) {
  const candidates = usePrefillCandidates();
  const seedFrom = usePrefillFromV1();
  const [list, setList] = useState<PrefillCandidate[] | null>(null);

  const { mutateAsync: loadCandidates } = candidates;
  useEffect(() => {
    if (!open) {
      setList(null);
      return;
    }
    loadCandidates()
      .then((res) => setList(res.candidates))
      .catch(() => {
        toast.error("Não foi possível listar agentes v1.");
        setList([]);
      });
  }, [open, loadCandidates]);

  const pick = async (c: PrefillCandidate) => {
    try {
      const res = await seedFrom.mutateAsync({ sourceAgentId: c.id, archetype });
      onSeed(res.prefill.config);
    } catch {
      toast.error("Falha ao pré-preencher a partir desse agente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pré-preencher do v1</DialogTitle>
          <DialogDescription>
            Escolha um agente v1 desta organização. Vamos mapear o que dá com segurança e
            marcar o restante como pendente — nada é adivinhado.
          </DialogDescription>
        </DialogHeader>
        {list === null ? (
          <TorqueLoader variant="inline" />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum agente v1 para importar nesta organização. Configure do zero.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                className="justify-between"
                disabled={seedFrom.isPending}
                onClick={() => pick(c)}
              >
                <span className="truncate">{c.name ?? "Agente sem nome"}</span>
                {c.templateType && (
                  <Badge variant="secondary" className="ml-2 capitalize">
                    {c.templateType}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
