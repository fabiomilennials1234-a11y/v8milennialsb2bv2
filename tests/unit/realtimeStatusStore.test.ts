/**
 * realtimeStatusStore — contador de joins e marco de "não saudável desde".
 *
 * `joinCount` é o sinal de RECONEXÃO que a reconciliação do chat assina
 * (`chatReconcile.ts`). Antes, `setChannelState` engolia estado repetido, e um
 * "joined" → "joined" era invisível.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getChannelStatus,
  setChannelState,
  subscribeChannelStatus,
} from "@/lib/realtimeStatusStore";

let seq = 0;
const novoCanal = () => `teste-store-${++seq}-${Math.random()}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("joinCount", () => {
  it("nasce em 0", () => {
    expect(getChannelStatus(novoCanal()).joinCount).toBe(0);
  });

  it("sobe em todo 'joined', inclusive repetido, e emite", () => {
    const ch = novoCanal();
    const ouvinte = vi.fn();
    subscribeChannelStatus(ch, ouvinte);
    setChannelState(ch, "joining");
    setChannelState(ch, "joined");
    expect(getChannelStatus(ch).joinCount).toBe(1);
    setChannelState(ch, "joined"); // rejoin sem passar por outro estado
    expect(getChannelStatus(ch).joinCount).toBe(2);
    expect(ouvinte).toHaveBeenCalledTimes(3);
  });

  it("estados não-joined repetidos continuam sem emitir", () => {
    const ch = novoCanal();
    setChannelState(ch, "joining");
    const ouvinte = vi.fn();
    subscribeChannelStatus(ch, ouvinte);
    setChannelState(ch, "joining");
    expect(ouvinte).not.toHaveBeenCalled();
    expect(getChannelStatus(ch).joinCount).toBe(0);
  });
});

describe("errored", () => {
  it("é um estado aceito pelo store", () => {
    const ch = novoCanal();
    setChannelState(ch, "errored", "CHANNEL_ERROR");
    expect(getChannelStatus(ch).state).toBe("errored");
  });
});

describe("unhealthySince", () => {
  it("marca a saída de 'joined' e se mantém entre estados não saudáveis", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const ch = novoCanal();
    setChannelState(ch, "joined");
    vi.setSystemTime(2_000_000);
    setChannelState(ch, "errored", "x");
    expect(getChannelStatus(ch).unhealthySince).toBe(2_000_000);
    vi.setSystemTime(2_005_000);
    setChannelState(ch, "joining");
    vi.setSystemTime(2_010_000);
    setChannelState(ch, "errored", "y");
    // o backoff alterna errored ↔ joining; o marco não reinicia
    expect(getChannelStatus(ch).unhealthySince).toBe(2_000_000);
    expect(getChannelStatus(ch).lastTransitionAt).toBe(2_010_000);
  });
});
