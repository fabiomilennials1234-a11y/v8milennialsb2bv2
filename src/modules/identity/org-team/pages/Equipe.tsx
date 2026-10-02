import { useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Edit2,
  Trash2,
  UserCheck,
  UserX,
  Mail,
  MoreHorizontal,
  UserPlus,
  Users,
  CalendarCheck,
  Handshake,
  Wallet,
  ShieldCheck,
  Gem,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FocusCard, FocusTile, InkPanel, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { PageHeader } from "@/components/ui/page-header";
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
import { useTeamMembers, useUpdateTeamMember, TeamMember } from "../hooks/useTeamMembers";
import { useOrganization } from "../hooks/useOrganization";
import { useIdentity } from "../../auth/hooks/useIdentity";
import { MemberPermissions } from "../components/team/MemberPermissions";
import { ChatRestrictionCard } from "../components/team/ChatRestrictionCard";
import { useProfiles } from "../hooks/useProfiles";
import { useSeatUsage } from "../hooks/useSeatUsage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
type TeamRole = "admin" | "member";

interface TeamMemberFormData {
  name: string;
  email: string;
  role: "admin" | "member";
  job_title: string;
  metric_type: "meetings" | "sales";
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
  role: "member",
  job_title: "",
  metric_type: "meetings",
  ote_base: 0,
  ote_bonus: 0,
  commission_mrr_percent: 1.0,
  commission_projeto_percent: 0.5,
  is_active: true,
  user_id: null,
};

export default function Equipe() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "admin" | "member" | "inactive">("all");
  const [aba, setAba] = useState("membros");
  const avatarMap = useAvatarMap();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState<TeamMemberFormData>(initialFormData);

  const [isCreateUserDialogOpen, setIsCreateUserDialogOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ email: "", name: "", role: "member" as TeamRole, job_title: "", metric_type: "meetings" as "meetings" | "sales", password: "" });
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const [createdUserEmail, setCreatedUserEmail] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const { data: members = [], isLoading } = useTeamMembers();
  const updateMember = useUpdateTeamMember();
  const { organizationId } = useOrganization();
  const { isAdmin, isMaster } = useIdentity();
  const queryClient = useQueryClient();
  const { data: seatUsage } = useSeatUsage(organizationId ?? undefined);

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
    const matchesRole =
      filterRole === "all" ||
      (filterRole === "inactive" ? !member.is_active : filterRole === "admin" ? member.role === "admin" : member.role !== "admin");
    return matchesSearch && matchesRole;
  });

  const { data: allProfiles = [] } = useProfiles();
  // Filtrar profiles para mostrar apenas usuários da mesma organização
  const orgUserIds = new Set(members.filter(m => m.user_id).map(m => m.user_id));
  const profiles = allProfiles.filter(p => orgUserIds.has(p.id));

  const handleOpenEditDialog = (member: TeamMember) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      email: (member as any).email || "",
      role: (member.role === "admin" ? "admin" : "member") as TeamRole,
      job_title: (member as any).job_title || "",
      metric_type: ((member as any).metric_type as "meetings" | "sales") || "meetings",
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
      // Sanitizar valores numéricos para evitar NaN no banco
      const sanitizedData = {
        ...formData,
        ote_base: isNaN(formData.ote_base) ? 0 : formData.ote_base,
        ote_bonus: isNaN(formData.ote_bonus) ? 0 : formData.ote_bonus,
        commission_mrr_percent: isNaN(formData.commission_mrr_percent) ? 1.0 : formData.commission_mrr_percent,
        commission_projeto_percent: isNaN(formData.commission_projeto_percent) ? 0.5 : formData.commission_projeto_percent,
      };
      await updateMember.mutateAsync({
        id: editingMember.id,
        ...sanitizedData,
        role: sanitizedData.role as any,
      });
      // Sincronizar user_roles para que RLS e UI vejam a role correta (admin/member)
      // GUARD: só sincroniza se o membro editado tem user_id e a role mudou
      if (editingMember.user_id && formData.role !== editingMember.role) {
        const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", editingMember.user_id);
        if (delErr) {
          console.warn("[Equipe] Erro ao remover user_roles:", delErr.message);
        }
        const { error: insertErr } = await supabase.from("user_roles").insert({
          user_id: editingMember.user_id,
          role: formData.role as any,
        });
        if (insertErr && !String(insertErr.message).toLowerCase().includes("duplicate")) {
          console.warn("[Equipe] Sync user_roles:", insertErr.message);
        }
        queryClient.invalidateQueries({ queryKey: ["user_role"] });
      }
      toast.success("Membro atualizado com sucesso!");
      setIsDialogOpen(false);
      setEditingMember(null);
    } catch (error: any) {
      const msg = error?.message || "";
      const msgLower = msg.toLowerCase();
      if (msgLower.includes("new row violates") || msgLower.includes("permission") || msgLower.includes("policy")) {
        toast.error("Sem permissão para editar. Verifique se você é admin.");
      } else if (msgLower.includes("row not found") || msgLower.includes("0 rows") || msgLower.includes("json object requested") || msgLower.includes("não foi possível atualizar")) {
        toast.error("Não foi possível atualizar. Verifique suas permissões de admin.");
      } else {
        toast.error("Erro ao salvar membro: " + (msg || "erro desconhecido"));
      }
      console.error("[Equipe] handleSubmitEdit error:", error);
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
      queryClient.invalidateQueries({ queryKey: ["seat-usage"] });
    } catch (error) {
      toast.error("Erro ao remover membro. Tente novamente.");
      console.error(error);
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleCreateUserSubmit = async () => {
    const { email, name, role, job_title, metric_type, password } = createUserForm;
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
        job_title: job_title.trim(),
        metric_type,
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
      queryClient.invalidateQueries({ queryKey: ["seat-usage"] });
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
      setCreateUserForm({ email: "", name: "", role: "member", job_title: "", metric_type: "meetings", password: "" });
      setCreatedUserEmail(null);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: "Administrador",
    member: "Membro",
  };

  const activeMembers = members.filter((m) => m.is_active);
  const meetingsCount = activeMembers.filter((m) => (m as any).metric_type === "meetings").length;
  const salesCount = activeMembers.filter((m) => (m as any).metric_type === "sales").length;
  const oteTotal = activeMembers.reduce(
    (sum, m) => sum + Number(m.ote_base || 0) + Number(m.ote_bonus || 0),
    0,
  );

  // V5: a lista virou fileira de chips (Todos · Administradores · Membros ·
  // Inativos) — mesma filtragem, agora com a contagem à vista.
  const contagemFiltro = {
    all: members.length,
    admin: members.filter((m) => m.role === "admin").length,
    member: members.filter((m) => m.role !== "admin").length,
    inactive: members.filter((m) => !m.is_active).length,
  };
  const preVenda = activeMembers.filter((m) => m.metric_type === "meetings");
  const venda = activeMembers.filter((m) => m.metric_type === "sales");
  const admins = activeMembers.filter((m) => m.role === "admin");
  const inativos = members.filter((m) => !m.is_active).length;
  const podeVerPermissoes = isAdmin || isMaster;

  const copiarId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success("ID copiado — use no round robin do n8n.");
    } catch {
      toast.error("Não foi possível copiar o ID.");
    }
  };

  const membros = (
    <div className="space-y-5">
      {seatUsage && !seatUsage.can_add && (
        <p className="text-xs text-destructive">
          Limite de seats atingido. Faça upgrade para adicionar mais membros.
        </p>
      )}

      {/* Stats — os mesmos números de antes; os assentos entram no 1º tile
          (a faixa solta de assentos saiu). */}
      <KpiRow cols={4}>
        <KpiTile
          label="Pessoas na equipe"
          value={
            seatUsage && !seatUsage.is_unlimited ? (
              <>
                {seatUsage.active_members}
                <ValueUnit>de {seatUsage.paid_seats}</ValueUnit>
              </>
            ) : (
              members.length
            )
          }
          icon={Users}
          tone="gold"
          note={
            seatUsage
              ? seatUsage.is_unlimited
                ? `${members.length} membros · assentos ilimitados`
                : `${seatUsage.remaining} ${seatUsage.remaining === 1 ? "assento livre" : "assentos livres"} no ${seatUsage.plan_name}`
              : `${members.length} membros`
          }
        >
          {seatUsage && !seatUsage.is_unlimited && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn("h-full rounded-full", seatUsage.can_add ? "bg-primary" : "bg-destructive")}
                style={{ width: `${Math.min(100, seatUsage.paid_seats > 0 ? (seatUsage.active_members / seatUsage.paid_seats) * 100 : 100)}%` }}
              />
            </div>
          )}
        </KpiTile>
        <KpiTile
          label="Reuniões"
          value={meetingsCount}
          icon={CalendarCheck}
          tone="info"
          note="Membros ativos · pré-venda"
        />
        <KpiTile
          label="Vendas"
          value={salesCount}
          icon={Handshake}
          tone="gold"
          note="Membros ativos · venda"
        />
        <KpiTile
          label="OTE mensal do time"
          value={formatCurrency(oteTotal)}
          icon={Wallet}
          tone="good"
          note="Base + bônus dos ativos"
        >
          <Button variant="ink" size="sm" className="h-8" asChild>
            <Link to="/comissoes">Ver comissões</Link>
          </Button>
        </KpiTile>
      </KpiRow>

      {/* Herói: a estrutura do time comercial (pré-venda × venda × gestão) e
          os assentos do plano no cartão de ouro. */}
      <InkPanel
        title="Estrutura comercial"
        count={`${activeMembers.length} ${activeMembers.length === 1 ? "piloto ativo" : "pilotos ativos"}`}
        actions={
          <span className="hidden text-[11.5px] text-tinta-muted md:inline">
            Cargo é rótulo; a função (Administrador ou Membro) é o que dá acesso
          </span>
        }
      >
        <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <GrupoComercial
                indice={1}
                titulo="Pré-venda"
                sub="métrica: reuniões"
                icon={CalendarCheck}
                pessoas={preVenda}
                avatarDe={(id) => avatarMap.get(id)}
              />
              <GrupoComercial
                indice={2}
                titulo="Venda"
                sub="métrica: vendas"
                icon={Handshake}
                pessoas={venda}
                avatarDe={(id) => avatarMap.get(id)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-[22px] border border-tinta-line bg-tinta-2 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10" aria-hidden>
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold">Gestão</p>
                <p className="text-[11.5px] text-tinta-muted">Administradores da organização</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {admins.length === 0 ? (
                  <span className="text-[12px] text-tinta-muted">Nenhum administrador ativo</span>
                ) : (
                  admins.slice(0, 4).map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-2 text-[13px] font-semibold">
                      <UserAvatar name={a.name} avatarUrl={avatarMap.get(a.id)} size="xs" className="h-7 w-7" fallbackClassName="bg-white/10 text-tinta-foreground" />
                      {a.name}
                    </span>
                  ))
                )}
                {admins.length > 4 && <span className="text-[12px] text-tinta-muted">+{admins.length - 4}</span>}
              </div>
            </div>
          </div>

          <FocusCard className="order-1 gap-3.5 lg:order-2">
            <Badge variant="ink" className="w-fit gap-1">
              <Gem className="h-3 w-3" />
              {seatUsage ? `Assentos do plano ${seatUsage.plan_name}` : "Assentos do plano"}
            </Badge>
            {seatUsage ? (
              seatUsage.is_unlimited ? (
                <p className="text-[2.6rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
                  {seatUsage.active_members}
                  <span className="ml-2 text-[13px] font-bold tracking-normal text-primary-foreground/70">em uso · ilimitado</span>
                </p>
              ) : (
                <>
                  <p className="text-[2.6rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
                    {seatUsage.active_members}
                    <span className="text-[1.5rem] text-primary-foreground/60">/{seatUsage.paid_seats}</span>
                    <span className="ml-2 text-[13px] font-bold tracking-normal text-primary-foreground/70">em uso</span>
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-primary-foreground/15" aria-hidden>
                    <div
                      className="h-full rounded-full bg-tinta"
                      style={{ width: `${Math.min(100, seatUsage.paid_seats > 0 ? (seatUsage.active_members / seatUsage.paid_seats) * 100 : 100)}%` }}
                    />
                  </div>
                </>
              )
            ) : (
              <p className="text-[13px] text-primary-foreground/70">Carregando os assentos…</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <FocusTile>
                <p className="text-[1.1rem] font-extrabold tabular-nums">{inativos}</p>
                <p className="text-[11px] font-semibold text-primary-foreground/70">
                  {inativos === 1 ? "inativo" : "inativos"} (não ocupa assento)
                </p>
              </FocusTile>
              <FocusTile>
                <p className="text-[1.1rem] font-extrabold tabular-nums">
                  {seatUsage ? (seatUsage.is_unlimited ? "∞" : seatUsage.remaining) : "—"}
                </p>
                <p className="text-[11px] font-semibold text-primary-foreground/70">assentos livres</p>
              </FocusTile>
            </div>
            {isAdmin && (
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  disabled={seatUsage ? !seatUsage.can_add : false}
                  onClick={() => handleCreateUserDialogOpen(true)}
                  className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                >
                  <UserPlus />
                  Criar usuário
                </Button>
                <Button
                  variant="outline"
                  asChild
                  className="border-transparent bg-[hsl(40_60%_8%/.1)] text-primary-foreground shadow-none hover:bg-[hsl(40_60%_8%/.16)]"
                >
                  <Link to="/configuracoes/outros?tab=billing">Ver plano</Link>
                </Button>
              </div>
            )}
          </FocusCard>
        </div>
      </InkPanel>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/60 p-4 lg:flex-row lg:items-center">
          <div role="group" aria-label="Função" className="-mx-1 flex gap-2 overflow-x-auto px-1 scrollbar-hide">
            {([
              ["all", "Todos"],
              ["admin", "Administradores"],
              ["member", "Membros"],
              ["inactive", "Inativos"],
            ] as const).map(([valor, rotulo]) => {
              const ativo = filterRole === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setFilterRole(valor)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    ativo
                      ? "bg-tinta text-tinta-foreground dark:bg-foreground dark:text-background"
                      : "border border-input bg-card text-foreground/80 hover:text-foreground",
                  )}
                >
                  {rotulo}
                  <span
                    className={cn(
                      "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                      ativo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {contagemFiltro[valor]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative lg:ml-auto lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar membro..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-full pl-9"
            />
          </div>
        </div>
        <Table className="min-w-[1120px] [&_td]:px-3 [&_th]:whitespace-nowrap [&_th]:px-3">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">OTE Base</TableHead>
              <TableHead className="text-right">OTE Bônus</TableHead>
              <TableHead className="text-right">Com. rec.</TableHead>
              <TableHead className="text-right">Com. projeto</TableHead>
              <TableHead>Métrica</TableHead>
              {isAdmin && <TableHead className="w-[50px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filteredMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  Nenhum membro encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredMembers.map((member) => (
                <TableRow key={member.id} className={cn(!member.is_active && "text-muted-foreground")}>
                  <TableCell className="whitespace-nowrap py-3 pl-5">
                    <span className="flex items-center gap-3">
                      <UserAvatar
                        name={member.name}
                        avatarUrl={avatarMap.get(member.id)}
                        size="sm"
                        className={cn(!member.is_active && "opacity-60")}
                        fallbackClassName="bg-muted text-foreground"
                      />
                      <span className="font-semibold">{member.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {member.email ? (
                      <span className="block max-w-[220px] truncate text-sm text-muted-foreground" title={member.email}>{member.email}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">Não configurado</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.role === "admin" ? (
                      <Badge variant="ink" className="gap-1 whitespace-nowrap">
                        <ShieldCheck className="h-3 w-3" />
                        {roleLabels.admin}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="whitespace-nowrap">
                        {roleLabels[member.role] || member.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {member.job_title || <span className="text-xs text-muted-foreground/50 italic">-</span>}
                  </TableCell>
                  <TableCell>
                    {member.is_active ? (
                      <Badge variant="success">
                        <UserCheck className="w-3 h-3 mr-1" />
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="soft" className="text-muted-foreground">
                        <UserX className="w-3 h-3 mr-1" />
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(Number(member.ote_base) || 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(Number(member.ote_bonus) || 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(member.commission_mrr_percent || 0)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(member.commission_projeto_percent || 0)}%</TableCell>
                  <TableCell>
                    {member.metric_type ? (
                      <Badge variant={member.metric_type === "meetings" ? "info" : "gold"} className="gap-1 whitespace-nowrap">
                        {member.metric_type === "meetings" ? <CalendarCheck className="h-3 w-3" /> : <Handshake className="h-3 w-3" />}
                        {member.metric_type === "meetings" ? "Reuniões" : "Vendas"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações de ${member.name}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditDialog(member)}>
                            <Edit2 className="w-4 h-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          {/* O ID saiu da tabela (era uma coluna de UUID); continua
                              à mão para o round robin do n8n. */}
                          <DropdownMenuItem onClick={() => copiarId(member.id)}>
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar ID do piloto
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3 text-[12px] text-muted-foreground">
          <span>
            Mostrando {filteredMembers.length} de {members.length} {members.length === 1 ? "pessoa" : "pessoas"}
          </span>
          <span>Com. rec. = comissão sobre recorrência · Com. projeto = comissão sobre setup e serviços</span>
        </div>
      </Card>
    </div>
  );

  return (
    <Tabs value={aba} onValueChange={setAba} className="space-y-5">
      <PageHeader
        title="Equipe"
        subtitle="Gerencie membros da equipe e suas permissões"
        actions={
          isAdmin && (
              <Dialog open={isCreateUserDialogOpen} onOpenChange={handleCreateUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={seatUsage ? !seatUsage.can_add : false}>
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
                        <Button onClick={() => { setCreatedUserEmail(null); setCreateUserForm({ email: "", name: "", role: "member", job_title: "", metric_type: "meetings", password: "" }); }}>
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
                          <Label htmlFor="create-user-role">Função</Label>
                          <Select
                            value={createUserForm.role}
                            onValueChange={(v) => setCreateUserForm((p) => ({ ...p, role: v as TeamRole }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Administrador</SelectItem>
                              <SelectItem value="member">Membro</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="create-user-job-title">Cargo</Label>
                          <Input
                            id="create-user-job-title"
                            value={createUserForm.job_title}
                            onChange={(e) => setCreateUserForm((p) => ({ ...p, job_title: e.target.value }))}
                            placeholder="Ex: Vendedor, Representante"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="create-user-metric-type">Tipo de Métrica</Label>
                          <Select
                            value={createUserForm.metric_type}
                            onValueChange={(v) => setCreateUserForm((p) => ({ ...p, metric_type: v as "meetings" | "sales" }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="meetings">Reuniões</SelectItem>
                              <SelectItem value="sales">Vendas</SelectItem>
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
          )
        }
        tabs={
          podeVerPermissoes ? (
            <TabsList variant="pill" aria-label="Seções da equipe">
              <TabsTrigger value="membros">
                <Users className="h-3.5 w-3.5" />
                Membros
                <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-bold tabular-nums [[data-state=active]>&]:bg-primary-foreground/15">
                  {members.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="permissoes">
                <ShieldCheck className="h-3.5 w-3.5" />
                Permissões
              </TabsTrigger>
            </TabsList>
          ) : undefined
        }
      />

      <TabsContent value="membros" className="mt-0">
        {membros}
      </TabsContent>

      {podeVerPermissoes && (
        <TabsContent value="permissoes" className="mt-0 space-y-5">
          {/* Política da organização (isolamento por responsável) primeiro: é o
              que governa TODO membro, inclusive quem ainda vai ser contratado. */}
          <ChatRestrictionCard />
          {isAdmin && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <MemberPermissions />
            </motion.div>
          )}
        </TabsContent>
      )}

      {isAdmin && (
              <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              if (!open) setEditingMember(null);
              setIsDialogOpen(open);
            }}
          >
            <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Editar Membro</DialogTitle>
                <DialogDescription>
                  Ajuste as informações do membro da equipe (OTE, comissões, Cal.com, etc.)
                </DialogDescription>
              </DialogHeader>
            <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-1">
              <div className="grid gap-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
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
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
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
                  onValueChange={(value: TeamRole) => setFormData(prev => ({ ...prev, role: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="member">Membro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="job_title">Cargo</Label>
                <Input
                  id="job_title"
                  value={formData.job_title}
                  onChange={(e) => setFormData(prev => ({ ...prev, job_title: e.target.value }))}
                  placeholder="Ex: Vendedor, Representante"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="metric_type">Tipo de Métrica</Label>
                <Select
                  value={formData.metric_type}
                  onValueChange={(value: "meetings" | "sales") => setFormData(prev => ({ ...prev, metric_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meetings">Reuniões</SelectItem>
                    <SelectItem value="sales">Vendas</SelectItem>
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
                    step="0.01"
                    value={formData.ote_base}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, ote_base: isNaN(val) ? 0 : val }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ote_bonus">OTE Bônus (R$)</Label>
                  <Input
                    id="ote_bonus"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.ote_bonus}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, ote_bonus: isNaN(val) ? 0 : val }));
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="commission_mrr">Comissão Rec. (%)</Label>
                  <Input
                    id="commission_mrr"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.commission_mrr_percent}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, commission_mrr_percent: isNaN(val) ? 0 : val }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="commission_projeto">Comissão Projeto (%)</Label>
                  <Input
                    id="commission_projeto"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.commission_projeto_percent}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, commission_projeto_percent: isNaN(val) ? 0 : val }));
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="user_id">Vincular ao Usuário</Label>
                <Select
                  value={formData.user_id || "none"}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, user_id: value === "none" ? null : value }))}
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
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                />
              </div>
            </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmitEdit}
                  disabled={updateMember.isPending}
                >
                  {updateMember.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      )}
    </Tabs>
  );
}

/** Um grupo do time comercial (Pré-venda / Venda), no vidro da tinta. */
function GrupoComercial({
  indice,
  titulo,
  sub,
  icon: Icon,
  pessoas,
  avatarDe,
}: {
  indice: number;
  titulo: string;
  sub: string;
  icon: LucideIcon;
  pessoas: TeamMember[];
  avatarDe: (id: string) => string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[22px] border border-tinta-line bg-tinta-2 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold">
            <span className="mr-1.5 text-tinta-muted tabular-nums">{indice}</span>
            {titulo}
          </p>
          <p className="truncate text-[11.5px] text-tinta-muted">{sub}</p>
        </div>
      </div>
      <p className="text-[2.1rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
        {pessoas.length}
        <span className="ml-1.5 text-[12px] font-semibold tracking-normal text-tinta-muted">
          {pessoas.length === 1 ? "pessoa ativa" : "pessoas ativas"}
        </span>
      </p>
      <div className="mt-auto flex items-center gap-2">
        <div className="flex -space-x-2">
          {pessoas.slice(0, 5).map((p) => (
            <UserAvatar
              key={p.id}
              name={p.name}
              avatarUrl={avatarDe(p.id)}
              size="xs"
              className="h-7 w-7 ring-2 ring-tinta-2"
              fallbackClassName="bg-white/10 text-tinta-foreground"
            />
          ))}
        </div>
        {pessoas.length > 5 && <span className="text-[11.5px] text-tinta-muted">+{pessoas.length - 5}</span>}
        <span className="ml-auto truncate text-[11.5px] text-tinta-muted">
          {pessoas
            .slice(0, 3)
            .map((p) => p.job_title || p.name.split(" ")[0])
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}
