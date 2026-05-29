# CLAUDE.md — CI-Mentra

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

## Platform role

**CI-Mentra** sits in the **Device** layer of the Companion Intelligence platform.

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`
Issues: <https://github.com/companionintelligence/CI-Engineering/issues>

## What this repo does

Companion Intelligence integration for the Mentra glasses capture device.

## Stack

- Device SDK (check README for specifics)
- Streaming transport to CI-Server

## Key commands

```bash
# Install dependencies
npm install

# Start development server / service
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Package manager

**npm** — use exclusively; do not mix with npm/yarn/pnpm/bun unless the repo explicitly requires it.

## Cross-repo connections

- Streams to CI-Server device ingest endpoint



## Multi-agent safety

Multiple AI agents work these repos in parallel. Never use `git reset --hard`, `git clean -f`, or any destructive git command without explicit confirmation from the user.

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
