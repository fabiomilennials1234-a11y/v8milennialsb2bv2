import { describe, it, expect } from "vitest";
import {
  unificarCaixas,
  type CaixaDaLinha,
  type EntradaUnificada,
  type FonteUnificada,
  type ListaUnificada,
} from "./caixaUnificada";
import type { ChatContact, SocialContact } from "@/modules/communication/hooks/chat/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────
//
// As caixas nomeadas aqui são as de produção que motivaram o épico: na Chique o
// mesmo contato fala com um Chip ("Carol", uazapi) e com o canal oficial
// ("Chiquê", notificame). Nomear os dublês assim mantém o teste legível como
// cenário, e não como matriz de ids.

const carol: CaixaDaLinha = { id: "cx-carol", nome: "Carol", kind: "whatsapp" };
const chique: CaixaDaLinha = { id: "cx-chique", nome: "Chiquê", kind: "whatsapp", oficial: true };
const comercial: CaixaDaLinha = { id: "cx-comercial", nome: "Comercial", kind: "whatsapp" };
const tecnica: CaixaDaLinha = { id: "cx-tecnica", nome: "Técnica", kind: "whatsapp" };
const insta: CaixaDaLinha = { id: "cx-insta", nome: "@chiquestore", kind: "instagram" };

/** Uma conversa vinda de um Chip (RPC de WhatsApp por QR). */
function doChip(
  caixa: CaixaDaLinha,
  phone: string,
  quando: string,
  over: Partial<ChatContact> = {},
): EntradaUnificada {
  const contato: ChatContact = {
    channel: "whatsapp",
    instance_id: caixa.id,
    phone_number: phone,
    push_name: `chip ${phone}`,
    last_message: "oi",
    last_message_time: quando,
    last_message_direction: "incoming",
    last_message_sent_source: null,
    unread_count: 0,
    lead_id: null,
    lead_name: null,
    conversation_id: null,
    archived_at: null,
    tags: [],
    is_group: false,
    ...over,
  };
  return { contato, caixa };
}

/** Uma conversa vinda de uma caixa que lê `channel_messages`. */
function social(
  caixa: CaixaDaLinha,
  channel: SocialContact["channel"],
  externalUserId: string,
  quando: string,
  over: Partial<SocialContact> = {},
): EntradaUnificada {
  const contato: SocialContact = {
    channel,
    conversation_key: `${channel}:${caixa.id}:${externalUserId}`,
    messaging_channel_id: caixa.id,
    external_user_id: externalUserId,
    handle: null,
    display_name: `${channel} ${externalUserId}`,
    avatar_url: null,
    last_message: "oi",
    last_message_time: quando,
    last_message_direction: "incoming",
    unread_count: 0,
    lead_id: null,
    lead_name: null,
    tags: [],
    ...over,
  };
  return { contato, caixa };
}

const doOficial = (caixa: CaixaDaLinha, telefone: string, quando: string) =>
  social(caixa, "whatsapp_oficial", telefone, quando);

const doInstagram = (caixa: CaixaDaLinha, igsid: string, quando: string) =>
  social(caixa, "instagram", igsid, quando);

const fonte = (entradas: EntradaUnificada[], cheia = false): FonteUnificada => ({ entradas, cheia });

/** O que o vendedor lê na lista, de cima para baixo. */
const rotulos = (lista: ListaUnificada) =>
  lista.linhas.map((l) =>
    l.contato.channel === "whatsapp" ? l.contato.push_name : l.contato.display_name,
  );

const chaves = (lista: ListaUnificada) => lista.linhas.map((l) => l.chave);

/** Os fios de cada linha, por nome de caixa — o que a UI desenha ao lado dela. */
const fios = (lista: ListaUnificada) => lista.linhas.map((l) => l.tambemEm.map((c) => c.nome));

// ─── Mistura por recência ───────────────────────────────────────────────────

describe("unificarCaixas — mistura por recência", () => {
  it("intercala duas caixas pela hora da última mensagem, não pela fonte", () => {
    // A promessa central do épico: a lista é UMA, ordenada por recência. Se o
    // motor concatenasse fonte a fonte, a caixa que o hook resolvesse primeiro
    // apareceria inteira no topo e a segunda caixa viraria um bloco morto no pé.
    const a = fonte([
      doChip(comercial, "5548911110000", "2026-09-03T12:00:00Z"),
      doChip(comercial, "5548911112222", "2026-09-03T08:00:00Z"),
    ]);
    const b = fonte([
      doChip(tecnica, "5548933330000", "2026-09-03T10:00:00Z"),
      doChip(tecnica, "5548933334444", "2026-09-03T06:00:00Z"),
    ]);

    expect(rotulos(unificarCaixas([a, b]))).toEqual([
      "chip 5548911110000",
      "chip 5548933330000",
      "chip 5548911112222",
      "chip 5548933334444",
    ]);
  });

  it("intercala Chip com canal oficial — a fonte da linha não influencia a ordem", () => {
    const chip = fonte([doChip(carol, "5548911110000", "2026-09-03T09:00:00Z")]);
    const oficial = fonte([
      doOficial(chique, "554899999999", "2026-09-03T11:00:00Z"),
      doOficial(chique, "554888888888", "2026-09-03T07:00:00Z"),
    ]);

    expect(rotulos(unificarCaixas([oficial, chip]))).toEqual([
      "whatsapp_oficial 554899999999",
      "chip 5548911110000",
      "whatsapp_oficial 554888888888",
    ]);
  });
});

// ─── Uma linha por caixa (decisão travada) ──────────────────────────────────

describe("unificarCaixas — uma linha por caixa", () => {
  it("o mesmo telefone em duas caixas dá duas linhas, com chaves distintas, ligadas entre si", () => {
    // Decisão 1 do grill: a Conversa do Lead é o par (Lead ↔ caixa). A Alamaster
    // separou 57 números por departamento de propósito — fundir apagaria o
    // assunto de uma das duas conversas.
    const lista = unificarCaixas([
      fonte([doChip(comercial, "5548988334050", "2026-09-03T12:00:00Z")]),
      fonte([doChip(tecnica, "5548988334050", "2026-09-03T09:00:00Z")]),
    ]);

    expect(lista.linhas).toHaveLength(2);
    expect(chaves(lista)).toEqual([
      "whatsapp:cx-comercial:5548988334050",
      "whatsapp:cx-tecnica:5548988334050",
    ]);
    expect(fios(lista)).toEqual([["Técnica"], ["Comercial"]]);
  });

  it("telefones diferentes na mesma caixa não ganham fio", () => {
    const lista = unificarCaixas([
      fonte([
        doChip(comercial, "5548911110000", "2026-09-03T12:00:00Z"),
        doChip(comercial, "5548922220000", "2026-09-03T11:00:00Z"),
      ]),
    ]);

    expect(fios(lista)).toEqual([[], []]);
  });

  it("Chique: o Chip e o canal oficial reconhecem o mesmo contato apesar do formato do número", () => {
    // O caso REAL que originou o épico. No Chip o telefone chega formatado; no
    // canal oficial o `external_user_id` é o mesmo número em dígitos crus. Sem
    // normalizar OS DOIS LADOS com a mesma função, nenhum dos 10 contatos
    // sobrepostos da Chique casaria — e a promessa "esta pessoa também fala na
    // outra caixa" nunca apareceria na tela.
    const lista = unificarCaixas([
      fonte([doChip(carol, "+55 48 98833-4050", "2026-09-03T12:00:00Z")]),
      fonte([doOficial(chique, "5548988334050", "2026-09-03T10:00:00Z")]),
    ]);

    expect(lista.linhas).toHaveLength(2);
    expect(chaves(lista)).toEqual([
      "whatsapp:cx-carol:+55 48 98833-4050",
      "whatsapp_oficial:cx-chique:5548988334050",
    ]);
    expect(fios(lista)).toEqual([["Chiquê"], ["Carol"]]);
  });

  it("um IGSID só de dígitos não vira telefone", () => {
    // O namespace `ig:` existe por este risco: um IGSID pode, por azar, ser uma
    // sequência de dígitos que `normalizePhone` aceita. Ligar esse perfil ao
    // telefone homônimo mostraria "também fala no Instagram" para uma pessoa
    // que nunca falou.
    const lista = unificarCaixas([
      fonte([doChip(carol, "+55 48 98833-4050", "2026-09-03T12:00:00Z")]),
      fonte([doInstagram(insta, "5548988334050", "2026-09-03T10:00:00Z")]),
    ]);

    expect(lista.linhas).toHaveLength(2);
    expect(fios(lista)).toEqual([[], []]);
  });
});

// ─── Piso de confiança ──────────────────────────────────────────────────────

describe("unificarCaixas — piso de confiança", () => {
  const cheiaComDuas = () =>
    fonte(
      [
        doChip(comercial, "5548911110000", "2026-09-03T12:00:00Z"),
        doChip(comercial, "5548911112222", "2026-09-02T09:00:00Z"),
      ],
      true,
    );

  const curtaComDuas = () =>
    fonte([
      doChip(tecnica, "5548933330000", "2026-09-02T18:00:00Z"),
      doChip(tecnica, "5548933334444", "2026-09-01T08:00:00Z"),
    ]);

  it("fonte cheia impede buraco: nada mais antigo que a linha mais velha dela entra", () => {
    // Cada RPC corta o SEU conjunto em N. A fonte cheia parou em 02/09 09h —
    // existe conversa dela entre 01/09 e 02/09 que não veio. Deixar a linha de
    // 01/09 da outra fonte aparecer seria desenhar o fim da lista por cima de um
    // buraco: a pessoa rola até o fim e não vê o que existe.
    const lista = unificarCaixas([cheiaComDuas(), curtaComDuas()]);

    expect(rotulos(lista)).toEqual([
      "chip 5548911110000",
      "chip 5548933330000",
      "chip 5548911112222", // exatamente no piso: fica
    ]);
    expect(lista.truncada).toBe(true);
  });

  it("fonte NÃO cheia não impõe piso nenhum", () => {
    // Controle positivo do caso acima: mesmos dados, só muda `cheia`. A fonte
    // que devolveu tudo que tinha não esconde nada abaixo da própria cauda —
    // impor piso aqui truncaria a lista de uma org pequena sem motivo.
    const lista = unificarCaixas([fonte(cheiaComDuas().entradas.slice()), curtaComDuas()]);

    expect(rotulos(lista)).toEqual([
      "chip 5548911110000",
      "chip 5548933330000",
      "chip 5548911112222",
      "chip 5548933334444",
    ]);
    expect(lista.truncada).toBe(false);
  });

  it("duas fontes cheias: vale o piso MAIS ALTO", () => {
    const antiga = fonte([doChip(comercial, "5548911110000", "2026-09-01T00:00:00Z")], true);
    const recente = fonte(
      [
        doChip(tecnica, "5548933330000", "2026-09-03T00:00:00Z"),
        doChip(tecnica, "5548933334444", "2026-09-02T00:00:00Z"),
      ],
      true,
    );

    const lista = unificarCaixas([antiga, recente]);
    expect(rotulos(lista)).toEqual(["chip 5548933330000", "chip 5548933334444"]);
    expect(lista.truncada).toBe(true);
  });

  it("fonte cheia vazia não impõe piso (a org só não tem conversa nessa caixa)", () => {
    const lista = unificarCaixas([
      fonte([], true),
      fonte([doChip(tecnica, "5548933330000", "2026-09-01T00:00:00Z")]),
    ]);

    expect(rotulos(lista)).toEqual(["chip 5548933330000"]);
    expect(lista.truncada).toBe(false);
  });
});

// ─── Ordenação defensiva ────────────────────────────────────────────────────

describe("unificarCaixas — ordenação defensiva", () => {
  it("hora ausente manda a linha para o fim em vez de derrubar a ordem", () => {
    // Como no engine de filtro: dado torto degrada UMA linha, nunca a lista.
    // Construir `Date` por linha aqui seria caro (4.209 conversas na Alamaster)
    // e um `Invalid Date` no comparador embaralha tudo.
    const semHora = doChip(comercial, "5548900000000", "2026-09-03T12:00:00Z");
    (semHora.contato as { last_message_time: unknown }).last_message_time = null;

    const lista = unificarCaixas([
      fonte([semHora]),
      fonte([
        doChip(tecnica, "5548933330000", "2026-09-03T10:00:00Z"),
        doChip(tecnica, "5548933334444", "2026-09-03T11:00:00Z"),
      ]),
    ]);

    expect(rotulos(lista)).toEqual([
      "chip 5548933334444",
      "chip 5548933330000",
      "chip 5548900000000",
    ]);
  });

  it("string que não é data não lança e não embaralha as linhas válidas entre si", () => {
    const torta = doChip(comercial, "5548900000000", "ontem à noite");

    const lista = unificarCaixas([
      fonte([torta]),
      fonte([
        doChip(tecnica, "5548933330000", "2026-09-03T10:00:00Z"),
        doChip(tecnica, "5548933334444", "2026-09-03T11:00:00Z"),
      ]),
    ]);

    expect(lista.linhas).toHaveLength(3);
    const validas = rotulos(lista).filter((n) => n !== "chip 5548900000000");
    expect(validas).toEqual(["chip 5548933334444", "chip 5548933330000"]);
  });
});

// ─── Estabilidade no empate ─────────────────────────────────────────────────

describe("unificarCaixas — empate de instante", () => {
  const mesmoInstante = "2026-09-03T12:00:00Z";

  it("empate desempata por chave, não pela ordem de chegada das fontes", () => {
    // Duas fontes resolvem em ordem imprevisível. Sem desempate a linha "pisca"
    // de lugar entre renders sem ninguém ter mexido nela — a mesma classe de
    // defeito de uma paginação de conjunto sem chave de desempate.
    const a = fonte([doChip(comercial, "5548911110000", mesmoInstante)]);
    const b = fonte([doChip(tecnica, "5548933330000", mesmoInstante)]);

    const esperado = ["whatsapp:cx-comercial:5548911110000", "whatsapp:cx-tecnica:5548933330000"];
    expect(chaves(unificarCaixas([a, b]))).toEqual(esperado);
    expect(chaves(unificarCaixas([b, a]))).toEqual(esperado);
  });

  it("empate atravessando canais também é estável", () => {
    const chip = fonte([doChip(carol, "5548911110000", mesmoInstante)]);
    const oficial = fonte([doOficial(chique, "554899999999", mesmoInstante)]);
    const ig = fonte([doInstagram(insta, "17841400000000000", mesmoInstante)]);

    expect(chaves(unificarCaixas([chip, oficial, ig]))).toEqual(
      chaves(unificarCaixas([ig, chip, oficial])),
    );
  });
});

// ─── Limite ─────────────────────────────────────────────────────────────────

describe("unificarCaixas — limite", () => {
  it("corta o fim da lista e marca truncada", () => {
    const lista = unificarCaixas(
      [
        fonte([
          doChip(comercial, "5548911110000", "2026-09-03T12:00:00Z"),
          doChip(comercial, "5548911112222", "2026-09-03T08:00:00Z"),
        ]),
        fonte([doChip(tecnica, "5548933330000", "2026-09-03T10:00:00Z")]),
      ],
      { limite: 2 },
    );

    expect(rotulos(lista)).toEqual(["chip 5548911110000", "chip 5548933330000"]);
    expect(lista.truncada).toBe(true);
  });

  it("o fio só cita caixa que sobrou na tela", () => {
    // A linha da Técnica foi cortada pelo limite: ela não está na tela para ser
    // aberta. Prometer "também fala na Técnica" na linha do Comercial seria uma
    // promessa que a lista não cumpre — clicar no fio não leva a lugar nenhum.
    const lista = unificarCaixas(
      [
        fonte([doChip(comercial, "5548988334050", "2026-09-03T12:00:00Z")]),
        fonte([
          doChip(tecnica, "5548922220000", "2026-09-03T11:00:00Z"),
          doChip(tecnica, "5548988334050", "2026-09-03T06:00:00Z"),
        ]),
      ],
      { limite: 2 },
    );

    expect(chaves(lista)).toEqual([
      "whatsapp:cx-comercial:5548988334050",
      "whatsapp:cx-tecnica:5548922220000",
    ]);
    expect(fios(lista)).toEqual([[], []]);
    expect(lista.truncada).toBe(true);
  });

  it("limite maior que a lista não trunca nem some com fio", () => {
    const lista = unificarCaixas(
      [
        fonte([doChip(comercial, "5548988334050", "2026-09-03T12:00:00Z")]),
        fonte([doChip(tecnica, "5548988334050", "2026-09-03T06:00:00Z")]),
      ],
      { limite: 50 },
    );

    expect(fios(lista)).toEqual([["Técnica"], ["Comercial"]]);
    expect(lista.truncada).toBe(false);
  });
});

// ─── Org de uma caixa só ────────────────────────────────────────────────────

describe("unificarCaixas — org de uma caixa só", () => {
  it("devolve a entrada intacta, na mesma ordem, sem fio nenhum", () => {
    // 42 das ~60 orgs têm uma Instance só. Para elas a caixa unificada não pode
    // ser perceptível de forma alguma: nem reordenação, nem selo, nem fio.
    const entradas = [
      doChip(comercial, "5548911110000", "2026-09-03T12:00:00Z"),
      doChip(comercial, "5548922220000", "2026-09-03T11:00:00Z"),
      doChip(comercial, "5548933330000", "2026-09-03T10:00:00Z"),
    ];

    const lista = unificarCaixas([fonte(entradas, true)]);

    expect(lista.linhas.map((l) => l.contato)).toEqual(entradas.map((e) => e.contato));
    expect(fios(lista)).toEqual([[], [], []]);
    expect(lista.truncada).toBe(false);
  });

  it("lista vazia não trunca", () => {
    expect(unificarCaixas([fonte([], true)])).toEqual({ linhas: [], truncada: false });
    expect(unificarCaixas([])).toEqual({ linhas: [], truncada: false });
  });
});
