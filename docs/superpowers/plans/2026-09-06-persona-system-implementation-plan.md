# Persona System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Approach B persona runners on Fly + orchestrator eval with OpenAI-compatible LLM and simple product auth.

**Architecture:** YAML personas → orchestrator POST `/missions` → Fly runner (Fastify + MCP Chrome + LLM tool loop) → aggregated `report.md`.

**Tech Stack:** Node 22, TypeScript, Zod, Fastify, OpenAI SDK, MCP SDK, Fly.io, chrome-devtools-mcp.

---

### Task 1: Shared schemas + persona loader ✅

### Task 2: Persona YAML (5 personas) ✅

### Task 3: persona-runner (Docker, MCP, agent, server) ✅

### Task 4: Orchestrator CLI (list, deploy, eval, report) ✅

### Task 5: Docs + tests + build verification

**Step 1:** `npm install && npm run build && npm test`
**Step 2:** Commit on branch `cursor/persona-system-design-6f2b`
