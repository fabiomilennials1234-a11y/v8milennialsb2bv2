/**
 * ExpiredMedia — unit tests for the 30-day retention degrade state.
 *
 * Guarantees:
 *  - renders a graceful, type-specific "expired" placeholder
 *  - NEVER issues a broken <img>/<video>/<audio> request
 *  - message_type → icon-kind mapping is correct per media type
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  ExpiredMedia,
  resolveExpiredMediaKind,
  type ExpiredMediaKind,
} from "@/modules/communication/components/chat/media/MessageMedia";

describe("resolveExpiredMediaKind", () => {
  const cases: Array<[string, ExpiredMediaKind]> = [
    ["image", "image"],
    ["album", "image"],
    ["sticker", "image"],
    ["video", "video"],
    ["ptv", "video"],
    ["gif", "video"],
    ["audio", "audio"],
    ["ptt", "audio"],
    ["document", "document"],
    ["unknown_type", "file"],
  ];

  it.each(cases)("maps message_type %s → kind %s", (type, kind) => {
    expect(resolveExpiredMediaKind(type)).toBe(kind);
  });

  it("defaults null/undefined to file", () => {
    expect(resolveExpiredMediaKind(null)).toBe("file");
    expect(resolveExpiredMediaKind(undefined)).toBe("file");
  });
});

describe("ExpiredMedia rendering", () => {
  const kinds: Array<[ExpiredMediaKind, RegExp]> = [
    ["image", /Imagem expirada/i],
    ["video", /Vídeo expirado/i],
    ["audio", /Áudio expirado/i],
    ["document", /Documento expirado/i],
    ["file", /Mídia expirada/i],
  ];

  it.each(kinds)("renders the %s label without any media element", (kind, label) => {
    const { container, getByText } = render(<ExpiredMedia kind={kind} />);
    expect(getByText(label)).toBeInTheDocument();
    // The whole point: no network request for dead media.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("shows the 30-day retention subtitle", () => {
    const { getByText } = render(<ExpiredMedia kind="image" />);
    expect(getByText(/Retida por 30 dias/i)).toBeInTheDocument();
  });

  it("exposes an accessible label for screen readers", () => {
    const { getByRole } = render(<ExpiredMedia kind="document" />);
    expect(getByRole("note")).toHaveAttribute("aria-label", "Documento expirado");
  });
});
