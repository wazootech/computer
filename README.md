1: # Computer
2: 
3: <p align="center">
4:   <a href="https://docs.wazo.dev">
5:     <img src="https://wazo.dev/assets/wazo.svg" alt="Wazo Worlds" width="120" />
6:   </a>
7:   <br /><br />
8:   <em>Wazo's operating computer for turning direction into shipped work.</em>
9: </p>
10: 
11: Computer is Wazo's operational AI partner: the general assistant the whole team shares, modeled after the Enterprise computer from *Star Trek: The Next Generation*. It runs on [eve](https://eve.dev) and speaks through an authenticated web chat. Engineering is the one domain it runs as a supervised factory pipeline.
12: 
13: ## Factory pipeline
14: 
15: Computer follows the official Eve software-factory shape:
16: 
17: ```text
18: work item → classifier → researcher (when needed) → analyst → implementer → reviewer → draft PR
19: ```
20: 
21: Each station has its own instructions, sandbox, tools, and structured output. The reviewer is independent, revision loops are capped, and Computer never merges or marks a pull request ready without a person. GitHub intake supports authorized mentions, deliberate candidate triage, human promotion, and CI-failure follow-up. Linear remains an optional channel.
22: 
23: ## Risk-scaled review
24: 
25: The orchestrator uses `assess_review_depth` after analysis. Documentation-only changes take the light path, ordinary changes take standard review, and public API, security, permissions, migrations, data, deployment, runtime, or critical changes take deep review with targeted probes, repository checks, evidence fields, and an explicit human handoff. The reviewer can only upgrade the tier, never downgrade an actual high-risk diff.
26: 
27: ## Deliberate intake
28: 
29: A normal work item does not start implementation automatically. An authorized maintainer applies `factory:candidate`; Computer classifies the issue with `set_intake_state` and moves it to `factory:queued`, `factory:needs-clarification`, `factory:duplicate`, or `factory:blocked`. A human then applies `factory:promoted` to a queued issue carrying `wayfinder:task`. Only that promotion starts the unattended pipeline, and it stops at a draft pull request.
30: 
31: Factory state transitions are durable, idempotent, and issue-scoped. The candidate session cannot create pull requests, close issues, mutate state through generic label tools, or write the shared factory brain.
32: 
33: ## Durable run history
34: 
35: Every verified GitHub session emits a redacted lifecycle history under the private `run-history/v1/` Blob namespace. The stable run ID is the Eve session ID; `read_run_record` retrieves the immutable event set by that ID, and `list_run_history` lists repository-scoped summaries. Events use stable idempotency keys, so webhook retries do not duplicate records. The history records source delivery, turn and stage lifecycle, child-session lineage, approvals, and terminal outcome without raw issue content or credentials. Legacy Markdown records under `run-records/` remain a read-only compatibility fallback; new writes never update that legacy namespace.
36: 
37: ## Memory and run records
38: 
39: Computer-specific curated memory, handoff artifacts, preferences, and redacted run records live in Vercel Blob, using reserved namespaces owned by dedicated tools. Run records contain stage events, approvals, outputs, token usage, and failures. They must never contain credentials, access tokens, private keys, or raw customer data.
40: 
41: The safe repeatability gate is:
42: 
43: ```bash
44: pnpm acceptance:repeatability -- --repository wazootech/wazoo-console --issue 84 --base-sha <full-40-character-sha> --worktree /tmp/factory-acceptance --disposable true
45: ```
46: 
47: It writes redacted evidence under `.eve/acceptance-repeatability/`, performs two fixture replays, requires equal canonical traces, and records zero model calls, GitHub mutations, branch pushes, or pull requests. It is not a live-provider test. The write-capable live eval remains opt-in and additionally requires `EVE_LIVE_ACCEPTANCE_CONFIRM=1`, `EVE_LIVE_ACCEPTANCE_TARGET=wazootech/wazo-console`, `EVE_LIVE_ACCEPTANCE_ISSUE=84`, `EVE_LIVE_ACCEPTANCE_BASE_SHA=<full SHA>`, and `EVE_LIVE_ACCEPTANCE_DISPOSABLE=1`.
48: 
49: The separate [computer-memory](https://github.com/wazootech/computer-memory) repository is a follow-up integration point, tracked separately from the first Blob-backed factory implementation.
50: 
51: User preferences and transient station handoff artifacts remain in their isolated storage namespaces. They are not the Computer factory brain.
52: 
53: ## Access and configuration
54: 
55: The authenticated web chat is served at `/`. In development:
56: 
57: ```bash
58: pnpm dev
59: ```
60: 
61: The Eve runtime can also be exercised with:
62: 
63: ```bash
64: pnpm dev:eve
65: ```
66: 
67: Production deployment uses:
68: 
69: ```bash
70: eve deploy
71: ```
72: 
73: The production runtime needs `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `FACTORY_APPROVAL_SECRET`, `AI_GATEWAY_API_KEY`, `DISCORD_BOT_TOKEN`, and `DISCORD_BRIDGE_SECRET`. Two optional variables, `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, enable GitHub sign-in; set both or neither. When they are set, a signed-in person can link their GitHub account, and that verified login is what attributes a write approval from chat.
74: 
75: ## Session repository attachment
76: 
77: The GitHub channel stamps the repository from the verified event. A session a person starts from the web chat or the Eve HTTP API had no such stamp, so every `github__*` tool stayed unbound and work stopped at "No verified GitHub repository is attached to this session". The Eve channel now attaches a repository at request time: it resolves `owner/name` through the App installation token and stamps the same `githubRepository*` attributes the GitHub channel uses, so the tool binders and `preflight` need no special case.
78: 
79: - The default is `COMPUTER_SESSION_REPOSITORY`, falling back to `wazootech/workspace` (the federation manifest repo, which lists every repository in the org).
80: - A request can point the session at another repository with the `x-computer-repository: owner/name` header. A malformed value fails closed.
81: - Coverage is proven, not assumed: `GET /repos/{owner}/{name}` succeeds only when the installation can reach the repository, and a repository the App cannot see is reported (`not-covered`) instead of binding tools that would fail later.
82: - Only human principals are attached. App and runtime principals (eval and schedule runs) keep the auth they have today, so unattended runs do not gain a GitHub write surface.
83: - `preflight` reports the repository it checked, the App installation coverage for it, and the token's permission set; pass `repository` to check another `owner/name`.
84: 
85: The GitHub channel uses Eve's native GitHub App authentication with the WazooComputer App credentials. It does not require `GITHUB_CONNECTOR`. The GitHub webhook secret authenticates inbound events; the App private key and installation ID authorize GitHub API calls and sandbox egress.
86: A direct `@wazootech/computer` invocation is accepted in an issue or pull-request body when it is opened or edited, in issue and pull-request timeline comments, and in inline pull-request review comments. For timeline and review comments, `@wazootech/computer` is the native channel trigger; Eve prefilters those events by one configured `botName`. `@wazoocomputer` and `@wazoocomputer[bot]` remain compatibility aliases for body-based triggers. Direct invocations require the sender to be an active member of the configured approver team.
87: 
88: ## Approval identity
89: 
90: Every GitHub write that a person asks for is approval-gated, and the approval is only accepted from a verified member of the approver team. A GitHub issue or pull-request reply carries the sender's login, so those approvals resolve directly. A chat session has no sender, so its approvals are attributed to the signed-in person's linked GitHub account: the account id must appear in the approver-team roster, and the login from that roster is stamped on the session as `githubLogin`.
91: 
92: To enable it, register a GitHub OAuth App with the callback URL `https://<deployment>/api/auth/callback/github`, set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, and sign in with GitHub once to link the account. Without the link there is no verified login, so an approval from chat is rejected with that specific reason instead of a generic one; the GitHub path keeps working throughout.
93: 
94: ## Discord channel (internal mentions)
95: 
96: Computer answers ordinary `@Computer` mentions in the configured internal Discord channel. `/ask` is retired: the slash command, its registration, and the HTTP interaction channel were removed, so a mention is the only way to summon Computer and there is no second interface to keep in sync.
97: 
98: Discord delivers ordinary messages over its Gateway websocket, never to an application's interactions endpoint, so a small always-on worker holds that connection and forwards admitted mentions to the agent's ingress route (`POST /eve/v1/discord-mentions`). Everything that decides anything lives in the deployment:
99: 
100: - `agent/channels/discord-mentions.ts` owns mention sessions. It is default-deny without configuration, verifies the bridge's HMAC signature, re-admits every forward against the deployment's own allowlists, and posts replies back to the originating channel or thread.
101: - `bridge/discord-gateway/index.ts` is transport only: one Gateway connection, the same admission policy as a prefilter, a per-user rate limit, duplicate suppression, and reconnect with backoff. It never posts to Discord.
102: - `lib/discord-mention-policy.ts` holds the pure admission matrix: mention parsing, allowlist denial, thread-to-parent mapping, self-loop prevention, and hostile-input handling. `lib/discord-policy.ts` remains the tier authority, and `lib/discord-bridge.ts` holds the transport primitives.
103: 
104: Operator setup:
105: 
106: 1. Create the Discord application and bot, and enable the privileged **Message Content** intent in its Bot settings. It is required for `content` to arrive at all; a socket that requests it without the portal toggle is closed with code 4014.
107: 2. Give the bot a channel permission set that can read and reply: View Channels, Send Messages, Send Messages in Threads, Read Message History, and Embed Links. No administrator permission is needed, and the `applications.commands` scope is no longer required.
108: 3. Leave the application's **Interactions Endpoint URL unset**. Discord is exclusive here: once a URL is configured, interactions stop arriving on the Gateway, so the approval buttons and modal answers a mention session waits on would go nowhere.
109: 4. Set the deployment environment (comma-separated ids): `DISCORD_INTERNAL_GUILD_IDS`, `DISCORD_INTERNAL_CHANNEL_IDS`, `DISCORD_INTERNAL_USER_IDS`, `DISCORD_INTERNAL_ROLE_IDS`, plus `DISCORD_BRIDGE_SECRET` and `DISCORD_BOT_TOKEN` (replies are posted with the bot token). No `DISCORD_PUBLIC_KEY` is needed: nothing verifies an inbound interaction signature any more.
110: 5. Run the bridge on an always-on host, with the same allowlists, the same secret, and the deployment origin:
111: 
112: ```bash
113: DISCORD_BOT_TOKEN=... \
114: DISCORD_BRIDGE_SECRET=... \
115: COMPUTER_BASE_URL=https://wazoocomputer.vercel.app \
116: DISCORD_INTERNAL_GUILD_IDS=... \
117: DISCORD_INTERNAL_CHANNEL_IDS=... \
118: DISCORD_INTERNAL_USER_IDS=... \
119: DISCORD_INTERNAL_ROLE_IDS=... \
120: pnpm discord:bridge
121: ```
122: 
123: Vercel cannot hold the Gateway socket, so the worker needs its own host. It reconnects with exponential backoff, resumes its session, and exits non-zero on a close code that retrying cannot fix (a bad token, sharding, or a disallowed intent).
124: 
125: ### Hosting the bridge on Zo Computer
126: 
127: The reference host is a Zo Computer service, because it is always-on, restarts on crash, and can be redeployed from CI. Register it once with `mode: "process"` (no public port) and the deployment environment from step 4:
128: 
129: ```text
130: label:      computer-discord-bridge
131: mode:       process
132: workdir:    /home/workspace/users/etok/workspaces/wazootech/repos/computer
133: entrypoint: node --experimental-strip-types bridge/discord-gateway/index.ts
134: env:        DISCORD_BOT_TOKEN, DISCORD_BRIDGE_SECRET, COMPUTER_BASE_URL,
135:             DISCORD_INTERNAL_GUILD_IDS, DISCORD_INTERNAL_CHANNEL_IDS,
136:             DISCORD_INTERNAL_USER_IDS, DISCORD_INTERNAL_ROLE_IDS
137: ```
138: 
139: `scripts/zo-deploy.ts` deploys a new revision over Zo's MCP endpoint (`api.zo.computer/mcp`), which needs no open ports on the host:
140: 
141: ```bash
142: ZO_API_KEY=... pnpm discord:deploy --service computer-discord-bridge --dir /path/to/computer
143: ```
144: 
145: It fast-forwards the checkout with `git pull --ff-only`, restarts the service by id, and then waits for the bridge's own `gateway ready` line in `service_doctor` before it reports success. Each step is safe to repeat, and a failed pull aborts before the restart, so a broken deploy leaves the previous process running. `--dry-run` resolves the service without restarting anything.
146: 
147: `.github/workflows/deploy.yml` runs that script on every push to `main` that touches the bridge or its libraries, serialized and never cancelled. It needs one repository secret and, optionally, two variables:
148: 
149: - `ZO_API_KEY` — a Zo access token from Zo Computer's Settings, under Advanced, in the Access Tokens area. Until it is set, the workflow warns and skips instead of failing.
150: - `vars.ZO_SERVICE` / `vars.ZO_SERVICE_DIRECTORY` — override the service label or the live checkout path.
151: 
152: The restart is graceful: the bridge closes its socket and exits 0 on `SIGTERM`, and Discord replays the events a resumed session missed, so a deploy does not drop a mention. Vercel deploys the agent side of the same push, so a mention that arrives mid-deploy waits for the ingress route instead of failing.
153: 
154: Policy: admission is default deny and fails closed. A message dispatches only when it arrives in the internal guild, in an allowlisted channel (or in a thread whose parent channel is allowlisted), from an allowlisted user or role, from a person rather than a bot or webhook, and with an explicit `@Computer` mention that leaves a non-empty request. Mention text is untrusted input: it cannot change the allowlists, permissions, approval policy, or these instructions, invisible and bidirectional characters are stripped before the model sees it, and an over-long message is truncated rather than dispatched whole. Replies never ping anyone (`allowed_mentions: {parse: []}`), and the bridge ignores every bot-authored message, so a self-mention loop cannot start. Public and customer-service mentions are deferred: a public-allowlisted channel never starts a mention turn.
155: 
156: Sessions are keyed to the guild and to the channel or thread, so a thread never shares context with its parent channel and one channel never shares with another. Replies land where the mention came from, with the same approval gates the web and GitHub channels use; an approval renders as Discord buttons and the click is answered over the same Gateway connection. The transport knobs are `DISCORD_BRIDGE_RATE_LIMIT` and `DISCORD_BRIDGE_RATE_WINDOW_MS` (6 per user per 60s by default), `DISCORD_BRIDGE_MAX_IN_FLIGHT` (4), and `DISCORD_BRIDGE_QUEUE_LIMIT` (25).
157: 
158: Operator controls: allowlists and secrets live in deployment environment variables, stopping the bridge silences mentions everywhere, and the admission matrix plus the transport primitives are covered by `pnpm test`.
159: 
160: ## Validation
161: 
162: ```bash
163: pnpm typecheck
164: pnpm test
165: pnpm build
166: pnpm build:eve
167: ```
168: 
169: The factory evals are under `evals/`. Full-pipeline evals can create branches and consume model tokens, so run them only against a disposable target repository.