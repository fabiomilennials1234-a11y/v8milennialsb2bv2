import { memo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  rateLimit: { used: number; remaining: number; limit: number };
  onSend: (question: string) => void;
  onClose: () => void;
}

const suggestions = [
  "Como está meu mês?",
  "Quem precisa de atenção?",
  "Qual produto focar?",
];

function OraculoChatBase({ messages, isLoading, rateLimit, onSend, onClose }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const q = input.trim();
    if (!q || isLoading || rateLimit.remaining <= 0) return;
    onSend(q);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[600px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Oráculo Comercial</h3>
              <p className="text-xs text-muted-foreground">
                {rateLimit.remaining} consulta{rateLimit.remaining !== 1 ? "s" : ""} restante{rateLimit.remaining !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {/* Welcome message */}
          {messages.length === 0 && !isLoading && (
            <div className="space-y-4">
              <div className="bg-muted rounded-2xl rounded-bl-sm p-3">
                <p className="text-sm">
                  Olá! Posso analisar seus dados de vendas, performance da equipe e sugerir estratégias. O que quer saber?
                </p>
              </div>
              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSend(s)}
                    disabled={rateLimit.remaining <= 0}
                    className="text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[85%] p-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                  : "bg-muted rounded-2xl rounded-bl-sm"
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </motion.div>
          ))}

          {/* Loading dots */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm p-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-2 h-2 bg-muted-foreground/40 rounded-full"
                      animate={{ y: [0, -6, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          {rateLimit.remaining <= 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              Você utilizou suas {rateLimit.limit} consultas de hoje. Novas consultas disponíveis amanhã.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte ao Oráculo..."
                className="flex-1 bg-muted rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/50 transition-shadow"
                disabled={isLoading}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export const OraculoChat = memo(OraculoChatBase);
