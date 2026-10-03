/**
 * Página de gerenciamento de organizações pelo Master
 */

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  Search,
  MoreVertical,
  CreditCard,
  Users,
  Trash2,
  Eye,
  Power,
  PowerOff,
  Copy,
  Check,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMasterOrganizations,
  useMasterCreateOrganization,
  useMasterSetOrgSuspension,
  useMasterDeleteOrganization,
  type MasterOrganization,
  FUNNEL_TEMPLATES,
  type OrgType,
  type FunnelTemplateKey,
} from "../hooks/useMasterOrganizations";
import { BillingOverrideModal } from "../components/BillingOverrideModal";
import { OrgSuspensionDialog } from "../components/OrgSuspensionDialog";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { toast } from "sonner";
import { MasterPageHeader } from "../components/MasterPageHeader";

export default function MasterOrganizations() {
  const { isOutbounder } = useMasterAuth();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [billingOverrideOpen, setBillingOverrideOpen] = useState(false);
  const [suspensionOrg, setSuspensionOrg] = useState<MasterOrganization | null>(null);
  const [suspensionMode, setSuspensionMode] = useState<"suspend" | "reactivate">("suspend");
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgType, setNewOrgType] = useState<OrgType>(isOutbounder ? "outbound" : "crm");
  const [newOrgFunnel, setNewOrgFunnel] = useState<FunnelTemplateKey | "none">("none");

  const { data: organizations, isLoading } = useMasterOrganizations();
  const createOrg = useMasterCreateOrganization();
  const deleteOrg = useMasterDeleteOrganization();
  const setSuspension = useMasterSetOrgSuspension();

  // Outbounder só vê organizações outbound
  const baseOrgs = isOutbounder
    ? organizations?.filter((org) => org.org_type === "outbound")
    : organizations;

  const filteredOrgs = baseOrgs?.filter(
    (org) =>
      org.name.toLowerCase().includes(search.toLowerCase()) ||
      org.slug.toLowerCase().includes(search.toLowerCase()) ||
      org.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!newOrgName || !newOrgSlug) return;
    await createOrg.mutateAsync({
      name: newOrgName,
      slug: newOrgSlug.toLowerCase().replace(/\s+/g, "-"),
      org_type: newOrgType,
      funnelTemplate: newOrgFunnel === "none" ? null : newOrgFunnel,
    });
    setNewOrgName("");
    setNewOrgSlug("");
    setNewOrgType("crm");
    setNewOrgFunnel("none");
    setCreateOpen(false);
  };

  // Status e override são dois fatos, não um. Colapsar os dois num badge só
  // escondia o caso que mais importa: org "suspensa" com override ligado, que
  // continua com acesso liberado. Agora aparecem lado a lado.
  const getStatusBadge = (status: string, hasOverride: boolean) => {
    const bloqueada = ["suspended", "cancelled", "expired"].includes(status) && !hasOverride;

    const statusBadge = (() => {
      switch (status) {
        case "active":
          return <Badge variant="success">Ativo</Badge>;
        case "trial":
          return <Badge variant="info">Trial</Badge>;
        case "suspended":
          return <Badge variant="warning">Suspenso</Badge>;
        case "cancelled":
        case "expired":
          return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/15">Cancelado</Badge>;
        default:
          return <Badge variant="secondary">{status}</Badge>;
      }
    })();

    return (
      <div className="flex items-center gap-1.5">
        {statusBadge}
        {hasOverride && (
          <Badge variant="gold" title="Plano liberado pelo Master — ignora o status da assinatura">
            Override
          </Badge>
        )}
        {bloqueada && (
          <span className="text-[10px] uppercase tracking-wide text-destructive">
            sem acesso
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title={isOutbounder ? "Organizações outbound" : "Organizações"}
        subtitle={
          isOutbounder
            ? "Gerencie as organizações de outbound"
            : "Gerencie todas as organizações do sistema"
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            Nova organização
          </Button>
        }
      />

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

      {/* Table — carga e vazio ficam FORA da tabela, centrados no cartão. No
          celular, tipo e plano sobem para baixo do slug e a data some: nenhuma
          coluna sai da tela. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : !filteredOrgs?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma organização encontrada</p>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização</TableHead>
                <TableHead className="max-sm:hidden">Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="max-md:hidden">Plano</TableHead>
                <TableHead className="max-lg:hidden">Criada em</TableHead>
                <TableHead className="w-[100px] max-sm:w-14">
                  <span className="max-sm:sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="max-md:w-full max-md:max-w-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{org.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{org.slug}</p>
                        <p className="truncate text-xs text-muted-foreground md:hidden">
                          <span className="sm:hidden">{org.org_type === "outbound" ? "Outbound" : "CRM"} · </span>
                          <span className="capitalize">{org.subscription_plan || "free"}</span>
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <Badge variant={org.org_type === "outbound" ? "info" : "soft"}>
                        {org.org_type === "outbound" ? "Outbound" : "CRM"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(org.subscription_status, org.billing_override)}
                    </TableCell>
                    <TableCell className="max-md:hidden">
                      <span className="capitalize">{org.subscription_plan || "free"}</span>
                    </TableCell>
                    <TableCell className="max-lg:hidden">
                      {format(new Date(org.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Ações de ${org.name}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* V5: a coluna de ID saiu da tabela; o copiar continua aqui. */}
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(org.id);
                              setCopiedId(org.id);
                              toast.success("ID copiado");
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                          >
                            {copiedId === org.id ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                            Copiar ID
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Eye className="w-4 h-4 mr-2" />
                            Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Users className="w-4 h-4 mr-2" />
                            Ver membros
                          </DropdownMenuItem>
                          {!isOutbounder && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedOrg(org);
                                  setBillingOverrideOpen(true);
                                }}
                              >
                                <CreditCard className="w-4 h-4 mr-2" />
                                Liberar plano
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSuspensionMode(
                                    org.subscription_status === "active" ? "suspend" : "reactivate"
                                  );
                                  setSuspensionOrg(org);
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
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!isOutbounder && (
              <div className="space-y-2">
                <Label>Tipo de organização</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={newOrgType === "crm" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewOrgType("crm")}
                  >
                    CRM
                  </Button>
                  <Button
                    type="button"
                    variant={newOrgType === "outbound" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewOrgType("outbound")}
                  >
                    Outbound
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {newOrgType === "crm"
                    ? "Fluxo padrão com Admin, SDR e Closer."
                    : "Agência de prospecção com Agency, BDR e Cliente."}
                </p>
              </div>
            )}
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
            <div className="space-y-2">
              <Label>Modelo de funil (kanban)</Label>
              <Select
                value={newOrgFunnel}
                onValueChange={(v) => setNewOrgFunnel(v as FunnelTemplateKey | "none")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um modelo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Padrão (sem modelo)</SelectItem>
                  {(
                    Object.entries(FUNNEL_TEMPLATES) as [
                      FunnelTemplateKey,
                      (typeof FUNNEL_TEMPLATES)[FunnelTemplateKey],
                    ][]
                  ).map(([key, tpl]) => (
                    <SelectItem key={key} value={key}>
                      {tpl.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {newOrgFunnel === "none"
                  ? "A org começa com os kanbans padrão do sistema."
                  : FUNNEL_TEMPLATES[newOrgFunnel].description +
                    " — kanbans e automações do funil já vêm setados (as automações são criadas inativas)."}
              </p>
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

      <OrgSuspensionDialog
        open={!!suspensionOrg}
        onOpenChange={(open) => {
          if (!open) setSuspensionOrg(null);
        }}
        org={suspensionOrg}
        suspend={suspensionMode === "suspend"}
        pending={setSuspension.isPending}
        onConfirm={(reason) => {
          if (!suspensionOrg) return;
          setSuspension.mutate(
            {
              orgId: suspensionOrg.id,
              suspend: suspensionMode === "suspend",
              reason: reason || undefined,
            },
            // erro já vira toast no hook; o diálogo fica aberto para nova tentativa
            { onSuccess: () => setSuspensionOrg(null) }
          );
        }}
      />
    </div>
  );
}
