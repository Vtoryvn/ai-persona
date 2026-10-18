import assert from "node:assert/strict";
import test from "node:test";
import * as missionControl from "./mission-control.js";

test("pause blocks waitUntilRunning until resume", async () => {
  missionControl._resetForTests();
  const events: string[] = [];
  missionControl.beginMission("demo", async (event) => {
    if (event.type === "control" && event.action) events.push(event.action);
  });

  const pauseResult = await missionControl.requestPause();
  assert.equal(pauseResult.ok, true);
  assert.equal(missionControl.isPaused(), true);

  let resumed = false;
  const waiting = missionControl.waitUntilRunning().then(() => {
    resumed = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resumed, false);

  await missionControl.requestResume();
  await waiting;
  assert.equal(resumed, true);
  assert.deepEqual(events, ["pause", "resume"]);

  missionControl.endMission();
});

test("requestPause without active mission fails", async () => {
  missionControl._resetForTests();
  const result = await missionControl.requestPause();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_active_mission");
});
