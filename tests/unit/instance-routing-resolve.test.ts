// @vitest-environment node
/**
 * resolveRoutedInstance — a regra que decide de qual Instance o nó de mensagem
 * do Workflow envia (PRD #1331 / issue #1335, ADR-0025).
 *
 * Estes testes prendem o comportamento observável: dado o estado do banco,
 * QUAL número sai. Nada sobre ordem de query ou forma do builder.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import {
  LEGACY_PROVIDERS,
  resolveRoutedInstance,
} from "../../supabase/functions/_shared/instance-routing.ts";

const ORG = "org-1";
const OUTRA_ORG = "org-2";

const base = { provider: "uazapi", session_dead_since: null, owner_team_member_id: null };
const INST_1 = { ...base, id: "inst-1", organization_id: ORG, instance_name: "Comercial 1", status: "connected" };
const INST_2 = { ...base, id: "inst-2", organization_id: ORG, instance_name: "Comercial 2", status: "open", owner_team_member_id: "tm-9" };
const INST_MORTA = { ...base, id: "inst-morta", organization_id: ORG, instance_name: "Antiga", status: "close" };
/** Status congelado em "connected" após logout remoto — o watchdog marcou a sessão. */
const INST_DESLOGADA = { ...base, id: "inst-deslogada", organization_id: ORG, instance_name: "Deslogada", status: "connected", session_dead_since: "2026-08-01T09:00:00Z" };
const INST_META = { ...base, id: "inst-meta", organization_id: ORG, instance_name: "Meta Oficial", status: "connected", provider: "meta" };
const INST_ALHEIA = { ...base, id: "inst-alheia", organization_id: OUTRA_ORG, instance_name: "De outro cliente", status: "connected" };
/** Canal oficial (Meta via NotificaMe). Vivo — e, desde o #1700, em todos os degraus. */
const INST_OFICIAL = { ...base, id: "inst-oficial", organization_id: ORG, instance_name: "Chique Oficial", status: "connected", provider: "notificame" };
const INST_OFICIAL_MORTA = { ...INST_OFICIAL, id: "inst-oficial-morta", instance_name: "Oficial Caída", status: "disconnected" };

const LEAD = { id: "lead-1", organization_id: ORG, normalized_phone: "48999053409", responsible_id: null };

/** Mensagem 1:1 na thread do LEAD. */
function msg(over: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    normalized_phone: LEAD.normalized_phone,
    instance_id: INST_1.id,
    direction: "incoming",
    is_group: false,
    lead_id: null,
    timestamp: "2026-08-01T10:00:00Z",
    ...over,
  };
}

let sb: ReturnType<typeof createMockSupabase>["sb"];
let mockTable: ReturnType<typeof createMockSupabase>["mockTable"];
let mockRpc: ReturnType<typeof createMockSupabase>["mockRpc"];

beforeEach(() => {
  const m = createMockSupabase();
  sb = m.sb;
  mockTable = m.mockTable;
  mockRpc = m.mockRpc;
  mockTable("leads", [LEAD]);
  mockTable("whatsapp_instances", [INST_1, INST_2, INST_MORTA, INST_ALHEIA]);
  mockTable("whatsapp_messages", []);
  mockTable("channel_messages", []);
});

/**
 * Uma linha da caixa do canal oficial. O telefone é CRU — prefixado por 55 e,
 * às vezes, sem o nono dígito. Medido em produção (36 linhas, 2026-08-20):
 * `554884398055` e `5555992382506`, só dígitos, 12 ou 13 caracteres.
 */
function msgOficial(over: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    channel: "whatsapp",
    phone_number: "5548" + LEAD.normalized_phone.slice(2),
    instance_id: INST_OFICIAL.id,
    direction: "incoming",
    lead_id: null,
    timestamp: "2026-08-01T10:00:00Z",
    ...over,
  };
}

function resolve(node: Record<string, unknown>, leadId: string | null = LEAD.id) {
  return resolveRoutedInstance(sb, { organizationId: ORG, leadId, node });
}

/** A instância resolvida, falhando o teste se a regra recusou. */
async function resolved(node: Record<string, unknown>, leadId: string | null = LEAD.id) {
  const r = await resolve(node, leadId);
  if (!r.ok) throw new Error(`esperava resolução, veio ${r.code}: ${r.message}`);
  return r.instance;
}

// ─── Política fixed ────────────────────────────────────────────────────────

describe("política fixed", () => {
  it("devolve a instância declarada mesmo havendo thread em outra", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    const inst = await resolved({ instanceRoutingPolicy: "fixed", whatsappInstanceId: INST_2.id });
    expect(inst.id).toBe(INST_2.id);
  });

  it("nó legado com whatsappInstanceId preenchido se comporta como fixed", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    const inst = await resolved({ whatsappInstanceId: INST_2.id });
    expect(inst.id).toBe(INST_2.id);
  });

  it("não atravessa a fronteira da organização", async () => {
    // A instância de outra org é, para esta, inexistente — e com duas vivas
    // aqui não há para onde recuar sem escolher sozinho.
    await expect(
      resolve({ instanceRoutingPolicy: "fixed", whatsappInstanceId: INST_ALHEIA.id }),
    ).resolves.toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  // ── Pin obsoleto: a instância declarada não existe mais ──────────────────
  // Configuração velha (instância recriada ou removida), não queda temporária.
  // Medido em prod: 44 nós ativos em 3 orgs de um número vivo só — Basic4u
  // (35), Itatex (6), SC Beauty (3). Falhar todos por causa de um id morto no
  // JSON é pior do que usar o único número que a org tem.

  it("pin inexistente numa org de um número vivo usa esse número", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_MORTA]);
    const inst = await resolved({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: "inst-que-sumiu",
    });
    expect(inst.id).toBe(INST_1.id);
  });

  it("pin inexistente com recuo declarado usa o recuo", async () => {
    const inst = await resolved({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: "inst-que-sumiu",
      fallbackInstanceId: INST_2.id,
    });
    expect(inst.id).toBe(INST_2.id);
  });

  it("pin inexistente, duas vivas e sem recuo, falha — não escolhe sozinho", async () => {
    await expect(
      resolve({ instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" }),
    ).resolves.toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("pin inexistente NÃO cai para a conversa do lead — o operador recusou isso", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    await expect(
      resolve({ instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" }),
    ).resolves.toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  // Existe mas caiu é outra coisa: queda é quase sempre temporária, e trocar
  // de número por dez minutos de instabilidade é o defeito de volta.
  it("instância declarada desconectada falha — nunca troca de número", async () => {
    await expect(
      resolve({
        instanceRoutingPolicy: "fixed",
        whatsappInstanceId: INST_MORTA.id,
        fallbackInstanceId: INST_1.id,
      }),
    ).resolves.toMatchObject({ ok: false, code: "instance_disconnected" });
  });
});

// ─── Política conversation ─────────────────────────────────────────────────

describe("política conversation", () => {
  it("nó legado sem instância declarada se comporta como conversation", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_2.id })]);
    const inst = await resolved({});
    expect(inst.id).toBe(INST_2.id);
  });

  it("devolve a instância da mensagem mais recente", async () => {
    mockTable("whatsapp_messages", [
      msg({ instance_id: INST_1.id, timestamp: "2026-07-01T10:00:00Z" }),
      msg({ instance_id: INST_2.id, timestamp: "2026-08-01T10:00:00Z" }),
    ]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_2.id);
  });

  // O primeiro nó do funil abre a thread; os seguintes herdam.
  it("mensagem de saída mais recente ganha de uma de entrada mais antiga", async () => {
    mockTable("whatsapp_messages", [
      msg({ instance_id: INST_1.id, direction: "incoming", timestamp: "2026-07-01T10:00:00Z" }),
      msg({ instance_id: INST_2.id, direction: "outgoing", timestamp: "2026-08-01T10:00:00Z" }),
    ]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_2.id);
  });

  it("mensagem de grupo mais recente é ignorada", async () => {
    mockTable("whatsapp_messages", [
      msg({ instance_id: INST_1.id, timestamp: "2026-07-01T10:00:00Z" }),
      msg({ instance_id: INST_2.id, is_group: true, timestamp: "2026-08-01T10:00:00Z" }),
    ]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  // 52% das mensagens 1:1 em produção não têm lead_id. A thread é do telefone.
  it("resolve com lead_id nulo em todas as mensagens", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_2.id, lead_id: null })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_2.id);
  });

  it("ignora thread de outra organização com o mesmo telefone", async () => {
    mockTable("whatsapp_messages", [
      msg({ organization_id: OUTRA_ORG, instance_id: INST_ALHEIA.id, timestamp: "2026-08-01T10:00:00Z" }),
      msg({ instance_id: INST_1.id, timestamp: "2026-07-01T10:00:00Z" }),
    ]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  it("thread na instância desconectada falha — não cai para o recuo", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_MORTA.id })]);
    await expect(
      resolve({ instanceRoutingPolicy: "conversation", fallbackInstanceId: INST_1.id }),
    ).resolves.toMatchObject({ ok: false, code: "instance_disconnected" });
  });
});

// ─── Recuo e desambiguação ─────────────────────────────────────────────────

describe("recuo e desambiguação", () => {
  it("sem thread, usa o recuo declarado", async () => {
    const inst = await resolved({
      instanceRoutingPolicy: "conversation",
      fallbackInstanceId: INST_2.id,
    });
    expect(inst.id).toBe(INST_2.id);
  });

  it("sem thread e sem recuo, com duas conectadas, falha — não sorteia", async () => {
    await expect(resolve({ instanceRoutingPolicy: "conversation" })).resolves.toMatchObject({
      ok: false,
      code: "no_instance_resolved",
    });
  });

  it("organização com uma conectada usa ela, sem thread e sem recuo", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_MORTA]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  // Instância recriada: o histórico aponta para a antiga, que morreu. Com um
  // número conectado só não existe substituição a temer — é o único número.
  it("organização com uma conectada usa ela mesmo com a thread na instância morta", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_MORTA]);
    mockTable("whatsapp_messages", [msg({ instance_id: INST_MORTA.id })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  it("recuo apontando para instância desconectada falha", async () => {
    await expect(
      resolve({ instanceRoutingPolicy: "conversation", fallbackInstanceId: INST_MORTA.id }),
    ).resolves.toMatchObject({ ok: false, code: "instance_disconnected" });
  });

  it("sem lead nenhum, cai direto no recuo", async () => {
    const inst = await resolved(
      { instanceRoutingPolicy: "conversation", fallbackInstanceId: INST_2.id },
      null,
    );
    expect(inst.id).toBe(INST_2.id);
  });
});

// ─── Política responsible ──────────────────────────────────────────────────

describe("política responsible", () => {
  it("devolve a instância vinculada ao responsável", async () => {
    mockRpc("get_lead_write_instance", [{ instance_id: INST_2.id, instance_name: "Comercial 2", responsible_user_id: "tm-9" }]);
    const inst = await resolved({ instanceRoutingPolicy: "responsible" });
    expect(inst.id).toBe(INST_2.id);
  });

  it("sem vínculo, cai para o recuo declarado", async () => {
    mockRpc("get_lead_write_instance", [{ error_code: "NO_INSTANCE" }]);
    const inst = await resolved({
      instanceRoutingPolicy: "responsible",
      fallbackInstanceId: INST_1.id,
    });
    expect(inst.id).toBe(INST_1.id);
  });

  it("sem vínculo e sem recuo, com duas conectadas, falha", async () => {
    mockRpc("get_lead_write_instance", [{ error_code: "NO_RESPONSIBLE" }]);
    await expect(resolve({ instanceRoutingPolicy: "responsible" })).resolves.toMatchObject({
      ok: false,
      code: "no_instance_resolved",
    });
  });

  it("não consulta a conversa — a política declarada manda", async () => {
    mockRpc("get_lead_write_instance", [{ instance_id: INST_2.id, responsible_user_id: "tm-9" }]);
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    const inst = await resolved({ instanceRoutingPolicy: "responsible" });
    expect(inst.id).toBe(INST_2.id);
  });
});

// ─── Sessão morta e isolamento Meta ────────────────────────────────────────

describe("sessão morta e isolamento Meta", () => {
  // `status` congela em "connected" após logout remoto de outro aparelho; o
  // veredito real é session_dead_since, gravado pelo watchdog.
  it("instância com sessão morta não é usada, mesmo com status connected", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_DESLOGADA.id })]);
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_DESLOGADA]);
    await expect(resolve({ instanceRoutingPolicy: "conversation" })).resolves.toMatchObject({
      ok: false,
      code: "instance_disconnected",
    });
  });

  it("instância com sessão morta não conta para a desambiguação de um número", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_DESLOGADA]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  // Isolamento de certificação: um número Meta nunca é escolhido para envio legado.
  it("instância Meta não conta como o único número conectado", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_META]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  it("com uma Uazapi e uma Meta, não há ambiguidade a resolver", async () => {
    mockTable("whatsapp_instances", [INST_META, INST_2]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_2.id);
  });
});

// ─── Contrato do erro ──────────────────────────────────────────────────────

describe("contrato do erro", () => {
  it("distingue instância caída de nenhum número resolvido", async () => {
    const caida = await resolve({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: INST_MORTA.id,
    });
    const nenhum = await resolve({ instanceRoutingPolicy: "conversation" });

    expect(caida).toMatchObject({ ok: false, code: "instance_disconnected" });
    expect(nenhum).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("a mensagem nomeia a instância caída, para a tela de Execuções", async () => {
    const r = await resolve({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: INST_MORTA.id,
    });
    expect(r.ok === false && r.message).toContain("Antiga");
  });

  // Para as 66 orgs de um número, "todos caíram" é o caso comum. Reportar
  // "nenhum número resolvido" mandaria o operador procurar o problema errado.
  it("org cujo único número caiu reporta desconexão, não ausência de regra", async () => {
    mockTable("whatsapp_instances", [INST_MORTA]);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "instance_disconnected" });
  });

  it("org que nunca conectou um número reporta ausência de número", async () => {
    mockTable("whatsapp_instances", []);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });
});


// ─── Canal oficial (#1700) ─────────────────────────────────────────────────

/**
 * O canal oficial passou a ser ESCOLHÍVEL pela regra, não só nomeável por uma
 * pessoa: conta no atalho de "uma Instance viva só", `conversation` e
 * `responsible` resolvem nele, e ele pode ser o recuo declarado.
 *
 * A exceção é uma só, e é o risco central da fatia: quando a fixa declarada
 * morreu, o atalho conta só chips. Ver o bloco "os 63 nós de fixa morta".
 */
describe("canal oficial", () => {
  it("fixed nomeando o canal oficial resolve nele", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL]);
    const inst = await resolved({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: INST_OFICIAL.id,
    });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  // Critério de aceite: org só com canal oficial funciona sem configurar nada.
  it("org só com canal oficial: o atalho de uma viva só o encontra", async () => {
    mockTable("whatsapp_instances", [INST_OFICIAL, INST_MORTA]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("o canal oficial serve de recuo declarado", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    const inst = await resolved({
      instanceRoutingPolicy: "conversation",
      fallbackInstanceId: INST_OFICIAL.id,
    });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("responsible resolve no canal oficial quando é o número do responsável", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    // O nome do RPC importa: com o nome errado o mock devolve vazio, a regra
    // nunca chega ao canal oficial e o teste ficaria verde sem provar nada.
    mockRpc("get_lead_write_instance", [
      { instance_id: INST_OFICIAL.id, instance_name: "Chique Oficial", responsible_user_id: "tm-9" },
    ]);
    const inst = await resolved({ instanceRoutingPolicy: "responsible" });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("canal oficial desconectado falha — não troca de número, como o chip", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL_MORTA]);
    await expect(
      resolve({
        instanceRoutingPolicy: "fixed",
        whatsappInstanceId: INST_OFICIAL_MORTA.id,
        fallbackInstanceId: INST_1.id,
      }),
    ).resolves.toMatchObject({ ok: false, code: "instance_disconnected" });
  });

  it("um número meta_cloud continua fora de tudo", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_META]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });
});

// ─── conversation nas DUAS caixas (#1700) ──────────────────────────────────

/**
 * O canal oficial NÃO grava em `whatsapp_messages` — o provider dele grava em
 * `channel_messages` por conta própria (#1699, `providerPersistsOwnMessages`).
 * Sem ler as duas caixas, `conversation` seria cego para o oficial e a Chique
 * responderia pelo chip a quem escreveu no oficial.
 */
describe("conversation lê as duas caixas", () => {
  beforeEach(() => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL, INST_2]);
  });

  it("thread só no canal oficial resolve no canal oficial", async () => {
    mockTable("channel_messages", [msgOficial()]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("thread só no chip resolve no chip", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  // Critério de aceite: responde pelo número em que o cliente escreveu.
  it("com as duas caixas povoadas, ganha a mensagem mais recente", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id, timestamp: "2026-07-01T10:00:00Z" })]);
    mockTable("channel_messages", [msgOficial({ timestamp: "2026-08-01T10:00:00Z" })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("e o chip ganha quando é ele o mais recente", async () => {
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id, timestamp: "2026-08-02T10:00:00Z" })]);
    mockTable("channel_messages", [msgOficial({ timestamp: "2026-08-01T10:00:00Z" })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });

  // `channel_messages.phone_number` é cru: 55 na frente e, às vezes, sem o
  // nono dígito. `leads.normalized_phone` não tem nem um nem outro.
  it("casa o telefone cru sem o nono dígito com o canônico do lead", async () => {
    const sem9 = "55" + LEAD.normalized_phone.slice(0, 2) + LEAD.normalized_phone.slice(3);
    mockTable("channel_messages", [msgOficial({ phone_number: sem9 })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  it("ignora a thread de outro telefone na mesma caixa", async () => {
    mockTable("channel_messages", [msgOficial({ phone_number: "5511988887777" })]);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("ignora a caixa de outra organização", async () => {
    mockTable("channel_messages", [msgOficial({ organization_id: OUTRA_ORG })]);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  // O Instagram mora na MESMA tabela. Em produção suas linhas não têm telefone
  // nem instância, mas o filtro de canal é o que garante isso — a fixture
  // carrega os dois de propósito, senão o teste passaria pelo motivo errado.
  it("ignora a caixa do Instagram", async () => {
    mockTable("channel_messages", [msgOficial({ channel: "instagram" })]);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  // Simetria com o chip: thread parada num número caído FALHA, não troca.
  it("thread no canal oficial caído falha — não cai para o chip", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL_MORTA]);
    mockTable("channel_messages", [msgOficial({ instance_id: INST_OFICIAL_MORTA.id })]);
    await expect(
      resolve({ instanceRoutingPolicy: "conversation", fallbackInstanceId: INST_1.id }),
    ).resolves.toMatchObject({ ok: false, code: "instance_disconnected" });
  });

  /**
   * Critério de aceite: os ~30 clientes que só usam chip não mudam de
   * comportamento. Aqui isso é estrutural, não uma promessa — sem Instance de
   * canal oficial na organização, `channel_messages` nem é consultada.
   */
  it("org só com chip não consulta a caixa do canal oficial", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2]);
    // Uma linha que resolveria no oficial se fosse lida. Não é.
    mockTable("channel_messages", [msgOficial({ timestamp: "2026-09-01T10:00:00Z" })]);
    mockTable("whatsapp_messages", [msg({ instance_id: INST_1.id })]);
    const inst = await resolved({ instanceRoutingPolicy: "conversation" });
    expect(inst.id).toBe(INST_1.id);
  });
});

// ─── Os 63 nós de fixa morta (#1700) ───────────────────────────────────────

/**
 * ⚠️ O RISCO CENTRAL DA FATIA, e a razão de `deadPinShortcut` existir.
 *
 * Medido em produção em 2026-08-20: 63 nós de envio ativos, em 9 organizações,
 * apontam para instâncias que não existem mais, e NENHUM declara recuo —
 * Basic4u 29, Chique 18, Itatex 6, SC Beauty 3, mais 5 orgs com 7. Todos
 * sobrevivem exclusivamente pelo atalho de "uma Instance viva só".
 *
 * A Chique é a única org com canal oficial e tem também um chip. Se o oficial
 * entrasse na contagem do atalho, ela iria de uma Instance viva para duas, o
 * atalho pararia de disparar, `fixed` não participa do degrau 3, não há recuo —
 * e os 18 nós dela parariam de enviar no dia do deploy.
 */
describe("os 63 nós de fixa morta continuam enviando", () => {
  const FIXA_MORTA = {
    instanceRoutingPolicy: "fixed",
    whatsappInstanceId: "inst-que-nao-existe-mais",
  };

  // A Chique, exatamente: 1 chip + 1 oficial, 18 nós assim.
  it("org com chip e canal oficial sai pelo chip", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL]);
    const inst = await resolved(FIXA_MORTA);
    expect(inst.id).toBe(INST_1.id);
  });

  // A thread no oficial não muda nada: `fixed` não participa do degrau 3.
  it("nem mesmo com a conversa do lead viva no canal oficial", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL]);
    mockTable("channel_messages", [msgOficial({ timestamp: "2026-09-01T10:00:00Z" })]);
    const inst = await resolved(FIXA_MORTA);
    expect(inst.id).toBe(INST_1.id);
  });

  // Basic4u, Itatex, SC Beauty: um chip só, nenhum canal oficial.
  it("org de um chip só sai por ele", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_MORTA]);
    const inst = await resolved(FIXA_MORTA);
    expect(inst.id).toBe(INST_1.id);
  });

  // Sem chip nenhum, o oficial é o único número que a organização tem.
  it("org só com canal oficial sai por ele", async () => {
    mockTable("whatsapp_instances", [INST_OFICIAL]);
    const inst = await resolved(FIXA_MORTA);
    expect(inst.id).toBe(INST_OFICIAL.id);
  });

  // Dois chips vivos: ambíguo antes e depois do #1700. A máquina não escolhe.
  it("org com dois chips falha — a máquina não desempata sozinha", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    await expect(resolve(FIXA_MORTA)).resolves.toMatchObject({
      ok: false,
      code: "no_instance_resolved",
    });
  });

  it("e com dois chips e recuo declarado usa o recuo", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    const inst = await resolved({ ...FIXA_MORTA, fallbackInstanceId: INST_2.id });
    expect(inst.id).toBe(INST_2.id);
  });
});

// ─── send_to_number: o universo estreito (#1700) ───────────────────────────

/**
 * `send_to_number` manda para números avulsos — vendedores, gestores. Eles não
 * são leads e nunca escreveram antes, então a janela de 24 horas da Meta está
 * fechada por definição e o texto livre pelo canal oficial seria recusa
 * garantida, por callback, depois de a tela dizer "enviado".
 *
 * O painel daquele nó já recusa a opção desde o #1699. Isto é a mesma recusa do
 * lado do executor: o handler passa `LEGACY_PROVIDERS` como `providers`.
 */
describe("nó de números avulsos: o canal oficial não entra", () => {
  function resolveEstreito(node: Record<string, unknown>) {
    return resolveRoutedInstance(sb, {
      organizationId: ORG,
      leadId: null,
      node,
      providers: LEGACY_PROVIDERS,
    });
  }

  it("o atalho de uma viva só não enxerga o canal oficial", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL]);
    const r = await resolveEstreito({});
    expect(r.ok === true && r.instance.id).toBe(INST_1.id);
  });

  it("nomear o canal oficial não resolve nele", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    const r = await resolveEstreito({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: INST_OFICIAL.id,
    });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("org só com canal oficial reporta ausência de número", async () => {
    mockTable("whatsapp_instances", [INST_OFICIAL]);
    const r = await resolveEstreito({});
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });
});
