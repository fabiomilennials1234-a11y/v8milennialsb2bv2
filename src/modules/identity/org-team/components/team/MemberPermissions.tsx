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

const MODULE_LABELS: Record<string, string> = {
  leads: "Leads",
  pipeline: "Funis",
  campaigns: "Campanhas",
  whatsapp: "WhatsApp / Chat",
  copilot: "Copilot / IA",
  workflows: "Automacoes",
  products: "Produtos",
  agenda: "Agenda",
  performance: "Metas e Performance",
  commissions: "Comissoes",
  followups: "Follow-ups",
  settings: "Configuracoes",
  upsell: "Upsell / Carteira",
  marketing: "Marketing",
  team: "Equipe",
};

export function MemberPermissions() {
  const { isAdmin } = useIdentity();
  const { data: members = [], isLoading: loadingMembers } = useTeamMembers();
  const queryClient = useQueryClient();

  const [searchMembers, setSearchMembers] = useState("");
  const [searchFeatures, setSearchFeatures] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

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

  // Build a map of current permissions (DB values + local overrides)
  const permissionMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    // Start with defaults from feature_permissions
    for (const fp of featurePermissions) {
      map[fp.key] = fp.default_value;
    }
    // Apply DB overrides for the selected member
    for (const mp of memberPermissions) {
      map[mp.feature_key] = mp.enabled;
    }
    // Apply local (unsaved) overrides
    for (const [key, val] of Object.entries(localOverrides)) {
      map[key] = val;
    }
    return map;
  }, [featurePermissions, memberPermissions, localOverrides]);

  // Group features by module
  const groupedFeatures = useMemo(() => {
    const groups: Record<string, FeaturePermission[]> = {};
    for (const fp of featurePermissions) {
      if (!groups[fp.module]) groups[fp.module] = [];
      groups[fp.module].push(fp);
    }
    return groups;
  }, [featurePermissions]);

  // Filter features by search
  const filteredModules = useMemo(() => {
    if (!searchFeatures.trim()) return groupedFeatures;
    const q = searchFeatures.toLowerCase();
    const filtered: Record<string, FeaturePermission[]> = {};
    for (const [mod, features] of Object.entries(groupedFeatures)) {
      const matched = features.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q),
      );
      if (matched.length > 0) filtered[mod] = matched;
    }
    return filtered;
  }, [groupedFeatures, searchFeatures]);

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

  const isModuleViewKey = (key: string) => key.endsWith(".view");

  const getModuleViewKey = (module: string) => `${module}.view`;

  const isModuleEnabled = (module: string) => {
    const viewKey = getModuleViewKey(module);
    return permissionMap[viewKey] !== false;
  };

  const handleToggle = (featureKey: string, checked: boolean) => {
    setLocalOverrides((prev) => ({ ...prev, [featureKey]: checked }));
  };

  const handleModuleToggle = (module: string, checked: boolean) => {
    const viewKey = getModuleViewKey(module);
    const updates: Record<string, boolean> = { [viewKey]: checked };
    // If disabling the module, disable all features in this module
    if (!checked && groupedFeatures[module]) {
      for (const fp of groupedFeatures[module]) {
        updates[fp.key] = false;
      }
    }
    setLocalOverrides((prev) => ({ ...prev, ...updates }));
  };

  // Save permissions
  const handleSave = async () => {
    if (selectedList.length === 0) {
      toast.error("Selecione ao menos um membro.");
      return;
    }
    if (Object.keys(localOverrides).length === 0) {
      toast.info("Nenhuma alteracao para salvar.");
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
                Selecione membros e configure quais features cada um pode acessar.
                Desative o modulo inteiro pelo toggle do cabecalho ou controle cada feature individualmente.
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isSaving || selectedList.length === 0}
              className="gap-1"
            >
              <RotateCcw className="w-4 h-4" />
              Resetar para padrao
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
          {/* Left panel: member list */}
          <div className="w-full lg:w-72 shrink-0 space-y-3">
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
            {selectedList.length === 0 ? (
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

                {Object.keys(filteredModules).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Nenhuma feature encontrada.
                  </div>
                ) : (
                  Object.entries(filteredModules).map(([module, features]) => {
                    const moduleEnabled = isModuleEnabled(module);
                    const viewKey = getModuleViewKey(module);
                    const hasViewFeature = features.some((f) => f.key === viewKey);

                    return (
                      <div
                        key={module}
                        className={`border rounded-lg overflow-hidden ${
                          !moduleEnabled ? "opacity-50" : ""
                        }`}
                      >
                        {/* Module header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b">
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-primary" />
                            <span className="font-semibold text-sm">
                              {MODULE_LABELS[module] ?? module}
                            </span>
                          </div>
                          {hasViewFeature && (
                            <Switch
                              checked={moduleEnabled}
                              onCheckedChange={(checked) =>
                                handleModuleToggle(module, checked)
                              }
                            />
                          )}
                        </div>

                        {/* Feature list — separated by view vs action */}
                        <div className="divide-y">
                          {(() => {
                            const nonViewFeatures = features.filter((f) => !isModuleViewKey(f.key));
                            const viewFeatures = nonViewFeatures.filter((f) => f.key.endsWith(".view_all"));
                            const actionFeatures = nonViewFeatures.filter((f) => !f.key.endsWith(".view_all"));

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
                                {viewFeatures.length > 0 && (
                                  <>
                                    <div className="px-4 pt-3 pb-1">
                                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                                        Visualizacao
                                      </p>
                                    </div>
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

                {selectedList.length > 1 && (
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
