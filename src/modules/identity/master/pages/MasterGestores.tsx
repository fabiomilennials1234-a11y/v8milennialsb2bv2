/**
 * Página do Master para gerenciar Gestores de Portfólio (ADR-0021 §8).
 *
 * Gestor de Portfólio = "scoped master": ator abaixo do Master, com escrita full
 * de admin operacional nas orgs que o Master vincula aqui. Esta página cria/desativa
 * gestores e gerencia o whitelist de organizações de cada um.
 *
 * Espelha MasterOrganizations/MasterUsers (layout, estilo, dark-first).
 */

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  UserCog,
  Plus,
  Search,
  MoreVertical,
  Building2,
  Power,
  PowerOff,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  useMasterGestores,
  useCreateGestor,
  useToggleGestorActive,
  useSetGestorOrgs,
  type MasterGestorView,
} from "../hooks/useMasterGestores";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";
import { useMasterAuth } from "../hooks/useMasterAuth";

export default function MasterGestores() {
  const { hasPermission } = useMasterAuth();
  const canManageGestores = hasPermission("gestores");

  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Manage-orgs dialog
  const [orgsDialogGestor, setOrgsDialogGestor] = useState<MasterGestorView | null>(null);
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set());

  const { data: gestores, isLoading } = useMasterGestores();
  const { data: organizations } = useMasterOrganizations();
  const createGestor = useCreateGestor();
  const toggleActive = useToggleGestorActive();
  const setGestorOrgs = useSetGestorOrgs();

  const orgNameById = useMemo(
    () => new Map((organizations ?? []).map((o) => [o.id, o.name])),
    [organizations],
  );

  const filtered = gestores?.filter((g) => {
    const q = search.toLowerCase();
    return (
      (g.full_name?.toLowerCase().includes(q) ?? false) ||
      g.user_id.toLowerCase().includes(q) ||
      (g.notes?.toLowerCase().includes(q) ?? false)
    );
  });

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success("ID copiado");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = async () => {
    if (!newEmail.trim()) return;
    await createGestor.mutateAsync({
      email: newEmail,
      name: newName,
      password: newPassword,
      notes: newNotes,
    });
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setNewNotes("");
    setCreateOpen(false);
  };

  const openOrgsDialog = (gestor: MasterGestorView) => {
    setOrgsDialogGestor(gestor);
    setSelectedOrgIds(new Set(gestor.organization_ids));
  };

  const toggleOrg = (orgId: string) => {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const handleSaveOrgs = async () => {
    if (!orgsDialogGestor) return;
    await setGestorOrgs.mutateAsync({
      gestorId: orgsDialogGestor.id,
      organizationIds: Array.from(selectedOrgIds),
    });
    setOrgsDialogGestor(null);
  };

  // Gate por permissão granular (ADR-0021 §8). MasterRoute já garante isMaster;
  // aqui refinamos por `gestores`. Masters com `all` passam automaticamente.
  if (!canManageGestores) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldAlert className="w-16 h-16 text-destructive" />
          <h1 className="text-2xl font-bold">Acesso Negado</h1>
          <p className="text-muted-foreground">
            Você não tem permissão para gerenciar Gestores de Portfólio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="w-6 h-6" />
            Gestores de Portfólio
          </h1>
          <p className="text-muted-foreground">
            Gerencie gestores e as organizações que cada um administra
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Gestor
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, ID ou nota..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gestor</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Organizações</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhum gestor encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filtered?.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{g.full_name || "Sem nome"}</p>
                        {g.notes && (
                          <p className="text-sm text-muted-foreground">{g.notes}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 group/copy"
                        onClick={() => copyId(g.user_id)}
                        title={g.user_id}
                      >
                        <code className="text-xs text-muted-foreground font-mono">
                          {g.user_id.slice(0, 8)}...
                        </code>
                        {copiedId === g.user_id ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      {g.organization_ids.length === 0 ? (
                        <span className="text-sm text-muted-foreground">Nenhuma</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {g.organization_ids.slice(0, 3).map((orgId) => (
                            <Badge key={orgId} variant="secondary" className="font-normal">
                              {orgNameById.get(orgId) ?? `${orgId.slice(0, 6)}…`}
                            </Badge>
                          ))}
                          {g.organization_ids.length > 3 && (
                            <Badge variant="outline" className="font-normal">
                              +{g.organization_ids.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {g.is_active ? (
                        <Badge className="bg-success text-success-foreground">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {format(new Date(g.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openOrgsDialog(g)}>
                            <Building2 className="w-4 h-4 mr-2" />
                            Gerenciar Organizações
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              toggleActive.mutate({ gestorId: g.id, isActive: !g.is_active })
                            }
                          >
                            {g.is_active ? (
                              <>
                                <PowerOff className="w-4 h-4 mr-2" />
                                Desativar
                              </>
                            ) : (
                              <>
                                <Power className="w-4 h-4 mr-2" />
                                Ativar
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Gestor de Portfólio</DialogTitle>
            <DialogDescription>
              Informe o email. Se já houver uma conta, ela será reaproveitada; caso
              contrário, defina uma senha para criar a conta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="gestor@exemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do gestor"
              />
            </div>
            <div className="space-y-2">
              <Label>Senha (apenas se criar conta nova)</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
              <p className="text-xs text-muted-foreground">
                Ignorada quando o email já pertence a uma conta existente.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Agência / parceiro / responsável"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createGestor.isPending || !newEmail.trim()}
            >
              {createGestor.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Orgs Dialog */}
      <Dialog
        open={!!orgsDialogGestor}
        onOpenChange={(open) => !open && setOrgsDialogGestor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organizações vinculadas</DialogTitle>
            <DialogDescription>
              Selecione as organizações que {orgsDialogGestor?.full_name || "este gestor"}{" "}
              administra. Desmarcar revoga o acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1 py-2">
            {(organizations ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhuma organização disponível.
              </p>
            ) : (
              organizations?.map((org) => (
                <label
                  key={org.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent cursor-pointer"
                >
                  <Checkbox
                    checked={selectedOrgIds.has(org.id)}
                    onCheckedChange={() => toggleOrg(org.id)}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{org.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{org.slug}</p>
                  </div>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgsDialogGestor(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveOrgs} disabled={setGestorOrgs.isPending}>
              {setGestorOrgs.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
