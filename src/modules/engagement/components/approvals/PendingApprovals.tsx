import { Shield, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePendingApprovals } from "@/modules/engagement/hooks/useApprovals";
import { ApprovalRequestCard } from "./ApprovalRequestCard";
import { IconChip } from "@/components/ui/bento";

export function PendingApprovals() {
  const { data: requests = [], isLoading } = usePendingApprovals();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconChip icon={Shield} tone="gold" />
        <h3 className="text-[15px] font-bold tracking-[-0.02em]">Aprovações pendentes</h3>
        {requests.length > 0 && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-warning-strong">
            {requests.length}
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Shield className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Nenhuma aprovação pendente</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <ApprovalRequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
}
