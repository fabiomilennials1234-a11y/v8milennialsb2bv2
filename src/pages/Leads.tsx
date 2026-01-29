import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Fuel,
  Search,
  Filter,
  Star,
  Phone,
  Mail,
  Building,
  Calendar,
  Tag,
  MoreHorizontal,
  Plus,
  X,
  Edit2,
  Eye,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeads, useCreateLead, useUpdateLead, useDeleteLead, type Lead } from "@/hooks/useLeads";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const originLabels: Record<string, string> = {
  remarketing: "Remarketing",
  base_clientes: "Base de clientes",
  parceiro: "Parceiro",
  indicacao: "Indicação",
  calendly: "Calendly",
  quiz: "Quiz",
  site: "Site",
  organico: "Orgânico",
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outro",
};

const originColors: Record<string, string> = {
  remarketing: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  base_clientes: "bg-chart-2/10 text-chart-2 border-chart-2/20",
  parceiro: "bg-chart-3/10 text-chart-3 border-chart-3/20",
  indicacao: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  calendly: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  quiz: "bg-primary/10 text-primary border-primary/20",
  site: "bg-success/10 text-success border-success/20",
  organico: "bg-warning/10 text-warning border-warning/20",
  whatsapp: "bg-green-500/10 text-green-600 border-green-500/20",
  meta_ads: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  outro: "bg-muted text-muted-foreground border-muted",
};

interface LeadFormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  rating: number;
  segment: string;
  faturamento: string;
  urgency: string;
  notes: string;
  sdr_id: string | null;
  closer_id: string | null;
  compromisso_date: string;
}

const initialFormData: LeadFormData = {
  name: "",
  company: "",
  email: "",
  phone: "",
  origin: "outro",
  rating: 5,
  segment: "",
  faturamento: "",
  urgency: "",
  notes: "",
  sdr_id: null,
  closer_id: null,
  compromisso_date: "",
};

function StarRating({ rating, onRate, readonly = false }: { rating: number; onRate?: (r: number) => void; readonly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onRate?.(star)}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              star <= rating
                ? "fill-chart-5 text-chart-5"
                : "text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export default function Leads() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOrigin, setFilterOrigin] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState<LeadFormData>(initialFormData);

  const { data: leads = [], isLoading } = useLeads();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: currentTeamMember, isLoading: isLoadingTeamMember, isFetching: isFetchingTeamMember } = useCurrentTeamMember();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);

  const sdrs = teamMembers.filter(m => m.role === "sdr" && m.is_active);
  const closers = teamMembers.filter(m => m.role === "closer" && m.is_active);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead: Lead) => {
      const matchesSearch = 
        lead.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.email?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesOrigin = filterOrigin === "all" || lead.origin === filterOrigin;
      
      const matchesRating = filterRating === "all" || 
        (filterRating === "high" && (lead.rating || 0) >= 7) ||
        (filterRating === "medium" && (lead.rating || 0) >= 4 && (lead.rating || 0) < 7) ||
        (filterRating === "low" && (lead.rating || 0) < 4);
      
      return matchesSearch && matchesOrigin && matchesRating;
    });
  }, [leads, searchQuery, filterOrigin, filterRating]);

  const stats = useMemo(() => {
    const total = leads.length;
    const highRating = leads.filter((l: Lead) => (l.rating || 0) >= 7).length;
    const thisMonth = leads.filter((l: Lead) => {
      const date = new Date(l.created_at);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const withSDR = leads.filter((l: Lead) => l.sdr_id).length;
    
    return { total, highRating, thisMonth, withSDR };
  }, [leads]);

  const handleOpenDialog = (lead?: any) => {
    if (lead) {
      setEditingLead(lead);
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        origin: lead.origin || "outro",
        rating: lead.rating || 5,
        segment: lead.segment || "",
        faturamento: lead.faturamento,
        urgency: lead.urgency || "",
        notes: lead.notes || "",
        sdr_id: lead.sdr_id,
        closer_id: lead.closer_id,
        compromisso_date: lead.compromisso_date ? lead.compromisso_date.slice(0, 16) : "",
      });
    } else {
      setEditingLead(null);
      setFormData(initialFormData);
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    // Verificar se ainda está carregando
    if (isLoadingTeamMember || isFetchingTeamMember) {
      toast.info("Carregando informações da organização...");
      return;
    }

    // Verificar se tem organization_id
    if (!currentTeamMember?.organization_id) {
      toast.error(
        "Você precisa estar vinculado a uma organização. Execute o script SQL 'SOLUCAO_DEFINITIVA_RLS.sql' no Supabase Dashboard e recarregue a página.",
        { duration: 10000 }
      );
      console.error("❌ Team member sem organization_id:", {
        currentTeamMember,
        hasTeamMember: !!currentTeamMember,
        organizationId: currentTeamMember?.organization_id,
        isLoading: isLoadingTeamMember,
        isFetching: isFetchingTeamMember,
      });
      return;
    }

    try {
      const payload = {
        ...formData,
        origin: formData.origin as any,
        faturamento: formData.faturamento || null,
        sdr_id: formData.sdr_id || null,
        closer_id: formData.closer_id || null,
        compromisso_date: formData.compromisso_date ? new Date(formData.compromisso_date).toISOString() : null,
        organization_id: currentTeamMember.organization_id,
      };

      if (editingLead) {
        await updateLead.mutateAsync({ id: editingLead.id, ...payload });
        toast.success("Lead atualizado!");
      } else {
        await createLead.mutateAsync(payload);
        toast.success("Lead criado!");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingLead(null);
    } catch (error: any) {
      console.error("❌ Erro ao salvar lead:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        fullError: error,
      });
      
      if (error?.code === '42501' || error?.message?.includes('permission denied')) {
        toast.error("Erro de permissão. Verifique as políticas RLS no Supabase.");
      } else if (error?.code === '23503' || error?.message?.includes('foreign key')) {
        toast.error("Erro: organização não encontrada. Execute o script SQL de vinculação.");
      } else {
        toast.error(`Erro ao salvar lead: ${error?.message || 'Erro desconhecido'}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Fuel className="w-6 h-6 text-primary" />
            Tanque de Combustível
            <span className="text-lg">⛽</span>
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Gerencie todo o combustível da sua máquina de vendas
          </p>
        </div>

        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Lead
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Total de Leads</p>
          <p className="text-xl font-bold">{stats.total}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Alta Qualidade (7+)</p>
          <p className="text-xl font-bold text-chart-5">{stats.highRating}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Este Mês</p>
          <p className="text-xl font-bold text-primary">{stats.thisMonth}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Com SDR Atribuído</p>
          <p className="text-xl font-bold text-success">{stats.withSDR}</p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, empresa ou email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterOrigin} onValueChange={setFilterOrigin}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Origens</SelectItem>
            {Object.entries(originLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRating} onValueChange={setFilterRating}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Ratings</SelectItem>
            <SelectItem value="high">Alta (7-10)</SelectItem>
            <SelectItem value="medium">Média (4-6)</SelectItem>
            <SelectItem value="low">Baixa (0-3)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>SDR</TableHead>
              <TableHead>Closer</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredLeads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhum lead encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredLeads.map((lead: Lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{lead.name}</p>
                      {lead.company && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {lead.company}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {lead.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {lead.email}
                        </p>
                      )}
                      {lead.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={originColors[lead.origin] || originColors.outro}>
                      {originLabels[lead.origin] || lead.origin}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StarRating rating={lead.rating || 0} readonly />
                  </TableCell>
                  <TableCell>
                    {lead.sdr?.name ? (
                      <Badge variant="outline" className="text-xs">
                        {lead.sdr.name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.closer?.name ? (
                      <Badge variant="outline" className="text-xs">
                        {lead.closer.name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenDialog(lead)}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => {
                            setLeadToDelete(lead);
                            setDeleteConfirmOpen(true);
                          }}
                          className="text-destructive focus:text-destructive"
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
      </div>

      {/* Lead Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingLead ? "Editar Lead" : "Novo Lead"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nome do lead"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="company">Empresa</Label>
                <Input
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Nome da empresa"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="origin">Origem</Label>
                <Select
                  value={formData.origin}
                  onValueChange={(v) => setFormData({ ...formData, origin: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(originLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Rating (0-10)</Label>
                <div className="py-2">
                  <StarRating
                    rating={formData.rating}
                    onRate={(r) => setFormData({ ...formData, rating: r })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="segment">Segmento</Label>
                <Input
                  id="segment"
                  value={formData.segment}
                  onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
                  placeholder="Ex: Tecnologia, Varejo..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="faturamento">Faturamento</Label>
                <Input
                  id="faturamento"
                  value={formData.faturamento}
                  onChange={(e) => setFormData({ ...formData, faturamento: e.target.value })}
                  placeholder="Ex: R$ 100.000, Acima de 1M..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sdr">SDR Responsável</Label>
                <Select
                  value={formData.sdr_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, sdr_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar SDR" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {sdrs.map(sdr => (
                      <SelectItem key={sdr.id} value={sdr.id}>{sdr.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closer">Closer Responsável</Label>
                <Select
                  value={formData.closer_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, closer_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar Closer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {closers.map(closer => (
                      <SelectItem key={closer.id} value={closer.id}>{closer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="compromisso_date">Compromisso Marcado</Label>
                <Input
                  id="compromisso_date"
                  type="datetime-local"
                  value={formData.compromisso_date}
                  onChange={(e) => setFormData({ ...formData, compromisso_date: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="urgency">Urgência</Label>
                <Input
                  id="urgency"
                  value={formData.urgency}
                  onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                  placeholder="Ex: Alta, Média, Baixa..."
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Anotações sobre o lead..."
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={createLead.isPending || updateLead.isPending}>
              {editingLead ? "Salvar" : "Criar Lead"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{leadToDelete?.name}"? Esta ação irá remover também todas as reuniões, propostas e follow-ups associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (leadToDelete) {
                  try {
                    await deleteLead.mutateAsync(leadToDelete.id);
                    toast.success("Lead excluído com sucesso!");
                    setLeadToDelete(null);
                  } catch (error) {
                    toast.error("Erro ao excluir lead");
                  }
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
