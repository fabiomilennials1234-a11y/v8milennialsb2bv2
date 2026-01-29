import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, AlertTriangle, CheckCircle2, Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OraculoComercialProps {
  role: "sdr" | "closer";
  metrics: {
    // SDR
    confirmados?: number;
    metaReuniao?: number;
    percentualMeta?: number;
    // Closer
    faturamento?: number;
    metaVendas?: number;
    numeroVendas?: number;
    percentualMetaCloser?: number;
  };
  collapsed?: boolean;
}

interface OraculoResponse {
  problema: string;
  tarefa: string;
}

export function OraculoComercial({ role, metrics, collapsed }: OraculoComercialProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<OraculoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  const now = new Date();
  const diaDoMes = now.getDate();
  const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const diasRestantes = ultimoDia - diaDoMes;

  const fetchOraculo = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = {
        metrics: {
          role,
          confirmados: metrics.confirmados,
          metaReuniao: metrics.metaReuniao,
          percentualMeta: role === "sdr" ? metrics.percentualMeta : metrics.percentualMetaCloser,
          faturamento: metrics.faturamento,
          metaVendas: metrics.metaVendas,
          numeroVendas: metrics.numeroVendas,
          diaDoMes,
          diasRestantes,
        },
      };

      const { data, error: fnError } = await supabase.functions.invoke("oraculo-comercial", {
        body: payload,
      });

      if (fnError) {
        throw fnError;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResponse(data as OraculoResponse);
    } catch (err: any) {
      console.error("Oráculo error:", err);
      const errorMessage = err?.message || "Erro ao consultar o oráculo";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Modo colapsado do sidebar ou minimizado pelo usuário
  if (collapsed || isMinimized) {
    return (
      <button
        onClick={() => {
          if (isMinimized) {
            setIsMinimized(false);
          } else {
            fetchOraculo();
          }
        }}
        disabled={isLoading}
        className="w-full p-2 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors"
        title={isMinimized ? "Expandir Oráculo" : "Oráculo Comercial"}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        ) : (
          <Sparkles className="w-5 h-5 text-purple-400" />
        )}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg p-3 bg-gradient-to-br from-purple-500/20 to-indigo-600/10 border border-purple-500/30"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-semibold text-sidebar-foreground/80">
            Oráculo Comercial
          </span>
        </div>
        <div className="flex items-center gap-1">
          {response && (
            <button
              onClick={fetchOraculo}
              disabled={isLoading}
              className="p-1 hover:bg-purple-500/20 rounded transition-colors"
              title="Atualizar"
            >
              <RefreshCw className={`w-3 h-3 text-purple-400 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          )}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 hover:bg-purple-500/20 rounded transition-colors"
            title="Minimizar"
          >
            <ChevronDown className="w-3 h-3 text-purple-400" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!response && !isLoading && !error && (
          <motion.button
            key="ask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={fetchOraculo}
            className="w-full py-2 px-3 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3 h-3" />
            O que devo focar hoje?
          </motion.button>
        )}

        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center py-3"
          >
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            <span className="text-xs text-sidebar-foreground/60 ml-2">Analisando...</span>
          </motion.div>
        )}

        {error && !isLoading && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-red-400"
          >
            <p>{error}</p>
            <button
              onClick={fetchOraculo}
              className="mt-2 text-purple-400 hover:underline"
            >
              Tentar novamente
            </button>
          </motion.div>
        )}

        {response && !isLoading && (
          <motion.div
            key="response"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            {/* Problema */}
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-sidebar-foreground/70 leading-relaxed">
                {response.problema}
              </p>
            </div>

            {/* Tarefa */}
            <div className="flex items-start gap-2 bg-emerald-500/10 rounded-md p-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-300 font-medium leading-relaxed">
                {response.tarefa}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
