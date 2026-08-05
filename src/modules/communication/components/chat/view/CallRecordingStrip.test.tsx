/**
 * A gravação embaixo do marco da ligação.
 *
 * ── A regra que estes testes travam ──
 * Os quatro casos são VISUALMENTE DISTINTOS, e nenhum degrada para outro:
 * gravação processando não pode parecer perdida, gravação que falhou não pode
 * parecer inexistente, e ligação sem gravação não ganha ruído.
 *
 * ── E a que eles travam com mais força ──
 * A peça NÃO decide quem ouve. Ela pede, e o banco responde. Um teste que
 * verificasse "o botão não aparece para o colega" estaria exigindo que o
 * navegador reimplementasse `fn_voip_can_hear_recording` — a segunda cópia que a
 * policy existe para não precisar. O que se testa aqui é que a recusa do banco
 * vira uma frase honesta, e que o pedido só sai quando alguém aperta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const resolver = vi.fn();

vi.mock("@/modules/communication/lib/callRecording", async () => {
  const real = await vi.importActual<typeof import("@/modules/communication/lib/callRecording")>(
    "@/modules/communication/lib/callRecording",
  );
  return { ...real, resolveCallRecordingUrl: (p: string) => resolver(p) };
});

import { CallRecordingStrip } from "./CallRecordingStrip";

// jsdom não implementa o transporte de mídia. Sem estes dublês, `play()` estoura
// e o botão nunca chega ao estado tocando.
let paused = true;
beforeEach(() => {
  paused = true;
  resolver.mockReset();
  resolver.mockResolvedValue({ ok: true, url: "https://storage.test/org/call.opus?token=abc" });

  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => paused,
  });
  HTMLMediaElement.prototype.play = vi.fn(function play(this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }) as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn(function pause(this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event("pause"));
  }) as unknown as HTMLMediaElement["pause"];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const pronta = {
  recording_status: "ready",
  recording_url: "org-a/call-1.opus",
  recording_failure_reason: null,
};

describe("CallRecordingStrip — ausência", () => {
  it("ligação sem gravação não desenha nada", () => {
    const { container } = render(<CallRecordingStrip call={{ recording_status: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("e não pede URL nenhuma", () => {
    render(<CallRecordingStrip call={{ recording_status: null }} />);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("CallRecordingStrip — processando", () => {
  it("diz que está sendo processada, para o gestor não achar que se perdeu", () => {
    render(<CallRecordingStrip call={{ recording_status: "processing", recording_url: null }} />);
    expect(screen.getByTestId("call-recording-processing")).toBeInTheDocument();
    expect(screen.getByText(/processada/i)).toBeInTheDocument();
  });

  it("não oferece play: não há o que tocar ainda", () => {
    render(<CallRecordingStrip call={{ recording_status: "processing", recording_url: null }} />);
    expect(screen.queryByTestId("call-recording-ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ouvir/i })).not.toBeInTheDocument();
  });

  it("é distinguível da ausência — que não desenha nada", () => {
    const { container: comEstado } = render(
      <CallRecordingStrip call={{ recording_status: "processing", recording_url: null }} />,
    );
    const { container: semEstado } = render(<CallRecordingStrip call={{ recording_status: null }} />);
    expect(comEstado).not.toBeEmptyDOMElement();
    expect(semEstado).toBeEmptyDOMElement();
  });
});

describe("CallRecordingStrip — falhou", () => {
  it("aparece como FALHA, não como ausência", () => {
    const { container } = render(
      <CallRecordingStrip
        call={{ recording_status: "failed", recording_url: null, recording_failure_reason: "vps_timeout" }}
      />,
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("call-recording-failed")).toBeInTheDocument();
  });

  it("diz a CAUSA em português, não o slug", () => {
    render(
      <CallRecordingStrip
        call={{ recording_status: "failed", recording_url: null, recording_failure_reason: "vps_timeout" }}
      />,
    );
    expect(screen.getByText("A gravação não chegou da telefonia.")).toBeInTheDocument();
    expect(screen.queryByText(/vps_timeout/)).not.toBeInTheDocument();
  });

  it("guarda o slug cru para o suporte, fora do corpo do texto", () => {
    render(
      <CallRecordingStrip
        call={{ recording_status: "failed", recording_url: null, recording_failure_reason: "storage_upload_failed" }}
      />,
    );
    expect(screen.getByTestId("call-recording-failed")).toHaveAttribute("title", "storage_upload_failed");
  });

  it("falha sem causa ainda diz que falhou", () => {
    render(<CallRecordingStrip call={{ recording_status: "failed", recording_failure_reason: null }} />);
    expect(screen.getByText("A gravação falhou.")).toBeInTheDocument();
  });

  it("não oferece play numa gravação que não vai existir", () => {
    render(
      <CallRecordingStrip
        call={{ recording_status: "failed", recording_url: null, recording_failure_reason: "vps_timeout" }}
      />,
    );
    expect(screen.queryByRole("button", { name: /ouvir/i })).not.toBeInTheDocument();
  });
});

describe("CallRecordingStrip — pronta", () => {
  it("oferece ouvir", () => {
    render(<CallRecordingStrip call={pronta} />);
    expect(screen.getByRole("button", { name: /ouvir gravação/i })).toBeInTheDocument();
  });

  it("NÃO assina nada antes de alguém apertar — a thread tem dezenas de ligações", () => {
    render(<CallRecordingStrip call={pronta} />);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("ao apertar, assina o objeto DESTA ligação", async () => {
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    expect(resolver).toHaveBeenCalledWith("org-a/call-1.opus");
  });

  it("vira transporte com a URL assinada e começa a tocar", async () => {
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    const audio = await screen.findByTestId("call-recording-audio");
    expect(audio).toHaveAttribute("src", "https://storage.test/org/call.opus?token=abc");
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it("play e pause — o que a fatia promete, e nada além", async () => {
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    const pausar = await screen.findByRole("button", { name: /pausar gravação/i });
    await user.click(pausar);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    const tocar = await screen.findByRole("button", { name: /tocar gravação/i });
    await user.click(tocar);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /pausar gravação/i })).toBeInTheDocument(),
    );
  });

  it("mostra o ponteiro andando contra a duração do arquivo", async () => {
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    const audio = (await screen.findByTestId("call-recording-audio")) as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 220 });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 12 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.dispatchEvent(new Event("timeupdate"));

    await waitFor(() => expect(screen.getByText("0:12 / 3:40")).toBeInTheDocument());
  });

  it("uma fatia não navegável: sem controle de velocidade, marcador ou recorte", async () => {
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));
    await screen.findByTestId("call-recording-audio");

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByText(/1[,.]5x|2x|velocidade/i)).not.toBeInTheDocument();
  });
});

describe("CallRecordingStrip — quando o banco recusa", () => {
  it("a peça NÃO prevê a recusa: o botão existe até o banco responder", () => {
    resolver.mockResolvedValue({ ok: false, kind: "denied" });
    render(<CallRecordingStrip call={pronta} />);
    // Prever exigiria uma segunda cópia da regra no navegador.
    expect(screen.getByRole("button", { name: /ouvir gravação/i })).toBeInTheDocument();
  });

  it("explica a recusa em vez de mostrar um erro cru", async () => {
    resolver.mockResolvedValue({ ok: false, kind: "denied" });
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    expect(await screen.findByTestId("call-recording-denied")).toBeInTheDocument();
    expect(screen.getByText(/só quem fez a ligação e a gestão podem ouvir/i)).toBeInTheDocument();
  });

  it("recusa não vira áudio: nenhum elemento de mídia é montado", async () => {
    resolver.mockResolvedValue({ ok: false, kind: "denied" });
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    await screen.findByTestId("call-recording-denied");
    expect(screen.queryByTestId("call-recording-audio")).not.toBeInTheDocument();
  });

  it("recusa não oferece tentar de novo — recusa é definitiva, não intermitente", async () => {
    resolver.mockResolvedValue({ ok: false, kind: "denied" });
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    await screen.findByTestId("call-recording-denied");
    expect(screen.queryByRole("button", { name: /tentar de novo/i })).not.toBeInTheDocument();
  });
});

describe("CallRecordingStrip — quando o servidor tropeça", () => {
  it("oferece tentar de novo, e não acusa falta de permissão", async () => {
    resolver.mockResolvedValue({ ok: false, kind: "unavailable" });
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    expect(await screen.findByTestId("call-recording-unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/podem ouvir/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it("tentar de novo pede a URL outra vez", async () => {
    resolver.mockResolvedValue({ ok: false, kind: "unavailable" });
    const user = userEvent.setup();
    render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));

    await screen.findByTestId("call-recording-unavailable");
    resolver.mockResolvedValue({ ok: true, url: "https://storage.test/depois.opus" });
    await user.click(screen.getByRole("button", { name: /tentar de novo/i }));

    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("call-recording-audio")).toHaveAttribute(
      "src",
      "https://storage.test/depois.opus",
    );
  });
});

describe("CallRecordingStrip — trocar de ligação", () => {
  it("não reaproveita a URL assinada da ligação anterior", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CallRecordingStrip call={pronta} />);
    await user.click(screen.getByRole("button", { name: /ouvir gravação/i }));
    await screen.findByTestId("call-recording-audio");

    rerender(
      <CallRecordingStrip
        call={{ recording_status: "ready", recording_url: "org-a/call-2.opus", recording_failure_reason: null }}
      />,
    );

    // Voltou ao convite: som de uma conversa não escorrega para o registro de outra.
    expect(screen.queryByTestId("call-recording-audio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ouvir gravação/i })).toBeInTheDocument();
  });
});
