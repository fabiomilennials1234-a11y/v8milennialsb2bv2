import {
  OPCOES_DE_VISAO,
  VISAO_PADRAO,
  donoForcadoPelaVisao,
  normalizarVisao,
  visaoDisponivel,
} from "./visao-meu-todos";

describe("visão Meus · Todos (flag visao_meu_todos)", () => {
  describe("visaoDisponivel", () => {
    it("só aparece com flag + admin + membro da org", () => {
      expect(visaoDisponivel({ flag: true, isAdmin: true, teamMemberId: "tm-1" })).toBe(true);
    });

    it.each([
      ["sem flag (outra org)", { flag: false, isAdmin: true, teamMemberId: "tm-1" }],
      ["membro comum", { flag: true, isAdmin: false, teamMemberId: "tm-1" }],
      ["master sombra, sem team_member", { flag: true, isAdmin: true, teamMemberId: null }],
    ])("some para %s", (_caso, input) => {
      expect(visaoDisponivel(input)).toBe(false);
    });
  });

  describe("donoForcadoPelaVisao", () => {
    it("'meu' com o controle disponível força o próprio membro", () => {
      expect(donoForcadoPelaVisao(true, "meu", "tm-1")).toBe("tm-1");
    });

    it("'todos' deixa a tela seguir o próprio filtro", () => {
      expect(donoForcadoPelaVisao(true, "todos", "tm-1")).toBeNull();
    });

    it("controle indisponível nunca força — mesmo com 'meu' guardado de antes", () => {
      expect(donoForcadoPelaVisao(false, "meu", "tm-1")).toBeNull();
    });
  });

  describe("padrões", () => {
    it("ligar a flag não muda o que o admin já via", () => {
      expect(VISAO_PADRAO).toEqual({ leads: "todos", funis: "todos", avisos: "meu" });
    });

    it("valor guardado inválido cai no padrão da superfície", () => {
      expect(normalizarVisao("qualquer", "meu")).toBe("meu");
      expect(normalizarVisao(undefined, "todos")).toBe("todos");
      expect(normalizarVisao("todos", "meu")).toBe("todos");
    });

    it("rótulos na ordem do controle", () => {
      expect(OPCOES_DE_VISAO.map((o) => o.label)).toEqual(["Meus", "Todos"]);
    });
  });
});
