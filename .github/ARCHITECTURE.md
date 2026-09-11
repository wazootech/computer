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
- `agent/extensions/github.ts` mounts the official GitHub tools with an explicit allowlist and the WazooComputer GitHub App installation token.
- `agent/subagents/` contains isolated station prompts, sandboxes, and handoff tools.
- `agent/skills/` contains load-on-demand triage, writing, and tracker-bridging procedures.
- `evals/` contains routing, safety, smoke, and opt-in pipeline evaluations.
- `agent/lib/trust.ts` is the single authority for attended, unattended, and schedule caller classes.
- `agent/lib/github/approval.ts` keeps reversible writes separate from actions that can ship.

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

`DEEPSEEK_MODEL` defaults to `deepseek-v4-flash`. GitHub events provide the verified owner, repository name, and repository ID. The sender must be an active member of `COMPUTER_APPROVER_ORG` and `COMPUTER_APPROVER_TEAM`; the default organization is `wazootech` and the default team is `team`.

The web surface uses Vercel authentication. The GitHub channel uses Eve’s native GitHub App credentials and webhook verification; no Vercel Connect GitHub connector is required. Linear is optional and is not required for the GitHub factory path.
