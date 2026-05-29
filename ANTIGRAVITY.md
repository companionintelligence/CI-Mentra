# ANTIGRAVITY.md — CI-Mentra

## Context

**CI-Mentra** — **Device** layer of the Companion Intelligence platform (Lifescope Inc).

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`

## Purpose

Companion Intelligence integration for the Mentra glasses capture device.

## Stack

- Device SDK (check README for specifics)
- Streaming transport to CI-Server

## Commands

```bash
npm install
npm run dev
npm test
```

## Rules

- Package manager: do not switch or mix.
- Destructive git operations (`reset --hard`, `clean -f`) require explicit user confirmation.
- Commits reference CI-Engineering issues.
- All content is **private and confidential** — Property of Lifescope Inc.
