import { describe, it, expect } from "vitest";
import {
  applyDensityCeiling,
  densityCeiling,
  hasHeroTypography,
  cellsUsed,
  CELLS_PER_PAGE,
} from "./tv-density";

const w = (weight: string, gw = 1, gh = 1) => ({ weight, grid_w: gw, grid_h: gh });

describe("tv-density (spec §6.4, §8.4.6)", () => {
  it("teto padrão é 12 widgets/página", () => {
    expect(densityCeiling([w("secondary"), w("primary")])).toBe(12);
  });

  it("o teto de 8 dispara pela TIPOGRAFIA, não pelo tamanho da célula", () => {
    // Thermometer congelado: 3×4 células, mas tipo --tv-value → NÃO dispara.
    const grandeMasNaoHero = [w("primary", 3, 4)];
    expect(hasHeroTypography(grandeMasNaoHero)).toBe(false);
    expect(densityCeiling(grandeMasNaoHero)).toBe(12);

    // Um widget com --tv-hero dispara, mesmo pequeno.
    const pequenoHero = [w("hero", 2, 1)];
    expect(hasHeroTypography(pequenoHero)).toBe(true);
    expect(densityCeiling(pequenoHero)).toBe(8);
  });

  it("excedente volta em overflow — não é escondido em silêncio", () => {
    const items = Array.from({ length: 15 }, () => w("secondary"));
    const { visible, overflow, ceiling } = applyDensityCeiling(items);
    expect(ceiling).toBe(12);
    expect(visible).toHaveLength(12);
    expect(overflow).toHaveLength(3);
  });

  it("com hero, o teto cai para 8", () => {
    const items = [w("hero"), ...Array.from({ length: 10 }, () => w("secondary"))];
    const { visible, overflow } = applyDensityCeiling(items);
    expect(visible).toHaveLength(8);
    expect(overflow).toHaveLength(3);
  });

  it("os 2 pinned legados custam 20 células — 28% de cada página", () => {
    const pinned = [w("primary", 3, 4), w("primary", 4, 2)]; // termômetro + closer
    expect(cellsUsed(pinned)).toBe(20);
    expect(CELLS_PER_PAGE).toBe(72);
    expect(Math.round((20 / CELLS_PER_PAGE) * 100)).toBe(28);
  });

  it("grid é 12×6 = 72 células", () => {
    expect(CELLS_PER_PAGE).toBe(72);
  });
});
