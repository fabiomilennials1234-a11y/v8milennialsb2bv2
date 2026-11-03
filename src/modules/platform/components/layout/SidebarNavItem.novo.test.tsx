import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Snowflake } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavNode } from "@/modules/platform/lib/navigation-model";

import { SidebarNavItem } from "./SidebarNavItem";

const item = (ate: string): NavNode => ({
  label: "Lista fria",
  icon: Snowflake,
  path: "/lista-fria",
  novo: { id: "lista-fria-teste", ate },
});
const FUTURO = "2999-01-01";

const montar = (n: NavNode, rail = false, active = false) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarNavItem item={n} active={active} collapsed={rail} rail={rail} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => window.localStorage.clear());

describe("SidebarNavItem: selo Novo", () => {
  it("mostra o selo no trilho e na lateral aberta, com a animação", () => {
    const { unmount } = montar(item(FUTURO), true);
    expect(screen.getByTestId("selo-novo")).toHaveClass("animate-novo-pulso");
    expect(screen.getByRole("link", { name: "Lista fria (novo)" })).toBeInTheDocument();
    unmount();
    montar(item(FUTURO), false);
    expect(screen.getByTestId("selo-novo")).toBeInTheDocument();
  });

  it("some ao abrir a tela e não volta depois (já vi)", async () => {
    const user = userEvent.setup();
    const { unmount } = montar(item(FUTURO), true);
    await user.click(screen.getByRole("link"));
    expect(screen.queryByTestId("selo-novo")).not.toBeInTheDocument();
    unmount();
    montar(item(FUTURO), true);
    expect(screen.queryByTestId("selo-novo")).not.toBeInTheDocument();
  });

  it("quem chega pela URL (item ativo) também apaga o selo", () => {
    montar(item(FUTURO), true, true);
    expect(screen.queryByTestId("selo-novo")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("torque:novidade-vista:lista-fria-teste")).toBe("1");
  });

  it("depois do prazo não aparece, mesmo para quem nunca abriu", () => {
    montar(item("2020-01-01"), true);
    expect(screen.queryByTestId("selo-novo")).not.toBeInTheDocument();
  });

  it("item sem novidade não ganha selo", () => {
    montar({ label: "Leads", icon: Snowflake, path: "/leads" }, true);
    expect(screen.queryByTestId("selo-novo")).not.toBeInTheDocument();
  });
});
