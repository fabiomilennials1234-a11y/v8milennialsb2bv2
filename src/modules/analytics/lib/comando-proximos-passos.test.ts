import { describe, expect, it } from "vitest";
import { diasAte, filaComLead } from "./comando-proximos-passos";

const conversa = (leadId: string | null, quando: string) => ({
  leadId,
  lastClientMessageAt: quando,
  nome: leadId ?? "sem lead",
});

describe("filaComLead", () => {
  it("descarta conversa sem lead cadastrado", () => {
    const fila = filaComLead([
      conversa("lead-1", "2026-09-04T10:00:00Z"),
      conversa(null, "2026-09-04T11:00:00Z"),
    ]);
    expect(fila.map((c) => c.leadId)).toEqual(["lead-1"]);
  });

  it("mais recente primeiro", () => {
    const fila = filaComLead([
      conversa("a", "2026-09-04T08:00:00Z"),
      conversa("c", "2026-09-04T12:00:00Z"),
      conversa("b", "2026-09-04T10:00:00Z"),
    ]);
    expect(fila.map((c) => c.leadId)).toEqual(["c", "b", "a"]);
  });

  it("devolve a lista INTEIRA filtrada — o corte é de quem chama", () => {
    // O total do cabeçalho sai daqui. Cortar aqui faria o contador mentir para
    // baixo, que é o defeito espelhado do que existia (contar antes do filtro).
    const fila = filaComLead(
      Array.from({ length: 25 }, (_, i) =>
        conversa(`lead-${i}`, `2026-09-04T10:${String(i).padStart(2, "0")}:00Z`),
      ),
    );
    expect(fila).toHaveLength(25);
  });

  it("nenhuma com lead devolve lista vazia, não erro", () => {
    expect(filaComLead([conversa(null, "2026-09-04T10:00:00Z")])).toEqual([]);
  });
});

describe("diasAte", () => {
  const agora = new Date(2026, 8, 4, 23, 0, 0); // 04/09/2026, 23h

  it("hoje é hoje, mesmo faltando minutos", () => {
    expect(diasAte(new Date(2026, 8, 4, 23, 59), agora)).toMatchObject({
      texto: "hoje",
      hoje: true,
    });
  });

  it("amanhã às 8h é AMANHÃ, e não 'hoje' por faltar 9 horas", () => {
    // A conta por horas daria 0. É o caso que motivou dias de calendário.
    expect(diasAte(new Date(2026, 8, 5, 8, 0), agora)).toMatchObject({
      dias: 1,
      texto: "amanhã",
      hoje: false,
    });
  });

  it("conta os dias no plural", () => {
    expect(diasAte(new Date(2026, 8, 11, 9, 0), agora)).toMatchObject({
      dias: 7,
      texto: "7 dias",
    });
  });

  it("atravessa a virada do mês", () => {
    const fimDoMes = new Date(2026, 8, 30, 10, 0);
    expect(diasAte(new Date(2026, 9, 2, 10, 0), fimDoMes)).toMatchObject({
      dias: 2,
      texto: "2 dias",
    });
  });

  it("evento já passado não vira número negativo na tela", () => {
    expect(diasAte(new Date(2026, 8, 1, 10, 0), agora)).toMatchObject({
      texto: "hoje",
      hoje: true,
    });
  });
});
