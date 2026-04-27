import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";

/**
 * Regression tests for Sheet component CSS class merging.
 *
 * Root cause of the mobile menu bug: `twMerge` resolved `relative` (added
 * as a customization) over the variant's `fixed`, making the panel render
 * out of viewport on mobile while the overlay still covered the screen.
 */

// Mirror of the sheetVariants from src/components/ui/sheet.tsx
const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

describe("Sheet positioning — twMerge regression", () => {
  it("SheetContent preserves `fixed` positioning for all sides", () => {
    const sides = ["top", "bottom", "left", "right"] as const;

    for (const side of sides) {
      const result = cn(
        sheetVariants({ side }),
        "z-[51] data-[state=closed]:pointer-events-none",
      );

      expect(result).toContain("fixed");
      expect(result).not.toContain("relative");
      expect(result).not.toContain("absolute");
      expect(result).not.toContain("sticky");
    }
  });

  it("SheetContent `fixed` survives consumer className overrides", () => {
    // Simulates the TopNavigation mobile menu usage
    const consumerClassName =
      "w-[300px] p-0 bg-background/98 backdrop-blur-xl border-l border-border/30";

    const result = cn(
      sheetVariants({ side: "right" }),
      "z-[51] data-[state=closed]:pointer-events-none",
      consumerClassName,
    );

    expect(result).toContain("fixed");
    expect(result).not.toContain("relative");
  });

  it("`relative` would override `fixed` via twMerge (documents the bug)", () => {
    // This test documents WHY the bug happened — `relative` wins over `fixed`
    const broken = cn(
      sheetVariants({ side: "right" }),
      "relative z-[51]",
    );

    // twMerge resolves position conflict: relative overrides fixed
    expect(broken).toContain("relative");
    expect(broken).not.toContain("fixed");
  });

  it("SheetContent z-[51] is above overlay z-50", () => {
    const result = cn(
      sheetVariants({ side: "right" }),
      "z-[51] data-[state=closed]:pointer-events-none",
    );

    expect(result).toContain("z-[51]");
    expect(result).not.toMatch(/\bz-50\b/);
  });

  it("Sidebar mobile SheetContent preserves fixed positioning", () => {
    // Simulates the sidebar.tsx mobile usage
    const sidebarClassName =
      "w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden";

    const result = cn(
      sheetVariants({ side: "left" }),
      "z-[51] data-[state=closed]:pointer-events-none",
      sidebarClassName,
    );

    expect(result).toContain("fixed");
    expect(result).not.toContain("relative");
  });
});
