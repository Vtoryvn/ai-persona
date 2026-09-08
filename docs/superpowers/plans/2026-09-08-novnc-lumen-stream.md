# noVNC Lumen-style Live View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace screenshot SSE UI with Lumen-style noVNC live desktop streaming on persona Fly runners.

**Architecture:** Xvfb + headed Chrome (CDP :9222) + x11vnc + noVNC proxy (:6080) in runner image; MCP connects via `--browser-url`; console embeds noVNC iframes per persona grid cell and detail view; agent events still flow over SSE.

**Tech Stack:** Fly.io Machines, noVNC, x11vnc, chrome-devtools-mcp, Fastify console

**Spec:** User request + Lumen reference (`C:\Users\ADMIN\Project\lumen`)

## Global Constraints

- Region `sin`, viewport `1280x720`
- Fly auto-stop/start between evals
- Runner API `:8080`, noVNC `:6080`
- VM size: shared-cpu-1x, 1GB (Lumen parity)

## Deploy note

After merge, re-deploy all persona runners so Fly picks up new Dockerfile, `start.sh`, and port 6080 services:

```bash
npm run persona -- deploy
```
