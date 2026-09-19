# Computer

<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Wazoo's operating computer for turning direction into shipped work.</em>
</p>

Computer is Wazoo's operational AI partner, modeled after the Enterprise computer from *Star Trek: The Next Generation*. It runs on [eve](https://eve.dev), speaks through an authenticated web chat, and routes software work through a supervised factory pipeline.

## Factory pipeline

Computer follows the official Eve software-factory shape:

```text
work item → classifier → researcher (when needed) → analyst → implementer → reviewer → draft PR
```

Each station has its own instructions, sandbox, tools, and structured output. The reviewer is independent, revision loops are capped, and Computer never merges or marks a pull request ready without a person. GitHub intake supports authorized mentions, deliberate candidate triage, human promotion, and CI-failure follow-up. Linear remains an optional channel.

## Deliberate intake

A normal work item does not start implementation automatically. An authorized maintainer applies `factory:candidate`; Computer classifies the issue with `set_intake_state` and moves it to `factory:queued`, `factory:needs-clarification`, `factory:duplicate`, or `factory:blocked`. A human then applies `factory:promoted` to a queued issue carrying `wayfinder:task`. Only that promotion starts the unattended pipeline, and it stops at a draft pull request.

Factory state transitions are durable, idempotent, and issue-scoped. The candidate session cannot create pull requests, close issues, mutate state through generic label tools, or write the shared factory brain.

## Durable run history

Every verified GitHub session emits a redacted lifecycle history under the private `run-history/v1/` Blob namespace. The stable run ID is the Eve session ID; `read_run_record` retrieves the immutable event set by that ID, and `list_run_history` lists repository-scoped summaries. Events use stable idempotency keys, so webhook retries do not duplicate records. The history records source delivery, turn and stage lifecycle, child-session lineage, approvals, and terminal outcome without raw issue content or credentials.

## Memory and run records

Computer-specific curated memory, handoff artifacts, preferences, and redacted run records live in Vercel Blob, using reserved namespaces owned by dedicated tools. Run records contain stage events, approvals, outputs, token usage, and failures. They must never contain credentials, access tokens, private keys, or raw customer data.

The safe repeatability gate is:

```bash
pnpm acceptance:repeatability -- --repository wazootech/wazoo-console --issue 84 --base-sha <full-40-character-sha> --worktree /tmp/factory-acceptance --disposable true
```

It writes redacted evidence under `.eve/acceptance-repeatability/`, performs two fixture replays, requires equal canonical traces, and records zero model calls, GitHub mutations, branch pushes, or pull requests. It is not a live-provider test. The write-capable live eval remains opt-in and additionally requires `EVE_LIVE_ACCEPTANCE_CONFIRM=1`, `EVE_LIVE_ACCEPTANCE_TARGET=wazootech/wazoo-console`, `EVE_LIVE_ACCEPTANCE_ISSUE=84`, `EVE_LIVE_ACCEPTANCE_BASE_SHA=<full SHA>`, and `EVE_LIVE_ACCEPTANCE_DISPOSABLE=1`.

The separate [computer-memory](https://github.com/wazootech/computer-memory) repository is a follow-up integration point, tracked separately from the first Blob-backed factory implementation.

User preferences and transient station handoff artifacts remain in their isolated storage namespaces. They are not the Computer factory brain.

## Access and configuration

The authenticated web chat is served at `/`. In development:

```bash
pnpm dev
```

The Eve runtime can also be exercised with:

```bash
pnpm dev:eve
```

Production deployment uses:

```bash
eve deploy
```

The production runtime needs `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `FACTORY_APPROVAL_SECRET`, and `DEEPSEEK_API_KEY`.

The GitHub channel uses Eve's native GitHub App authentication with the WazooComputer App credentials. It does not require `GITHUB_CONNECTOR`. The GitHub webhook secret authenticates inbound events; the App private key and installation ID authorize GitHub API calls and sandbox egress.
A direct `@wazootech/computer` invocation is accepted in an issue or pull-request body when it is opened or edited, in issue and pull-request timeline comments, and in inline pull-request review comments. For timeline and review comments, `@wazootech/computer` is the native channel trigger; Eve prefilters those events by one configured `botName`. `@wazoocomputer` and `@wazoocomputer[bot]` remain compatibility aliases for body-based triggers. Direct invocations require the sender to be an active member of the configured approver team.

## Discord channel (staged)

A controlled Discord channel is wired at `agent/channels/discord.ts` on eve's native Discord integration. It is default-deny: without operator configuration the bot never dispatches anywhere, including DMs.

Operator setup:

1. Create the Discord application and bot. Either run the guided Connect setup (`pnpm eve add channel/discord`, which stores the bot token in Vercel Connect), or set `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and `DISCORD_PUBLIC_KEY` as deployment secrets and point the application's Interactions Endpoint URL at `POST /eve/v1/discord`.
2. Register the `/ask` application command. The guided setup registers it; the manual path is documented in eve's Discord channel docs (`node_modules/eve/docs/channels/discord.mdx`).
3. Configure the allowlists as deployment environment variables (comma-separated ids): `DISCORD_PUBLIC_GUILD_IDS`, `DISCORD_PUBLIC_CHANNEL_IDS`, `DISCORD_INTERNAL_GUILD_IDS`, `DISCORD_INTERNAL_CHANNEL_IDS`, `DISCORD_INTERNAL_USER_IDS`, `DISCORD_INTERNAL_ROLE_IDS`.

Policy: the public tier (allowlisted public support channels) is read-only with respect to Wazoo systems and answers from public-safe knowledge only. The internal team tier (allowlisted internal channels plus an allowlisted user or role) may expose approved internal context, with destructive, public, and externally communicative actions still behind approval gates (eve renders HITL confirmations as Discord components). Internal replies are ephemeral, visible only to the invoking user, so internal context does not linger in a shared channel. Admission is computed from the full request context with default deny and fails closed. Public and internal sessions use distinct principals and never share context. A channel id may not appear in both the public and internal allowlists; the environment parser rejects such a configuration at startup.

Operator controls: allowlists change through deployment environment variables, and clearing them (or removing the channel file) silences the bot everywhere. Route health follows the Vercel deployment checks plus the `/eve/v1/discord` interaction route. The admission policy is pure and covered by `pnpm test`. Reconnect handling does not apply in this mode: the channel is webhook-based (no persistent socket), and signature verification plus delivery retries come from eve's native channel runtime.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:eve
```

The factory evals are under `evals/`. Full-pipeline evals can create branches and consume model tokens, so run them only against a disposable target repository.
