import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const scope = { setTags: vi.fn(), setContext: vi.fn(), setFingerprint: vi.fn() };
  return {
    scope,
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    addIntegration: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((fn: (s: typeof scope) => void) => fn(scope)),
    replayIntegration: vi.fn((options: unknown) => ({ name: "Replay", options })),
  };
});

vi.mock("@sentry/react", () => sdk);

import { reportError } from "./report";
import { initSentry as realInitSentry, type SentryOptions } from "./sentry";
import { loadSentry, sentryOptionsFromEnv } from "./sentry-loader";
import { toAppError } from "./to-app-error";

const options: SentryOptions = { dsn: "https://k@o1.ingest.de.sentry.io/1", environment: "test", release: "sha-1", replayOnErrorRate: 0 };

// `initSentry` registra o reporter no módulo `report`; cada teste desfaz o seu
// para a contagem de `captureException` de um não vazar no outro.
const detachers: Array<() => void> = [];

function initSentry(...args: Parameters<typeof realInitSentry>) {
  detachers.push(realInitSentry(...args));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (detachers.length) detachers.pop()!();
});

describe("initSentry", () => {
  it("desliga toda a coleta automática do SDK", () => {
    initSentry(options);
    const config = sdk.init.mock.calls[0][0];
    expect(config.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
    expect(config.enhanceFetchErrorMessages).toBe("report-only");
    expect(config.replaysSessionSampleRate).toBe(0);
    expect(config.tracesSampleRate).toBeUndefined();
    expect(typeof config.beforeSend).toBe("function");
    expect(typeof config.beforeBreadcrumb).toBe("function");
  });

  it("defeito vira evento com referência, código e agrupamento; recusa esperada vira só rastro", () => {
    initSentry(options);

    const defect = toAppError({ message: 'new row violates row-level security policy for table "leads"', code: "42501", details: null, hint: null });
    reportError(defect, { source: "mutation" });
    expect(defect.reportable).toBe(true);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.scope.setTags).toHaveBeenCalledWith(
      expect.objectContaining({ reference: defect.reference, error_code: defect.code, source: "mutation" }),
    );
    expect(sdk.scope.setFingerprint).toHaveBeenCalled();

    const expected = toAppError({ message: "JWT expired", code: "PGRST301", details: null, hint: null });
    reportError(expected, { source: "query" });
    expect(expected.reportable).toBe(false);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "app.error", message: `${expected.code} · ${expected.reference}` }),
    );
  });

  it("entrega o que chegou enquanto o SDK carregava", () => {
    const early = toAppError(new TypeError("boot quebrou"));
    initSentry(options, [{ error: early, context: { source: "boot" }, identity: null }]);
    expect(sdk.captureException).toHaveBeenCalledWith(early.cause);
  });

  it("replay: carrega depois que a página assenta, todo mascarado", async () => {
    const idle = vi.fn((cb: () => void) => cb());
    vi.stubGlobal("requestIdleCallback", idle);
    try {
      initSentry({ ...options, replayOnErrorRate: 1 });
      await vi.waitFor(() => expect(sdk.addIntegration).toHaveBeenCalled());
      expect(sdk.replayIntegration).toHaveBeenCalledWith(
        expect.objectContaining({ maskAllText: true, maskAllInputs: true, blockAllMedia: true, networkDetailAllowUrls: [] }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("replay desligado com taxa zero", () => {
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    try {
      initSentry({ ...options, replayOnErrorRate: 0 });
      expect(idle).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sentryOptionsFromEnv", () => {
  it("sem DSN, nada carrega", () => {
    expect(sentryOptionsFromEnv({ PROD: true }, "sha-1")).toBeNull();
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: "  " }, "sha-1")).toBeNull();
  });

  it("ambiente padrão pelo modo do build; taxa do replay presa em [0, 1]", () => {
    const dsn = "https://k@o1.ingest.de.sentry.io/1";
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn }, "sha-1")).toEqual({
      dsn,
      environment: "production",
      release: "sha-1",
      replayOnErrorRate: 1,
    });
    expect(sentryOptionsFromEnv({ PROD: false, VITE_SENTRY_DSN: dsn }, "dev")?.environment).toBe("development");
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn, VITE_SENTRY_ENVIRONMENT: "branch" }, "x")?.environment).toBe("branch");
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn, VITE_SENTRY_REPLAY_ON_ERROR_RATE: "0.25" }, "x")?.replayOnErrorRate).toBe(0.25);
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn, VITE_SENTRY_REPLAY_ON_ERROR_RATE: "7" }, "x")?.replayOnErrorRate).toBe(1);
    expect(sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn, VITE_SENTRY_REPLAY_ON_ERROR_RATE: "abc" }, "x")?.replayOnErrorRate).toBe(1);
  });

  it("leva o id da aba — o mesmo que o edge grava — como tag fixa", () => {
    const dsn = "https://k@o1.ingest.de.sentry.io/1";
    const built = sentryOptionsFromEnv({ PROD: true, VITE_SENTRY_DSN: dsn }, "x", "sess-1");
    expect(built?.sessionId).toBe("sess-1");
    initSentry(built!);
    expect(sdk.init.mock.calls[0][0].initialScope).toEqual({ tags: { app: "torque-web", session_id: "sess-1" } });
  });
});

describe("loadSentry", () => {
  it("segura o erro de boot até o SDK chegar e o entrega", async () => {
    const loading = loadSentry(options);
    const boot = toAppError(new TypeError("consulta do membro quebrou"));
    reportError(boot, { source: "boot:team_member" });
    expect(sdk.captureException).not.toHaveBeenCalled();
    detachers.push(await loading);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).toHaveBeenCalledWith(boot.cause);
  });
});
