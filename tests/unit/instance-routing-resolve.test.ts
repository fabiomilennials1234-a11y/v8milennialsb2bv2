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
import { resolveRoutedInstance } from "../../supabase/functions/_shared/instance-routing.ts";

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
/** Canal oficial (Meta via NotificaMe). Vivo — e ainda assim fora dos degraus automáticos. */
const INST_OFICIAL = { ...base, id: "inst-oficial", organization_id: ORG, instance_name: "Chique Oficial", status: "connected", provider: "notificame" };

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
});

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


// ─── Canal oficial (#1690) ─────────────────────────────────────────────────

/**
 * O canal oficial é NOMEÁVEL e não é ESCOLHÍVEL.
 *
 * Um degrau só o alcança — o primeiro, onde uma pessoa escreveu o id no nó.
 * Nos outros quatro a regra escolhe sozinha, e deixá-lo entrar ali quebraria
 * duas coisas: a janela de 24h (fora dela a Meta recusa texto livre, por
 * callback, depois de a tela dizer "enviado") e os nós de pin morto, que
 * sobrevivem exatamente porque o atalho do degrau 2 não conta a oficial.
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

  /**
   * A regressão que o #1690 quase introduziu, medida na Chique em 2026-08-20:
   * 18 nós ativos com pin morto e sem recuo, vivos só pelo atalho do degrau 2.
   * Se a oficial contasse ali, a org iria de uma Instance viva para duas, o
   * atalho pararia de disparar e os 18 falhariam no dia do deploy.
   */
  it("pin morto numa org com chip e canal oficial ainda sai pelo chip", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_OFICIAL]);
    const inst = await resolved({
      instanceRoutingPolicy: "fixed",
      whatsappInstanceId: "inst-que-nao-existe-mais",
    });
    expect(inst.id).toBe(INST_1.id);
  });

  it("conversation não escolhe o canal oficial, mesmo com a thread nele", async () => {
    // Duas legadas de propósito: com uma só, o atalho do degrau 2 responderia
    // antes da política e o teste passaria sem provar nada.
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    mockTable("whatsapp_messages", [msg({ instance_id: INST_OFICIAL.id })]);
    const r = await resolve({ instanceRoutingPolicy: "conversation" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("o canal oficial não serve de recuo declarado", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    const r = await resolve({
      instanceRoutingPolicy: "conversation",
      fallbackInstanceId: INST_OFICIAL.id,
    });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });

  it("responsible não escolhe o canal oficial", async () => {
    mockTable("whatsapp_instances", [INST_1, INST_2, INST_OFICIAL]);
    // O nome do RPC importa: com o nome errado o mock devolve vazio, a regra
    // nunca chega ao canal oficial e o teste ficaria verde sem provar nada.
    mockRpc("get_lead_write_instance", { instance_id: INST_OFICIAL.id, error_code: null });
    const r = await resolve({ instanceRoutingPolicy: "responsible" });
    expect(r).toMatchObject({ ok: false, code: "no_instance_resolved" });
  });
});
