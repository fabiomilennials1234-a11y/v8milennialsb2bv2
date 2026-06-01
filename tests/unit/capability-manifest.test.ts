/**
 * capability-manifest.test.ts
 *
 * TDD for PRD #544 / Slice #546 — Copilot Builder capability manifest.
 * The manifest is the Builder's omniscient, drift-proof knowledge of every
 * Copilot capability, derived from the single source (PLAYGROUND_TOOLS +
 * PlaygroundData) plus a curated guidance layer.
 */

import { describe, it, expect } from "vitest";
import {
  PLAYGROUND_TOOLS,
  LEGACY_TOOL_IDS,
  DEFAULT_PROMPT_SECTIONS,
} from "@/modules/copilot/components/playground/types";
import {
  buildCapabilityManifest,
  buildBuilderToolDefs,
} from "@/modules/copilot/lib/capability-manifest";

describe("buildCapabilityManifest — tools", () => {
  it("includes every non-legacy tool from the registry", () => {
    const manifest = buildCapabilityManifest();

    const manifestIds = manifest.tools.map((t) => t.id).sort();
    const expectedIds = PLAYGROUND_TOOLS
      .filter((t) => !LEGACY_TOOL_IDS.has(t.id))
      .map((t) => t.id)
      .sort();

    expect(manifestIds).toEqual(expectedIds);
  });

  it("carries each tool's parameters from the registry", () => {
    const manifest = buildCapabilityManifest();

    const sendDoc = manifest.tools.find((t) => t.id === "ENVIAR_DOCUMENTO");
    expect(sendDoc).toBeDefined();

    const paramKeys = sendDoc!.params.map((p) => p.key);
    expect(paramKeys).toContain("document_id");
    expect(paramKeys).toContain("caption");
  });

  it("tags each tool with the org dependency it needs to function", () => {
    const manifest = buildCapabilityManifest();
    const dep = (id: string) => manifest.tools.find((t) => t.id === id)?.dependency;

    expect(dep("ENVIAR_DOCUMENTO")).toBe("knowledge_document");
    expect(dep("TRANSFERIR_SZ_CHAT")).toBe("sz_chat_config");
    expect(dep("MOVER_CARD")).toBe("pipeline_stages");
    expect(dep("AGENDAR_REUNIAO")).toBe("scheduling");
    // A tool with no external org dependency
    expect(dep("QUALIFICAR_LEAD")).toBeNull();
  });

  // Drift guard: adding a tool to the registry without a curated guide
  // entry must fail this test, forcing the guidance to be kept in sync.
  it("provides a non-empty when-to-use guide for every non-legacy tool", () => {
    const manifest = buildCapabilityManifest();

    for (const tool of manifest.tools) {
      expect(tool.guide, `missing guide for ${tool.id}`).toBeDefined();
      expect(
        tool.guide.whenToUse.trim().length,
        `empty whenToUse for ${tool.id}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("buildCapabilityManifest — fields", () => {
  // Coverage + drift guard for the writable prompt-section surface.
  it("covers every prompt section with a non-empty guide", () => {
    const manifest = buildCapabilityManifest();

    const fieldKeys = manifest.fields.map((f) => f.key).sort();
    expect(fieldKeys).toEqual(Object.keys(DEFAULT_PROMPT_SECTIONS).sort());

    for (const f of manifest.fields) {
      expect(
        f.guide.whenToUse.trim().length,
        `empty guide for field ${f.key}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("buildBuilderToolDefs", () => {
  it("derives enable_tool's valid ids from the manifest, not a hardcoded list", () => {
    const manifest = buildCapabilityManifest();
    const defs = buildBuilderToolDefs(manifest);

    const enableTool = defs.find((d) => d.name === "enable_tool");
    expect(enableTool).toBeDefined();

    const enumIds = [...enableTool!.input_schema.properties.tool_id.enum].sort();
    expect(enumIds).toEqual(manifest.tools.map((t) => t.id).sort());
  });

  it("derives set_prompt_section's sections from the manifest fields", () => {
    const manifest = buildCapabilityManifest();
    const defs = buildBuilderToolDefs(manifest);

    const setSection = defs.find((d) => d.name === "set_prompt_section");
    expect(setSection).toBeDefined();

    const enumKeys = [...setSection!.input_schema.properties.section.enum].sort();
    expect(enumKeys).toEqual(manifest.fields.map((f) => f.key).sort());
  });
});
