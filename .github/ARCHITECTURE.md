# Computer architecture

Computer adopts the official Eve software-factory pattern while keeping Wazoo-specific identity, credentials, and memory boundaries.

## Runtime

The root agent is an orchestrator. It delegates every work item through structured stations:

1. `classifier` triages the work item.
2. `researcher` gathers cited external facts when needed.
3. `analyst` plans against a repository checkout.
4. `implementer` changes code on a protected feature branch and runs checks.
5. `reviewer` inspects the pushed branch independently and can request at most two revisions.

The result is a draft pull request. Merge and ready-for-review actions are intentionally outside the tool surface.

## Eve capabilities

- `agent/channels/github.ts` handles authorized mentions, `factory`-label intake, CI-failure follow-up, and PR summaries.
- `agent/channels/discord-mentions.ts` owns ordinary `@Computer` mentions in the internal Discord channel; `bridge/discord-gateway/` holds the Gateway connection that carries them, and `lib/discord-mention-policy.ts` decides admission.
- `agent/extensions/github.ts` mounts the official GitHub tools with an explicit allowlist and the WazooComputer GitHub App installation token.
- `agent/subagents/` contains isolated station prompts, sandboxes, and handoff tools.
- `agent/skills/` contains load-on-demand triage, writing, and tracker-bridging procedures.
- `evals/` contains routing, safety, smoke, and opt-in pipeline evaluations.
- `agent/lib/trust.ts` is the single authority for attended, unattended, and schedule caller classes.
- `agent/lib/github/approval.ts` keeps reversible writes separate from actions that can ship.
- `agent/lib/github/session-attachment.ts` attaches a verified repository to sessions that no GitHub event started, through the `x-computer-repository` header or the deployment default.
- `agent/lib/github/approver-login.ts` resolves a chat session's approval to a verified GitHub login from the approver-team roster, and `preflight` proves the roster is readable.

## Agent File projection

`agents/@wazootech/computer/computer.af` is the generated, importable declaration of this agent layer. It is a projection, not a source of truth: `scripts/export-agent-file.ts` reads the compiled manifest (`.eve/agent-summary.json`), the declaration (`agent/agent-file-declaration.json`), and the authored tool bindings, and writes the file. Nothing generated is ever read back into `agent/`.

The same exporter projects **Data's** file in *source mode*, where there is no eve build to read: `agents/data/agent/instructions.md` is the prompt, and `agents/data/agent/agent-file-declaration.json` names the GitHub tools Data may call — the read half only. Names are declared; descriptions and the read/write class still come from the SDK, so the two agents cannot disagree about what a tool is. Data's file is committed here and published to `wazootech/data/agents/@wazootech/data/data.af`: this repository's CI is the drift guard for both copies.

- **The system prompt is exported verbatim** from the compiled instructions. A reworded or truncated prompt fails the export rather than shipping a file that describes an agent nobody runs.
- **Memory blocks are allowlisted, block by block.** `persona` and `scope` publish; `factory_brain`, `user_preferences`, `run_history`, and `intake_state` export schema-only and each states why it stays private. An undeclared block, or a private block carrying a value, fails the export. Messages and credentials are always empty.
- **The tool surface is derived, not declared.** `agent/tools/github__*.ts` bind the `@github-tools/sdk` factories through `defineDynamic`, so they never appear in the compiled manifest; the projection enumerates those binding files and resolves each one's description and read/write class from the installed SDK's type declarations. A bound tool with no resolvable description stops the export, so the surface cannot silently shrink. Parameter schemas are not projected — TypeScript tool code does not run on another framework — so each tool carries `schema_fidelity: declared` plus `source_path` and `source_repository` pointers.
- **Channels, subagents, schedules, sandboxes, approval tiers, and hooks have no `.af` counterpart** and stay eve-only. Approval policy is tiered and risk-scaled, so it is carried as the per-tool `write` flag rather than flattened into `default_requires_approval`.
- **The model is declared, then checked.** `llm_config` is declared in the same file as the blocks, and the export cross-checks the declared handle against the model the compiled manifest actually runs, so a model change cannot leave the published declaration behind.
- **Skills export whole.** Each `agent/skills/*/SKILL.md` ships with its content and a source URL; the other eve surfaces have no counterpart.

`pnpm run export:agent-file` and `pnpm run export:data-agent-file` regenerate the two files; `pnpm run check:agent-file` and `pnpm run check:data-agent-file` fail when a committed file is out of date, which is the guard against hand edits. CI builds the manifest, then runs both checks. Export behavior is covered by `lib/agent-file.test.ts` (schema validity, byte stability, privacy, and integrity) and `lib/github-tool-catalog.test.ts` (surface completeness, description extraction, and the write/approval split).

## Memory boundary

Computer-specific curated memory and redacted run records use Vercel Blob for the first factory implementation. Reserved namespaces prevent generic file tools from reading or overwriting factory brain and run records. A follow-up issue tracks optional synchronization to the private `wazootech/computer-memory` repository; that integration is not part of this factory adoption.

Each run record may include:

- stage transitions and timestamps;
- approval decisions;
- concise station outputs;
- token usage when reported by a station;
- failure status and safe error summaries.

The writer recursively redacts credential-shaped keys and values. It never stores tokens, private keys, authorization headers, or raw customer data. Vercel Blob is reserved for user preferences and transient station handoff artifacts, not Computer memory.

## Security boundaries

- GitHub installation tokens are minted at runtime and never passed to a model or sandbox.
- Feature branches use the `factory/` prefix and cannot target `main`, `master`, `HEAD`, or `refs/*`.
- Unattended intake is denied actions that require a person; it can only narrate on its intake issue and open a draft PR.
- The GitHub App has broad repository selection by design, with read-only organization Members permission for team-backed approval resolution.
- The `preflight` tool reports only boolean, status, and count data for GitHub and DeepSeek checks.

## Configuration

`DEEPSEEK_MODEL` defaults to `deepseek-flash` (the canonical name for DeepSeek-V4.1-Flash; the retired `deepseek-v4-flash` alias remains settable via the env var). Thinking mode is pinned off on every request by default — DeepSeek-V4.1-Flash defaults to thinking ON, which would otherwise silently change agent behavior — and `DEEPSEEK_THINKING=enabled` opts back in. GitHub events provide the verified owner, repository name, and repository ID. A session without a GitHub event attaches `COMPUTER_SESSION_REPOSITORY`, defaulting to `wazootech/workspace`, and proves installation coverage before stamping it. Optional GitHub sign-in (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`) links a chat principal to its GitHub account, which supplies the login an approval from chat is attributed to. The sender must be an active member of `COMPUTER_APPROVER_ORG` and `COMPUTER_APPROVER_TEAM`; the default organization is `wazootech` and the default team is `team`.

The web surface uses Vercel authentication. The GitHub channel uses Eve’s native GitHub App credentials and webhook verification; no Vercel Connect GitHub connector is required. Linear is optional and is not required for the GitHub factory path.
