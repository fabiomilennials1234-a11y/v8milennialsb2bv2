import { Building2, ChevronDown, Check, Loader2, Shield, FlaskConical, LineChart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useOrgSwitcher } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useMasterAuth, MasterOnlineIndicator } from "@/modules/identity";
import { useNavigate } from "react-router-dom";

export function OrgSwitcher() {
  const { orgs, hasMultipleOrgs, isSwitching, switchOrg } = useOrgSwitcher();
  const { organizationId } = useOrganization();
  const { isMaster, isOutbounder } = useMasterAuth();
  const navigate = useNavigate();

  // Só renderiza se o user tem mais de 1 org (master sempre vê)
  if (!hasMultipleOrgs && !isMaster) return null;

  const currentOrg = orgs.find((o) => o.id === organizationId);

  return (
    <div className="flex items-center gap-2">
      {hasMultipleOrgs && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 max-w-[240px]"
              disabled={isSwitching}
            >
              {isSwitching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Building2 className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate text-sm font-medium">
                {currentOrg?.name ?? "Selecionar org..."}
              </span>
              {currentOrg?.name?.includes("[Sandbox]") && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600 gap-0.5">
                  <FlaskConical className="w-2.5 h-2.5" />
                  SANDBOX
                </Badge>
              )}
              {isMaster && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-yellow-500/50 text-yellow-600">
                  SHADOW
                </Badge>
              )}
              <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[220px] max-h-[400px] overflow-y-auto">
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => {
                  if (org.id !== organizationId) {
                    switchOrg(org.id);
                  }
                }}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{org.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {org.name?.includes("[Sandbox]") && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600">
                      SBX
                    </Badge>
                  )}
                  {org.org_type === "outbound" && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      OUT
                    </Badge>
                  )}
                  {org.id === organizationId && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isMaster && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700"
          onClick={() => navigate("/master")}
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">
            {isOutbounder ? "Painel Outbound" : "Master"}
          </span>
        </Button>
      )}

      {isMaster && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-insights/30 text-insights hover:bg-insights/10 hover:text-insights focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={() => navigate("/insights")}
        >
          <LineChart className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Gestor</span>
        </Button>
      )}

      {/* Só o sinal: ping verde + total de usuários ativos na frota. */}
      <MasterOnlineIndicator />
    </div>
  );
}
