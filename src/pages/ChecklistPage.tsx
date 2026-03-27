import { motion, AnimatePresence } from "framer-motion";
import { ListChecks } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { ChecklistCard } from "@/components/checklists/ChecklistCard";
import { CreateChecklistDialog } from "@/components/checklists/CreateChecklistDialog";

export default function ChecklistPage() {
  const { data: checklists = [], isLoading } = useChecklists();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checklists</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Organize suas tarefas em listas de verificação
          </p>
        </div>
        <CreateChecklistDialog />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground mt-2">Carregando checklists...</p>
        </div>
      ) : checklists.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <ListChecks className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">Nenhum checklist ainda</h3>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Crie seu primeiro checklist para organizar suas tarefas
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
