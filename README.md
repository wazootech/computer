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

Each station has its own instructions, sandbox, tools, and structured output. The reviewer is independent, revision loops are capped, and Computer never merges or marks a pull request ready without a person. GitHub intake supports authorized mentions, the `factory` label, and CI-failure follow-up. Linear remains an optional channel.

## Memory and run records

Computer-specific curated memory, handoff artifacts, preferences, and redacted run records live in Vercel Blob, using reserved namespaces owned by dedicated tools. Run records contain stage events, approvals, outputs, token usage, and failures. They must never contain credentials, access tokens, private keys, or raw customer data.

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

Discord is not connected yet. The planned Discord bot will use the same Computer identity and pipeline with channel- and role-aware authorization.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:eve
```

The factory evals are under `evals/`. Full-pipeline evals can create branches and consume model tokens, so run them only against a disposable target repository.
