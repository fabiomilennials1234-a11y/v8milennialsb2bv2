import { OnboardingQuestion } from "../OnboardingQuestion";

interface Props {
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function StepProcessoVendas({ answers, onChange }: Props) {
  const mode = answers.presentation_mode as string;
  const showsMeetingQ = mode && mode !== "whatsapp_direto";

  return (
    <div className="space-y-8">
      <OnboardingQuestion
        title="Como você apresenta o produto/serviço?"
        type="single"
        value={mode}
        onChange={(v) => onChange("presentation_mode", v)}
        options={[
          { value: "whatsapp_direto", label: "Direto no WhatsApp", description: "Negociação e fechamento via chat" },
          { value: "video_call", label: "Videochamada / Ligação", description: "Apresentação por Google Meet, Zoom ou ligação" },
          { value: "presencial", label: "Presencial", description: "Visita ao cliente ou showroom" },
          { value: "misto", label: "Misto", description: "Depende do cliente ou do momento" },
        ]}
      />
      <OnboardingQuestion
        title="Qual o ciclo médio de venda?"
        subtitle="Do primeiro contato até o fechamento"
        type="single"
        value={answers.sales_cycle as string}
        onChange={(v) => onChange("sales_cycle", v)}
        options={[
          { value: "mesmo_dia", label: "Mesmo dia / imediato" },
          { value: "ate_7_dias", label: "Até 7 dias" },
          { value: "ate_30_dias", label: "Até 30 dias" },
          { value: "mais_30_dias", label: "Mais de 30 dias" },
        ]}
      />
      <OnboardingQuestion
        title="Envia proposta formal antes de fechar?"
        subtitle="Orçamento, contrato ou proposta escrita"
        type="boolean"
        value={answers.uses_proposal as boolean}
        onChange={(v) => onChange("uses_proposal", v)}
      />
      {showsMeetingQ && (
        <OnboardingQuestion
          title="Agenda reunião de apresentação?"
          subtitle="Existe uma etapa formal de agendamento de reunião/demo"
          type="boolean"
          value={answers.schedules_meeting as boolean}
          onChange={(v) => onChange("schedules_meeting", v)}
        />
      )}
      <OnboardingQuestion
        title="Quer gerenciar carteira de clientes?"
        subtitle="Acompanhar clientes ativos, inativos e oportunidades de upsell"
        type="boolean"
        value={answers.wants_carteira as boolean}
        onChange={(v) => onChange("wants_carteira", v)}
      />
    </div>
  );
}
