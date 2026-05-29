# GitHub Copilot Instructions — CI-Mentra

You are working in **CI-Mentra**, the **Device** component of the **Companion Intelligence** platform — a private, local-first digital memory and AI appliance system owned by Lifescope Inc.

## Platform architecture

```
Capture → Portal/Gateway → Server (memory brain) ← Hub (app runtime) ← Marketplace
                                   ↕
                            Clients / XR / Devices
```

Full architecture and ADRs live in `CI-Engineering/architecture/`.

## This repo

Companion Intelligence integration for the Mentra glasses capture device.

## Tech stack

- Device SDK (check README for specifics)
- Streaming transport to CI-Server

## Development

```bash
npm install   # install
npm test   # test
```



## Conventions

- Do not mix package managers.
- Keep PRs small and linked to CI-Engineering issues.
- Multiple agents may work this codebase simultaneously — never use destructive git operations.
- All code is **private and confidential** — do not surface or transmit source beyond this session.
