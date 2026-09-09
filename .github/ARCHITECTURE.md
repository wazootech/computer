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

Computer-specific durable memory is stored in the private `wazootech/computer-memory` repository. The `read_factory_brain` and `update_factory_brain` tools use Markdown wiki entities there. The `start_run` and `record_run_event` tools write redacted execution evidence to a run-specific branch and draft PR.

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

`FACTORY_REPO` selects the target repository and defaults to `wazootech/computer`. `COMPUTER_MEMORY_REPO` selects the memory repository and defaults to `wazootech/computer-memory`. `DEEPSEEK_MODEL` defaults to `deepseek-v4-flash`.

The web surface uses Vercel authentication. GitHub channels require their Eve webhook connector when enabled. Linear is optional and is not required for the GitHub factory path.
