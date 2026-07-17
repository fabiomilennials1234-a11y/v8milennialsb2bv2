import { describe, it, expect, beforeEach } from "vitest";
import {
  decideAnnouncement,
  markLaunchSeen,
  dismissNudgeForever,
  LAUNCH_KEY,
  NUDGE_OFF_KEY,
} from "./announcement-state";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("decideAnnouncement", () => {
  it("mostra o LANÇAMENTO na estreia (nada visto ainda)", () => {
    expect(decideAnnouncement()).toBe("launch");
  });

  it("depois do lançamento visto, mostra o COACH-MARK", () => {
    markLaunchSeen();
    expect(decideAnnouncement()).toBe("nudge");
  });

  it("o coach-mark aparece só uma vez por sessão (reload não repete)", () => {
    markLaunchSeen();
    expect(decideAnnouncement()).toBe("nudge");
    expect(decideAnnouncement()).toBe("none"); // mesma sessão -> silêncio
  });

  it("volta a aparecer numa nova sessão", () => {
    markLaunchSeen();
    decideAnnouncement(); // sessão A -> nudge
    sessionStorage.clear(); // nova sessão
    expect(decideAnnouncement()).toBe("nudge");
  });

  it("o X desliga o coach-mark em definitivo", () => {
    markLaunchSeen();
    dismissNudgeForever();
    sessionStorage.clear();
    expect(decideAnnouncement()).toBe("none");
  });

  it("marca as chaves certas", () => {
    markLaunchSeen();
    expect(localStorage.getItem(LAUNCH_KEY)).toBe("1");
    dismissNudgeForever();
    expect(localStorage.getItem(NUDGE_OFF_KEY)).toBe("1");
  });
});
