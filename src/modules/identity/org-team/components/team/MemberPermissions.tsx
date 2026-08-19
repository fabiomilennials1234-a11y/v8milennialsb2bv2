import { useState, useMemo } from "react";
import { Shield, Search, CheckSquare, Square, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTeamMembers } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildPermissionMap } from "@/modules/identity/permissions/lib/resolvePermissionLayers";
import {
  LEAD_VISIBILITY_KEYS,
  LEAD_VISIBILITY_OPTIONS,
  isLegacyCombination,
  levelFromPermissions,
  permissionsFromLevel,
  type LeadVisibilityLevel,
} from "@/modules/identity/permissions/lib/leadVisibility";
import { toast } from "sonner";

interface FeaturePermission {
  key: string;
  module: string;
  name: string;
  description: string;
  is_admin_only: boolean;
  default_value: boolean;
  sort_order: number;
}

interface MemberFeaturePermission {
  feature_key: string;
  enabled: boolean;
}

/**
 * Um módulo da tela: o slug que prefixa as chaves (`leads`), o rótulo que o
 * catálogo já traz (`Leads`) e as features.
 *
 * O slug precisa sair das CHAVES, não da coluna `module`. As duas nunca
 * coincidiram — o catálogo guarda rótulo de exibição, acentuado e com espaço
 * ("Automações", "Follow-ups"), enquanto as chaves usam slug ("workflows.view",
 * "followups.view"). O código anterior montava `${module}.view` e procurava
 * "Automações.view", que não existe em módulo nenhum: o switch de cabeçalho
 * nunca renderizou e o `handleModuleToggle` gravava chave fantasma.
 */
interface ModuleGroup {
  slug: string;
  label: string;
  features: FeaturePermission[];
}

/**
 * O rótulo vem do catálogo, que é a fonte única. Havia um MODULE_LABELS
 * paralelo aqui, indexado por slug e nunca acertado — além de morto, estava
 * desatualizado ("Automacoes" sem acento contra "Automações" do banco).
 */
function toModuleGroups(features: FeaturePermission[]): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>();

  for (const feature of features) {
    const slug = feature.key.split(".")[0];
    if (!slug) continue;

    const existing = groups.get(slug);
    if (existing) {
      existing.features.push(feature);
    } else {
      groups.set(slug, { slug, label: feature.module || slug, features: [feature] });
    }
  }

  return Array.from(groups.values());
}

/** O grupo de visibilidade de leads vira um controle só. Ver `leadVisibility.ts`. */
const LEAD_VISIBILITY_KEY_SET = new Set<string>(LEAD_VISIBILITY_KEYS);

/**
 * Escala de alcance, não três interruptores.
 *
 * Um `Switch` por chave sugeria que as três se combinavam livremente. Elas não
 * se combinam: o RLS reduz as 8 combinações a 3 resultados, e 5 delas eram
 * armadilha — desligar `leads.view_all` sozinho não tirava um único lead da
 * frente de ninguém. Segmentado porque a grandeza é ordinal: cada passo à
 * direita mostra estritamente mais do que o anterior.
 */
function LeadVisibilityField({
  level,
  isLegacy,
  disabled,
  onChange,
}: {
  level: LeadVisibilityLevel;
  isLegacy: boolean;
  disabled: boolean;
  onChange: (level: LeadVisibilityLevel) => void;
}) {
  const active = LEAD_VISIBILITY_OPTIONS.find((o) => o.level === level);

  return (
    <div className={`px-4 py-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">Visualizacao de leads</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {active?.description}
          </p>
        </div>

        <div
          className="inline-flex rounded-md border border-border p-0.5 shrink-0"
          role="radiogroup"
          aria-label="Visualizacao de leads"
        >
          {LEAD_VISIBILITY_OPTIONS.map((option) => {
            const isActive = option.level === level;
            return (
              <button
                key={option.level}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={disabled}
                onClick={() => onChange(option.level)}
                className={
                  "px-3 py-1 text-xs rounded-sm transition-colors whitespace-nowrap disabled:cursor-not-allowed " +
                  (isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* O admin precisa saber que salvar normaliza as tres chaves. Mudanca de
          permissao que acontece de lado, sem ninguem pedir, e a que ninguem
          audita depois. */}
      {isLegacy && !disabled && (
        <p className="text-xs text-amber-500/90 mt-2">
          A configuracao atual mistura as tres chaves antigas
          (`leads.view_all`, `leads.view_unassigned`, `leads.view_subordinates`)
          num estado que o banco ja resolve como &ldquo;{active?.label}&rdquo;.
          Salvar grava as tres de forma coerente, sem mudar quem enxerga o que.
        </p>
      )}
    </div>
  );
}

/**
 * `organization_feature_defaults` ainda não está em `src/integrations/supabase/types.ts`:
 * aquele arquivo é gerado a partir de PRODUÇÃO. A premissa original deste
 * comentário era que a migration `20270818170000` não tinha sido aplicada em
 * prod — ela FOI (verificado 2026-08-19 no ledger
 * `supabase_migrations.schema_migrations` e na própria tabela, que já tem linha
 * da org Bolívar). Falta só regerar o arquivo de tipos; os casts somem no
 * mesmo comando:
 *
 *   supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
 *
 * A regen não entra nesta branch de propósito: são 270KB de diff gerado, que
 * afogaria a revisão de uma mudança de permissão — área frágil.
 */
export function MemberPermissions() {
  const { isAdmin, organizationId } = useIdentity();
  const { data: members = [], isLoading: loadingMembers } = useTeamMembers();
  const queryClient = useQueryClient();

  const [searchMembers, setSearchMembers] = useState("");
  const [searchFeatures, setSearchFeatures] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  /**
   * `"org"` edita a POLÍTICA da organização (organization_feature_defaults);
   * `"member"` edita a exceção de uma pessoa (member_feature_permissions).
   *
   * A política da org é o que faz contratado novo nascer com a configuração
   * certa — sem ela o admin desligava membro a membro e a próxima contratação
   * desfazia tudo em silêncio.
   */
  const [scope, setScope] = useState<"org" | "member">("org");

  // Fetch all feature_permissions from Supabase
  const { data: featurePermissions = [], isLoading: loadingFeatures } = useQuery({
    queryKey: ["feature_permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_permissions")
        .select("*")
        .order("module")
        .order("sort_order");

      if (error) throw error;
      return (data ?? []) as FeaturePermission[];
    },
    enabled: isAdmin,
  });

  // Fetch member_feature_permissions for selected member(s)
  const selectedList = useMemo(
    () => (selectedIds.size > 0 ? Array.from(selectedIds) : []),
    [selectedIds],
  );
  const firstSelectedId = selectedList[0] ?? null;

  const { data: memberPermissions = [], isLoading: loadingPerms } = useQuery({
    queryKey: ["member_feature_permissions", firstSelectedId],
    queryFn: async () => {
      if (!firstSelectedId) return [];
      const { data, error } = await supabase
        .from("member_feature_permissions")
        .select("feature_key, enabled")
        .eq("team_member_id", firstSelectedId);

      if (error) throw error;
      return (data ?? []) as MemberFeaturePermission[];
    },
    enabled: !!firstSelectedId,
  });

  const { data: orgDefaultRows = [] } = useQuery({
    queryKey: ["organization_feature_defaults", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from("organization_feature_defaults")
        .select("feature_key, enabled")
        .eq("organization_id", organizationId);

      if (error) throw error;
      return (data ?? []) as MemberFeaturePermission[];
    },
    enabled: !!organizationId && isAdmin,
  });

  const orgDefaults = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of orgDefaultRows) m[r.feature_key] = r.enabled;
    return m;
  }, [orgDefaultRows]);

  // Build a map of current permissions (DB values + local overrides)
  const permissionMap = useMemo(() => {
    // A cascata vive em resolvePermissionLayers, que espelha
    // has_feature_permission() no banco. Se as duas discordarem, a tela mente.
    const memberOverrides: Record<string, boolean> = {};
    for (const mp of memberPermissions) memberOverrides[mp.feature_key] = mp.enabled;

    return buildPermissionMap(
      { catalog: featurePermissions, orgDefaults, memberOverrides, localOverrides },
      { scope },
    );
  }, [featurePermissions, orgDefaults, memberPermissions, localOverrides, scope]);

  // Group features by module
  const moduleGroups = useMemo(
    () => toModuleGroups(featurePermissions),
    [featurePermissions],
  );

  // Filter features by search
  const filteredGroups = useMemo(() => {
    if (!searchFeatures.trim()) return moduleGroups;
    const q = searchFeatures.toLowerCase();

    return moduleGroups
      .map((group) => ({
        ...group,
        features: group.features.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            (f.description ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.features.length > 0);
  }, [moduleGroups, searchFeatures]);

  // Filter members by search
  const filteredMembers = useMemo(() => {
    if (!searchMembers.trim()) return members;
    const q = searchMembers.toLowerCase();
    return members.filter((m) => m.name?.toLowerCase().includes(q));
  }, [members, searchMembers]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Reset local overrides when selection changes
    setLocalOverrides({});
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredMembers.map((m) => m.id)));
    else setSelectedIds(new Set());
    setLocalOverrides({});
  };

  const isSelected = (id: string) => selectedIds.has(id);

  /** Chave-porta do módulo: `leads.view`, `whatsapp.view`, ... */
  const getModuleViewKey = (slug: string) => `${slug}.view`;

  const isModuleEnabled = (slug: string) =>
    permissionMap[getModuleViewKey(slug)] !== false;

  const handleToggle = (featureKey: string, checked: boolean) => {
    setLocalOverrides((prev) => ({ ...prev, [featureKey]: checked }));
  };

  const handleModuleToggle = (group: ModuleGroup, checked: boolean) => {
    const updates: Record<string, boolean> = {
      [getModuleViewKey(group.slug)]: checked,
    };
    // Desligar o módulo desliga tudo dentro dele: deixar uma ação ligada sob um
    // módulo fechado é permissão que ninguém vê na tela e o banco continua
    // honrando se a porta reabrir.
    if (!checked) {
      for (const fp of group.features) {
        updates[fp.key] = false;
      }
    }
    setLocalOverrides((prev) => ({ ...prev, ...updates }));
  };

  /**
   * Um clique no controle de visibilidade escreve as TRÊS chaves. Gravar só a
   * que mudou é o que produziu o estado da Bolívar — `view_all` desligado com
   * `view_subordinates` ainda ligado, que o RLS lê como "vê tudo".
   */
  const handleLeadVisibilityChange = (level: LeadVisibilityLevel) => {
    setLocalOverrides((prev) => ({ ...prev, ...permissionsFromLevel(level) }));
  };

  const leadVisibilityLevel = levelFromPermissions(permissionMap);
  const leadVisibilityIsLegacy = isLegacyCombination(permissionMap);

  // Save permissions
  const handleSave = async () => {
    if (Object.keys(localOverrides).length === 0) {
      toast.info("Nenhuma alteracao para salvar.");
      return;
    }

    if (scope === "org") {
      if (!organizationId) {
        toast.error("Organizacao nao resolvida.");
        return;
      }
      setIsSaving(true);
      try {
        // Grava a linha explícita mesmo quando o valor coincide com o catálogo
        // global: a intenção do admin é explícita, e apagar a linha faria a
        // política voltar a seguir o produto sem ninguém pedir. Quem quer
        // voltar ao padrão usa "Restaurar padrao".
        const rows = Object.entries(localOverrides).map(([feature_key, enabled]) => ({
          organization_id: organizationId,
          feature_key,
          enabled,
        }));

        const { error } = await (supabase as any)
          .from("organization_feature_defaults")
          .upsert(rows, { onConflict: "organization_id,feature_key" });

        if (error) throw error;

        toast.success("Politica da organizacao salva!");
        setLocalOverrides({});
        queryClient.invalidateQueries({ queryKey: ["organization_feature_defaults"] });
      } catch (err: any) {
        toast.error(err?.message || "Erro ao salvar a politica da organizacao.");
        console.error("[MemberPermissions] org save error:", err);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (selectedList.length === 0) {
      toast.error("Selecione ao menos um membro.");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sessao expirada. Faca login novamente.");
        setIsSaving(false);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const permissionsMap: Record<string, boolean> = { ...localOverrides };

      // Call edge function once per selected member
      for (const memberId of selectedList) {
        const res = await fetch(
          `${supabaseUrl.replace(/\/$/, "")}/functions/v1/save-member-permissions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${anonKey}`,
              "X-User-JWT": session.access_token,
            },
            body: JSON.stringify({
              teamMemberId: memberId,
              permissions: permissionsMap,
            }),
          },
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any)?.message ?? (data as any)?.error ?? "Erro ao salvar permissoes");
        }
      }

      toast.success("Permissoes salvas com sucesso!");
      setLocalOverrides({});
      queryClient.invalidateQueries({ queryKey: ["member_feature_permissions"] });
      queryClient.invalidateQueries({ queryKey: ["feature-permissions"] });
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar permissoes.");
      console.error("[MemberPermissions] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset to defaults
  const handleReset = async () => {
    if (scope === "org") {
      if (!organizationId) {
        toast.error("Organizacao nao resolvida.");
        return;
      }
      setIsSaving(true);
      try {
        const { error } = await (supabase as any)
          .from("organization_feature_defaults")
          .delete()
          .eq("organization_id", organizationId);

        if (error) throw error;

        toast.success("Politica da organizacao restaurada ao padrao do produto.");
        setLocalOverrides({});
        queryClient.invalidateQueries({ queryKey: ["organization_feature_defaults"] });
      } catch (err: any) {
        toast.error(err?.message || "Erro ao restaurar a politica.");
        console.error("[MemberPermissions] org reset error:", err);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (selectedList.length === 0) {
      toast.error("Selecione ao menos um membro.");
      return;
    }

    setIsSaving(true);
    try {
      for (const memberId of selectedList) {
        const { error } = await supabase
          .from("member_feature_permissions")
          .delete()
          .eq("team_member_id", memberId);

        if (error) throw error;
      }

      toast.success("Permissoes resetadas para o padrao!");
      setLocalOverrides({});
      queryClient.invalidateQueries({ queryKey: ["member_feature_permissions"] });
      queryClient.invalidateQueries({ queryKey: ["feature-permissions"] });
    } catch (err: any) {
      toast.error(err?.message || "Erro ao resetar permissoes.");
      console.error("[MemberPermissions] reset error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = Object.keys(localOverrides).length > 0;

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Permissoes por Feature</CardTitle>
              <CardDescription>
                {scope === "org"
                  ? "Politica da organizacao: vale para todo membro, inclusive quem for contratado depois. Excecoes individuais ficam na aba Por membro."
                  : "Excecao individual: sobrepoe a politica da organizacao apenas para os membros selecionados."}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {/* Duas coisas diferentes, nunca no mesmo toggle: a POLITICA da org
                e a EXCECAO de uma pessoa. Misturar as duas foi o que fez a
                permissao vazar na contratacao seguinte. */}
            <div className="inline-flex rounded-md border border-border p-0.5 mr-2">
              {(["org", "member"] as const).map((s0) => (
                <button
                  key={s0}
                  type="button"
                  onClick={() => {
                    setScope(s0);
                    setLocalOverrides({});
                  }}
                  className={
                    "px-3 py-1 text-xs rounded-sm transition-colors " +
                    (scope === s0
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {s0 === "org" ? "Organizacao" : "Por membro"}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isSaving || (scope === "member" && selectedList.length === 0)}
              className="gap-1"
            >
              <RotateCcw className="w-4 h-4" />
              {scope === "org" ? "Restaurar padrao" : "Resetar para padrao"}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? "Salvando..." : "Salvar permissoes"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Left panel: member list — só no escopo por membro. Editando a
              política da organização não há quem selecionar. */}
          <div className={`w-full lg:w-72 shrink-0 space-y-3 ${scope === "org" ? "hidden" : ""}`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar membro..."
                value={searchMembers}
                onChange={(e) => setSearchMembers(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="border rounded-lg max-h-[400px] overflow-y-auto">
              {/* Select all */}
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted text-sm border-b"
                onClick={() =>
                  toggleSelectAll(selectedIds.size !== filteredMembers.length)
                }
              >
                {filteredMembers.length > 0 &&
                selectedIds.size === filteredMembers.length ? (
                  <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-muted-foreground">Selecionar todos</span>
              </button>

              {loadingMembers ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Carregando...
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted text-sm ${
                      isSelected(member.id) ? "bg-primary/5" : ""
                    }`}
                    onClick={() => toggleSelect(member.id)}
                  >
                    {isSelected(member.id) ? (
                      <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium truncate">{member.name}</span>
                    <span className="text-muted-foreground text-xs ml-auto">
                      {member.role === "admin" ? "Admin" : "Membro"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right panel: permissions matrix by module */}
          <div className="flex-1 min-w-0 space-y-4">
            {scope === "member" && selectedList.length === 0 ? (
              <div className="flex items-center justify-center h-48 rounded-lg border border-dashed text-muted-foreground text-sm">
                Selecione um ou mais membros para editar as permissoes.
              </div>
            ) : loadingPerms || loadingFeatures ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                Carregando permissoes...
              </div>
            ) : (
              <>
                {/* Search features */}
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Filtrar features..."
                    value={searchFeatures}
                    onChange={(e) => setSearchFeatures(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Nenhuma feature encontrada.
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const { slug, label, features } = group;
                    const moduleEnabled = isModuleEnabled(slug);
                    const viewKey = getModuleViewKey(slug);
                    const hasViewFeature = features.some((f) => f.key === viewKey);
                    const showLeadVisibility =
                      slug === "leads" &&
                      features.some((f) => LEAD_VISIBILITY_KEY_SET.has(f.key));

                    return (
                      <div
                        key={slug}
                        className={`border rounded-lg overflow-hidden ${
                          !moduleEnabled ? "opacity-50" : ""
                        }`}
                      >
                        {/* Module header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b">
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-primary" />
                            <span className="font-semibold text-sm">{label}</span>
                          </div>
                          {hasViewFeature && (
                            <Switch
                              checked={moduleEnabled}
                              onCheckedChange={(checked) =>
                                handleModuleToggle(group, checked)
                              }
                            />
                          )}
                        </div>

                        {/* Feature list — separated by view vs action */}
                        <div className="divide-y">
                          {(() => {
                            // A porta do módulo já é o switch do cabeçalho, e as
                            // três chaves de visibilidade de leads viraram um
                            // controle só — nenhuma das duas volta como linha.
                            const nonViewFeatures = features.filter(
                              (f) =>
                                f.key !== viewKey &&
                                !(showLeadVisibility && LEAD_VISIBILITY_KEY_SET.has(f.key)),
                            );
                            // Visualização = quem governa O QUE se enxerga
                            // (`*.view_all`, `leads.view_general_info`);
                            // Ações = quem governa o que se FAZ. O corte antigo
                            // era `endsWith('.view_all')`, que jogava
                            // `view_general_info` no balde das ações.
                            const viewFeatures = nonViewFeatures.filter((f) =>
                              f.key.startsWith(`${slug}.view`),
                            );
                            const actionFeatures = nonViewFeatures.filter(
                              (f) => !f.key.startsWith(`${slug}.view`),
                            );

                            const renderFeature = (feature: FeaturePermission) => {
                              const enabled = permissionMap[feature.key] ?? feature.default_value;
                              const disabled = feature.is_admin_only || !moduleEnabled;

                              return (
                                <div
                                  key={feature.key}
                                  className={`flex items-center justify-between px-4 py-2.5 ${
                                    disabled ? "opacity-50" : ""
                                  }`}
                                >
                                  <div className="flex-1 min-w-0 mr-3">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">
                                        {feature.name}
                                      </span>
                                      {feature.is_admin_only && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs bg-purple-500/10 text-purple-500 border-purple-500/20"
                                        >
                                          Apenas Admin
                                        </Badge>
                                      )}
                                    </div>
                                    {feature.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {feature.description}
                                      </p>
                                    )}
                                  </div>
                                  <Switch
                                    checked={enabled}
                                    disabled={disabled}
                                    onCheckedChange={(checked) =>
                                      handleToggle(feature.key, checked)
                                    }
                                  />
                                </div>
                              );
                            };

                            return (
                              <>
                                {(showLeadVisibility || viewFeatures.length > 0) && (
                                  <>
                                    <div className="px-4 pt-3 pb-1">
                                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                                        Visualizacao
                                      </p>
                                    </div>
                                    {showLeadVisibility && (
                                      <LeadVisibilityField
                                        level={leadVisibilityLevel}
                                        isLegacy={leadVisibilityIsLegacy}
                                        disabled={!moduleEnabled}
                                        onChange={handleLeadVisibilityChange}
                                      />
                                    )}
                                    {viewFeatures.map(renderFeature)}
                                    <div className="px-4">
                                      <Separator className="my-0" />
                                    </div>
                                  </>
                                )}
                                {actionFeatures.length > 0 && (
                                  <div className="px-4 pt-3 pb-1">
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                                      Acoes
                                    </p>
                                  </div>
                                )}
                                {actionFeatures.map(renderFeature)}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* No escopo "Organizacao" a selecao de membros nem aparece —
                    anunciar "aplicado a N membros" ali seria mentira sobre onde
                    a gravacao vai cair. */}
                {scope === "member" && selectedList.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Alteracoes serao aplicadas a todos os {selectedList.length}{" "}
                    membros selecionados.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
