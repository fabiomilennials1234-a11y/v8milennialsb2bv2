import { useState, useMemo } from "react";
import { Shield, Search, CheckSquare, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useOrganization } from "@/hooks/useOrganization";
import { useIsAdmin } from "@/hooks/useUserRole";
import {
  useTeamMemberPermissions,
  useSaveTeamMemberPermissions,
  getViewScopes,
  getExportScopes,
  getValue,
  RESOURCE_KEYS,
  ACTION_KEYS,
  RESOURCE_LABELS,
  ACTION_DESCRIPTIONS,
  VIEW_OPTIONS,
  EXPORT_OPTIONS,
  type ResourceKey,
  type ActionKey,
  type PermissionValue,
} from "@/hooks/useTeamMemberPermissions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

const ROLE_GROUP_LABEL: Record<string, string> = {
  sdr: "SDR",
  closer: "Closer",
  admin: "Administrador",
  member: "Membro",
};

export function PermissoesEquipe() {
  const { isAdmin } = useIsAdmin();
  const { organizationId } = useOrganization();
  const { data: members = [], isLoading: loadingMembers } = useTeamMembers();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        ROLE_GROUP_LABEL[m.role]?.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  const selectedList = useMemo(() => selectedIds.size > 0 ? Array.from(selectedIds) : [], [selectedIds]);
  const { data: permissionsList = [], isLoading: loadingPerms } = useTeamMemberPermissions(selectedList);
  const savePermissions = useSaveTeamMemberPermissions();

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredMembers.map((m) => m.id)));
    else setSelectedIds(new Set());
  };

  const isSelected = (id: string) => selectedIds.has(id);

  const setPermission = (
    resource: ResourceKey,
    action: ActionKey,
    values: PermissionValue[]
  ) => {
    if (selectedList.length === 0) return;
    savePermissions.mutate(
      {
        teamMemberIds: selectedList,
        permissions: [
          { resource_key: resource, action_key: action, values },
        ],
      },
      {
        onSuccess: () => toast.success("Permissão atualizada"),
        onError: () => toast.error("Erro ao salvar"),
      }
    );
  };

  const firstSelectedId = selectedList[0];
  const toggleViewScope = (
    resource: ResourceKey,
    scopeValue: PermissionValue,
    checked: boolean
  ) => {
    if (!firstSelectedId) return;
    const current = getViewScopes(permissionsList, firstSelectedId, resource);
    const next = checked
      ? [...current.filter((v) => v !== scopeValue), scopeValue]
      : current.filter((v) => v !== scopeValue);
    setPermission(resource, "view", next.length ? next : ["denied"]);
  };

  const toggleExportScope = (
    resource: ResourceKey,
    scopeValue: PermissionValue,
    checked: boolean
  ) => {
    if (!firstSelectedId) return;
    const current = getExportScopes(permissionsList, firstSelectedId, resource);
    const next = checked
      ? [...current.filter((v) => v !== scopeValue), scopeValue]
      : current.filter((v) => v !== scopeValue);
    setPermission(resource, "export", next.length ? next : ["denied"]);
  };

  const isView = (action: ActionKey) => action === "view";
  const isExport = (action: ActionKey) => action === "export";
  const isSwitchAction = (action: ActionKey) => action === "create" || action === "edit" || action === "delete";

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Permissões de personalização</CardTitle>
              <CardDescription>
                Selecione um ou mais usuários e defina o que cada um pode fazer em cada recurso. Em <strong>Ver</strong> e <strong>Exportar</strong> você pode marcar vários escopos: se responsável, equipe, todos e sem responsável. Passe o mouse no nome da coluna para ver a descrição.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Lista de usuários */}
          <div className="w-full lg:w-80 shrink-0 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Busca e filtro"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Grupo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <button
                        type="button"
                        className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted"
                        onClick={() => toggleSelectAll(selectedIds.size !== filteredMembers.length)}
                      >
                        {filteredMembers.length > 0 && selectedIds.size === filteredMembers.length ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell colSpan={2} className="text-xs text-muted-foreground">
                      Selecionar todos
                    </TableCell>
                  </TableRow>
                  {loadingMembers ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-4 text-muted-foreground text-sm">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMembers.map((member) => (
                      <TableRow
                        key={member.id}
                        className={isSelected(member.id) ? "bg-primary/5" : ""}
                      >
                        <TableCell>
                          <button
                            type="button"
                            className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted"
                            onClick={() => toggleSelect(member.id)}
                          >
                            {isSelected(member.id) ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {ROLE_GROUP_LABEL[member.role] ?? member.role}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Matriz de permissões */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            {selectedList.length === 0 ? (
              <div className="flex items-center justify-center h-48 rounded-lg border border-dashed text-muted-foreground text-sm">
                Selecione um ou mais usuários para editar as permissões.
              </div>
            ) : loadingPerms ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                Carregando permissões...
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <TooltipProvider>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">Recurso / Funil</TableHead>
                        <TableHead className="text-center min-w-[140px]">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted">
                              Criar
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {ACTION_DESCRIPTIONS.create}
                            </TooltipContent>
                          </Tooltip>
                          <p className="text-xs font-normal text-muted-foreground mt-0.5">Permitido / Negado</p>
                        </TableHead>
                        <TableHead className="min-w-[180px]">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted">
                              Ver
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px]">
                              {ACTION_DESCRIPTIONS.view}
                            </TooltipContent>
                          </Tooltip>
                          <p className="text-xs font-normal text-muted-foreground mt-0.5">Escopo: se responsável, equipe, todos e sem responsável</p>
                        </TableHead>
                        <TableHead className="text-center min-w-[120px]">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted">
                              Editar
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {ACTION_DESCRIPTIONS.edit}
                            </TooltipContent>
                          </Tooltip>
                          <p className="text-xs font-normal text-muted-foreground mt-0.5">Permitido / Negado</p>
                        </TableHead>
                        <TableHead className="text-center min-w-[120px]">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted">
                              Excluir
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {ACTION_DESCRIPTIONS.delete}
                            </TooltipContent>
                          </Tooltip>
                          <p className="text-xs font-normal text-muted-foreground mt-0.5">Permitido / Negado</p>
                        </TableHead>
                        <TableHead className="min-w-[160px]">
                          <Tooltip>
                            <TooltipTrigger className="cursor-help underline decoration-dotted">
                              Exportar
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {ACTION_DESCRIPTIONS.export}
                            </TooltipContent>
                          </Tooltip>
                          <p className="text-xs font-normal text-muted-foreground mt-0.5">Se responsável, equipe ou permitido</p>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {RESOURCE_KEYS.map((resource) => (
                        <TableRow key={resource}>
                          <TableCell className="font-medium">
                            {RESOURCE_LABELS[resource]}
                          </TableCell>
                          {ACTION_KEYS.map((action) => {
                            if (isView(action)) {
                              const scopes = firstSelectedId
                                ? getViewScopes(permissionsList, firstSelectedId, resource)
                                : [];
                              const viewScopeOptions = VIEW_OPTIONS.filter(
                                (o) => o.value !== "denied"
                              );
                              return (
                                <TableCell key={action}>
                                  <div className="flex flex-col gap-1.5">
                                    {viewScopeOptions.map((opt) => (
                                      <label
                                        key={opt.value}
                                        className="flex items-center gap-2 text-sm cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={scopes.includes(opt.value)}
                                          onChange={(e) =>
                                            toggleViewScope(
                                              resource,
                                              opt.value,
                                              e.target.checked
                                            )
                                          }
                                          className="rounded border-input"
                                        />
                                        <span title={opt.description}>
                                          {opt.label}
                                        </span>
                                      </label>
                                    ))}
                                    {scopes.length === 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        Nenhum
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                              );
                            }
                            if (isExport(action)) {
                              const scopes = firstSelectedId
                                ? getExportScopes(
                                    permissionsList,
                                    firstSelectedId,
                                    resource
                                  )
                                : [];
                              const exportScopeOptions = EXPORT_OPTIONS.filter(
                                (o) => o.value !== "denied"
                              );
                              return (
                                <TableCell key={action}>
                                  <div className="flex flex-col gap-1.5">
                                    {exportScopeOptions.map((opt) => (
                                      <label
                                        key={opt.value}
                                        className="flex items-center gap-2 text-sm cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={scopes.includes(opt.value)}
                                          onChange={(e) =>
                                            toggleExportScope(
                                              resource,
                                              opt.value,
                                              e.target.checked
                                            )
                                          }
                                          className="rounded border-input"
                                        />
                                        <span title={opt.description}>
                                          {opt.label}
                                        </span>
                                      </label>
                                    ))}
                                    {scopes.length === 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        Negado
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                              );
                            }
                            if (isSwitchAction(action)) {
                              const value = firstSelectedId
                                ? getValue(
                                    permissionsList,
                                    firstSelectedId,
                                    resource,
                                    action
                                  )
                                : "denied";
                              const allowed = value === "allowed";
                              return (
                                <TableCell key={action} className="text-center">
                                  <div className="flex justify-center">
                                    <Switch
                                      checked={allowed}
                                      onCheckedChange={(checked) =>
                                        setPermission(resource, action, [
                                          checked ? "allowed" : "denied",
                                        ])
                                      }
                                    />
                                  </div>
                                </TableCell>
                              );
                            }
                            return null;
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </div>
            )}
            {selectedList.length > 1 && (
              <p className="text-xs text-muted-foreground mt-2">
                Alterações aplicam-se a todos os {selectedList.length} usuários selecionados.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
