import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Check } from "lucide-react";
import type { ContatoDoCliente } from "@/shared/format/cliente-agenda";
import { ContatoDoClientePicker } from "./ContatoDoClientePicker";

// Contatos fictícios — nenhum é cliente real.
const CONTATOS: ContatoDoCliente[] = [
  { id: "c1", nome: "Carlos - Compras", telefone: "5548991230001", principal: true },
  { id: "c2", nome: "Ana Paula - Financeiro", telefone: "5548991230002", principal: false },
  { id: "c3", nome: "Rodrigo - Gerente da loja Centro", telefone: "554833330003", principal: false },
  { id: "c4", nome: null, telefone: "5548991230004", principal: false },
];

/**
 * O pedaço do "Nova agenda" em volta do seletor: o cliente já escolhido logo
 * acima. O preview do Storybook já envolve tudo em `.dark`.
 */
function Moldura({ contatos, inicial = "" }: { contatos: ContatoDoCliente[]; inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="flex w-[592px] max-w-full flex-col gap-5 rounded-2xl border border-border bg-background p-6 text-foreground">
      <p className="flex items-center gap-1.5 rounded-lg bg-primary-soft/60 px-3 py-1.5 text-[12px] text-primary-soft-foreground">
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-semibold">Empório Lagoa Comércio de Alimentos LTDA</span>
      </p>
      <ContatoDoClientePicker contatos={contatos} value={valor} onChange={setValor} />
    </div>
  );
}

const meta: Meta<typeof Moldura> = {
  title: "Engagement/Agenda/Contato do cliente",
  component: Moldura,
};
export default meta;

type Story = StoryObj<typeof Moldura>;

export const SemEscolha: Story = { args: { contatos: CONTATOS } };
export const Escolhido: Story = { args: { contatos: CONTATOS, inicial: "c2" } };
export const Muitos: Story = {
  args: {
    contatos: Array.from({ length: 9 }, (_, i) => ({
      id: `m${i}`,
      nome: `Contato ${i + 1} - Setor`,
      telefone: `55489912300${String(i).padStart(2, "0")}`,
      principal: i === 0,
    })),
  },
};
