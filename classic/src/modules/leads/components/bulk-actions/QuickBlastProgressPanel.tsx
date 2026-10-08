import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, StopCircle, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useMassSendJobs, useControlMassSend, type UazapiSenderJob } from "@/modules/campaigns";
import { useUserRole } from "@/modules/identity";

const ACTIVE = new Set(["queued", "running", "paused"]);

function isQuickBlast(job: UazapiSenderJob): boolean {
  const track = (job.payload as { trackSource?: string } | null)?.trackSource;
  return track === "quick-blast";
}

/**
 * Floating inline panel showing in-progress Quick Blasts on any board.
 * Realtime progress (sent/total/failed) reused from uazapi_sender_jobs.
 * Pause/resume/stop reuse mass-send-control — admin/master only, since that
 * endpoint is role-gated (Quick Blast firing is not). Members get visibility.
 * Renders nothing when there are no active Quick Blasts.
 */
export function QuickBlastProgressPanel() {
  const { data: jobs = [] } = useMassSendJobs();
  const control = useControlMassSend();
  const { data: roleRow } = useUserRole();
  // useUserRole devolve `team_members.role`, que é o enum `app_role`
  // (admin|sdr|closer|agency|bdr|cliente|member) — o comentário anterior dizia
  // "admin/master/membro" e errava DOIS dos três valores. `master` não é role:
  // é camada à parte (`useMasterAuth`), então `role === "master"` nunca casava
  // e o disjunto era morto. Removido sem mudar quem passa hoje.
  //
  // CONSEQUÊNCIA CONHECIDA (#1541): master que não seja admin naquela org não
  // controla o disparo. Conceder isso é mudança de PERMISSÃO — precisa de
  // `isMaster` e de revisão própria, não entra de carona aqui.
  const role = roleRow?.role;
  const canControl = role === "admin";

  const active = useMemo(
    () => jobs.filter((j) => ACTIVE.has(j.status) && isQuickBlast(j)),
    [jobs],
  );

  if (active.length === 0) return null;

  return (
    // Deslocado do canto: o FloatingDock ocupa `bottom-6 right-6`.
    <div className="fixed bottom-6 right-24 z-40 w-80 max-w-[calc(100vw-6.5rem)] space-y-2">
      <AnimatePresence initial={false}>
        {active.map((job) => {
          const pct = job.total_messages > 0 ? Math.round((job.sent / job.total_messages) * 100) : 0;
          const running = job.status === "running";
          return (
            <motion.div
              key={job.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  Disparo rápido
                </div>
                <Badge variant={job.status === "paused" ? "outline" : "secondary"} className="tabular-nums">
                  {job.status}
                </Badge>
              </div>

              <Progress value={pct} className="h-1.5" />

              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {job.sent}/{job.total_messages} enviadas
                  {job.failed > 0 ? ` · ${job.failed} falhas` : ""}
                </span>

                {canControl && (
                  <div className="flex gap-1">
                    {running ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={control.isPending}
                        aria-label="Pausar"
                        onClick={() => control.mutate({ job_id: job.id, action: "pause" })}
                      >
                        <Pause className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={control.isPending}
                        aria-label="Retomar"
                        onClick={() => control.mutate({ job_id: job.id, action: "resume" })}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      disabled={control.isPending}
                      aria-label="Parar"
                      onClick={() => control.mutate({ job_id: job.id, action: "stop" })}
                    >
                      <StopCircle className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
