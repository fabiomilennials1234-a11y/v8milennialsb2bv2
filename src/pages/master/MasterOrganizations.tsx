/**
 * Página de gerenciamento de organizações pelo Master
 */

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Building2,
  Plus,
  Search,
  MoreVertical,
  CreditCard,
  Users,
  Trash2,
  Edit,
  Eye,
  Power,
  PowerOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  useMasterOrganizations,
  useMasterCreateOrganization,
  useMasterUpdateOrganization,
  useMasterDeleteOrganization,
} from "@/hooks/useMasterOrganizations";
import { BillingOverrideModal } from "@/components/master/BillingOverrideModal";

export default function MasterOrganizations() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [billingOverrideOpen, setBillingOverrideOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");

  const { data: organizations, isLoading } = useMasterOrganizations();
  const createOrg = useMasterCreateOrganization();
  const updateOrg = useMasterUpdateOrganization();
  const deleteOrg = useMasterDeleteOrganization();

  const filteredOrgs = organizations?.filter(
    (org) =>
      org.name.toLowerCase().includes(search.toLowerCase()) ||
      org.slug.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!newOrgName || !newOrgSlug) return;
    await createOrg.mutateAsync({
      name: newOrgName,
      slug: newOrgSlug.toLowerCase().replace(/\s+/g, "-"),
    });
    setNewOrgName("");
    setNewOrgSlug("");
    setCreateOpen(false);
  };

  const getStatusBadge = (status: string, hasOverride: boolean) => {
    if (hasOverride) {
      return <Badge className="bg-purple-500">Override</Badge>;
    }
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Ativo</Badge>;
      case "trial":
        return <Badge className="bg-blue-500">Trial</Badge>;
      case "suspended":
        return <Badge className="bg-yellow-500">Suspenso</Badge>;
      case "cancelled":
      case "expired":
        return <Badge variant="destructive">Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6" />
            Organizações
          </h1>
          <p className="text-muted-foreground">
            Gerencie todas as organizações do sistema
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nova Organização
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou slug..."
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
                <TableHead>Organização</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Criada em</TableHead>
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
              ) : filteredOrgs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhuma organização encontrada
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrgs?.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-sm text-muted-foreground">{org.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(org.subscription_status, org.billing_override)}
                    </TableCell>
                    <TableCell>
                      <span className="capitalize">{org.subscription_plan || "free"}</span>
                    </TableCell>
                    <TableCell>
                      {format(new Date(org.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Eye className="w-4 h-4 mr-2" />
                            Ver Detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Users className="w-4 h-4 mr-2" />
                            Ver Membros
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedOrg(org);
                              setBillingOverrideOpen(true);
                            }}
                          >
                            <CreditCard className="w-4 h-4 mr-2" />
                            Liberar Plano
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              updateOrg.mutate({
                                id: org.id,
                                subscription_status: org.subscription_status === "active" ? "suspended" : "active",
                              });
                            }}
                          >
                            {org.subscription_status === "active" ? (
                              <>
                                <PowerOff className="w-4 h-4 mr-2" />
                                Suspender
                              </>
                            ) : (
                              <>
                                <Power className="w-4 h-4 mr-2" />
                                Ativar
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              if (confirm(`Excluir "${org.name}"? Esta ação não pode ser desfeita.`)) {
                                deleteOrg.mutate(org.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Excluir
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
            <DialogTitle>Nova Organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (URL)</Label>
              <Input
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
                placeholder="nome-da-empresa"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createOrg.isPending}>
              {createOrg.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Billing Override Modal */}
      <BillingOverrideModal
        open={billingOverrideOpen}
        onOpenChange={setBillingOverrideOpen}
        organization={selectedOrg}
      />
    </div>
  );
}
