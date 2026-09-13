import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { readUazapiMenu } from "../../src/modules/communication/lib/uazapiMenuDisplay";
import { UazapiMenuBubble } from "../../src/modules/communication/components/chat/bubbles/UazapiMenuBubble";

describe("provider list card", () => {
  it("renders titles and descriptions while hiding routing IDs", () => {
    const menu = readUazapiMenu({ uazapi_menu_sections: [{ title: "Escolha", rows: [{ rowID: "internal-route", title: "Validar", description: "Conferir integração" }] }], uazapi_menu_description: "Escolha uma opção", uazapi_menu_button: "Abrir teste" });
    render(<UazapiMenuBubble menu={menu!} fallbackText={null} />);
    expect(screen.getByText("Validar")).toBeTruthy();
    expect(screen.getByText("Conferir integração")).toBeTruthy();
    expect(screen.queryByText("internal-route")).toBeNull();
  });
  it("reads the same list from a realtime row before refetch", () => {
    const menu = readUazapiMenu({ raw_payload: { content: { sections: [{ rows: [{ title: "Validar", rowID: "private" }] }], buttonText: "Abrir" } } });
    expect(menu?.button).toBe("Abrir");
    expect(menu?.sections[0].rows).toEqual([{ title: "Validar", description: "" }]);
  });
  it("ignores malformed or non-menu content", () => {
    expect(readUazapiMenu({ uazapi_menu_sections: [{ rows: [null, { title: 42 }] }] })).toBeNull();
    expect(readUazapiMenu({})).toBeNull();
  });
});
