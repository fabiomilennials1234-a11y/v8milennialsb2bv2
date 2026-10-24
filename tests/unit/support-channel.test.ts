import { describe, it, expect } from "vitest";
import {
  pickSenderInstance,
  senderTrace,
  type SenderCandidate,
  type SupportSender,
} from "../../supabase/functions/_shared/support-channel.ts";

const base: SenderCandidate = {
  id: "i1",
  instance_name: "TorqueSDR",
  phone_number: "554884334050",
  status: "connected",
  provider: "uazapi",
  session_dead_since: null,
  last_connection_at: "2026-09-02T16:14:08Z",
};

describe("pickSenderInstance", () => {
  it("escolhe a instância conectada", () => {
    expect(pickSenderInstance([base])?.id).toBe("i1");
  });

  it("ignora instância desconectada", () => {
    expect(pickSenderInstance([{ ...base, status: "disconnected" }])).toBeNull();
  });

  // A queda de 02/09: `status = 'connected'` no banco convivendo com sessão
  // irrecuperável na Uazapi. Quem carimba a coluna é o watchdog de sessão, e é
  // ela que desempata entre "o banco acha" e "está mesmo".
  it("ignora instância que o watchdog de sessão já deu por morta, mesmo com status connected", () => {
    expect(
      pickSenderInstance([{ ...base, session_dead_since: "2026-09-02T16:22:00Z" }]),
    ).toBeNull();
  });

  it("ignora provider que não é uazapi", () => {
    expect(pickSenderInstance([{ ...base, provider: "meta" }])).toBeNull();
  });

  it("aceita provider nulo (linha legada nasce sem a coluna preenchida)", () => {
    expect(pickSenderInstance([{ ...base, provider: null }])?.id).toBe("i1");
  });

  it("prefere a conectada mais recente entre várias vivas", () => {
    const antiga = { ...base, id: "velha", last_connection_at: "2026-08-01T10:00:00Z" };
    const nova = { ...base, id: "nova", last_connection_at: "2026-09-02T16:14:08Z" };
    expect(pickSenderInstance([antiga, nova])?.id).toBe("nova");
  });

  // `null` é ausência de prova de conexão, não prova de antiguidade — mas
  // também não pode ganhar de quem tem carimbo recente.
  it("põe quem nunca conectou atrás de quem tem carimbo", () => {
    const semCarimbo = { ...base, id: "sem", last_connection_at: null };
    const comCarimbo = { ...base, id: "com", last_connection_at: "2026-08-01T10:00:00Z" };
    expect(pickSenderInstance([semCarimbo, comCarimbo])?.id).toBe("com");
  });

  it("devolve null quando não há candidata nenhuma", () => {
    expect(pickSenderInstance([])).toBeNull();
  });
});

describe("senderTrace", () => {
  it("carrega origem e identidade da instância, e nenhum segredo", () => {
    const sender: SupportSender = {
      token: "segredo-que-nao-pode-vazar",
      baseUrl: "https://uazapi.test",
      groupJid: "1203@g.us",
      source: "instance",
      instanceId: "i1",
      instanceName: "TorqueSDR",
      phoneNumber: "554884334050",
    };
    const trace = senderTrace(sender);
    expect(trace).toEqual({
      sender_source: "instance",
      sender_instance_id: "i1",
      sender_instance_name: "TorqueSDR",
      sender_phone: "554884334050",
    });
    expect(JSON.stringify(trace)).not.toContain("segredo-que-nao-pode-vazar");
  });

  it("marca o caminho legado, para uma regressão para a secret não passar por sucesso", () => {
    const trace = senderTrace({
      token: "t",
      baseUrl: "https://uazapi.test",
      groupJid: "1203@g.us",
      source: "env",
    });
    expect(trace.sender_source).toBe("env");
    expect(trace.sender_instance_id).toBeNull();
  });
});
