import { motion } from "framer-motion";
import { Handshake, Search, RefreshCw, FileText, Lock } from "lucide-react";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";

export type CampaignTemplateType = "indicacao" | "prospeccao" | "reativacao" | "livre";

interface Template {
  type: CampaignTemplateType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  borderColor: string;
  stagesCount: number;
  featureKey: string;
}

const TEMPLATES: Template[] = [
  {
    type: "indicacao",
    label: "Indicação",
    description: "Ative sua rede de clientes e parceiros para gerar novos leads",
    icon: Handshake,
    color: "text-orange-500",
    borderColor: "border-orange-500/20 hover:border-orange-500/40",
    stagesCount: 4,
    featureKey: "campaigns_indicacao",
  },
  {
    type: "prospeccao",
    label: "Prospecção",
    description: "Importe listas externas e trabalhe prospecção ativa",
    icon: Search,
    color: "text-blue-500",
    borderColor: "border-blue-500/20 hover:border-blue-500/40",
    stagesCount: 5,
    featureKey: "campaigns_prospeccao",
  },
  {
    type: "reativacao",
    label: "Reativação",
    description: "Recupere clientes inativos e oportunidades perdidas",
    icon: RefreshCw,
    color: "text-purple-500",
    borderColor: "border-purple-500/20 hover:border-purple-500/40",
    stagesCount: 4,
    featureKey: "campaigns_reativacao",
  },
  {
    type: "livre",
    label: "Campanha livre",
    description: "Comece do zero com stages personalizados",
    icon: FileText,
    color: "text-muted-foreground",
    borderColor: "border-border hover:border-primary/30",
    stagesCount: 3,
    featureKey: "",
  },
];

interface Props {
  onSelect: (type: CampaignTemplateType) => void;
}

export function CampaignTemplateSelector({ onSelect }: Props) {
  const { hasFeature } = useOrgFeatures();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Escolha um template como ponto de partida. Você poderá editar tudo antes de confirmar.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TEMPLATES.map((t, i) => {
          const Icon = t.icon;
          const locked = t.featureKey && !hasFeature(t.featureKey as any);

          return (
            <motion.button
              key={t.type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => !locked && onSelect(t.type)}
              disabled={locked}
              className={`relative p-4 rounded-lg border text-left transition-colors ${t.borderColor} ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {locked && (
                <div className="absolute top-3 right-3">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <Icon className={`w-6 h-6 ${t.color} mb-2`} />
              <p className="font-semibold text-sm">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
              <p className="text-xs text-muted-foreground mt-2">{t.stagesCount} stages sugeridos</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function getTemplateStages(type: CampaignTemplateType): string[] {
  switch (type) {
    case "indicacao": return ["Indicado", "Contatado", "Qualificado", "Convertido"];
    case "prospeccao": return ["Importado", "Pesquisado", "Abordado", "Respondeu", "Qualificado"];
    case "reativacao": return ["Selecionado", "Abordado", "Reengajado", "Reativado"];
    case "livre": return ["Novo", "Em andamento", "Concluído"];
  }
}
