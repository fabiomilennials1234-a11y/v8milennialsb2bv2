/**
 * Etiquetar de dentro do Negócio.
 *
 * ── O QUE ESTAVA QUEBRADO ─────────────────────────────────────────────────
 * Etiqueta era o único campo do card do Lead que se lia e não se escrevia. No
 * card inteiro havia um `+ etiqueta` **sem `onClick`** — botão morto desde o
 * primeiro commit. Na coluna do painel do Negócio nem isso: só a pílula "sem
 * etiqueta", que é um convite para uma porta que não existe.
 *
 * ── POR QUE O CONSERTO É UM SLOT, E NÃO UM `onClick` ──────────────────────
 * `LeadCard.tsx` e `LeadCardAside.tsx` são alcançáveis a partir de
 * `src/preview/main.tsx`, e `preview-cards-sem-banco.test.ts` reprova qualquer
 * arquivo daquele grafo que alcance react-query/Supabase. Então quem escreve é
 * um componente à parte (`LeadCardEtiquetas`), montado pelo container e
 * entregue como `ReactNode`. Este arquivo prova os dois lados:
 *   1. o editor escreve o que promete (e no id certo);
 *   2. o card usa o slot quando ele vem, e não finge botão quando não vem.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ── Só o banco é mockado ────────────────────────────────────────────────────
const presas = vi.hoisted(() => ({
  lista: [] as Array<{
    id: string;
    tag_id: string;
    tag: { id: string; name: string; color: string | null } | null;
  }>,
}));
const doOrg = vi.hoisted(() => ({
  lista: [] as Array<{ id: string; name: string; color: string | null }>,
  carregando: false,
}));
const avisos = vi.hoisted(() => ({
  erro: vi.fn(),
  info: vi.fn(),
  sucesso: vi.fn(),
}));

const adicionar = vi.fn().mockResolvedValue({ id: "lt-novo", tag_id: "t-1" });
const remover = vi.fn().mockResolvedValue({ leadId: "lead-1", removidas: 1 });
const criar = vi.fn().mockResolvedValue({ id: "t-criada", name: "Inédita" });
const registrar = vi.fn();

vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: presas.lista, isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: adicionar, isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: remover, isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: doOrg.lista, isLoading: doOrg.carregando }),
  useCreateTag: () => ({ mutateAsync: criar, isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => registrar }));
vi.mock("sonner", () => ({
  toast: { error: avisos.erro, success: avisos.sucesso, info: avisos.info },
}));

import { LeadCardEtiquetas } from "@/modules/leads/components/lead-card/LeadCardEtiquetas";
import { LeadCard } from "@/modules/leads/components/lead-card/LeadCard";
import { LeadCardAside } from "@/modules/leads/components/lead-card/LeadCardAside";
import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";

beforeEach(() => {
  presas.lista = [];
  doOrg.lista = [
    { id: "t-1", name: "Ouro", color: "#f0a" },
    { id: "t-2", name: "Recompra", color: null },
  ];
  doOrg.carregando = false;
  adicionar.mockClear();
  remover.mockClear();
  remover.mockResolvedValue({ leadId: "lead-1", removidas: 1 });
  criar.mockClear();
  registrar.mockClear();
  avisos.erro.mockClear();
  avisos.info.mockClear();
  avisos.sucesso.mockClear();
});

/** O gatilho é a pílula tracejada — a mesma que era o botão morto. */
function abrirSeletor() {
  fireEvent.click(screen.getByRole("button", { name: /adicionar etiqueta/i }));
}

describe("LeadCardEtiquetas — a faixa que escreve", () => {
  it("pendura a etiqueta escolhida no lead aberto", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();

    fireEvent.click(await screen.findByRole("button", { name: "Ouro" }));

    await waitFor(() => expect(adicionar).toHaveBeenCalledTimes(1));
    expect(adicionar).toHaveBeenCalledWith({ leadId: "lead-1", tagId: "t-1" });
  });

  it("registra a ação no histórico do lead — etiquetar é evento, não só estado", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();
    fireEvent.click(await screen.findByRole("button", { name: "Ouro" }));

    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", action: "tag_added" }),
    );
  });

  /**
   * A troca mais fácil de fazer neste caminho: `lead_tags.id` e `tags.id` são
   * ambos uuid e estão os dois na mão. Apagar por `tag_id` removeria a etiqueta
   * de OUTRO lead que por acaso casasse o filtro — ou, com `.eq("id", tagId)`,
   * de ninguém, em silêncio.
   */
  it("remove pelo id da JUNÇÃO, não pelo id da etiqueta", async () => {
    presas.lista = [{ id: "lt-9", tag_id: "t-1", tag: { id: "t-1", name: "Ouro", color: "#f0a" } }];
    render(<LeadCardEtiquetas leadId="lead-1" />);

    fireEvent.click(screen.getByRole("button", { name: /remover a etiqueta ouro/i }));

    await waitFor(() => expect(remover).toHaveBeenCalledTimes(1));
    expect(remover).toHaveBeenCalledWith({ leadTagId: "lt-9", leadId: "lead-1" });
  });

  it("não oferece de novo o que o lead já tem", async () => {
    presas.lista = [{ id: "lt-9", tag_id: "t-1", tag: { id: "t-1", name: "Ouro", color: "#f0a" } }];
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();

    const lista = await screen.findByPlaceholderText(/buscar etiqueta/i);
    const painel = lista.closest("div")!.parentElement!;
    expect(within(painel).getByRole("button", { name: "Recompra" })).toBeInTheDocument();
    // "Ouro" continua na tela como PÍLULA presa, mas não como opção para pendurar.
    expect(within(painel).queryByRole("button", { name: "Ouro" })).toBeNull();
  });

  it("diz que a organização não tem etiqueta nenhuma, em vez de abrir uma lista vazia", async () => {
    doOrg.lista = [];
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();

    expect(await screen.findByText(/nenhuma etiqueta cadastrada/i)).toBeInTheDocument();
  });

  /**
   * O embed `tags(...)` é filtrado pela RLS por conta própria: vínculo visível
   * apontando para etiqueta invisível volta como `tag: null`. Ler `p.tag.name`
   * ali derruba a coluna inteira do painel.
   */
  it("um vínculo com etiqueta invisível não derruba a faixa — a linha é ignorada", () => {
    presas.lista = [
      { id: "lt-1", tag_id: "t-fantasma", tag: null },
      { id: "lt-2", tag_id: "t-1", tag: { id: "t-1", name: "Ouro", color: "#f0a" } },
    ];

    expect(() => render(<LeadCardEtiquetas leadId="lead-1" />)).not.toThrow();
    expect(screen.getByText("Ouro")).toBeInTheDocument();
  });
});

/**
 * O catálogo da organização chega por rede. Enquanto ele não chegou, `data` é
 * `[]` — e um `[]` que significa "não sei" é indistinguível de um que significa
 * "não tem". Confundir os dois faz a tela AFIRMAR que a org não tem etiqueta, e
 * destrava "Criar" para um nome que já existe.
 */
describe("LeadCardEtiquetas — catálogo ainda carregando não é catálogo vazio", () => {
  it("não afirma que a organização não tem etiqueta enquanto carrega", async () => {
    doOrg.lista = [];
    doOrg.carregando = true;
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();

    expect(await screen.findByText(/carregando etiquetas/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma etiqueta cadastrada/i)).toBeNull();
  });

  it("não oferece criar enquanto o catálogo não chegou — o nome pode já existir", async () => {
    doOrg.lista = [];
    doOrg.carregando = true;
    render(<LeadCardEtiquetas leadId="lead-1" podeCriar />);
    abrirSeletor();

    fireEvent.change(await screen.findByPlaceholderText(/buscar etiqueta/i), {
      target: { value: "Ouro" },
    });

    expect(screen.queryByRole("button", { name: /criar/i })).toBeNull();
  });
});

/**
 * Remover é a metade da faixa que mais tem como dar errado em silêncio: três
 * telas apagam `lead_tags` por filtros diferentes e nenhuma invalida o cache
 * das outras.
 */
describe("LeadCardEtiquetas — remoção que casa zero linhas", () => {
  beforeEach(() => {
    presas.lista = [{ id: "lt-9", tag_id: "t-1", tag: { id: "t-1", name: "Ouro", color: "#f0a" } }];
  });

  it("não acusa falta de permissão quando a etiqueta já tinha saído por outra tela", async () => {
    remover.mockResolvedValue({ leadId: "lead-1", removidas: 0 });
    render(<LeadCardEtiquetas leadId="lead-1" />);

    fireEvent.click(screen.getByRole("button", { name: /remover a etiqueta ouro/i }));

    await waitFor(() => expect(avisos.info).toHaveBeenCalledTimes(1));
    expect(avisos.info.mock.calls[0][0]).toMatch(/já tinha sido removida/i);
    expect(avisos.erro).not.toHaveBeenCalled();
    // Nada saiu, então nada foi removido: gravar `tag_removed` seria inventar
    // um evento no histórico do lead.
    expect(registrar).not.toHaveBeenCalled();
  });

  it("remoção de verdade registra o evento e não avisa nada", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" />);

    fireEvent.click(screen.getByRole("button", { name: /remover a etiqueta ouro/i }));

    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tag_removed" }),
    );
    expect(avisos.info).not.toHaveBeenCalled();
    expect(avisos.erro).not.toHaveBeenCalled();
  });
});

/**
 * Criar etiqueta nova é ADMIN — `tags_insert_admin_only` exige
 * `is_user_admin()` no INSERT em `tags`, enquanto pendurar uma existente
 * (`lead_tags_insert_organization`) vale para qualquer pessoa da org.
 */
describe("LeadCardEtiquetas — criar etiqueta nova é de admin", () => {
  it("sem podeCriar, um nome inédito explica onde a etiqueta nasce e não oferece criar", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" />);
    abrirSeletor();

    fireEvent.change(await screen.findByPlaceholderText(/buscar etiqueta/i), {
      target: { value: "Inédita" },
    });

    expect(screen.queryByRole("button", { name: /criar/i })).toBeNull();
    expect(screen.getByText(/criadas por um administrador/i)).toBeInTheDocument();
  });

  it("com podeCriar, cria a etiqueta e já a pendura — dois passos, um clique", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" podeCriar />);
    abrirSeletor();

    fireEvent.change(await screen.findByPlaceholderText(/buscar etiqueta/i), {
      target: { value: "Inédita" },
    });
    fireEvent.click(screen.getByRole("button", { name: /criar/i }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ name: "Inédita" }));
    await waitFor(() => expect(adicionar).toHaveBeenCalledTimes(1));
    expect(adicionar).toHaveBeenCalledWith({ leadId: "lead-1", tagId: "t-criada" });
  });

  it("não oferece criar um nome que a organização JÁ tem — nem quando o lead não o usa", async () => {
    render(<LeadCardEtiquetas leadId="lead-1" podeCriar />);
    abrirSeletor();

    fireEvent.change(await screen.findByPlaceholderText(/buscar etiqueta/i), {
      target: { value: "ouro" },
    });

    expect(screen.queryByRole("button", { name: /criar/i })).toBeNull();
  });

  /**
   * Acento é a forma mais barata de nascer etiqueta gêmea: o catálogo é por
   * organização e a pessoa escolhe pelo NOME, mas o filtro do quadro casa por
   * id — duas "Não responde" quebram o filtro sem nenhum erro na tela.
   */
  it("acha a etiqueta acentuada quando o nome é digitado sem acento", async () => {
    doOrg.lista = [{ id: "t-3", name: "Não responde", color: null }];
    render(<LeadCardEtiquetas leadId="lead-1" podeCriar />);
    abrirSeletor();

    fireEvent.change(await screen.findByPlaceholderText(/buscar etiqueta/i), {
      target: { value: "Nao responde" },
    });

    expect(screen.getByRole("button", { name: "Não responde" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar/i })).toBeNull();
  });
});

/**
 * O slot. O que se prova aqui é que o card USA o nó quando ele vem — e que,
 * quando não vem, ele não desenha um botão que não faz nada.
 */
describe("O card do Lead usa o slot de etiquetas", () => {
  const marca = <span data-testid="editor-de-etiquetas">editor</span>;

  it("o card inteiro troca as pílulas de leitura pelo editor", () => {
    render(<LeadCard lead={LEAD_EXEMPLO} editorDeEtiquetas={marca} />);

    expect(screen.getByTestId("editor-de-etiquetas")).toBeInTheDocument();
    expect(screen.queryByText(LEAD_EXEMPLO.tags[0].nome)).toBeNull();
  });

  it("a coluna do painel do Negócio idem", () => {
    render(<LeadCardAside lead={LEAD_EXEMPLO} editorDeEtiquetas={marca} />);

    expect(screen.getByTestId("editor-de-etiquetas")).toBeInTheDocument();
    expect(screen.queryByText("sem etiqueta")).toBeNull();
  });

  /**
   * A regressão que este arquivo existe para impedir: um `+ etiqueta` inerte.
   * Sem o slot o card lê as etiquetas e não promete escrever.
   */
  it("sem o slot, o card NÃO desenha botão de etiqueta — só as pílulas de leitura", () => {
    render(<LeadCard lead={LEAD_EXEMPLO} />);

    expect(screen.getByText(LEAD_EXEMPLO.tags[0].nome)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /etiqueta/i })).toBeNull();
  });

  it("sem o slot, a coluna mantém a pílula 'sem etiqueta' do lead sem nenhuma", () => {
    render(<LeadCardAside lead={{ ...LEAD_EXEMPLO, tags: [] }} />);

    expect(screen.getByText("sem etiqueta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+?\s*etiqueta$/i })).toBeNull();
  });
});
