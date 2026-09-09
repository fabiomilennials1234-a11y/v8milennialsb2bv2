/**
 * `useLeadsStats` — os cards do topo da lista contam a ORGANIZAÇÃO.
 *
 * ── O DEFEITO QUE ISTO IMPEDE ─────────────────────────────────────────────
 * Até a correção da ADR-0024 §2, "Alto rating" (que morreu com o calor em
 * 2026-09-03), "Deste mês" e "Com dono" viviam num `useMemo` dentro de
 * `Leads.tsx` que filtrava o array `leads` — e `leads` é **a página corrente,
 * 25 linhas**. O card "Total" vinha de `useLeadsCount`, que conta a org
 * inteira. Números de página encostados
 * num total de organização, sem nada na tela marcando a diferença: numa org
 * com **2.987 leads**, "leads deste mês" reportava o que coubesse na primeira
 * página.
 *
 * O sintoma é traiçoeiro porque o número nunca fica absurdo — fica plausível
 * e menor. Ninguém abre chamado para "22 em vez de 311".
 *
 * Por isso as asserções abaixo são sobre a FORMA DA CONSULTA, não só sobre o
 * valor: contagem `head` no servidor, escopo da org, e **nenhum** recorte de
 * página (`in`/`limit`/`range`). Um teste que só conferisse o número passaria
 * com a versão de página, bastando devolver 25 leads no mock.
 *
 * ── FUSO ──────────────────────────────────────────────────────────────────
 * "Deste mês" é cortado no fuso da ORG, não no do navegador. A versão anterior
 * usava `new Date().getMonth()` no cliente. É a mesma classe do incidente
 * medido na Basic4u (2026-07-24), em que o Dashboard contava por dia-UTC e a
 * lista mostrava dia-BRT: 6 leads contra 1, sem nenhum dado errado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

/** Organização vista pelo hook — cada teste reescreve o que precisa. */
const org = vi.hoisted(() => ({
  organizationId: "org-1" as string | null,
  isReady: true,
  timezone: "America/Sao_Paulo" as string | null,
}));

/** Contagens que o "servidor" devolve para cada um dos dois recortes. */
const contagens = vi.hoisted(() => ({ mes: 0, comDono: 0 }));

/** Toda consulta emitida, com a cadeia de operadores na ordem. */
const consultas = vi.hoisted(
  () => [] as Array<{ tabela: string; ops: Array<[string, ...unknown[]]> }>,
);

vi.mock("@/modules/identity", () => ({ useOrganization: () => org }));

vi.mock("@/integrations/supabase/client", () => {
  const METODOS = [
    "select", "eq", "is", "or", "gte", "gt", "lte", "lt", "not",
    "in", "order", "limit", "range", "neq", "filter",
  ];

  /** O último operador da cadeia é o que distingue os dois cards. */
  const contagemDe = (ops: Array<[string, ...unknown[]]>): number => {
    const ultima = ops[ops.length - 1];
    if (!ultima) return 0;
    if (ultima[0] === "gte" && ultima[1] === "created_at") return contagens.mes;
    if (ultima[0] === "not" && ultima[1] === "responsible_id") return contagens.comDono;
    return 0;
  };

  const from = (tabela: string) => {
    const ops: Array<[string, ...unknown[]]> = [];
    consultas.push({ tabela, ops });
    const b: Record<string, unknown> = {};
    for (const m of METODOS) {
      b[m] = (...args: unknown[]) => {
        ops.push([m, ...args]);
        return b;
      };
    }
    // O hook faz `await` direto no builder — `then` é o que resolve.
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ count: contagemDe(ops), data: null, error: null }).then(resolve);
    return b;
  };

  return { supabase: { from } };
});

import { useLeadsStats } from "@/modules/leads/hooks/useLeadsStats";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

/** Operadores de uma consulta, achatados em `metodo|arg|arg` para conferência. */
const assinatura = (c: { ops: Array<[string, ...unknown[]]> }) =>
  c.ops.map((o) => o.map((x) => String(x)).join("|"));

async function medir(filtros: Parameters<typeof useLeadsStats>[0] = {}) {
  const { result } = renderHook(() => useLeadsStats(filtros), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  return result.current.data!;
}

beforeEach(() => {
  org.organizationId = "org-1";
  org.isReady = true;
  org.timezone = "America/Sao_Paulo";
  contagens.mes = 0;
  contagens.comDono = 0;
  consultas.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("os cards do topo contam a organização, não a página", () => {
  it("devolve o número da org mesmo acima do que cabe numa página de 25", async () => {
    // 2.987 é o tamanho medido da org que expôs o defeito. Se o hook voltasse
    // a contar a página, nenhum destes números seria alcançável.
    contagens.mes = 2987;
    contagens.comDono = 1544;

    const data = await medir();

    expect(data).toEqual({ thisMonth: 2987, withOwner: 1544 });
  });

  it("pede CONTAGEM ao Postgres, não linhas — `head` com `count: exact`", async () => {
    await medir();

    expect(consultas).toHaveLength(2);
    for (const c of consultas) {
      expect(c.tabela).toBe("leads");
      expect(c.ops[0]).toEqual(["select", "*", { count: "exact", head: true }]);
    }
  });

  it("nenhuma das consultas recorta uma página de leads", async () => {
    // A prova direta de que o número não é o da página: sem `in(id, …)`, sem
    // `limit`, sem `range`. É esta asserção que reprova a volta do `useMemo`.
    await medir();

    for (const c of consultas) {
      const metodos = c.ops.map((o) => o[0]);
      expect(metodos).not.toContain("in");
      expect(metodos).not.toContain("limit");
      expect(metodos).not.toContain("range");
    }
  });

  it("as contagens são escopadas pela org e ignoram a lixeira", async () => {
    // Multi-tenancy: o filtro explícito vive além da RLS. E `deleted_at` é
    // soft-delete — sem o `is null` o card contaria lead que a lista não mostra.
    await medir();

    for (const c of consultas) {
      expect(assinatura(c)).toContain("eq|organization_id|org-1");
      expect(assinatura(c)).toContain("is|deleted_at|null");
    }
  });

  it("cada card mede um recorte diferente do mesmo universo", async () => {
    await medir();

    const finais = consultas.map((c) => assinatura(c)[c.ops.length - 1]);
    expect(finais).toContain("not|responsible_id|is|null");
    expect(finais.some((f) => f.startsWith("gte|created_at"))).toBe(true);
  });

  it("sem organização resolvida não vai ao banco e não inventa número", async () => {
    org.organizationId = null;

    const data = await medir();

    expect(data).toEqual({ thisMonth: 0, withOwner: 0 });
    expect(consultas).toHaveLength(0);
  });
});

describe('"deste mês" é cortado no fuso da organização', () => {
  /** Instante do corte usado pela consulta do card "deste mês". */
  const corteDoMes = () => {
    const mes = consultas.find((c) => {
      const ultima = c.ops[c.ops.length - 1];
      return ultima?.[0] === "gte" && ultima?.[1] === "created_at";
    });
    return String(mes!.ops[mes!.ops.length - 1][2]);
  };

  it("1º de agosto às 02:00 UTC ainda é julho em São Paulo — e o card sabe", async () => {
    // O caso de fronteira que gera o chamado: a virada do mês em BRT acontece
    // 3h depois da virada em UTC. Cortar em UTC arrastaria para "deste mês"
    // todo lead criado entre 21:00 e 00:00 de 31/07 no horário de Brasília.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T02:00:00.000Z"));
    org.timezone = "America/Sao_Paulo";

    await medir();

    expect(corteDoMes()).toBe("2026-07-01T03:00:00.000Z");
  });

  it("o mesmo instante corta noutro ponto para uma org em Tóquio", async () => {
    // Prova que o corte segue a ORG, não o relógio do processo: mesmo instante,
    // fuso diferente, mês diferente.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T02:00:00.000Z"));
    org.timezone = "Asia/Tokyo";

    await medir();

    expect(corteDoMes()).toBe("2026-07-31T15:00:00.000Z");
  });

  it("org sem fuso configurado cai em São Paulo, não em UTC", async () => {
    // A maioria das ~30 orgs é brasileira. Cair em UTC deslocaria o corte 3h
    // silenciosamente em toda org que nunca abriu a tela de configuração.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T02:00:00.000Z"));
    org.timezone = null;

    await medir();

    expect(corteDoMes()).toBe("2026-07-01T03:00:00.000Z");
  });

  it("no meio do mês o corte é o dia 1 daquele mês, no fuso da org", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-17T18:30:00.000Z"));
    org.timezone = "America/Sao_Paulo";

    await medir();

    expect(corteDoMes()).toBe("2026-08-01T03:00:00.000Z");
  });
});

describe("o card concorda com a lista embaixo dele", () => {
  it("os filtros ativos entram nas DUAS contagens, não só numa", async () => {
    // Card que ignora o filtro ativo é outra forma de mentir: o usuário filtra
    // por origem e vê o topo continuar falando da org inteira.
    await medir({
      searchQuery: "acme",
      filterOrigin: "meta_ads",
      filterUf: "SP",
      createdFrom: "2026-07-01T03:00:00.000Z",
      createdTo: "2026-07-31T02:59:59.999Z",
    });

    expect(consultas).toHaveLength(2);
    for (const c of consultas) {
      const sig = assinatura(c);
      expect(sig.some((s) => s.startsWith("or|") && s.includes("acme"))).toBe(true);
      expect(sig).toContain("eq|origin|meta_ads");
      expect(sig).toContain("eq|uf|SP");
      expect(sig).toContain("gte|created_at|2026-07-01T03:00:00.000Z");
      expect(sig).toContain("lte|created_at|2026-07-31T02:59:59.999Z");
    }
  });

  // REMOVIDO na triagem: o caso afirmava que `filterUf: "all"` não vira filtro.
  // Medido: `ufFilter` vem de `?uf=XX` na URL (Leads.tsx:252, com `.toUpperCase()`)
  // e nunca recebe sentinel — quem tem "all" é origem e qualificação. O caso
  // testava uma semântica que o produto não tem.


  it("a janela de criação do deep-link não apaga o corte do mês", async () => {
    // O card "Leads" do Comando abre a lista com `createdFrom`/`createdTo`. Os
    // dois recortes precisam CO-EXISTIR na consulta do mês; se o corte do mês
    // sobrescrevesse a janela (ou vice-versa) o número deixaria de bater com o
    // card de onde veio o clique.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-17T18:30:00.000Z"));

    await medir({ createdFrom: "2026-08-10T03:00:00.000Z" });

    const mes = consultas.find((c) => {
      const ultima = c.ops[c.ops.length - 1];
      return ultima?.[0] === "gte" && ultima?.[1] === "created_at" && ultima?.[2] !== "2026-08-10T03:00:00.000Z";
    });
    const sig = assinatura(mes!);
    expect(sig).toContain("gte|created_at|2026-08-10T03:00:00.000Z");
    expect(sig).toContain("gte|created_at|2026-08-01T03:00:00.000Z");
  });
});
