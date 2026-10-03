import { OnboardingQuestion } from "../OnboardingQuestion";

interface Props {
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function StepEstruturaComercial({ answers, onChange }: Props) {
  const hasSdr = answers.has_sdr === true;

  return (
    <div className="space-y-8">
      <OnboardingQuestion
        title="Quantos vendedores na equipe?"
        type="single"
        value={answers.team_size as string}
        onChange={(v) => onChange("team_size", v)}
        options={[
          { value: "sozinho", label: "Só eu" },
          { value: "2_5", label: "2 a 5 pessoas" },
          { value: "6_15", label: "6 a 15 pessoas" },
          { value: "16_50", label: "16 a 50 pessoas" },
          { value: "acima_50", label: "Mais de 50 pessoas" },
        ]}
      />
      <OnboardingQuestion
        title="Tem pré-vendas (SDR) separado?"
        subtitle="Alguém que qualifica leads antes de passar para o vendedor"
        type="boolean"
        value={answers.has_sdr as boolean}
        onChange={(v) => onChange("has_sdr", v)}
      />
      {hasSdr && (
        <OnboardingQuestion
          title="Tem closer / executivo de contas separado?"
          subtitle="Alguém focado exclusivamente em fechar negócios"
          type="boolean"
          value={answers.has_closer as boolean}
          onChange={(v) => onChange("has_closer", v)}
        />
      )}
      <OnboardingQuestion
        title="Vendedor interno ou externo?"
        type="single"
        value={answers.seller_type as string}
        onChange={(v) => onChange("seller_type", v)}
        options={[
          { value: "interno", label: "Interno (inside sales)", description: "Vende de dentro da empresa, por telefone/WhatsApp/vídeo" },
          { value: "externo", label: "Externo (field sales)", description: "Visita clientes presencialmente" },
          { value: "misto", label: "Misto", description: "Parte do time é interno, parte é externo" },
        ]}
      />
    </div>
  );
}
