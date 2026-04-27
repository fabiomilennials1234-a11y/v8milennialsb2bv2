import { MessageSquare, Package, Users, Bot, ExternalLink } from "lucide-react";

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  link: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: "whatsapp", label: "Conectar WhatsApp", description: "Escaneie o QR Code para ativar o chat", icon: MessageSquare, link: "/configuracoes" },
  { key: "produtos", label: "Cadastrar Produtos", description: "Adicione seu catálogo de produtos ou serviços", icon: Package, link: "/produtos" },
  { key: "equipe", label: "Convidar Equipe", description: "Adicione vendedores e defina papéis", icon: Users, link: "/equipe" },
  { key: "copilot", label: "Configurar Copilot IA", description: "Crie um agente de IA para qualificar leads", icon: Bot, link: "/copilot/novo" },
];

interface Props {
  priorities: string[];
  onDefer: () => void;
}

export function StepAtivacao({ priorities, onDefer }: Props) {
  const orderedItems = priorities
    .map((key) => CHECKLIST_ITEMS.find((item) => item.key === key))
    .filter(Boolean) as ChecklistItem[];

  CHECKLIST_ITEMS.forEach((item) => {
    if (!orderedItems.find((o) => o.key === item.key)) {
      orderedItems.push(item);
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Ative sua operação</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Esses passos deixam o sistema pronto para uso. Você pode fazer agora ou voltar depois.
        </p>
      </div>

      <div className="space-y-2">
        {orderedItems.map((item) => (
          <a
            key={item.key}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:border-border hover:bg-muted/30 transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <item.icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>

      <button
        onClick={onDefer}
        className="w-full py-3 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-all"
      >
        Fazer depois — ir para o sistema
      </button>
    </div>
  );
}
