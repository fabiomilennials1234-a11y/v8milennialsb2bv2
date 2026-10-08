import { Check, X, Clock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useDecideApproval, ApprovalRequest, ApprovalStatus } from "@/modules/engagement/hooks/useApprovals";

interface ApprovalRequestCardProps {
  request: ApprovalRequest;
  ruleName?: string;
  entityLabel?: string;
}

// Selo tintado (fundo suave + texto do mesmo matiz), só tokens — vale no escuro.
const STATUS_CONFIG: Record<ApprovalStatus, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-warning/15 text-warning-strong" },
  approved: { label: "Aprovado", className: "bg-success/10 text-success" },
  rejected: { label: "Rejeitado", className: "bg-destructive/10 text-destructive" },
  expired: { label: "Expirado", className: "bg-muted text-muted-foreground" },
};

export function ApprovalRequestCard({ request, ruleName, entityLabel }: ApprovalRequestCardProps) {
  const decide = useDecideApproval();
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  const status = STATUS_CONFIG[request.status];
  const isPending = request.status === "pending";

  function handleDecision(decision: "approved" | "rejected") {
    decide.mutate({
      id: request.id,
      status: decision,
      comment: comment || undefined,
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {ruleName ?? `Regra ${request.rule_id.slice(0, 8)}`}
            </span>
            <Badge variant="soft" className={status.className}>{status.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {request.entity_type}: {entityLabel ?? request.entity_id.slice(0, 8)}
          </p>
          <p className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(request.created_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        {isPending && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setShowComment(!showComment)}
              aria-expanded={showComment}
            >
              <MessageSquare className="mr-1 h-3 w-3" />
              Comentar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-success hover:border-success/40 hover:bg-success/10 hover:text-success"
              onClick={() => handleDecision("approved")}
              disabled={decide.isPending}
            >
              <Check className="mr-1 h-3 w-3" /> Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => handleDecision("rejected")}
              disabled={decide.isPending}
            >
              <X className="mr-1 h-3 w-3" /> Rejeitar
            </Button>
          </div>
        )}
      </div>

      {showComment && isPending && (
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comentário opcional..."
          className="min-h-[60px] resize-none"
        />
      )}

      {request.comment && !isPending && (
        <p className="text-xs text-muted-foreground italic">
          "{request.comment}"
        </p>
      )}
    </div>
  );
}
