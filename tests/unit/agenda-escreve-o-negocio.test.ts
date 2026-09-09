/**
 * A Agenda passa a gravar `meetings.deal_id` — S6, frente ESCRITOR.
 *
 * O defeito que estes testes trancam: `meetings.deal_id` existe desde
 * `20270907000010` e nasceu MORTA. As 642 linhas preenchidas em prod são todas
 * do backfill do S3, gravadas no mesmo instante; toda reunião criada pelo app
 * depois disso tem `deal_id` NULL, porque `CreateMeetingInput` não tinha o
 * campo. Sem essa coluna escrita, o espelho `meetings → pipeline_entries`
 * sai calado e marcar reunião na Agenda nunca chega ao card do Negócio.
 *
 * O que se prova aqui:
 *   1. o negócio é RESOLVIDO a partir do par (funil, lead), sem clique a mais —
 *      `uq_pipeline_entries_deal_id` faz negócio ↔ entrada serem 1:1;
 *   2. no empate ninguém adivinha: a pessoa escolhe, e enquanto não escolhe a
 *      reunião é criada SEM negócio (falta de negócio nunca bloqueia reunião);
 *   3. `dealId` morre junto com `leadId` nos três handlers — um sobrevivente de
 *      outro funil grava a reunião no card errado, e nada na tela denuncia;
 *   4. o payload do INSERT leva `deal_id` só quando há lead E funil;
 *   5. abrir e salvar uma reunião do backfill SEM tocar em nada PRESERVA o
 *      vínculo — `useUpdateMeeting` é update CRU, sem merge: campo não semeado
 *      vai como `null` e apaga.
 *
 * O picker é o REAL nos testes de diálogo, não um dublê: o que interessa provar
 * é o caminho inteiro (escolher lead → resolver negócio → payload), e um dublê
 * do picker provaria só que o diálogo copia o que lhe entregam.
 *
 * O `Select` do Radix é dublado por um `<select>` nativo, como o resto da suíte
 * já faz: o primitivo depende de `hasPointerCapture`, ausente no jsdom.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Dublês ──────────────────────────────────────────────────────────────────

type SelProps = {
  value?: string;
  onValueChange?: (v: string) => void;
  children?: React.ReactNode;
  disabled?: boolean;
};

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: SelProps) =>
    React.createElement(
      "select",
      {
        "data-testid": "select-funil",
        value: value ?? "",
        disabled,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange?.(e.target.value),
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: SelProps) =>
    React.createElement(React.Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
    React.createElement("option", { value }, children),
}));

const funis = {
  data: [
    { id: "p-comercial", name: "Funil Comercial" },
    { id: "p-reativacao", name: "Funil Reativacao" },
  ],
  isLoading: false,
  isError: false,
};

vi.mock("@/modules/pipelines", () => ({
  usePipelines: () => funis,
  usePipelineDisplayConfig: () => ({ data: [] }),
}));

type Entrada = {
  id: string;
  deal_id: string | null;
  /** `null` = entrada viva no board. Preenchido = entrada encerrada. */
  closed_at: string | null;
  /** Nome que a org vê — o desempate não pode oferecer slug para escolher. */
  stage_name: string | null;
  stage_key: string | null;
  entered_at: string | null;
};

const leadsDoFunil = {
  data: undefined as
    | { leads: Array<Record<string, unknown>>; temMais: boolean }
    | undefined,
  isFetching: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
};

vi.mock("@/modules/leads", () => ({
  useLeadsPorFunil: () => leadsDoFunil,
  useLeadById: () => ({
    data: { id: "l-1", name: "Evandro", company: null },
    isLoading: false,
  }),
}));

vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [] }),
}));

const criar = vi.fn();
const atualizar = vi.fn();
const reuniaoCarregada = {
  data: null as Record<string, unknown> | null,
  isLoading: false,
  isError: false,
};

vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useCreateMeeting: () => ({ mutate: criar, isPending: false }),
  useUpdateMeeting: () => ({ mutate: atualizar, isPending: false }),
  useMeeting: () => reuniaoCarregada,
}));

const { LeadPorFunilPicker, SEM_FUNIL } = await import(
  "@/modules/engagement/components/agenda/LeadPorFunilPicker"
);
const { CreateMeetingDialog } = await import(
  "@/modules/engagement/components/agenda/CreateMeetingDialog"
);
const { EditMeetingDialog } = await import(
  "@/modules/engagement/components/agenda/EditMeetingDialog"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function lead(entradas: Entrada[]) {
  return {
    id: "l-1",
    name: "Evandro",
    company: null,
    phone: null,
    email: null,
    entradas,
  };
}

const UMA_ENTRADA: Entrada[] = [
  {
    id: "e-1",
    deal_id: "d-1",
    closed_at: null,
    stage_name: "Reuniao Marcada",
    stage_key: "reuniao_marcada",
    entered_at: "2026-08-01T10:00:00Z",
  },
];

const DUAS_ENTRADAS: Entrada[] = [
  {
    id: "e-1",
    deal_id: "d-1",
    closed_at: null,
    stage_name: "Reuniao Marcada",
    stage_key: "reuniao_marcada",
    entered_at: "2026-07-01T10:00:00Z",
  },
  {
    id: "e-2",
    deal_id: "d-2",
    closed_at: null,
    stage_name: "Proposta Enviada",
    stage_key: "proposta",
    entered_at: "2026-08-01T10:00:00Z",
  },
];

/**
 * Casca CONTROLADA. O picker não guarda funil/lead/negócio — quem guarda é o
 * formulário. Testá-lo com um `value` congelado provaria só a primeira emissão
 * e nunca o estado seguinte (é ali que o desempate aparece).
 */
type Valor = { pipelineId: string | null; leadId: string | null; dealId?: string | null };

function montarPicker(inicial: Valor) {
  const emissoes: Valor[] = [];

  function Casca() {
    const [valor, setValor] = React.useState<Valor>(inicial);
    return React.createElement(LeadPorFunilPicker, {
      value: valor,
      onChange: (proximo: Valor) => {
        emissoes.push(proximo);
        setValor(proximo);
      },
    });
  }

  render(React.createElement(Casca));
  return { emissoes, ultima: () => emissoes[emissoes.length - 1] };
}

beforeEach(() => {
  leadsDoFunil.data = { leads: [], temMais: false };
  leadsDoFunil.isFetching = false;
  leadsDoFunil.isError = false;
  criar.mockClear();
  atualizar.mockClear();
  reuniaoCarregada.data = null;
});

// ── 1. Resolução do negócio ────────────────────────────────────────────────

describe("o negocio sai do par (funil, lead)", () => {
  it("uma entrada com negocio: resolve sozinho, sem seletor a mais", () => {
    leadsDoFunil.data = { leads: [lead(UMA_ENTRADA)], temMais: false };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: "d-1",
    });
    expect(screen.queryByText(/Escolha em qual/i)).toBeNull();
  });

  it("nenhuma entrada com negocio: reuniao segue sem negocio, sem bloquear nada", () => {
    leadsDoFunil.data = {
      leads: [
        lead([
          {
            id: "e-1",
            deal_id: null,
            closed_at: null,
            stage_name: "Novo Lead",
            stage_key: "novo_lead",
            entered_at: null,
          },
        ]),
      ],
      temMais: false,
    };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: null,
    });
    expect(screen.queryByText(/Escolha em qual/i)).toBeNull();
  });

  it("duas entradas: NAO adivinha — mostra o desempate por etapa e espera a escolha", () => {
    leadsDoFunil.data = { leads: [lead(DUAS_ENTRADAS)], temMais: false };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    // Escolher a primeira, a mais recente ou a de maior valor é exatamente o
    // que põe a reunião no card errado sem ninguém perceber.
    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: null,
    });
    expect(screen.getByText("Reuniao Marcada")).toBeTruthy();
    expect(screen.getByText("Proposta Enviada")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByText("Proposta Enviada"));
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: "d-2",
    });
  });
});

// ── 1b. O que conta como candidata ─────────────────────────────────────────

/**
 * O filtro que decide de QUAL negócio a reunião vira espelho.
 *
 * Antes, candidata era só `!!deal_id`. Com uma candidata única o picker
 * resolvia sozinho, sem UI nenhuma, e gravava `meetings.deal_id` — inclusive o
 * de uma entrada já ENCERRADA. Medido em prod 2026-09-04: 2.046 dos 38.811
 * pares (funil, lead) com negócio caíam nesse caminho, e nada na tela dizia
 * nada. É a única classe de defeito desta fatia que o rollback da migration
 * não desfaz, porque o livro `backup.meetings_deal_id_s6_20270927` não sabe
 * distinguir o que uma pessoa vinculou à mão.
 *
 * A definição escolhida é `closed_at IS NULL` DA ENTRADA — a mesma do backfill
 * da migration, e pelo mesmo motivo: a entrada é a linha que recebe a projeção
 * (`pipeline_entries.metadata`), e é ela que está ou não está no board.
 */
describe("entrada encerrada nao e candidata a receber a reuniao", () => {
  const FECHADA: Entrada = {
    id: "e-morta",
    deal_id: "d-morto",
    closed_at: "2026-06-30T12:00:00Z",
    stage_name: "Vendido",
    stage_key: "vendido",
    entered_at: "2026-05-01T10:00:00Z",
  };

  it("🚨 unica entrada FECHADA: nao resolve sozinho — sai SEM negocio, e nao com o negocio morto", () => {
    leadsDoFunil.data = { leads: [lead([FECHADA])], temMais: false };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    // O defeito que este caso tranca: `dealId: "d-morto"` gravado em silêncio.
    // Card mudo é recuperável à mão; card errado ninguém vê.
    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: null,
    });
    // E não vira desempate: não há o que desempatar com zero candidata.
    expect(screen.queryByText(/Escolha em qual/i)).toBeNull();
    expect(screen.queryByText("Vendido")).toBeNull();
  });

  it("uma aberta e uma fechada: resolve na ABERTA, sem pedir desempate", () => {
    leadsDoFunil.data = {
      leads: [lead([FECHADA, ...UMA_ENTRADA])],
      temMais: false,
    };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    // Medido em prod: é o caso de 1 par que sai de "ambíguo" para "resolve
    // sozinho" — antes as duas entradas concorriam e ninguém escolhia.
    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: "d-1",
    });
    expect(screen.queryByText(/Escolha em qual/i)).toBeNull();
  });

  it("o desempate NAO oferece a entrada fechada como opcao", () => {
    leadsDoFunil.data = {
      leads: [lead([FECHADA, ...DUAS_ENTRADAS])],
      temMais: false,
    };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    expect(picker.ultima().dealId).toBeNull();
    expect(screen.getByText("Reuniao Marcada")).toBeTruthy();
    expect(screen.getByText("Proposta Enviada")).toBeTruthy();
    // Oferecer o negócio encerrado é o mesmo defeito com um clique humano no
    // meio: a pessoa escolhe algo que o produto não deveria ter listado.
    expect(screen.queryByText("Vendido")).toBeNull();
    expect(screen.getByText(/2 negócios abertos/)).toBeTruthy();
  });

  it("todas fechadas: segue sem negocio, e nao bloqueia a reuniao", () => {
    leadsDoFunil.data = {
      leads: [
        lead([
          FECHADA,
          { ...FECHADA, id: "e-morta-2", deal_id: "d-morto-2", stage_name: "Perdido" },
        ]),
      ],
      temMais: false,
    };
    const picker = montarPicker({ pipelineId: "p-comercial", leadId: null, dealId: null });

    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: null,
    });
    expect(screen.queryByText(/Escolha em qual/i)).toBeNull();
  });

  it("🚨 vinculo JA GRAVADO em entrada fechada sobrevive — o filtro governa o que se resolve agora", () => {
    // Reunião do backfill do S3 (642 linhas) ou do webhook, reaberta para
    // edição: o negócio dela pode ter sido encerrado desde então. Zerar aqui
    // seria o filtro APAGANDO um vínculo que alguém já decidiu — exatamente o
    // dano que ele existe para evitar, com o sinal trocado.
    leadsDoFunil.data = { leads: [], temMais: false };
    const picker = montarPicker({
      pipelineId: "p-comercial",
      leadId: "l-1",
      dealId: "d-morto",
    });

    expect(picker.emissoes).toHaveLength(0);
    expect(screen.getByText(/Evandro/)).toBeTruthy();
  });
});

// ── 2. Higiene: dealId morre junto com leadId ──────────────────────────────

describe("dealId morre junto com leadId", () => {
  const ESCOLHIDO: Valor = {
    pipelineId: "p-comercial",
    leadId: "l-1",
    dealId: "d-1",
  };

  it("trocar de funil zera lead E negocio", () => {
    const picker = montarPicker(ESCOLHIDO);

    act(() => {
      fireEvent.change(screen.getByTestId("select-funil"), {
        target: { value: "p-reativacao" },
      });
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-reativacao",
      leadId: null,
      dealId: null,
    });
  });

  it("limpar o funil zera lead E negocio", () => {
    const picker = montarPicker(ESCOLHIDO);

    act(() => {
      fireEvent.change(screen.getByTestId("select-funil"), {
        target: { value: SEM_FUNIL },
      });
    });

    expect(picker.ultima()).toEqual({
      pipelineId: null,
      leadId: null,
      dealId: null,
    });
  });

  it("limpar o lead zera o negocio junto", () => {
    const picker = montarPicker(ESCOLHIDO);

    act(() => {
      fireEvent.click(screen.getByText("Limpar"));
    });

    expect(picker.ultima()).toEqual({
      pipelineId: "p-comercial",
      leadId: null,
      dealId: null,
    });
  });
});

// ── 3. Payload do INSERT ───────────────────────────────────────────────────

describe("payload da criacao", () => {
  function montarCriacao(props: Record<string, unknown> = {}) {
    render(
      React.createElement(CreateMeetingDialog, {
        open: true,
        onOpenChange: vi.fn(),
        initialStart: new Date(2026, 8, 7, 14, 0),
        ...props,
      }),
    );
  }

  function preencherTitulo() {
    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Nome do evento"), {
        target: { value: "Reuniao Evandro" },
      });
    });
  }

  it("grava deal_id quando ha funil E lead", () => {
    leadsDoFunil.data = { leads: [lead(UMA_ENTRADA)], temMais: false };
    montarCriacao();
    preencherTitulo();

    act(() => {
      fireEvent.change(screen.getByTestId("select-funil"), {
        target: { value: "p-comercial" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByText("Evandro"));
    });
    act(() => {
      fireEvent.click(screen.getByText("Criar atividade"));
    });

    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0][0]).toMatchObject({
      lead_id: "l-1",
      pipeline_id: "p-comercial",
      deal_id: "d-1",
    });
  });

  it("sem lead, deal_id vai null — vinculo que nao aponta pra ninguem nao se grava", () => {
    montarCriacao();
    preencherTitulo();

    act(() => {
      fireEvent.change(screen.getByTestId("select-funil"), {
        target: { value: "p-comercial" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByText("Criar atividade"));
    });

    expect(criar.mock.calls[0][0]).toMatchObject({
      lead_id: null,
      pipeline_id: null,
      deal_id: null,
    });
  });

  it("abrir pelo card do funil ja chega com o funil semeado", () => {
    leadsDoFunil.data = { leads: [lead(UMA_ENTRADA)], temMais: false };
    montarCriacao({
      initialPipelineId: "p-comercial",
      initialLeadId: "l-1",
      initialLeadName: "Evandro",
    });

    // Com o par já semeado, o campo de funil abre no funil de origem — é isso
    // que permite ao picker resolver o negócio sem clique nenhum.
    expect((screen.getByTestId("select-funil") as HTMLSelectElement).value).toBe(
      "p-comercial",
    );
  });
});

// ── 4. Edição não pode apagar o vínculo ────────────────────────────────────

describe("edicao preserva o negocio", () => {
  it("salvar SEM tocar em nada mantem o deal_id da reuniao do backfill", () => {
    reuniaoCarregada.data = {
      id: "m-1",
      title: "Reuniao Evandro",
      description: null,
      location: null,
      start_at: "2026-09-07T14:00:00.000Z",
      end_at: "2026-09-07T15:00:00.000Z",
      all_day: false,
      event_type: "meeting",
      pipeline_id: "p-comercial",
      lead_id: "l-1",
      deal_id: "d-9",
      color: null,
      meet_link: null,
      updated_at: "2026-09-01T19:55:09.000Z",
    };

    render(
      React.createElement(EditMeetingDialog, {
        meetingId: "m-1",
        open: true,
        onOpenChange: vi.fn(),
      }),
    );

    act(() => {
      fireEvent.click(screen.getByText("Salvar alterações"));
    });

    expect(atualizar).toHaveBeenCalledTimes(1);
    // `useUpdateMeeting` faz `.update(updates)` cru: se o efeito de semeadura
    // não copiasse `deal_id`, este campo iria como `null` e o vínculo sumiria
    // em silêncio — sem erro, sem toast, sem nada na tela.
    expect(atualizar.mock.calls[0][0]).toMatchObject({
      id: "m-1",
      lead_id: "l-1",
      pipeline_id: "p-comercial",
      deal_id: "d-9",
    });
  });

  it("🚨 reuniao COM negocio e SEM funil (webhook/backfill) tambem preserva o deal_id", () => {
    // O caso que a semeadura sozinha NÃO cobria: `meetings.pipeline_id` é
    // opcional e mora vazia justamente onde há negócio. Medido em prod
    // (2026-09-03): 15 das 151 reuniões que o backfill da 20270926000000
    // preenche ficam com `pipeline_id` NULL — aquele bloco escreve SÓ
    // `deal_id` —, e o `meeting-webhook` (883 das 935 reuniões de prod) não
    // escreve `pipeline_id` em linha nenhuma, embora agora resolva `deal_id`.
    // Nenhum trigger de `public.meetings` deriva a coluna.
    //
    // Com o guard antigo (`form.lead_id && form.pipeline_id`), abrir uma
    // destas e clicar Salvar sem tocar em NADA mandava `deal_id: null`; o
    // `trg_meeting_espelha_no_funil` cobre `UPDATE OF deal_id`, via a troca e
    // chamava `fn_espelho_limpa_projecao` — o vínculo sumia E a data da
    // reunião desaparecia do card do Negócio e do card do funil, em silêncio.
    reuniaoCarregada.data = {
      id: "m-2",
      title: "Reuniao vinda do webhook",
      description: null,
      location: null,
      start_at: "2026-09-07T14:00:00.000Z",
      end_at: "2026-09-07T15:00:00.000Z",
      all_day: false,
      event_type: "meeting",
      pipeline_id: null,
      lead_id: "l-1",
      deal_id: "d-9",
      color: null,
      meet_link: null,
      updated_at: "2026-09-01T19:55:09.000Z",
    };

    render(
      React.createElement(EditMeetingDialog, {
        meetingId: "m-2",
        open: true,
        onOpenChange: vi.fn(),
      }),
    );

    act(() => {
      fireEvent.click(screen.getByText("Salvar alterações"));
    });

    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar.mock.calls[0][0]).toMatchObject({
      id: "m-2",
      lead_id: "l-1",
      // O funil continua saindo `null` — ele é opcional e ninguém o inventou.
      pipeline_id: null,
      // O negócio, que é o que o espelho lê, SOBREVIVE.
      deal_id: "d-9",
    });
  });

  it("desvincular o lead continua soltando o negocio junto", () => {
    // O contrapeso do teste acima: afrouxar o guard para depender só do lead
    // não pode transformar "tirei o lead" em "mantive o negócio". Aqui o
    // vínculo TEM de sair — é o caminho legítimo de desvincular, e é o que faz
    // o espelho limpar a projeção da entrada antiga.
    reuniaoCarregada.data = {
      id: "m-3",
      title: "Reuniao para desvincular",
      description: null,
      location: null,
      start_at: "2026-09-07T14:00:00.000Z",
      end_at: "2026-09-07T15:00:00.000Z",
      all_day: false,
      event_type: "meeting",
      pipeline_id: "p-comercial",
      lead_id: "l-1",
      deal_id: "d-9",
      color: null,
      meet_link: null,
      updated_at: "2026-09-01T19:55:09.000Z",
    };

    render(
      React.createElement(EditMeetingDialog, {
        meetingId: "m-3",
        open: true,
        onOpenChange: vi.fn(),
      }),
    );

    act(() => {
      fireEvent.click(screen.getByText("Limpar"));
    });
    act(() => {
      fireEvent.click(screen.getByText("Salvar alterações"));
    });

    expect(atualizar.mock.calls[0][0]).toMatchObject({
      id: "m-3",
      lead_id: null,
      pipeline_id: null,
      deal_id: null,
    });
  });
});
