# Computer

<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Wazoo's operating computer for turning direction into shipped work.</em>
  <br /><br />
  <a href="https://github.com/wazootech/computer"><img src="https://img.shields.io/badge/GitHub-black?logo=github" alt="GitHub" /></a>
  <a href="https://docs.wazoo.dev"><img src="https://img.shields.io/badge/Docs-wazoo.dev-blue" alt="Documentation" /></a>
</p>

Computer is Wazoo's operational AI partner, inspired by the Enterprise computer from *Star Trek: The Next Generation*. It is bootstrapped with [eve](https://eve.dev) and provides an authenticated web chat today. Its voice and operating guidance live in `agent/instructions.md`.

## Current access

The current access surface is the generated web chat at `/`. In development, run:

```bash
pnpm dev
```

The eve development TUI is available separately with:

```bash
pnpm dev:eve
```

For a production web presence, deploy from the project root:

```bash
eve deploy
```

Production access uses the Vercel sign-in flow already included in the scaffold. The deployment must provide `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, and `VERCEL_APP_CLIENT_SECRET`; the auth configuration also trusts the Vercel deployment host variables.

Discord is not connected yet. The intended next channel is a team-facing bot that uses the same Computer identity and runtime while preserving authentication, approval, and action boundaries.

## Development

Edit `agent/instructions.md` to refine Computer's identity, purpose, tone, and response guidelines. Configure its model and runtime behavior in `agent/agent.ts`.

Add capabilities under `agent/`, including tools, connections, channels, skills, subagents, and schedules. eve reloads your changes as you work.

Learn more in the [eve documentation](https://eve.dev/docs), the [Build an Agent tutorial](https://eve.dev/docs/tutorial/first-agent), or the [eve repository](https://github.com/vercel/eve).
