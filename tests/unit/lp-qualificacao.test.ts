// @vitest-environment node
/**
 * Perguntas de qualificação que a LP repassa ao n8n: `erp` e `cargo`
 * vêm de `booking.responses` do Cal; `erp` também sai do formulário "Tirar minhas dúvidas". O formulário do evento no Cal
 * ganha as perguntas depois do deploy da LP: reserva sem elas precisa sair igual, com as chaves vazias.
 * Roda o lp.js real sobre o HTML real das duas LPs.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../public/lp");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const sources = ["_shared/phone.js", "_shared/cal-metadata.js", "_shared/lp.js"].map(read);

type Win = Window & typeof globalThis & Record<string, unknown>;
type Payload = Record<string, unknown>;

const ERP_OPTIONS = [
  "Omie",
  "Bling",
  "Tiny (Olist)",
  "Sankhya",
  "TOTVS (Protheus/Winthor)",
  "SAP Business One",
  "Conta Azul",
  "Outro",
  "Não usamos ERP",
];
const QUALIFICACAO = ["erp", "cargo"] as const;

function boot(page: string) {
  // `outside-only`: nenhum <script> do HTML roda; só o que este teste passa por eval.
  const dom = new JSDOM(read(`${page}/index.html`), {
    url: `https://torquecrm.com.br/lp/${page}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Win;
  win.matchMedia = (() => ({ matches: true })) as unknown as typeof win.matchMedia;
  win.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  win.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  const posts: Payload[] = [];
  win.fetch = ((_url: string, init: { body: string }) => {
    posts.push(JSON.parse(init.body) as Payload);
    return Promise.resolve({ ok: true });
  }) as unknown as typeof win.fetch;
  const beacons: Blob[] = [];
  Object.defineProperty(win.navigator, "sendBeacon", { value: (_url: string, blob: Blob) => (beacons.push(blob), true) });
  const errors: unknown[] = [];
  win.addEventListener("error", (e) => errors.push(e.error ?? e.message));
  for (const source of sources) dom.window.eval(source);
  // A navegação para o WhatsApp não existe no JSDOM; aqui só importa o que foi enviado antes dela.
  dom.window.eval("window.location.assign = function () {};");
  return { win, posts, beacons, errors };
}

function click(win: Win, selector: string) {
  const el = win.document.querySelector(selector);
  expect(el).not.toBeNull();
  el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function reservar(page: string, responses: Record<string, unknown>) {
  const { win, posts, errors } = boot(page);
  click(win, "[data-agendar]");
  const cal = (win as unknown as { Cal: { ns: Record<string, { q: ArrayLike<unknown>[] }> } }).Cal;
  const [ns] = Object.values(cal.ns);
  const on = Array.from(ns.q)
    .map((entry) => Array.from(entry) as [string, { action: string; callback: (e: unknown) => void }])
    .find((entry) => entry[0] === "on" && entry[1].action === "bookingSuccessful");
  expect(on).toBeDefined();
  on![1].callback({
    detail: {
      data: {
        booking: { uid: "uid-1", startTime: "2027-01-29T13:00:00.000Z", responses: { name: "Ana", email: "ana@x.test", ...responses } },
      },
    },
  });
  expect(errors).toEqual([]);
  expect(posts).toHaveLength(1);
  return posts[0];
}

describe.each(["crm-b2b", "gestao-comercial"])("LP %s: qualificação na reserva do Cal", (page) => {
  it("perguntas ainda fora do Cal: payload de antes, com as 2 chaves vazias", () => {
    const payload = reservar(page, { empresa: "ACME", maior_dificuldade: "Follow-up" });
    for (const key of QUALIFICACAO) expect(payload[key]).toBe("");
    expect(Object.keys(payload)).not.toContain("vendedores");
    expect(payload).toMatchObject({ nome: "Ana", email: "ana@x.test", empresa: "ACME", desafio: "Follow-up", booking_uid: "uid-1" });
  });

  it("resposta em texto vai como o texto da opção", () => {
    const payload = reservar(page, { erp: " Omie ", cargo: "Dono ou sócio" });
    expect(payload).toMatchObject({ erp: "Omie", cargo: "Dono ou sócio" });
  });

  it("resposta embrulhada em { label, value } vale pelo value", () => {
    const payload = reservar(page, {
      erp: { label: "Qual ERP sua empresa usa?", value: "TOTVS (Protheus/Winthor)" },
      cargo: { label: "Qual o seu papel na empresa?", value: { value: "Diretor" } },
    });
    expect(payload).toMatchObject({ erp: "TOTVS (Protheus/Winthor)", cargo: "Diretor" });
  });

  it("objeto sem value e resposta nula não inventam dado", () => {
    for (const [erp, cargo] of [[{ label: "Omie" }, null], [{}, undefined]]) {
      const payload = reservar(page, { erp, cargo });
      for (const key of QUALIFICACAO) expect(payload[key]).toBe("");
    }
  });
});

describe.each(["crm-b2b", "gestao-comercial"])("LP %s: ERP no formulário de dúvida", (page) => {
  function preencher(win: Win, erp: string) {
    click(win, "[data-duvidas]");
    const set = (id: string, value: string) => {
      const el = win.document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
      el.value = value;
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
    };
    set("d-nome", "Ana");
    set("d-empresa", "ACME");
    set("d-whatsapp", "48984334050");
    set("d-email", "ana@x.test");
    set("d-erp", erp);
    win.document.getElementById("duvidasForm")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  }

  it("select com placeholder e as mesmas opções da reserva", () => {
    const { win } = boot(page);
    const select = win.document.querySelector<HTMLSelectElement>("#duvidasForm select[name='erp']");
    expect(select).not.toBeNull();
    expect(select!.required).toBe(true);
    const options = [...select!.options];
    expect(options[0]).toMatchObject({ value: "", text: "Selecione", disabled: true });
    expect(options.slice(1).map((o) => o.value)).toEqual(ERP_OPTIONS);
    expect(options.slice(1).map((o) => o.text)).toEqual(ERP_OPTIONS);
    expect(win.document.querySelector("label[for='d-erp']")!.textContent).toBe("Qual ERP sua empresa usa?");
  });

  it("sem ERP não envia, marca o campo e mostra o erro", () => {
    const { win, beacons, posts, errors } = boot(page);
    preencher(win, "");
    expect(errors).toEqual([]);
    expect(beacons).toHaveLength(0);
    expect(posts).toHaveLength(0);
    const select = win.document.getElementById("d-erp")!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(win.document.getElementById("d-erp-erro")!.hidden).toBe(false);
    expect(win.document.activeElement).toBe(select);
  });

  it("escolher depois do erro limpa a marca", () => {
    const { win } = boot(page);
    preencher(win, "");
    const select = win.document.getElementById("d-erp") as HTMLSelectElement;
    select.value = "Bling";
    select.dispatchEvent(new win.Event("change", { bubbles: true }));
    expect(select.hasAttribute("aria-invalid")).toBe(false);
    expect(win.document.getElementById("d-erp-erro")!.hidden).toBe(true);
  });

  it("com ERP, o payload da dúvida leva `erp`", async () => {
    const { win, beacons, errors } = boot(page);
    preencher(win, "Não usamos ERP");
    expect(errors).toEqual([]);
    expect(beacons).toHaveLength(1);
    const payload = JSON.parse(await beacons[0].text()) as Payload;
    expect(payload).toMatchObject({ evento: "duvida", nome: "Ana", empresa: "ACME", erp: "Não usamos ERP", email: "ana@x.test" });
  });
});
