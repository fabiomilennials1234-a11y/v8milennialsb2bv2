// @vitest-environment node
/**
 * Atribuição é opcional, como o pixel: sem public/lp/_shared/cal-metadata.js (rede, ou HTML em cache com lp.js novo),
 * os botões de agenda e de dúvida precisam continuar funcionando. Roda o lp.js real sobre o HTML real das duas LPs.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../public/lp");
const lpSource = fs.readFileSync(path.join(root, "_shared/lp.js"), "utf8");
const helperSource = fs.readFileSync(path.join(root, "_shared/cal-metadata.js"), "utf8");
const pageHtml = (page: string) => fs.readFileSync(path.join(root, page, "index.html"), "utf8");

function boot(page: string, helper?: unknown) {
  // `outside-only`: nenhum <script> do HTML roda; só o que este teste passa por eval.
  const dom = new JSDOM(pageHtml(page), { url:`https://torquecrm.com.br/lp/${page}/?utm_source=meta`, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
  win.matchMedia = (() => ({ matches: true })) as unknown as typeof win.matchMedia;
  win.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  win.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  if (helper === "real") dom.window.eval(helperSource);
  else if (helper) win.TorqueCalMetadata = helper;
  const errors: unknown[] = [];
  win.addEventListener("error", (e) => errors.push(e.error ?? e.message));
  dom.window.eval(lpSource);
  return { win, errors };
}

/** Configuração entregue ao embed: a fila do Cal guarda a chamada `inline` até o script dele carregar. */
function inlineConfig(win: Window & typeof globalThis): Record<string, string> {
  const cal = (win as unknown as { Cal: { ns: Record<string, { q: ArrayLike<unknown>[] }> } }).Cal;
  const [ns] = Object.values(cal.ns);
  const call = Array.from(ns.q).map((entry) => Array.from(entry)).find((entry) => entry[0] === "inline");
  expect(call).toBeDefined();
  return (call![1] as { config: Record<string, string> }).config;
}

const click = (win: Window & typeof globalThis, selector: string) => {
  const cta = win.document.querySelector(selector);
  expect(cta).not.toBeNull();
  cta!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
};
const openDialogs = (win: Window & typeof globalThis) => win.document.querySelectorAll("dialog[open]").length;

const quebrado = {
  build() { throw new Error("build"); },
  toConfig() { throw new Error("toConfig"); },
  withQuery() { throw new URIError("URI malformed"); },
};

describe.each(["crm-b2b", "gestao-comercial"])("LP %s com a atribuição fora do ar", (page) => {
  it.each([
    ["script ausente", undefined],
    ["script que lança", quebrado],
  ])("%s: boot não quebra e os dois CTAs abrem", (_caso, helper) => {
    const { win, errors } = boot(page, helper);
    expect(errors).toEqual([]);

    click(win, "[data-duvidas]");
    expect(openDialogs(win)).toBe(1);
    win.document.querySelector<HTMLDialogElement>("dialog[open]")!.close();

    click(win, "[data-agendar]");
    expect(openDialogs(win)).toBe(1);
    // O diálogo abre antes do embed: sem isto, a agenda morta passaria com o CTA "ok".
    expect(errors).toEqual([]);
    expect(Object.keys(inlineConfig(win)).filter((key) => key.startsWith("metadata["))).toEqual([]);
  });

  it("link direto cai na agenda limpa", () => {
    const { win } = boot(page);
    const links = [...win.document.querySelectorAll<HTMLAnchorElement>("[data-cal-link]")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.href).toMatch(/^https:\/\/cal\.com\/[^?]+$/);
  });
});

/* O try/catch tirou o erro barulhento: perder o helper agora zera a atribuição em silêncio, então o caminho feliz é cobrado. */
describe.each(["crm-b2b", "gestao-comercial"])("LP %s com a atribuição no ar", (page) => {
  it("a página carrega o helper antes do lp.js", () => {
    const html = pageHtml(page);
    const helperAt = html.search(/<script[^>]+_shared\/cal-metadata\.js/);
    const lpAt = html.search(/<script[^>]+_shared\/lp\.js/);
    expect(helperAt).toBeGreaterThan(-1);
    expect(lpAt).toBeGreaterThan(helperAt);
  });

  it("link direto e embed saem com a atribuição", () => {
    const { win, errors } = boot(page, "real");
    expect(errors).toEqual([]);

    const links = [...win.document.querySelectorAll<HTMLAnchorElement>("[data-cal-link]")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const url = new URL(link.href);
      expect(url.searchParams.get("metadata[utm_source]")).toBe("meta");
      expect(url.searchParams.get("metadata[lp]")).toBeTruthy();
    }

    click(win, "[data-agendar]");
    expect(errors).toEqual([]);
    const config = inlineConfig(win);
    expect(config["metadata[utm_source]"]).toBe("meta");
    expect(config["metadata[lp]"]).toBeTruthy();
  });
});

/* O app Meta Pixel do Cal dispara Schedule com `eid=<uid>` no frame da agenda: id diferente aqui conta a reserva em dobro. */
describe.each(["crm-b2b", "gestao-comercial"])("LP %s: id da conversão", (page) => {
  function reservar(data: Record<string, unknown>) {
    const { win, errors } = boot(page, "real");
    const track: unknown[][] = [];
    const posts: Array<Record<string, unknown>> = [];
    const w = win as unknown as Record<string, unknown>;
    w.fbq = (...args: unknown[]) => track.push(args);
    w.fetch = (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve({ ok: true });
    };
    click(win, "[data-agendar]");
    const cal = (win as unknown as { Cal: { ns: Record<string, { q: ArrayLike<unknown>[] }> } }).Cal;
    const [ns] = Object.values(cal.ns);
    const on = Array.from(ns.q)
      .map((entry) => Array.from(entry) as [string, { action: string; callback: (e: unknown) => void }])
      .find((entry) => entry[0] === "on" && entry[1].action === "bookingSuccessful");
    expect(on).toBeDefined();
    on![1].callback({ detail: { data } });
    expect(errors).toEqual([]);
    return { track, posts };
  }

  it("usa o uid puro do Cal no pixel e no aviso ao servidor", () => {
    const { track, posts } = reservar({
      date: "2027-01-29T13:00:00.000Z",
      booking: { uid: "jHmw7oB6hJZXXuvxgsPRyA", startTime: "2027-01-29T13:00:00.000Z", responses: { name: "A", telefone: "+5548900000000" } },
    });
    const schedule = track.filter((call) => call[1] === "Schedule");
    expect(schedule).toHaveLength(1);
    expect(schedule[0][3]).toEqual({ eventID: "jHmw7oB6hJZXXuvxgsPRyA" });
    expect(posts.map((body) => body.event_id)).toEqual(["jHmw7oB6hJZXXuvxgsPRyA"]);
  });

  it("sem uid do Cal, ainda sai um id para o pixel", () => {
    const { track } = reservar({ date: "2027-01-29T13:00:00.000Z", booking: { responses: { name: "A" } } });
    const schedule = track.filter((call) => call[1] === "Schedule");
    expect(schedule).toHaveLength(1);
    expect((schedule[0][3] as { eventID: string }).eventID).toBeTruthy();
  });
});
