---
name: Valo workbench manual build env vars
description: Both PORT and BASE_PATH must be set to build the workbench; Replit injects them from artifact.toml [services.env] automatically but manual/CI shells do not.
---

## Rule
Manual `vite build` of `@workspace/valo-workbench` requires **both** env vars:
- `PORT=21921`
- `BASE_PATH=/`

Correct invocation: `PORT=21921 BASE_PATH=/ pnpm --filter @workspace/valo-workbench run build`

## Why
`vite.config.ts` throws at config-load time if either is absent. Replit's Publish builder injects `[services.env]` from `artifact.toml` before running the build command, so production builds via Replit succeed without manual setting. Direct shell invocations (dev sessions, CI scripts, pre-release checks) must supply both.

## How to apply
Any time you run the workbench build from the shell, prefix with `PORT=21921 BASE_PATH=/`. The PORT value is the one declared in `artifact.toml [services.env]`.
