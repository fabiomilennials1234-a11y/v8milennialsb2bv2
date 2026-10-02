import { motion, AnimatePresence } from "framer-motion";
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useChecklists } from "@/modules/engagement/hooks/useChecklists";
import { ChecklistCard } from "@/modules/engagement/components/checklists/ChecklistCard";
import { CreateChecklistDialog } from "@/modules/engagement/components/checklists/CreateChecklistDialog";

export default function ChecklistPage() {
  const { data: checklists = [], isLoading } = useChecklists();

  // Sem `p-6`/`max-w-*` próprios: o <main> do layout já dá o respiro da página.
  return (
    <div className="space-y-5">
      <PageHeader
        title="Templates de Checklist"
        subtitle="Crie templates para vincular a leads via card ou automação"
        actions={<CreateChecklistDialog />}
      />

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">Carregando checklists...</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[86px] rounded-card" />
          ))}
        </div>
      ) : checklists.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-1.5 rounded-card border border-card-border bg-card px-6 py-14 text-center shadow-relevo"
        >
          <span className="mb-2 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <ListChecks className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold">Nenhum template ainda</h3>
          <p className="text-[13px] text-muted-foreground">
            Crie seu primeiro template de checklist
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {checklists.map((checklist) => (
              <ChecklistCard key={checklist.id} checklist={checklist} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
