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
} from "@/hooks/useMasterUsers";
import { useMasterOrganizations } from "@/hooks/useMasterOrganizations";

export default function MasterUsers() {
  const [search, setSearch] = useState("");
  const [moveOrgOpen, setMoveOrgOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newOrgId, setNewOrgId] = useState("");

  const { data: users, isLoading } = useMasterUsers();
  const { data: organizations } = useMasterOrganizations();
  const changeRole = useMasterChangeUserRole();
  const toggleActive = useMasterToggleUserActive();
  const moveToOrg = useMasterMoveUserToOrg();

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
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" />
          Usuários
        </h1>
        <p className="text-muted-foreground">
          Gerencie todos os usuários do sistema
        </p>
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
    </div>
  );
}
