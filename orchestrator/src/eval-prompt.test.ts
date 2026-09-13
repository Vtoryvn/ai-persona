import assert from "node:assert/strict";
import test from "node:test";
import { mergeEvalPrompt } from "./eval-prompt.js";

test("mergeEvalPrompt returns trimmed base when account absent", () => {
  assert.equal(mergeEvalPrompt("  Vào example.com  "), "Vào example.com");
});

test("mergeEvalPrompt appends account section when account provided", () => {
  const result = mergeEvalPrompt("Vào example.com", "Đăng nhập user-a@test.com / pass123");
  assert.equal(
    result,
    "Vào example.com\n\n## Tài khoản riêng cho agent này\nĐăng nhập user-a@test.com / pass123",
  );
});

test("mergeEvalPrompt ignores whitespace-only account", () => {
  assert.equal(mergeEvalPrompt("Vào example.com", "   \n  "), "Vào example.com");
});
