import type { MissionEvent } from "@persona-system/shared";
import { ensureNovncStack } from "./novnc-stack.js";

export type MissionEventHandler = (event: MissionEvent) => void | Promise<void>;

let activePersonaId: string | undefined;
let activeEmit: MissionEventHandler | undefined;
let paused = false;
let resumeWaiters: Array<() => void> = [];

function now() {
  return new Date().toISOString();
}

function wakeWaiters() {
  const waiters = resumeWaiters;
  resumeWaiters = [];
  for (const wake of waiters) wake();
}

export function beginMission(personaId: string, onEvent?: MissionEventHandler) {
  activePersonaId = personaId;
  activeEmit = onEvent;
  paused = false;
  wakeWaiters();
}

export function endMission() {
  activePersonaId = undefined;
  activeEmit = undefined;
  paused = false;
  wakeWaiters();
}

export function hasActiveMission(): boolean {
  return Boolean(activePersonaId);
}

export function getActivePersonaId(): string | undefined {
  return activePersonaId;
}

export function isPaused(): boolean {
  return paused;
}

async function emitControl(action: "pause" | "resume") {
  if (!activeEmit || !activePersonaId) return;
  const message =
    action === "pause"
      ? "Agent tạm dừng — bạn điều khiển desktop qua noVNC"
      : "Agent tiếp tục sau khi bạn trả quyền điều khiển";
  await activeEmit({
    type: "control",
    at: now(),
    personaId: activePersonaId,
    action,
    message,
  });
}

export async function requestPause(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!activePersonaId) return { ok: false, reason: "no_active_mission" };
  if (paused) return { ok: true };
  paused = true;
  ensureNovncStack();
  await emitControl("pause");
  return { ok: true };
}

export async function requestResume(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!activePersonaId) return { ok: false, reason: "no_active_mission" };
  if (!paused) return { ok: true };
  paused = false;
  wakeWaiters();
  await emitControl("resume");
  return { ok: true };
}

export async function waitUntilRunning(): Promise<void> {
  while (paused) {
    await new Promise<void>((resolve) => {
      resumeWaiters.push(resolve);
    });
  }
}

/** @internal test helper */
export function _resetForTests() {
  activePersonaId = undefined;
  activeEmit = undefined;
  paused = false;
  resumeWaiters = [];
}
