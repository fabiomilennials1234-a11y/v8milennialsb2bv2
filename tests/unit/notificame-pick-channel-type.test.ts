/**
 * Fatia 1.1 — `pickNewChannel` ganha o filtro de TIPO, e ele é a única coisa que
 * separa "conectou o Instagram" de "vinculou o WhatsApp do vizinho como se fosse
 * Instagram".
 *
 * O porquê, em uma linha: o `postMessage` do Seamless devolve
 * `{status:"channel-success"}` — IDÊNTICO para whatsapp e para instagram, sem id
 * e sem telefone. A identidade do canal recém-nascido é DEDUZIDA por diferença
 * contra a baseline. Se dois canais de tipos diferentes nascerem depois da foto,
 * o diff sozinho vê dois candidatos e para em `ambiguous_channel` — mesmo o caso
 * sendo perfeitamente decidível, porque nós SABEMOS qual tipo foi pedido no
 * clique (está gravado em `notificame_connect_sessions.requested_channel_type`).
 *
 * Os quatro eixos travados aqui:
 *   1. FILTRA — pedido 'instagram' com um canal de cada tipo escolhe o IG.
 *      Sem o filtro isto é `ambiguous_channel` e a conexão morre.
 *   2. NÃO DESCARTA O DESCONHECIDO — tipo que o normalizador não reconhece
 *      permanece candidato. Descartar deixaria um canal FATURÁVEL e IRREMOVÍVEL
 *      órfão no fornecedor, alcançável por nenhuma tela: desfecho pior que um
 *      `ambiguous_channel`, que ao menos é retentável.
 *   3. DEGRADA — sem sessão (`requestedType = null`) o comportamento é o de hoje,
 *      byte a byte. Controle positivo: estes casos passam ANTES da 1.1 e têm que
 *      continuar passando depois.
 *   4. ORDEM DAS EXCLUSÕES — baseline e reivindicados continuam mandando. O
 *      filtro de tipo ESTREITA os candidatos; ele nunca RESSUSCITA um canal que
 *      já tem dono, que seria vínculo cross-tenant.
 *
 * Sem rede, sem banco.
 */
import { describe, it, expect } from "vitest";
import {
  pickNewChannel,
  type NotificameChannel,
} from "../../supabase/functions/_shared/notificame";

// ── fixtures ─────────────────────────────────────────────────────────────────

const wa = (id: string, type: string | null = "whatsapp"): NotificameChannel => ({
  id,
  name: `Canal ${id}`,
  phone: "5511988887777",
  type,
  status: "connected",
});

const ig = (id: string, type: string | null = "instagram"): NotificameChannel => ({
  id,
  name: `@perfil_${id}`,
  phone: null,
  type,
  status: "connected",
});

const NONE = new Set<string>();

// ── 1. o caso decisivo ───────────────────────────────────────────────────────

describe("pickNewChannel com requestedType — o caso que sem o filtro morreria", () => {
  it("baseline vazia, um canal de cada tipo, pedido='instagram' ⇒ escolhe o Instagram", () => {
    // ESTE é o caso. Sem o quarto parâmetro são dois candidatos, o resultado é
    // `ambiguous_channel`, e o usuário vê "outra conexão está em andamento" logo
    // depois de concluir o fluxo da Meta — com o canal já nascido e faturável.
    const r = pickNewChannel([wa("ch_wa"), ig("ch_ig")], new Set(), NONE, "instagram");

    expect(r.ok).toBe(true);
    expect(r.ok && r.channel.id).toBe("ch_ig");
  });

  it("simétrico: o mesmo par com pedido='whatsapp' ⇒ escolhe o WhatsApp", () => {
    // A simetria não é decoração: prova que o filtro é por VALOR PEDIDO e não um
    // `if (type === 'instagram')` colado por cima do caminho antigo.
    const r = pickNewChannel([wa("ch_wa"), ig("ch_ig")], new Set(), NONE, "whatsapp");

    expect(r.ok).toBe(true);
    expect(r.ok && r.channel.id).toBe("ch_wa");
  });

  it("tolera a caixa e o alias do fornecedor ('IG', 'WA') — o discriminante é indocumentado", () => {
    // O `type` vem do `GET /v1/channels`, rota cujo contrato saiu do SDK e não da
    // doc. O normalizador é tolerante ali de propósito; este teste garante que a
    // tolerância CHEGA até a decisão de vínculo.
    const r = pickNewChannel([wa("ch_wa", "WA"), ig("ch_ig", "IG")], new Set(), NONE, "instagram");

    expect(r.ok && r.channel.id).toBe("ch_ig");
  });

  it("nenhum canal do tipo pedido ⇒ no_channel_found (RETENTÁVEL), nunca o do outro tipo", () => {
    // A distinção importa no cliente: `no_channel_found` é retentado (o
    // `/v1/channels` é eventualmente consistente logo após o canal nascer);
    // `ambiguous_channel` sem sessão não é. E o desfecho proibido — devolver o
    // canal de WhatsApp para um pedido de Instagram — é o vínculo errado que
    // acabaria escrevendo em `messaging_channels` um canal que fala WhatsApp.
    const r = pickNewChannel([wa("ch_wa")], new Set(), NONE, "instagram");

    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("no_channel_found");
    expect(!r.ok && r.candidates).toBe(0);
  });

  it("dois canais do MESMO tipo pedido continuam ambíguos — o filtro não adivinha", () => {
    // O filtro estreita; ele não escolhe. Concorrência real dentro do mesmo tipo
    // segue parando, que é o desfecho conservador correto.
    const r = pickNewChannel([ig("ch_a"), ig("ch_b")], new Set(), NONE, "instagram");

    expect(!r.ok && r.code).toBe("ambiguous_channel");
    expect(!r.ok && r.candidates).toBe(2);
  });
});

// ── 2. tipo desconhecido — nunca descartar ───────────────────────────────────

describe("tipo que o normalizador NÃO reconhece permanece candidato", () => {
  it("único canal listado tem type='reels' e o pedido é 'instagram' ⇒ vincula mesmo assim", () => {
    // A regra que parece errada e é a certa. Se o fornecedor renomear o
    // discriminante, descartar o canal deixaria um objeto FATURÁVEL e
    // IRREMOVÍVEL vivo do lado dele, sem nenhuma tela que o alcance — e o
    // usuário veria "não encontramos seu canal" depois de já ter conectado.
    // Vincular e LOGAR `notificame.unknown_channel_type` é o desfecho reversível.
    const r = pickNewChannel([ig("ch_novo", "reels")], new Set(), NONE, "instagram");

    expect(r.ok).toBe(true);
    expect(r.ok && r.channel.id).toBe("ch_novo");
  });

  it("desconhecido + um do tipo pedido ⇒ ambíguo: não reconhecer não é excluir", () => {
    const r = pickNewChannel([ig("ch_novo", "reels"), ig("ch_ig")], new Set(), NONE, "instagram");

    expect(!r.ok && r.code).toBe("ambiguous_channel");
    expect(!r.ok && r.candidates).toBe(2);
  });

  it("type ausente (null/undefined) também permanece candidato", () => {
    // O fornecedor pode simplesmente não mandar o campo. Ausência de informação
    // não pode virar decisão de descarte.
    const semTipo: NotificameChannel = { id: "ch_sem_tipo", type: null };
    expect(pickNewChannel([semTipo], new Set(), NONE, "instagram").ok).toBe(true);
    expect(pickNewChannel([{ id: "ch2" }], new Set(), NONE, "whatsapp").ok).toBe(true);
  });

  it("um tipo reconhecido e DIFERENTE do pedido é o único caso que o filtro exclui", () => {
    // Fecha o contrato: a exclusão é por CONHECIMENTO POSITIVO de divergência,
    // nunca por ausência ou por dúvida.
    const r = pickNewChannel(
      [wa("ch_wa"), ig("ch_desconhecido", "stories"), ig("ch_ig")],
      new Set(),
      NONE,
      "instagram",
    );
    expect(!r.ok && r.candidates).toBe(2); // o wa saiu; o desconhecido ficou
  });
});

// ── 3. caminho degradado — o comportamento de hoje, intacto ──────────────────

describe("requestedType ausente (sessão inexistente) — comportamento de hoje", () => {
  it("null com dois candidatos de tipos diferentes ⇒ ambiguous_channel, conservador", () => {
    // Sem sessão não há o que pedir, e ambíguo é o desfecho CERTO: não se sabe
    // qual dos dois nasceu do clique. Passar `null` nunca pode alargar a regra.
    const r = pickNewChannel([wa("ch_wa"), ig("ch_ig")], null, NONE, null);

    expect(!r.ok && r.code).toBe("ambiguous_channel");
    expect(!r.ok && r.candidates).toBe(2);
  });

  it("OMITIR o quarto argumento é idêntico a passar null — assinatura retrocompatível", () => {
    // Controle positivo do refactor: `notificame-channel-finish` só passa o tipo
    // quando há sessão. Se o parâmetro tivesse virado obrigatório, o caminho
    // degradado quebraria em TypeScript e, pior, mudaria de comportamento.
    const listed = [wa("ch_wa"), ig("ch_ig")];
    expect(pickNewChannel(listed, null, NONE)).toEqual(
      pickNewChannel(listed, null, NONE, null),
    );
  });

  it("null com um candidato só segue vinculando (nada mudou no caminho feliz de hoje)", () => {
    const r = pickNewChannel([wa("ch_wa")], new Set(["ch_velho"]), NONE, null);
    expect(r.ok && r.channel.id).toBe("ch_wa");
  });
});

// ── 4. o filtro estreita; nunca ressuscita ───────────────────────────────────

describe("baseline e reivindicados continuam mandando", () => {
  it("canal do tipo pedido que está na BASELINE não vira candidato", () => {
    // A foto é o que impede um popup abandonado travar a org para sempre. O
    // filtro de tipo não pode desfazê-la.
    const r = pickNewChannel([ig("ch_antigo")], new Set(["ch_antigo"]), NONE, "instagram");

    expect(!r.ok && r.code).toBe("no_channel_found");
  });

  it("canal do tipo pedido JÁ REIVINDICADO por uma linha nossa não vira candidato", () => {
    // Este é o eixo cross-tenant: reivindicado = já tem dono no nosso banco.
    // Devolvê-lo seria vincular à org B um canal da org A.
    const r = pickNewChannel([ig("ch_de_outra_org")], new Set(), new Set(["ch_de_outra_org"]), "instagram");

    expect(!r.ok && r.code).toBe("no_channel_found");
  });

  it("as três exclusões compõem: baseline ∪ reivindicados ∪ tipo divergente", () => {
    const r = pickNewChannel(
      [
        ig("ch_baseline"), // na foto
        ig("ch_claimed"), // já vinculado
        wa("ch_wa"), // tipo divergente
        ig("ch_novo"), // o único que sobra
      ],
      new Set(["ch_baseline"]),
      new Set(["ch_claimed"]),
      "instagram",
    );

    expect(r.ok).toBe(true);
    expect(r.ok && r.channel.id).toBe("ch_novo");
  });
});
