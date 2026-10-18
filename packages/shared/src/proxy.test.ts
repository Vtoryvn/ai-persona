import assert from "node:assert/strict";
import test from "node:test";
import { maskProxyUrl } from "./proxy.js";

test("maskProxyUrl hides password", () => {
  const masked = maskProxyUrl("http://masstic:secret@128.140.10.142:4000");
  assert.equal(masked?.includes("secret"), false);
  assert.equal(masked?.includes("128.140.10.142"), true);
});
