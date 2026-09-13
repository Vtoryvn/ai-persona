export function mergeEvalPrompt(basePrompt: string, accountPrompt?: string): string {
  const base = basePrompt.trim();
  const account = accountPrompt?.trim();
  if (!account) return base;
  return `${base}\n\n## Tài khoản riêng cho agent này\n${account}`;
}
