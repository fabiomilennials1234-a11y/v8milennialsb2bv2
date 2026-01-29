import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Play, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { usePipeConfirmacao } from "@/hooks/usePipeConfirmacao";
import { usePipePropostas } from "@/hooks/usePipePropostas";
import { useIndividualGoals } from "@/hooks/useGoals";

interface TeamMemberTask {
  memberId: string;
  memberName: string;
  role: "sdr" | "closer";
  tarefa: string;
  isLoading: boolean;
  error: string | null;
}

export function AICoachSection() {
  const [tasks, setTasks] = useState<TeamMemberTask[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { data: teamMembers } = useTeamMembers();
  const { data: confirmacoes } = usePipeConfirmacao();
  const { data: propostas } = usePipePropostas();
  
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  
  const { data: individualGoals } = useIndividualGoals(currentMonth, currentYear);
  
  const dayOfMonth = now.getDate();
  const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();
  const diasRestantes = lastDayOfMonth - dayOfMonth;

  const fetchTaskForMember = async (member: any) => {
    const role = member.role as "sdr" | "closer";
    
    let metrics: any = { role, diaDoMes: dayOfMonth, diasRestantes };
    
    if (role === "sdr") {
      const sdrConfirmacoes = confirmacoes?.filter(c => 
        c.sdr_id === member.id && 
        c.status === "compareceu" &&
        new Date(c.updated_at).getMonth() + 1 === currentMonth
      ) || [];
      
      const sdrGoal = individualGoals?.sdrGoals?.find(g => g.id === member.id);
      
      metrics.confirmados = sdrConfirmacoes.length;
      metrics.metaReuniao = sdrGoal?.goal || 20;
      metrics.percentualMeta = sdrGoal?.percentage || 0;
    } else {
      const closerSales = propostas?.filter(p => 
        p.closer_id === member.id && 
        p.status === "vendido" &&
        new Date(p.closed_at || "").getMonth() + 1 === currentMonth
      ) || [];
      
      const faturamento = closerSales.reduce((sum, p) => sum + (p.sale_value || 0), 0);
      const closerGoal = individualGoals?.closerGoals?.find(g => g.id === member.id);
      
      metrics.faturamento = faturamento;
      metrics.metaVendas = closerGoal?.goal || 50000;
      metrics.numeroVendas = closerSales.length;
      metrics.percentualMetaCloser = closerGoal?.percentage || 0;
    }

    try {
      const { data, error } = await supabase.functions.invoke("oraculo-comercial", {
        body: { metrics }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return {
        memberId: member.id,
        memberName: member.name,
        role,
        tarefa: data.tarefa || "",
        isLoading: false,
        error: null
      };
    } catch (err: any) {
      return {
        memberId: member.id,
        memberName: member.name,
        role,
        tarefa: "",
        isLoading: false,
        error: err.message || "Erro ao consultar IA"
      };
    }
  };

  const fetchAllTasks = async () => {
    if (!teamMembers) return;
    
    setIsRefreshing(true);
    const activeMembers = teamMembers.filter(m => 
      m.is_active && (m.role === "sdr" || m.role === "closer")
    );

    setTasks(activeMembers.map(m => ({
      memberId: m.id,
      memberName: m.name,
      role: m.role as "sdr" | "closer",
      tarefa: "",
      isLoading: true,
      error: null
    })));

    const results: TeamMemberTask[] = [];
    const batchSize = 3;
    
    for (let i = 0; i < activeMembers.length; i += batchSize) {
      const batch = activeMembers.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(fetchTaskForMember));
      results.push(...batchResults);
      
      setTasks(prev => {
        const updated = [...prev];
        batchResults.forEach(result => {
          const index = updated.findIndex(t => t.memberId === result.memberId);
          if (index !== -1) updated[index] = result;
        });
        return updated;
      });
    }

    setIsRefreshing(false);
  };

  useEffect(() => {
    if (teamMembers && confirmacoes && propostas && individualGoals) {
      fetchAllTasks();
    }
  }, [teamMembers?.length, confirmacoes?.length, propostas?.length]);

  useEffect(() => {
    const interval = setInterval(fetchAllTasks, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [teamMembers, confirmacoes, propostas, individualGoals]);

  const allTasks = [...tasks.filter(t => t.role === "closer"), ...tasks.filter(t => t.role === "sdr")];

  return (
    <div className="space-y-2">
      {allTasks.slice(0, 5).map((task, index) => (
        <TaskCard key={task.memberId} task={task} index={index} />
      ))}
      {allTasks.length === 0 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-white/30" />
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, index }: { task: TeamMemberTask; index: number }) {
  const roleColor = task.role === "closer" ? "text-primary" : "text-amber-400";
  const roleBg = task.role === "closer" ? "bg-primary/10" : "bg-amber-400/10";

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" }}
      className="p-2 rounded-lg bg-white/[0.02] border border-white/5 transition-all"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${roleBg} ${roleColor}`}>
          {task.memberName?.charAt(0)}
        </div>
        <span className="text-xs font-medium text-white/80 flex-1 truncate">{task.memberName}</span>
        <span className={`text-[9px] uppercase tracking-wider ${roleColor}`}>
          {task.role}
        </span>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {task.isLoading ? (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 pl-7"
          >
            <Loader2 className="w-3 h-3 animate-spin text-white/30" />
            <span className="text-[10px] text-white/30">Analisando...</span>
          </motion.div>
        ) : task.error ? (
          <motion.p 
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[10px] text-red-400/60 pl-7"
          >
            Erro ao carregar
          </motion.p>
        ) : (
          <motion.div 
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pl-7"
          >
            <p className="text-[11px] text-white/60 leading-relaxed line-clamp-2">
              {task.tarefa}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
