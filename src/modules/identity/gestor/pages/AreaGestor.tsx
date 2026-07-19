/**
 * Área do Gestor (`/gestor`) — hub do Gestor de Portfólio (ADR-0021 §5).
 *
 * Substitui a área master para o Gestor: lista as orgs vinculadas como cards.
 * Clicar em uma org seta `selected_org_id` (via `switchOrg`) e entra no app
 * operacional (`/dashboard`) — a mesma mecânica do org-switch do Master.
 * Zero vínculos → empty state (nunca app quebrado).
 *
 * Hub funcional/enxuto: dark-first, padrão do projeto, sem refino visual pesado.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ArrowRight, LifeBuoy, LogOut, LayoutGrid } from "lucide-react";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { Button } from "@/components/ui/button";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useOrgSwitcher } from "../../org-team/hooks/useOrgSwitcher";
import { GestorSupportPanel } from "../components/GestorSupportPanel";

export default function AreaGestor() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { orgs, isLoading, isSwitching, switchOrg } = useOrgSwitcher();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);

  const enterOrg = async (orgId: string) => {
    if (isSwitching) return;
    setEnteringId(orgId);
    await switchOrg(orgId);
    navigate("/dashboard");
  };

  if (isLoading) {
    return <TorqueLoader variant="full" />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <LayoutGrid className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Área do Gestor</h1>
              <p className="text-sm text-muted-foreground">
                Selecione uma organização para operar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSupportOpen(true)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              Suporte
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <GestorSupportPanel open={supportOpen} onOpenChange={setSupportOpen} />

      {/* Conteúdo */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        {orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Nenhuma organização vinculada</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Você ainda não tem organizações sob sua gestão. Peça ao
                administrador da plataforma para vincular as organizações à sua conta.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => signOut()}>
              Sair
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                disabled={isSwitching}
                onClick={() => enterOrg(org.id)}
                className="group flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="w-full">
                  <p className="truncate font-medium">{org.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{org.slug}</p>
                </div>
                <span className="mt-auto inline-flex items-center text-sm font-medium text-primary">
                  {enteringId === org.id && isSwitching ? "Entrando..." : "Entrar"}
                  <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
