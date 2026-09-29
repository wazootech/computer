# Computer

<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Wazoo's operating computer for turning direction into shipped work.</em>
</p>

Computer is Wazoo's operational AI partner: the general assistant the whole team shares, modeled after the Enterprise computer from *Star Trek: The Next Generation*. The authenticated web chat is a Vercel-hosted shell that proxies turns to Computer's Zo persona; the engineering workflow remains the Eve factory pipeline.

## Factory pipeline

Computer follows the official Eve software-factory shape:

```text
work item → classifier → researcher (when needed) → analyst → implementer → reviewer → draft PR
```

Each station has its own instructions, sandbox, tools, and structured output. The reviewer is independent, revision loops are capped, and Computer never merges or marks a pull request ready without a person. GitHub intake supports authorized mentions, deliberate candidate triage, human promotion, and CI-failure follow-up. Linear remains an optional channel.

## Risk-scaled review

The orchestrator uses `assess_review_depth` after analysis. Documentation-only changes take the light path, ordinary changes take standard review, and public API, security, permissions, migrations, data, deployment, runtime, or critical changes take deep review with targeted probes, repository checks, evidence fields, and an explicit human handoff. The reviewer can only upgrade the tier, never downgrade an actual high-risk diff.

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

The remaining Eve runtime needs `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `FACTORY_APPROVAL_SECRET`, and `AI_GATEWAY_API_KEY`. The Discord channel needs none of these: it runs on the Zo host, not here. `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` remain optional for authenticated Eve sessions that need GitHub write approval; the Zo-backed web chat is text-only and cannot invoke those tools.

## Web chat session proxy

The browser posts text turns to the Vercel route `/api/chat/:sessionId`. That route requires a same-origin request and a signed-in Better Auth session, then streams the answer from the public Zo Space route `https://etok.zo.space/api/computer-chat`, which calls the Computer persona through `/zo/ask`. The web UI is intentionally text-only: it does not expose Eve tools, approval prompts, file uploads, cancellation, or mid-turn steering. Conversation display history is saved in browser `localStorage`, keyed by the signed-in user and session; the Zo conversation id is carried in an HttpOnly, session-scoped cookie signed with HMAC-SHA-256 and bound to both ids.

`COMPUTER_CHAT_ZO_API_KEY` is a dedicated Zo Access Token used only by the Zo Space route when it calls `/zo/ask`; store it in Zo Secrets, never in Vercel or the browser. `COMPUTER_WEB_SECRET` must be at least 32 UTF-8 bytes and match in Vercel and Zo Space; it authenticates only the Vercel-to-Space request. `COMPUTER_CHAT_SESSION_SECRET` must also be at least 32 UTF-8 bytes, stays in Vercel only, and signs the HMAC session ticket. These are three different secrets with different purposes; never reuse the Zo API key as either web secret.

## Session repository attachment

The GitHub channel stamps the repository from the verified event. An Eve HTTP API session had no such stamp, so every `github__*` tool stayed unbound and work stopped at "No verified GitHub repository is attached to this session". The Eve channel now attaches a repository at request time: it resolves `owner/name` through the App installation token and stamps the same `githubRepository*` attributes the GitHub channel uses, so the tool binders and `preflight` need no special case.

- The default is `COMPUTER_SESSION_REPOSITORY`, falling back to `wazootech/workspace` (the federation manifest repo, which lists every repository in the org).
- A request can point the session at another repository with the `x-computer-repository: owner/name` header. A malformed value fails closed.
- Coverage is proven, not assumed: `GET /repos/{owner}/{name}` succeeds only when the installation can reach the repository, and a repository the App cannot see is reported (`not-covered`) instead of binding tools that would fail later.
- Only human principals are attached. App and runtime principals (eval and schedule runs) keep the auth they have today, so unattended runs do not gain a GitHub write surface.
- `preflight` reports the repository it checked, the App installation coverage for it, and the token's permission set; pass `repository` to check another `owner/name`.

The GitHub channel uses Eve's native GitHub App authentication with the WazooComputer App credentials. It does not require `GITHUB_CONNECTOR`. The GitHub webhook secret authenticates inbound events; the App private key and installation ID authorize GitHub API calls and sandbox egress.
A direct `@wazootech/computer` invocation is accepted in an issue or pull-request body when it is opened or edited, in issue and pull-request timeline comments, and in inline pull-request review comments. For timeline and review comments, `@wazootech/computer` is the native channel trigger; Eve prefilters those events by one configured `botName`. `@wazoocomputer` and `@wazoocomputer[bot]` remain compatibility aliases for body-based triggers. Direct invocations require the sender to be an active member of the configured approver team.

## Approval identity

GitHub writes from Eve sessions remain approval-gated and are accepted only from a verified member of the approver team. GitHub issue or pull-request replies carry the sender's login directly. An authenticated Eve API session without a GitHub sender can use a linked GitHub account (`githubLogin`) for approval attribution, but the Zo-backed web chat does not invoke write tools or display approval prompts.

For those Eve sessions, register a GitHub OAuth App with callback URL `https://<deployment>/api/auth/callback/github`, set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, and link the account once. Without the link, an approval is rejected with the specific missing-login reason; the GitHub event path continues to work.

## Discord channel (internal mentions)

Computer answers ordinary `@Computer` mentions in the configured internal Discord channel. `/ask` is retired: a mention is the only way to summon Computer, and there is no second interface to keep in sync.

Discord delivers ordinary messages over its Gateway, never to an application's interactions endpoint, so an always-on worker is required. `channels/discord/index.ts` uses `discord.js` to own the Gateway lifecycle; the channel admits a mention, asks Computer's brain, and posts the reply back into the originating channel or thread.

### Where the brain lives

Computer's brain for this channel is a Zo persona (`COMPUTER_PERSONA_ID`), reached through Zo's `/zo/ask` endpoint. The persona owns the prompt and the model; the channel names neither. No model credential lives in this repository or on Vercel for this path, so a revoked provider key cannot take the channel down, and there is no store to keep in order.

The persona's prompt of record is the text authored here in `agent/instructions.ts`, moved into the persona when the brain moved. Change Computer's identity or model in Zo, then update that file to match: the file is the record, the persona is the runtime.

Conversation continuity is per channel. The first turn on a channel creates a Zo conversation and later turns continue it, keyed in `channels/discord/data/conversations.json` (gitignored runtime state).

### Admission

Admission is default deny, fail closed, and pure enough to test. `lib/discord-mention-policy.ts` holds the matrix (mention parsing, allowlist denial, thread-to-parent mapping, self-loop prevention, hostile-input handling), `lib/discord-policy.ts` remains the tier authority, and `lib/discord-bridge.ts` holds duplicate suppression and per-user rate limiting. `discord.js` manages Gateway intents, heartbeat, reconnect, and resume.

A message dispatches only when it arrives in the internal guild, in an allowlisted channel (or in a thread whose parent channel is allowlisted), from an allowlisted user or role, from a person rather than a bot or webhook, and with an explicit `@Computer` mention that leaves a non-empty request. Mention text is untrusted input: it cannot change the allowlists, permissions, or these instructions, invisible and bidirectional characters are stripped before the model sees it, and an over-long message is truncated rather than dispatched whole. Replies never ping anyone (`allowed_mentions: {parse: []}`), and every bot-authored message is ignored, so a self-mention loop cannot start. Public and customer-service mentions are deferred: a public-allowlisted channel never starts a mention turn.

### Operator setup

1. Create the Discord application and bot, and enable the privileged **Message Content** intent in its Bot settings. It is required for `content` to arrive at all; without it, the client cannot read the message text needed to recognize mentions.
2. Give the bot a channel permission set that can read and reply: View Channels, Send Messages, Send Messages in Threads, Read Message History, and Embed Links. No administrator permission is needed, and the `applications.commands` scope is not required.
3. Leave the application's **Interactions Endpoint URL unset**. Nothing here verifies an inbound interaction signature any more, so no `DISCORD_PUBLIC_KEY` is needed either.
4. Set the service environment (comma-separated ids): `DISCORD_INTERNAL_GUILD_IDS`, `DISCORD_INTERNAL_CHANNEL_IDS`, `DISCORD_INTERNAL_USER_IDS`, `DISCORD_INTERNAL_ROLE_IDS`, plus `COMPUTER_PERSONA_ID`. Set `DISCORD_INTERNAL_GUILD_WIDE=1` to let an allowlisted operator mention the bot in any channel of an allowlisted guild, not only in the allowlisted channels; the guild allowlist and the user/role allowlist still both apply, so a shared or public server stays closed.
5. Run it on an always-on host:

```bash
DISCORD_BOT_TOKEN=... \
COMPUTER_PERSONA_ID=... \
DISCORD_INTERNAL_GUILD_IDS=... \
DISCORD_INTERNAL_CHANNEL_IDS=... \
DISCORD_INTERNAL_USER_IDS=... \
DISCORD_INTERNAL_ROLE_IDS=... \
DISCORD_INTERNAL_GUILD_WIDE=1 \
pnpm discord:channel
```

### Hosting the channel on Zo Computer

The reference host is a Zo Computer service, because it is always-on, restarts on crash, and can be redeployed from CI. Register it once with `mode: "process"` (no public port) and the environment from step 4:

```text
label:      computer-discord
mode:       process
workdir:    /home/workspace/users/etok/workspaces/wazootech/repos/computer
entrypoint: node --experimental-strip-types channels/discord/index.ts
env:        COMPUTER_PERSONA_ID,
            DISCORD_INTERNAL_GUILD_IDS, DISCORD_INTERNAL_CHANNEL_IDS,
            DISCORD_INTERNAL_USER_IDS, DISCORD_INTERNAL_ROLE_IDS
```

`DISCORD_BOT_TOKEN` stays out of that definition. A managed service inherits neither the host shell nor any deployment's variables, so its value is read from the host secrets file (`/root/.zo_secrets`, the same file the other Zo-hosted bots read; override with `ZO_SECRETS_PATH`) before anything reads the environment. An environment value always wins over the file, so the service definition can still override anything the file holds. The same loader fills `COMPUTER_DISCORD_ZO_API_KEY`, a dedicated Zo Access Token for this bot.

`scripts/zo-deploy.ts` deploys a new revision over Zo's MCP endpoint (`api.zo.computer/mcp`), which needs no open ports on the host:

```bash
COMPUTER_DEPLOY_ZO_API_KEY=... pnpm discord:deploy --service computer-discord --dir /path/to/computer
```

It fast-forwards the checkout with `git pull --ff-only`, installs the pinned `discord.js` package with Bun, restarts the service by id, and waits for the client's own `ready: computer-discord` line in `service_doctor` before reporting success. A failed pull or dependency install aborts before the restart, so the current process is left untouched. `--dry-run` resolves the service without installing dependencies or restarting anything.

`.github/workflows/deploy.yml` runs that script on every push to `main` that touches the channel or its libraries, serialized and never cancelled. It needs one repository secret and, optionally, two variables:

- `COMPUTER_DEPLOY_ZO_API_KEY` — a dedicated Zo Access Token for this deploy workflow, saved as a GitHub Actions secret. Until it is set, the workflow warns and skips instead of failing. Do not reuse the chat or Discord token.
- `vars.ZO_SERVICE` / `vars.ZO_SERVICE_DIRECTORY` — override the service label or the live checkout path.

The process calls `client.destroy()` on `SIGTERM`. `discord.js` manages reconnect and resume while the process is running, but a service restart or a rejected resume can leave a brief gap in which messages are not recovered; the channel does not perform a REST catch-up.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:eve
```

## Agent File

Retired 2026-09-25. This repository no longer publishes or checks an [Agent File](https://github.com/letta-ai/agent-file) projection.

The projection described less than the agent is: channels, subagents, sandboxes, approval tiers, and hooks have no `.af` counterpart, so the file could not be imported and run. It was also the only consumer of its own artifact — Computer does not run a Letta framework, and nothing read the file back.

What was removed: `agents/@wazootech/computer/computer.af`, `agent/agent-file-declaration.json`, `lib/agent-file-{schema,project,privacy,test}.ts`, `scripts/export-agent-file.ts`, the `export:agent-file` / `check:agent-file` scripts, the `check:agent-file` CI step, and the documentation that described them. The published file is preserved in `wazootech/data` at `archives/agent-file/data.af`, alongside the reason it was retired there.

Nothing about the live agent changed: this artifact was never read at runtime.

The factory evals are under `evals/`. Full-pipeline evals can create branches and consume model tokens, so run them only against a disposable target repository.
