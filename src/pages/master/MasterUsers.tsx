/**
 * Página de gerenciamento de usuários pelo Master
 */

import { useState } from "react";
import {
  Users,
  Search,
  MoreVertical,
  UserCog,
  Building2,
  Power,
  PowerOff,
  UserPlus,
  UserCheck,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  useMasterUsers,
  useMasterChangeUserRole,
  useMasterToggleUserActive,
  useMasterMoveUserToOrg,
  useMasterUnassignedUsers,
  useMasterAssignUserToOrg,
  type UnassignedUser,
} from "@/hooks/useMasterUsers";
import { useMasterOrganizations } from "@/hooks/useMasterOrganizations";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function MasterUsers() {
  const [search, setSearch] = useState("");
  const [moveOrgOpen, setMoveOrgOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newOrgId, setNewOrgId] = useState("");

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({
    organization_id: "",
    email: "",
    name: "",
    password: "",
  });

  const [assignPendingOpen, setAssignPendingOpen] = useState(false);
  const [assignPendingUser, setAssignPendingUser] = useState<UnassignedUser | null>(null);
  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignRole, setAssignRole] = useState("member");

  const queryClient = useQueryClient();
  const { data: users, isLoading } = useMasterUsers();
  const { data: unassignedUsers = [], isLoading: loadingUnassigned } = useMasterUnassignedUsers();
  const { data: organizations } = useMasterOrganizations();
  const changeRole = useMasterChangeUserRole();
  const toggleActive = useMasterToggleUserActive();
  const moveToOrg = useMasterMoveUserToOrg();
  const assignUserToOrg = useMasterAssignUserToOrg();

  const filteredUsers = users?.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      user.organization_name?.toLowerCase().includes(search.toLowerCase())
  );

  const handleMoveToOrg = async () => {
    if (!selectedUser || !newOrgId) return;
    await moveToOrg.mutateAsync({
      teamMemberId: selectedUser.team_member_id,
      newOrgId,
    });
    setMoveOrgOpen(false);
    setSelectedUser(null);
    setNewOrgId("");
  };

  const handleCreateUserSubmit = async () => {
    const { organization_id, email, name, password } = createUserForm;
    if (!email.trim()) {
      toast.error("Email é obrigatório");
      return;
    }
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!organization_id) {
      toast.error("Selecione uma organização");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Senha é obrigatória e deve ter no mínimo 6 caracteres");
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (!supabaseUrl?.trim() || !anonKey?.trim()) {
      toast.error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");
      return;
    }
    setCreateUserLoading(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.access_token) {
        toast.error("Sessão expirada ou inválida. Faça login novamente.");
        setCreateUserLoading(false);
        return;
      }
      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/create-org-user`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey.trim()}`,
          "X-User-JWT": session.access_token,
        },
        body: JSON.stringify({
          organization_id,
          email: email.trim(),
          name: name.trim(),
          password: password.trim(),
          role: "admin",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string };
      if (!res.ok) {
        const msg = data?.message ?? data?.error ?? "Erro ao criar usuário";
        toast.error(msg);
        setCreateUserLoading(false);
        return;
      }
      if (data?.success) {
        toast.success("Usuário admin criado. A pessoa pode entrar com este email e a senha definida.");
        setCreateUserForm({ organization_id: "", email: "", name: "", password: "" });
        setCreateUserOpen(false);
        queryClient.invalidateQueries({ queryKey: ["master-users"] });
        queryClient.invalidateQueries({ queryKey: ["master-organization-members"] });
      }
    } catch (err) {
      toast.error("Erro ao criar usuário. Tente novamente.");
      console.error(err);
    } finally {
      setCreateUserLoading(false);
    }
  };

  const getRoleBadge = (role: string | null) => {
    switch (role) {
      case "admin":
        return <Badge variant="destructive">Admin</Badge>;
      case "sdr":
        return <Badge variant="default">SDR</Badge>;
      case "closer":
        return <Badge variant="secondary">Closer</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Usuários
          </h1>
          <p className="text-muted-foreground">
            Gerencie todos os usuários do sistema
          </p>
        </div>
        <Button onClick={() => setCreateUserOpen(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Criar usuário admin
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou organização..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Cadastros pendentes (usuários que se cadastraram mas não têm organização) */}
      {unassignedUsers.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              Cadastros pendentes
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Usuários que se cadastraram por si só e ainda não têm organização ou acesso ao sistema.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome / Email</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                  <TableHead className="w-[140px]">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingUnassigned ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : (
                  unassignedUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.full_name || "—"}</p>
                          <p className="text-sm text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => {
                            setAssignPendingUser(u);
                            setAssignOrgId("");
                            setAssignRole("member");
                            setAssignPendingOpen(true);
                          }}
                        >
                          <UserCheck className="w-4 h-4" />
                          Vincular à organização
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Organização</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filteredUsers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum usuário encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers?.map((user) => (
                  <TableRow key={user.team_member_id || user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium">
                            {user.full_name?.substring(0, 2).toUpperCase() || "??"}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">{user.full_name || "Sem nome"}</p>
                          <p className="text-sm text-muted-foreground">{user.email || "-"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.organization_name || (
                        <span className="text-muted-foreground">Sem organização</span>
                      )}
                    </TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.is_active ? (
                        <Badge className="bg-green-500">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <UserCog className="w-4 h-4 mr-2" />
                              Alterar Role
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem
                                onClick={() =>
                                  changeRole.mutate({
                                    userId: user.id,
                                    newRole: "admin",
                                  })
                                }
                              >
                                Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  changeRole.mutate({
                                    userId: user.id,
                                    newRole: "sdr",
                                  })
                                }
                              >
                                SDR
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  changeRole.mutate({
                                    userId: user.id,
                                    newRole: "closer",
                                  })
                                }
                              >
                                Closer
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedUser(user);
                              setMoveOrgOpen(true);
                            }}
                          >
                            <Building2 className="w-4 h-4 mr-2" />
                            Mover para Organização
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              toggleActive.mutate({
                                teamMemberId: user.team_member_id,
                                isActive: !user.is_active,
                              })
                            }
                          >
                            {user.is_active ? (
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

      {/* Move to Org Dialog */}
      <Dialog open={moveOrgOpen} onOpenChange={setMoveOrgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover Usuário - {selectedUser?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organização Atual</Label>
              <p className="text-sm text-muted-foreground">
                {selectedUser?.organization_name || "Sem organização"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Nova Organização</Label>
              <Select value={newOrgId} onValueChange={setNewOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOrgOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleMoveToOrg}
              disabled={!newOrgId || moveToOrg.isPending}
            >
              {moveToOrg.isPending ? "Movendo..." : "Mover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create User Admin Dialog */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar usuário admin</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organização</Label>
              <Select
                value={createUserForm.organization_id}
                onValueChange={(v) =>
                  setCreateUserForm((prev) => ({ ...prev, organization_id: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a organização..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={createUserForm.email}
                onChange={(e) =>
                  setCreateUserForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                placeholder="Nome completo"
                value={createUserForm.name}
                onChange={(e) =>
                  setCreateUserForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Senha (mín. 6 caracteres)</Label>
              <Input
                type="password"
                placeholder="Senha de acesso"
                value={createUserForm.password}
                onChange={(e) =>
                  setCreateUserForm((prev) => ({ ...prev, password: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateUserOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateUserSubmit}
              disabled={createUserLoading}
            >
              {createUserLoading ? "Criando..." : "Criar usuário admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vincular cadastro pendente à organização */}
      <Dialog open={assignPendingOpen} onOpenChange={setAssignPendingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular à organização</DialogTitle>
          </DialogHeader>
          {assignPendingUser && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">{assignPendingUser.full_name || "—"}</p>
                <p className="text-muted-foreground">{assignPendingUser.email}</p>
              </div>
              <div className="space-y-2">
                <Label>Organização</Label>
                <Select value={assignOrgId} onValueChange={setAssignOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a organização..." />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Função</Label>
                <Select value={assignRole} onValueChange={setAssignRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Membro</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="sdr">SDR</SelectItem>
                    <SelectItem value="closer">Closer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignPendingOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!assignPendingUser || !assignOrgId) return;
                await assignUserToOrg.mutateAsync({
                  user_id: assignPendingUser.id,
                  organization_id: assignOrgId,
                  role: assignRole,
                  email: assignPendingUser.email,
                  full_name: assignPendingUser.full_name,
                });
                setAssignPendingOpen(false);
                setAssignPendingUser(null);
                setAssignOrgId("");
                setAssignRole("member");
              }}
              disabled={!assignOrgId || assignUserToOrg.isPending}
            >
              {assignUserToOrg.isPending ? "Vinculando..." : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
