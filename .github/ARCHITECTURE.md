1: # Computer architecture
2: 
3: Computer is Wazo's general assistant for the whole team, and it adopts the official Eve software-factory pattern for engineering work while keeping Wazo-specific identity, credentials, and memory boundaries. The factory described below covers Computer's engineering path, not the whole of its job.
4: 
5: ## Runtime
6: 
7: The root agent is an orchestrator. It delegates every work item through structured stations:
8: 
9: 1. `classifier` triages the work item.
10: 2. `researcher` gathers cited external facts when needed.
11: 3. `analyst` plans against a repository checkout.
14: 4. `implementer` changes code on a protected feature branch and runs checks.
15: 5. `reviewer` inspects the pushed branch independently and can request at most two revisions.
16: 
17: The result is a draft pull request. Merge and ready-for-review actions are intentionally outside the tool surface.
18: 
19: ## Eve capabilities
20: 
21: - `agent/channels/github.ts` handles authorized mentions, `factory`-label intake, CI-failure follow-up, and PR summaries.
22: - Failure comments are policy-controlled. `lib/failure-policy.ts` decides what a channel may say when a turn or session fails: a **deployment fault** (an unusable credential, an unpaid gateway account, or a model the account cannot reach) posts nothing, because only an operator can clear it, and every other failure posts one generic sentence that never carries the upstream provider's text. eve's built-in handler echoes that text verbatim, which is how a revoked key repeated `Model provider API error: Authentication Fails, Your api key: ****53a6...` into the originating thread on every dispatch.
23: - `agent/channels/discord-mentions.ts` owns ordinary `@Computer` mentions in the internal Discord channel; `bridge/discord-gateway/` holds the Gateway connection that carries them, and `lib/discord-mention-policy.ts` decides admission.
24: - `agent/extensions/github.ts` mounts the official GitHub tools with an explicit allowlist and the WazooComputer GitHub App installation token.
25: - `agent/subagents/` contains isolated station prompts, sandboxes, and handoff tools.
26: - `agent/skills/` contains load-on-demand triage, writing, and tracker-bridging procedures.
27: - `evals/` contains routing, safety, smoke, and opt-in pipeline evaluations.
28: - `agent/lib/trust.ts` is the single authority for attended, unattended, and schedule caller classes.
29: - `agent/lib/github/approval.ts` keeps reversible writes separate from actions that can ship.
30: - `agent/lib/github/session-attachment.ts` attaches a verified repository to sessions that no GitHub event started, through the `x-computer-repository` header or the deployment default.
31: - `agent/lib/github/approver-login.ts` resolves a chat session's approval to a verified GitHub login from the approver-team roster, and `preflight` proves the roster is readable.
32: 
33: ## Memory boundary
34: 
35: Computer-specific curated memory and redacted run records use Vercel Blob for the first factory implementation. Reserved namespaces prevent generic file tools from reading or overwriting factory brain and run records. A follow-up issue tracks optional synchronization to the private `wazootech/computer-memory` repository; that integration is not part of this factory adoption.
36: 
37: Each run record may include:
38: 
39: - stage transitions and timestamps;
40: - approval decisions;
41: - concise station outputs;
42: - token usage when reported by a station;
43: - failure status and safe error summaries.
44: 
45: The writer recursively redacts credential-shaped keys and values. It never stores tokens, private keys, authorization headers, or raw customer data. Vercel Blob is reserved for user preferences and transient station handoff artifacts, not Computer memory.
46: 
47: ## Security boundaries
48: 
49: - GitHub installation tokens are minted at runtime and never passed to a model or sandbox.
50: - Feature branches use the `factory/` prefix and cannot target `main`, `master`, `HEAD`, or `refs/*`.
51: - Unattended intake is denied actions that require a person; it can only narrate on its intake issue and open a draft PR.
52: - The GitHub App has broad repository selection by design, with read-only organization Members permission for team-backed approval resolution.
53: - The `preflight` tool reports only boolean, status, and count data for the GitHub and model-runtime checks.
54: 
55: ## Configuration
56: 
57: `COMPUTER_MODEL` defaults to the AI Gateway id `deepseek/deepseek-v4.1-flash`, so the agent reaches the model through the gateway instead of a direct provider client: the gateway resolves the slug to one of its upstream providers and fails over to another provider serving the same model when one is unavailable. The runtime credential is `AI_GATEWAY_API_KEY`, falling back to Vercel's injected `VERCEL_OIDC_TOKEN`; no per-provider key is needed in the app. Thinking mode is pinned off on every request by default — DeepSeek-V4.1-Flash defaults to thinking ON, which would otherwise silently change agent behavior — and `DEEPSEEK_THINKING=enabled` opts back in. The pin travels as the provider option `providerOptions.deepseek.thinking`, which the gateway forwards to the DeepSeek provider. GitHub events provide the verified owner, repository name, and repository ID. A session without a GitHub event attaches `COMPUTER_SESSION_REPOSITORY`, defaulting to `wazootech/workspace`, and proves installation coverage before stamping it. Optional GitHub sign-in (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`) links a chat principal to its GitHub account, which supplies the login an approval from chat is attributed to. The sender must be an active member of `COMPUTER_APPROVER_ORG` and `COMPUTER_APPROVER_TEAM`; the default organization is `wazootech` and the default team is `team`.
58: 
59: The web surface uses Vercel authentication. The GitHub channel uses Eve’s native GitHub App credentials and webhook verification; no Vercel Connect GitHub connector is required. Linear is optional and is not required for the GitHub factory path.