import { OnboardingQuestion } from "../OnboardingQuestion";
import { Factory, Building2, Briefcase, Monitor, BookOpen, Megaphone, GraduationCap, HelpCircle } from "lucide-react";

interface Props {
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function StepPerfilOperacao({ answers, onChange }: Props) {
  return (
    <div className="space-y-8">
      <OnboardingQuestion
        title="O que você vende?"
        type="single"
        value={answers.sells as string}
        onChange={(v) => onChange("sells", v)}
        options={[
          { value: "produto", label: "Produto físico", description: "Bens tangíveis, mercadorias, equipamentos" },
          { value: "servico", label: "Serviço", description: "Consultoria, assinatura, projeto, implementação" },
          { value: "ambos", label: "Produto + Serviço", description: "Vende produtos e presta serviços" },
        ]}
      />
      <OnboardingQuestion
        title="Qual o segmento da empresa?"
        type="single"
        value={answers.segment as string}
        onChange={(v) => onChange("segment", v)}
        options={[
          { value: "industria", label: "Indústria", icon: Factory },
          { value: "distribuidora", label: "Distribuidora", icon: Building2 },
          { value: "representante", label: "Representante Comercial", icon: Briefcase },
          { value: "saas", label: "SaaS / Tecnologia", icon: Monitor },
          { value: "consultoria", label: "Consultoria", icon: BookOpen },
          { value: "agencia", label: "Agência", icon: Megaphone },
          { value: "educacao", label: "Educação / Infoprodutos", icon: GraduationCap },
          { value: "outro", label: "Outro", icon: HelpCircle },
        ]}
      />
      <OnboardingQuestion
        title="Qual o ticket médio por venda?"
        type="single"
        value={answers.avg_ticket as string}
        onChange={(v) => onChange("avg_ticket", v)}
        options={[
          { value: "ate_500", label: "Até R$ 500" },
          { value: "500_2k", label: "R$ 500 a R$ 2.000" },
          { value: "2k_10k", label: "R$ 2.000 a R$ 10.000" },
          { value: "10k_50k", label: "R$ 10.000 a R$ 50.000" },
          { value: "acima_50k", label: "Acima de R$ 50.000" },
        ]}
      />
      <OnboardingQuestion
        title="Volume mensal de vendas?"
        subtitle="Quantas vendas sua operação fecha por mês, em média?"
        type="single"
        value={answers.monthly_volume as string}
        onChange={(v) => onChange("monthly_volume", v)}
        options={[
          { value: "ate_20", label: "Até 20 vendas/mês" },
          { value: "20_50", label: "20 a 50 vendas/mês" },
          { value: "50_200", label: "50 a 200 vendas/mês" },
          { value: "acima_200", label: "Mais de 200 vendas/mês" },
        ]}
      />
    </div>
  );
}
