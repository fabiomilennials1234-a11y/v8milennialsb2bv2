import { memo, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2, Edit2, Check, X, Loader2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useDeleteLeadComment, useUpdateLeadComment } from "../../hooks/useLeadComments";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useIsAdmin } from "@/hooks/useUserRole";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { LeadCommentWithAuthor } from "../types";

interface CommentItemProps {
  comment: LeadCommentWithAuthor;
  leadId: string;
  /** Quando true, scrolla pra esse comentário no mount e aplica pulse 2s. */
  highlight?: boolean;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function colorFromName(name: string): string {
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

export const CommentItem = memo(function CommentItem({ comment, leadId, highlight }: CommentItemProps) {
  const { user } = useAuth();
  const { isMaster } = useMasterAuth();
  const { isAdmin } = useIsAdmin();
  const remove = useDeleteLeadComment();
  const edit = useUpdateLeadComment();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!highlight) return;
    setPulsing(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => setPulsing(false), 2000);
    return () => clearTimeout(timeout);
  }, [highlight]);

  const isAuthor = comment.author_user_id === user?.id;
  const canEdit = isAuthor;
  const canDelete = isAuthor || isAdmin || isMaster;
  const isDeleted = !!comment.deleted_at;

  const authorName = comment.author?.name ?? "Usuário";
  const avatarUrl = comment.author?.avatar_url;

  const handleSaveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await edit.mutateAsync({ commentId: comment.id, leadId, body: trimmed });
      toast.success("Comentário atualizado");
      setEditing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast.error(msg);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Apagar este comentário?")) return;
    try {
      await remove.mutateAsync({ commentId: comment.id, leadId });
      toast.success("Comentário apagado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao apagar";
      toast.error(msg);
    }
  };

  if (isDeleted) {
    return (
      <div
        ref={rootRef}
        data-comment-id={comment.id}
        className={cn(
          "flex gap-3 opacity-50 italic rounded-md transition-shadow",
          pulsing && "animate-pulse ring-2 ring-primary/40 ring-offset-2 ring-offset-card",
        )}
      >
        <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
        <div className="flex-1 text-xs text-muted-foreground">
          Comentário apagado · {formatDistanceToNow(new Date(comment.deleted_at!), { addSuffix: true, locale: ptBR })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-comment-id={comment.id}
      className={cn(
        "flex gap-3 rounded-md transition-shadow",
        pulsing && "animate-pulse ring-2 ring-primary/40 ring-offset-2 ring-offset-card",
      )}>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
        style={!avatarUrl ? { backgroundColor: colorFromName(authorName) } : undefined}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={authorName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold text-white">{initials(authorName)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-foreground">{authorName}</span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR })}
            {comment.updated_at && " · editado"}
          </span>
          {(canEdit || canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-auto text-muted-foreground/40 hover:text-foreground p-0.5 rounded transition-colors"
                  aria-label="Opções do comentário"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Edit2 className="w-3.5 h-3.5 mr-2" /> Editar
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Apagar
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              className="text-sm resize-none"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleSaveEdit} disabled={edit.isPending}>
                {edit.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(false);
                }}
              >
                <X className="w-3 h-3 mr-1" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-lg bg-muted/30 border border-border/20 px-3 py-2 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words"
            )}
          >
            {comment.body}
          </div>
        )}
      </div>
    </div>
  );
});
