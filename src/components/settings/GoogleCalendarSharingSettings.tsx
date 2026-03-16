/**
 * Configurações de compartilhamento do Google Calendar
 *
 * Exibido abaixo das configurações de conexão quando o usuário
 * já tem o Google Calendar conectado.
 *
 * Permite:
 *  - Compartilhar o próprio calendário com colegas da org
 *  - Controlar se o colega pode só ver ou também criar eventos
 *  - Revogar compartilhamentos existentes
 *  - Ver calendários que outros compartilharam com você
 */

import { useState } from "react";
import {
  Users,
  UserPlus,
  Eye,
  PenLine,
  X,
  ChevronDown,
  Calendar,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useCalendarSharing,
  useShareCalendar,
  useUpdateCalendarShare,
  useRevokeCalendarShare,
  type OutgoingShare,
  type IncomingShare,
} from "@/hooks/useGoogleCalendarSharing";

const ROLE_LABELS: Record<string, string> = {
  admin:   "Admin",
  sdr:     "Vendedor",
  closer:  "Vendedor",
  bdr:     "BDR",
  agency:  "Agência",
  cliente: "Cliente",
  master:  "Master",
};

function roleBadgeVariant(role: string) {
  const map: Record<string, "default" | "secondary" | "outline"> = {
    admin:  "default",
    master: "default",
    closer: "secondary",
    sdr:    "outline",
  };
  return map[role] ?? "outline";
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SharedWithRow({ share, onUpdatePermission, onRevoke }: {
  share: OutgoingShare;
  onUpdatePermission: (viewerId: string, canCreate: boolean) => void;
  onRevoke: (viewerId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-xs font-medium text-primary">
            {share.viewer?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{share.viewer?.name ?? "Usuário"}</p>
          <p className="text-xs text-muted-foreground truncate">{share.viewer?.email}</p>
        </div>
        <Badge variant={roleBadgeVariant(share.viewer?.role ?? "")} className="text-xs shrink-0">
          {ROLE_LABELS[share.viewer?.role ?? ""] ?? share.viewer?.role}
        </Badge>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          {share.can_create_events ? (
            <PenLine className="w-3 h-3 text-primary" />
          ) : (
            <Eye className="w-3 h-3 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground hidden sm:block">
            {share.can_create_events ? "Pode criar" : "Só visualizar"}
          </span>
          <Switch
            checked={share.can_create_events}
            onCheckedChange={(checked) =>
              onUpdatePermission(share.viewer_id, checked)
            }
            className="scale-75"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRevoke(share.viewer_id)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SharedByRow({ share }: { share: IncomingShare }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30">
      <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
        <Calendar className="w-4 h-4 text-success" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{share.owner?.name ?? "Usuário"}</p>
        <p className="text-xs text-muted-foreground truncate">{share.owner?.email}</p>
      </div>
      <Badge variant="secondary" className="text-xs shrink-0">
        {share.can_create_events ? "Você pode criar" : "Só visualizar"}
      </Badge>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export function GoogleCalendarSharingSettings() {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [canCreate, setCanCreate]           = useState(false);
  const [outgoingOpen, setOutgoingOpen]     = useState(true);
  const [incomingOpen, setIncomingOpen]     = useState(true);

  const { data, isLoading } = useCalendarSharing();
  const shareMutation  = useShareCalendar();
  const updateMutation = useUpdateCalendarShare();
  const revokeMutation = useRevokeCalendarShare();

  const handleShare = () => {
    if (!selectedUserId) return;
    shareMutation.mutate(
      { viewerId: selectedUserId, canCreateEvents: canCreate },
      {
        onSuccess: () => {
          setSelectedUserId("");
          setCanCreate(false);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="mt-6 pt-6 border-t animate-pulse">
        <div className="h-4 bg-muted rounded w-48 mb-4" />
        <div className="space-y-2">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    );
  }

  const { outgoing = [], incoming = [], available_members = [] } = data ?? {};

  return (
    <div className="mt-6 pt-6 border-t space-y-5">
      <div className="flex items-center gap-2">
        <Share2 className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold">Compartilhamento de Calendário</h4>
      </div>

      {/* Adicionar compartilhamento */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Compartilhe seu calendário com colegas da organização para que possam ver
          sua disponibilidade.
        </p>

        <div className="flex gap-2">
          <Select
            value={selectedUserId}
            onValueChange={setSelectedUserId}
            disabled={available_members.length === 0}
          >
            <SelectTrigger className="flex-1 text-sm h-9">
              <SelectValue
                placeholder={
                  available_members.length === 0
                    ? "Todos os membros já têm acesso"
                    : "Selecionar colega..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available_members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <span className="flex items-center gap-2">
                    <span>{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            onClick={handleShare}
            disabled={!selectedUserId || shareMutation.isPending}
            className="gap-1.5 h-9"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Compartilhar
          </Button>
        </div>

        {selectedUserId && (
          <div className="flex items-center gap-2 px-1">
            <Switch
              id="can-create"
              checked={canCreate}
              onCheckedChange={setCanCreate}
              className="scale-90"
            />
            <Label htmlFor="can-create" className="text-xs cursor-pointer">
              Permitir que este colega crie eventos no meu calendário
            </Label>
          </div>
        )}
      </div>

      {/* Compartilhamentos ativos (outgoing) */}
      {outgoing.length > 0 && (
        <Collapsible open={outgoingOpen} onOpenChange={setOutgoingOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Compartilhado com ({outgoing.length})
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${outgoingOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            {outgoing.map((share) => (
              <SharedWithRow
                key={share.viewer_id}
                share={share}
                onUpdatePermission={(viewerId, canCreateEvents) =>
                  updateMutation.mutate({ viewerId, canCreateEvents })
                }
                onRevoke={(viewerId) => revokeMutation.mutate(viewerId)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Calendários compartilhados comigo (incoming) */}
      {incoming.length > 0 && (
        <Collapsible open={incomingOpen} onOpenChange={setIncomingOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Calendários compartilhados comigo ({incoming.length})
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${incomingOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            {incoming.map((share) => (
              <SharedByRow key={share.owner_id} share={share} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Nenhum compartilhamento ativo.
        </p>
      )}
    </div>
  );
}
