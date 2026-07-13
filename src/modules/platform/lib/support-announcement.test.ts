import {
  emptyState,
  isAppSettled,
  markCoachDone,
  markEngaged,
  markSessionShown,
  readSessionShown,
  readState,
  recordModalShown,
  shouldShowModal,
  writeState,
} from "./support-announcement";

const USER = "user-1";
const KEY = `torque:support-announcement:v1:${USER}`;
const SESSION_KEY = "torque:support-announcement:session-shown";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("shouldShowModal", () => {
  it("é elegível com shownCount 0", () => {
    expect(shouldShowModal(emptyState(), false)).toBe(true);
  });

  it("é elegível com shownCount 1 (segunda sessão)", () => {
    expect(shouldShowModal({ shownCount: 1, engaged: false, coachDone: false }, false)).toBe(true);
  });

  // Sem nag infinito: 2 exibições esgotam o anúncio mesmo com coachDone false.
  it("NÃO é elegível com shownCount 2", () => {
    expect(shouldShowModal({ shownCount: 2, engaged: false, coachDone: false }, false)).toBe(false);
  });

  it("NÃO é elegível quando engajou", () => {
    expect(shouldShowModal({ shownCount: 0, engaged: true, coachDone: true }, false)).toBe(false);
  });

  // Refresh na mesma aba não conta segunda exibição.
  it("NÃO é elegível quando a sessão já exibiu", () => {
    expect(shouldShowModal(emptyState(), true)).toBe(false);
  });
});

// App "assentado" = FAB no DOM E nenhum TorqueLoader na tela. Enquanto não
// assentar, o modal não pode abrir (abriria por cima do loading).
describe("isAppSettled", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const addFab = () => {
    const fab = document.createElement("button");
    fab.setAttribute("data-support-fab", "");
    document.body.appendChild(fab);
  };

  const addLoader = () => {
    const loader = document.createElement("div");
    loader.setAttribute("data-torque-loader", "");
    document.body.appendChild(loader);
  };

  it("NÃO assentado sem FAB (loader full de auth, tela fullbleed/TV/login)", () => {
    expect(isAppSettled(document)).toBe(false);
  });

  it("NÃO assentado com FAB mas TorqueLoader presente (Suspense de chunk)", () => {
    addFab();
    addLoader();
    expect(isAppSettled(document)).toBe(false);
  });

  it("NÃO assentado com loader e sem FAB", () => {
    addLoader();
    expect(isAppSettled(document)).toBe(false);
  });

  it("assentado com FAB presente e nenhum loader", () => {
    addFab();
    expect(isAppSettled(document)).toBe(true);
  });

  it("volta a NÃO assentado quando um loader remonta depois do FAB existir", () => {
    addFab();
    expect(isAppSettled(document)).toBe(true);
    addLoader();
    expect(isAppSettled(document)).toBe(false);
  });
});

describe("readState", () => {
  it("sem nada gravado devolve estado zerado", () => {
    expect(readState(USER)).toEqual(emptyState());
  });

  it("JSON corrompido devolve estado zerado sem throw", () => {
    window.localStorage.setItem(KEY, "{corrompido!!!");
    expect(readState(USER)).toEqual(emptyState());
  });

  it("JSON válido mas de shape errado devolve zerado campo a campo", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ shownCount: "dois", engaged: "sim", coachDone: 1 }),
    );
    expect(readState(USER)).toEqual(emptyState());
  });

  it("shownCount negativo ou não-finito é normalizado pra 0", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ shownCount: -3 }));
    expect(readState(USER).shownCount).toBe(0);
  });

  it("estado escrito por writeState faz roundtrip", () => {
    writeState(USER, { shownCount: 1, engaged: true, coachDone: false });
    expect(readState(USER)).toEqual({ shownCount: 1, engaged: true, coachDone: false });
  });

  // Estado é por usuário: outro user no mesmo browser começa do zero.
  it("é escopado por userId", () => {
    writeState(USER, { shownCount: 2, engaged: true, coachDone: true });
    expect(readState("user-2")).toEqual(emptyState());
  });
});

describe("recordModalShown", () => {
  it("incrementa o contador e trava a sessão", () => {
    const next = recordModalShown(USER);
    expect(next.shownCount).toBe(1);
    expect(readState(USER).shownCount).toBe(1);
    expect(readSessionShown()).toBe(true);
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("1");
  });

  it("segunda sessão leva a 2 e esgota a elegibilidade", () => {
    recordModalShown(USER);
    window.sessionStorage.clear(); // "nova sessão"
    const next = recordModalShown(USER);
    expect(next.shownCount).toBe(2);
    expect(shouldShowModal(readState(USER), readSessionShown())).toBe(false);
  });
});

describe("markEngaged / markCoachDone", () => {
  it("markEngaged persiste engaged E coachDone", () => {
    markEngaged(USER);
    expect(readState(USER)).toMatchObject({ engaged: true, coachDone: true });
  });

  it("markCoachDone persiste só o coachDone", () => {
    markCoachDone(USER);
    expect(readState(USER)).toMatchObject({ engaged: false, coachDone: true });
  });

  it("preservam o shownCount existente", () => {
    recordModalShown(USER);
    markEngaged(USER);
    expect(readState(USER).shownCount).toBe(1);
  });
});

// Safari private mode: setItem lança QuotaExceededError; nada pode explodir.
describe("storage indisponível", () => {
  it("readState não explode quando getItem lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readState(USER)).toEqual(emptyState());
  });

  it("writeState/markEngaged/markCoachDone/recordModalShown não explodem quando setItem lança", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeState(USER, emptyState())).not.toThrow();
    expect(() => markEngaged(USER)).not.toThrow();
    expect(() => markCoachDone(USER)).not.toThrow();
    expect(() => recordModalShown(USER)).not.toThrow();
    expect(() => markSessionShown()).not.toThrow();
  });

  it("readSessionShown devolve false quando sessionStorage lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSessionShown()).toBe(false);
  });
});
