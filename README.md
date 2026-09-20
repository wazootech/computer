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

Every verified GitHub session emits a redacted lifecycle history under the private `run-history/v1/` Blob namespace. The stable run ID is the Eve session ID; `read_run_record` retrieves the immutable event set by that ID, and `list_run_history` lists repository-scoped summaries. Events use stable idempotency keys, so webhook retries do not duplicate records. The history records source delivery, turn and stage lifecycle, child-session lineage, approvals, and terminal outcome without raw issue content or credentials. Legacy Markdown records under `run-records/` remain a read-only compatibility fallback; new writes never update that legacy namespace.

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

The production runtime needs `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `FACTORY_APPROVAL_SECRET`, `DEEPSEEK_API_KEY`, `DISCORD_BOT_TOKEN`, and `DISCORD_BRIDGE_SECRET`.

The GitHub channel uses Eve's native GitHub App authentication with the WazooComputer App credentials. It does not require `GITHUB_CONNECTOR`. The GitHub webhook secret authenticates inbound events; the App private key and installation ID authorize GitHub API calls and sandbox egress.
A direct `@wazootech/computer` invocation is accepted in an issue or pull-request body when it is opened or edited, in issue and pull-request timeline comments, and in inline pull-request review comments. For timeline and review comments, `@wazootech/computer` is the native channel trigger; Eve prefilters those events by one configured `botName`. `@wazoocomputer` and `@wazoocomputer[bot]` remain compatibility aliases for body-based triggers. Direct invocations require the sender to be an active member of the configured approver team.

## Discord channel (internal mentions)

Computer answers ordinary `@Computer` mentions in the configured internal Discord channel. `/ask` is retired: the slash command, its registration, and the HTTP interaction channel were removed, so a mention is the only way to summon Computer and there is no second interface to keep in sync.

Discord delivers ordinary messages over its Gateway websocket, never to an application's interactions endpoint, so a small always-on worker holds that connection and forwards admitted mentions to the agent's ingress route (`POST /eve/v1/discord-mentions`). Everything that decides anything lives in the deployment:

- `agent/channels/discord-mentions.ts` owns mention sessions. It is default-deny without configuration, verifies the bridge's HMAC signature, re-admits every forward against the deployment's own allowlists, and posts replies back to the originating channel or thread.
- `bridge/discord-gateway/index.ts` is transport only: one Gateway connection, the same admission policy as a prefilter, a per-user rate limit, duplicate suppression, and reconnect with backoff. It never posts to Discord.
- `lib/discord-mention-policy.ts` holds the pure admission matrix: mention parsing, allowlist denial, thread-to-parent mapping, self-loop prevention, and hostile-input handling. `lib/discord-policy.ts` remains the tier authority, and `lib/discord-bridge.ts` holds the transport primitives.

Operator setup:

1. Create the Discord application and bot, and enable the privileged **Message Content** intent in its Bot settings. It is required for `content` to arrive at all; a socket that requests it without the portal toggle is closed with code 4014.
2. Give the bot a channel permission set that can read and reply: View Channels, Send Messages, Send Messages in Threads, Read Message History, and Embed Links. No administrator permission is needed, and the `applications.commands` scope is no longer required.
3. Leave the application's **Interactions Endpoint URL unset**. Discord is exclusive here: once a URL is configured, interactions stop arriving on the Gateway, so the approval buttons and modal answers a mention session waits on would go nowhere.
4. Set the deployment environment (comma-separated ids): `DISCORD_INTERNAL_GUILD_IDS`, `DISCORD_INTERNAL_CHANNEL_IDS`, `DISCORD_INTERNAL_USER_IDS`, `DISCORD_INTERNAL_ROLE_IDS`, plus `DISCORD_BRIDGE_SECRET` and `DISCORD_BOT_TOKEN` (replies are posted with the bot token). No `DISCORD_PUBLIC_KEY` is needed: nothing verifies an inbound interaction signature any more.
5. Run the bridge on an always-on host, with the same allowlists, the same secret, and the deployment origin:

```bash
DISCORD_BOT_TOKEN=... \
DISCORD_BRIDGE_SECRET=... \
COMPUTER_BASE_URL=https://wazoocomputer.vercel.app \
DISCORD_INTERNAL_GUILD_IDS=... \
DISCORD_INTERNAL_CHANNEL_IDS=... \
DISCORD_INTERNAL_USER_IDS=... \
DISCORD_INTERNAL_ROLE_IDS=... \
pnpm discord:bridge
```

Vercel cannot hold the Gateway socket, so the worker needs its own host. It reconnects with exponential backoff, resumes its session, and exits non-zero on a close code that retrying cannot fix (a bad token, sharding, or a disallowed intent).

### Hosting the bridge on Zo Computer

The reference host is a Zo Computer service, because it is always-on, restarts on crash, and can be redeployed from CI. Register it once with `mode: "process"` (no public port) and the deployment environment from step 4:

```text
label:      computer-discord-bridge
mode:       process
workdir:    /home/workspace/users/etok/workspaces/wazootech/repos/computer
entrypoint: node --experimental-strip-types bridge/discord-gateway/index.ts
env:        DISCORD_BOT_TOKEN, DISCORD_BRIDGE_SECRET, COMPUTER_BASE_URL,
            DISCORD_INTERNAL_GUILD_IDS, DISCORD_INTERNAL_CHANNEL_IDS,
            DISCORD_INTERNAL_USER_IDS, DISCORD_INTERNAL_ROLE_IDS
```

`scripts/zo-deploy.ts` deploys a new revision over Zo's MCP endpoint (`api.zo.computer/mcp`), which needs no open ports on the host:

```bash
ZO_API_KEY=... pnpm discord:deploy --service computer-discord-bridge --dir /path/to/computer
```

It fast-forwards the checkout with `git pull --ff-only`, restarts the service by id, and then waits for the bridge's own `gateway ready` line in `service_doctor` before it reports success. Each step is safe to repeat, and a failed pull aborts before the restart, so a broken deploy leaves the previous process running. `--dry-run` resolves the service without restarting anything.

`.github/workflows/deploy-discord-bridge.yml` runs that script on every push to `main` that touches the bridge or its libraries, serialized and never cancelled. It needs one repository secret and, optionally, two variables:

- `ZO_API_KEY` — a Zo access token from Zo Computer's Settings, under Advanced, in the Access Tokens area. Until it is set, the workflow warns and skips instead of failing.
- `vars.ZO_BRIDGE_SERVICE` / `vars.ZO_BRIDGE_DIRECTORY` — override the service label or the live checkout path.

The restart is graceful: the bridge closes its socket and exits 0 on `SIGTERM`, and Discord replays the events a resumed session missed, so a deploy does not drop a mention. Vercel deploys the agent side of the same push, so a mention that arrives mid-deploy waits for the ingress route instead of failing.

Policy: admission is default deny and fails closed. A message dispatches only when it arrives in the internal guild, in an allowlisted channel (or in a thread whose parent channel is allowlisted), from an allowlisted user or role, from a person rather than a bot or webhook, and with an explicit `@Computer` mention that leaves a non-empty request. Mention text is untrusted input: it cannot change the allowlists, permissions, approval policy, or these instructions, invisible and bidirectional characters are stripped before the model sees it, and an over-long message is truncated rather than dispatched whole. Replies never ping anyone (`allowed_mentions: {parse: []}`), and the bridge ignores every bot-authored message, so a self-mention loop cannot start. Public and customer-service mentions are deferred: a public-allowlisted channel never starts a mention turn.

Sessions are keyed to the guild and to the channel or thread, so a thread never shares context with its parent channel and one channel never shares with another. Replies land where the mention came from, with the same approval gates the web and GitHub channels use; an approval renders as Discord buttons and the click is answered over the same Gateway connection. The transport knobs are `DISCORD_BRIDGE_RATE_LIMIT` and `DISCORD_BRIDGE_RATE_WINDOW_MS` (6 per user per 60s by default), `DISCORD_BRIDGE_MAX_IN_FLIGHT` (4), and `DISCORD_BRIDGE_QUEUE_LIMIT` (25).

Operator controls: allowlists and secrets live in deployment environment variables, stopping the bridge silences mentions everywhere, and the admission matrix plus the transport primitives are covered by `pnpm test`.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:eve
```

The factory evals are under `evals/`. Full-pipeline evals can create branches and consume model tokens, so run them only against a disposable target repository.
