import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Users, 
  Search, 
  Edit2, 
  Trash2, 
  DollarSign,
  Percent,
  UserCheck,
  UserX,
  Mail,
  MoreHorizontal,
  UserPlus,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTeamMembers, useUpdateTeamMember, TeamMember } from "@/hooks/useTeamMembers";
import { useOrganization } from "@/hooks/useOrganization";
import { useIsAdmin } from "@/hooks/useUserRole";
import { PermissoesEquipe } from "@/components/team/PermissoesEquipe";
import { useProfiles } from "@/hooks/useProfiles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TeamRole = "sdr" | "closer";

interface TeamMemberFormData {
  name: string;
  email: string;
  role: TeamRole;
  ote_base: number;
  ote_bonus: number;
  commission_mrr_percent: number;
  commission_projeto_percent: number;
  is_active: boolean;
  user_id: string | null;
}

const initialFormData: TeamMemberFormData = {
  name: "",
  email: "",
  role: "sdr",
  ote_base: 0,
  ote_bonus: 0,
  commission_mrr_percent: 1.0,
  commission_projeto_percent: 0.5,
  is_active: true,
  user_id: null,
};

export default function Equipe() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState<TeamMemberFormData>(initialFormData);

  const [isCreateUserDialogOpen, setIsCreateUserDialogOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ email: "", name: "", role: "sdr" as TeamRole, password: "" });
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const [createdUserEmail, setCreatedUserEmail] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const { data: members = [], isLoading } = useTeamMembers();
  const updateMember = useUpdateTeamMember();
  const { organizationId } = useOrganization();
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();

  const { data: orgKeyData } = useQuery({
    queryKey: ["organization", "user_creation_key", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("user_creation_key")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return data as { user_creation_key: string | null } | null;
    },
    enabled: Boolean(organizationId) && isAdmin,
  });
  const userCreationKey = orgKeyData?.user_creation_key ?? null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === "all" || member.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const { data: profiles = [] } = useProfiles();

  const handleOpenEditDialog = (member: TeamMember) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      email: (member as any).email || "",
      role: member.role as TeamRole,
      ote_base: Number(member.ote_base) || 0,
      ote_bonus: Number(member.ote_bonus) || 0,
      commission_mrr_percent:
        member.commission_mrr_percent != null ? Number(member.commission_mrr_percent) : 1.0,
      commission_projeto_percent:
        member.commission_projeto_percent != null ? Number(member.commission_projeto_percent) : 0.5,
      is_active: member.is_active,
      user_id: member.user_id || null,
    });
    setIsDialogOpen(true);
  };

  const handleSubmitEdit = async () => {
    if (!editingMember) return;
    try {
      await updateMember.mutateAsync({
        id: editingMember.id,
        ...formData,
      });
      toast.success("Membro atualizado com sucesso!");
      setIsDialogOpen(false);
      setEditingMember(null);
    } catch (error) {
      toast.error("Erro ao salvar membro");
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const useEdge = Boolean(supabaseUrl?.trim()) && Boolean(anonKey?.trim());

    if (!useEdge || !organizationId || !userCreationKey) {
      toast.error("Remoção com limpeza de cadastro requer configuração (Supabase URL, chave e chave da organização).");
      return;
    }
    setRemovingMemberId(id);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.access_token) {
        toast.error("Sessão expirada ou inválida. Faça login novamente.");
        setRemovingMemberId(null);
        return;
      }
      const url = `${supabaseUrl!.replace(/\/$/, "")}/functions/v1/remove-org-member`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey!.trim()}`,
          "X-User-JWT": session.access_token,
        },
        body: JSON.stringify({
          team_member_id: id,
          organization_id: organizationId,
          user_creation_key: userCreationKey,
          user_jwt: session.access_token,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string };
      if (!res.ok) {
        const msg = data?.message ?? data?.error ?? "Erro ao remover membro";
        const detail = (data as { detail?: string })?.detail;
        toast.error(detail ? `${msg} (${detail})` : msg);
        setRemovingMemberId(null);
        return;
      }
      if (data?.success) {
        toast.success("Membro removido e dados de cadastro apagados. O email pode ser reutilizado.");
      }
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    } catch (error) {
      toast.error("Erro ao remover membro. Tente novamente.");
      console.error(error);
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleCreateUserSubmit = async () => {
    const { email, name, role, password } = createUserForm;
    if (!email.trim()) {
      toast.error("Email é obrigatório");
      return;
    }
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Senha é obrigatória e deve ter no mínimo 6 caracteres");
      return;
    }
    const inviteApiUrl = import.meta.env.VITE_INVITE_API_URL as string | undefined;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const useBackend = Boolean(inviteApiUrl?.trim());
    const useEdgeDirect = !useBackend && Boolean(supabaseUrl?.trim()) && Boolean(anonKey?.trim());

    if (!useBackend && !useEdgeDirect) {
      toast.error(
        "Configure no .env: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (ou VITE_INVITE_API_URL para backend)."
      );
      return;
    }
    if (!organizationId) {
      toast.error("Organização não disponível. Faça login novamente.");
      return;
    }
    if (useEdgeDirect && !userCreationKey) {
      toast.error("Chave da organização não disponível. Execute a migration user_creation_key e recarregue.");
      return;
    }
    setCreateUserLoading(true);
    setCreatedUserEmail(null);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.access_token) {
        toast.error("Sessão expirada ou inválida. Faça login novamente.");
        setCreateUserLoading(false);
        return;
      }
      const url = useBackend
        ? inviteApiUrl!.trim()
        : `${supabaseUrl!.replace(/\/$/, "")}/functions/v1/create-org-user`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // Gateway do Supabase exige Authorization com anon key; JWT do usuário vai em X-User-JWT
        Authorization: useEdgeDirect ? `Bearer ${anonKey!.trim()}` : `Bearer ${session.access_token}`,
      };
      if (useEdgeDirect) {
        headers["X-User-JWT"] = session.access_token;
      }
      const bodyPayload: Record<string, string> = {
        email: email.trim(),
        name: name.trim(),
        role,
        organization_id: organizationId,
        password: password.trim(),
      };
      if (useEdgeDirect) {
        bodyPayload.user_creation_key = userCreationKey!;
        bodyPayload.user_jwt = session.access_token;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string };
      if (!res.ok) {
        const msg = data?.message ?? data?.error ?? "Erro ao criar usuário";
        const detail = (data as { detail?: string })?.detail;
        const msgLower = String(msg).toLowerCase();
        if (msgLower.includes("limite")) {
          toast.error("Limite de usuários do plano atingido. Faça upgrade para adicionar mais.");
        } else if (msgLower.includes("já está cadastrado") || msgLower.includes("already")) {
          toast.error("Este email já está cadastrado.");
        } else {
          toast.error(detail ? `${msg} (${detail})` : msg);
        }
        setCreateUserLoading(false);
        return;
      }
      if (data?.success) {
        setCreatedUserEmail(email.trim());
        toast.success("Usuário criado. A pessoa pode entrar com este email e a senha que você definiu.");
      }
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    } catch (err) {
      toast.error("Erro ao criar usuário. Tente novamente.");
      console.error(err);
    } finally {
      setCreateUserLoading(false);
    }
  };

  const handleCreateUserDialogOpen = (open: boolean) => {
    setIsCreateUserDialogOpen(open);
    if (!open) {
      setCreateUserForm({ email: "", name: "", role: "sdr", password: "" });
      setCreatedUserEmail(null);
    }
  };

  const roleLabels = {
    sdr: "SDR",
    closer: "Closer",
  };

  const roleColors = {
    sdr: "bg-chart-5/10 text-chart-5 border-chart-5/20",
    closer: "bg-primary/10 text-primary border-primary/20",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Users className="w-6 h-6 text-primary" />
            Equipe
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Gerencie SDRs, Closers e suas configurações de OTE
          </p>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <Dialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                if (!open) setEditingMember(null);
                setIsDialogOpen(open);
              }}
            >
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Editar Membro</DialogTitle>
                  <DialogDescription>
                    Ajuste as informações do membro da equipe (OTE, comissões, Cal.com, etc.)
                  </DialogDescription>
                </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email (Cal.com)</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@exemplo.com"
                      className="pl-9"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Email usado no Cal.com para atribuição automática de reuniões
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="role">Função</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value: TeamRole) => setFormData({ ...formData, role: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a função" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sdr">SDR</SelectItem>
                      <SelectItem value="closer">Closer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ote_base">OTE Base (R$)</Label>
                    <Input
                      id="ote_base"
                      type="number"
                      min="0"
                      value={formData.ote_base}
                      onChange={(e) => setFormData({ ...formData, ote_base: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ote_bonus">OTE Bônus (R$)</Label>
                    <Input
                      id="ote_bonus"
                      type="number"
                      min="0"
                      value={formData.ote_bonus}
                      onChange={(e) => setFormData({ ...formData, ote_bonus: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="commission_mrr">Comissão MRR (%)</Label>
                    <Input
                      id="commission_mrr"
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.commission_mrr_percent}
                      onChange={(e) => setFormData({ ...formData, commission_mrr_percent: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="commission_projeto">Comissão Projeto (%)</Label>
                    <Input
                      id="commission_projeto"
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.commission_projeto_percent}
                      onChange={(e) => setFormData({ ...formData, commission_projeto_percent: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="user_id">Vincular ao Usuário</Label>
                  <Select
                    value={formData.user_id || "none"}
                    onValueChange={(value) => setFormData({ ...formData, user_id: value === "none" ? null : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Vincule a um usuário cadastrado para ele acessar suas comissões
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active">Membro Ativo</Label>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>
              </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmitEdit} disabled={updateMember.isPending}>
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={isCreateUserDialogOpen} onOpenChange={handleCreateUserDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  Criar usuário
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <UserPlus className="w-5 h-5" />
                    Criar usuário
                  </DialogTitle>
                  <DialogDescription>
                    Informe o nome da conta, o email para login, a posição na organização e a senha. A pessoa entrará no sistema com esse email e a senha que você definir.
                  </DialogDescription>
                </DialogHeader>
                {createdUserEmail ? (
                  <div className="space-y-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      Usuário <strong>{createdUserEmail}</strong> criado. A pessoa pode entrar no sistema com esse email e a senha que você definiu.
                    </p>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => handleCreateUserDialogOpen(false)}>Fechar</Button>
                      <Button onClick={() => { setCreatedUserEmail(null); setCreateUserForm({ email: "", name: "", role: "sdr", password: "" }); }}>
                        Criar outro usuário
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="create-user-name">Nome</Label>
                        <Input
                          id="create-user-name"
                          value={createUserForm.name}
                          onChange={(e) => setCreateUserForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="Nome completo"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="create-user-email">Email (para login)</Label>
                        <Input
                          id="create-user-email"
                          type="email"
                          value={createUserForm.email}
                          onChange={(e) => setCreateUserForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="email@exemplo.com"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="create-user-role">Posição na organização</Label>
                        <Select
                          value={createUserForm.role}
                          onValueChange={(v) => setCreateUserForm((p) => ({ ...p, role: v as TeamRole }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sdr">SDR</SelectItem>
                            <SelectItem value="closer">Closer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="create-user-password">Senha (para ela entrar no sistema)</Label>
                        <Input
                          id="create-user-password"
                          type="password"
                          value={createUserForm.password}
                          onChange={(e) => setCreateUserForm((p) => ({ ...p, password: e.target.value }))}
                          placeholder="Mínimo 6 caracteres"
                          minLength={6}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => handleCreateUserDialogOpen(false)}>
                        Cancelar
                      </Button>
                      <Button onClick={handleCreateUserSubmit} disabled={createUserLoading}>
                        {createUserLoading ? "Criando..." : "Criar usuário"}
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Total Membros</p>
          <p className="text-xl font-bold">{members.length}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">SDRs Ativos</p>
          <p className="text-xl font-bold text-chart-5">
            {members.filter((m) => m.role === "sdr" && m.is_active).length}
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Closers Ativos</p>
          <p className="text-xl font-bold text-primary">
            {members.filter((m) => m.role === "closer" && m.is_active).length}
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4"
        >
          <p className="text-xs text-muted-foreground mb-1">Folha OTE Total</p>
          <p className="text-xl font-bold text-success">
            {formatCurrency(
              members
                .filter((m) => m.is_active)
                .reduce((sum, m) => sum + Number(m.ote_base || 0) + Number(m.ote_bonus || 0), 0)
            )}
          </p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar membro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Função" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Funções</SelectItem>
            <SelectItem value="sdr">SDR</SelectItem>
            <SelectItem value="closer">Closer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">OTE Base</TableHead>
              <TableHead className="text-right">OTE Bônus</TableHead>
              <TableHead className="text-right">Comissão MRR</TableHead>
              <TableHead className="text-right">Comissão Projeto</TableHead>
              {isAdmin && <TableHead className="w-[50px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filteredMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Nenhum membro encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell>
                    {(member as any).email ? (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {(member as any).email}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">Não configurado</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColors[member.role as TeamRole]}>
                      {roleLabels[member.role as TeamRole]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {member.is_active ? (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                        <UserCheck className="w-3 h-3 mr-1" />
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">
                        <UserX className="w-3 h-3 mr-1" />
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(member.ote_base) || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(member.ote_bonus) || 0)}</TableCell>
                  <TableCell className="text-right">{Number(member.commission_mrr_percent || 0)}%</TableCell>
                  <TableCell className="text-right">{Number(member.commission_projeto_percent || 0)}%</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditDialog(member)}>
                            <Edit2 className="w-4 h-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={removingMemberId === member.id}
                            onClick={() => handleDelete(member.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {removingMemberId === member.id ? "Removendo..." : "Remover"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Permissões por função (apenas admin) */}
      {isAdmin && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <PermissoesEquipe />
        </motion.div>
      )}
    </div>
  );
}
