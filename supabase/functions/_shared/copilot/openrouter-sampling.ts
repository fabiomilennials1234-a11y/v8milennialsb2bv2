const HAIKU_MODEL = "anthropic/claude-haiku-5.5";

export function resolveCopilotModel(configuredModel: unknown, fallback?: string): string {
  if (typeof configuredModel === "string" && configuredModel) return configuredModel;
  return fallback || "openai/gpt-4.1-mini";
}

export function copilotSamplingOptions(model: string, temperature?: number) {
  if (model === HAIKU_MODEL) {
    // Haiku 5.5 rejects sampling parameters. The Copilot uses small output
    // budgets and replays tool calls without provider-specific thinking blocks.
    return { reasoning: { enabled: false } };
  }
  return { temperature };
}
