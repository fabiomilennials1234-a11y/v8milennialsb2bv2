import { Check, X, Clock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useDecideApproval, ApprovalRequest, ApprovalStatus } from "@/hooks/useApprovals";

interface ApprovalRequestCardProps {
  request: ApprovalRequest;
  ruleName?: string;
  entityLabel?: string;
}

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  approved: { label: "Aprovado", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rejeitado", className: "bg-red-500/20 text-red-400 border-red-500/30" },
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
    <div className="rounded-lg border border-border/50 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {ruleName ?? `Regra ${request.rule_id.slice(0, 8)}`}
            </span>
            <Badge className={status.className}>{status.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {request.entity_type}: {entityLabel ?? request.entity_id.slice(0, 8)}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
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
            >
              <MessageSquare className="mr-1 h-3 w-3" />
              Comentar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-emerald-500 hover:text-emerald-400 hover:border-emerald-500/50"
              onClick={() => handleDecision("approved")}
              disabled={decide.isPending}
            >
              <Check className="mr-1 h-3 w-3" /> Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-red-500 hover:text-red-400 hover:border-red-500/50"
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
          placeholder="Comentario opcional..."
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
