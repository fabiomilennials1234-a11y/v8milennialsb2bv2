import { Shield, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePendingApprovals } from "@/hooks/useApprovals";
import { ApprovalRequestCard } from "./ApprovalRequestCard";

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
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-medium">Aprovacoes pendentes</h3>
        {requests.length > 0 && (
          <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
            {requests.length}
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Shield className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma aprovacao pendente</p>
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
