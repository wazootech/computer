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

## Discord channel (staged)

A controlled Discord channel is wired at `agent/channels/discord.ts` on eve's native Discord integration. It is default-deny: without operator configuration the bot never dispatches anywhere, including DMs.

Operator setup:

1. Create the Discord application and bot. Either run the guided Connect setup (`pnpm eve add channel/discord`, which stores the bot token in Vercel Connect), or set `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and `DISCORD_PUBLIC_KEY` as deployment secrets and point the application's Interactions Endpoint URL at `POST /eve/v1/discord`.
2. Register the `/ask` application command. The guided setup registers it; the manual path is documented in eve's Discord channel docs (`node_modules/eve/docs/channels/discord.mdx`).
3. Configure the allowlists as deployment environment variables (comma-separated ids): `DISCORD_PUBLIC_GUILD_IDS`, `DISCORD_PUBLIC_CHANNEL_IDS`, `DISCORD_INTERNAL_GUILD_IDS`, `DISCORD_INTERNAL_CHANNEL_IDS`, `DISCORD_INTERNAL_USER_IDS`, `DISCORD_INTERNAL_ROLE_IDS`.

Policy: the public tier (allowlisted public support channels) is read-only with respect to Wazoo systems and answers from public-safe knowledge only. The internal team tier (allowlisted internal channels plus an allowlisted user or role) may expose approved internal context, with destructive, public, and externally communicative actions still behind approval gates (eve renders HITL confirmations as Discord components). Internal replies are ephemeral, visible only to the invoking user, so internal context does not linger in a shared channel. Admission is computed from the full request context with default deny and fails closed. Public and internal sessions use distinct principals and never share context.

Operator controls: allowlists change through deployment environment variables, and clearing them (or removing the channel file) silences the bot everywhere. Route health follows the Vercel deployment checks plus the `/eve/v1/discord` interaction route. The admission policy is pure and covered by `pnpm test`.

## Development

Edit `agent/instructions.md` to refine Computer's identity, purpose, tone, and response guidelines. Configure its model and runtime behavior in `agent/agent.ts`.

Add capabilities under `agent/`, including tools, connections, channels, skills, subagents, and schedules. eve reloads your changes as you work.

Learn more in the [eve documentation](https://eve.dev/docs), the [Build an Agent tutorial](https://eve.dev/docs/tutorial/first-agent), or the [eve repository](https://github.com/vercel/eve).
