# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.

## Where Computer's brain lives

Computer's brain is a Zo persona (`5f58a6ba-da81-4b8e-9105-4c85685a6a93`), not this
Vercel app. `channels/discord/index.ts` is a thin channel that holds the Discord
Gateway connection and calls `/zo/ask` with that persona; the persona owns the
prompt and the model, so neither is named in code here.

The prompt of record is `agent/instructions.ts`. When the persona changes, update
that file to match it. `agent/**` still holds the eve agent that the Vercel app
builds, which is the factory path and the web surface, not Computer's Discord
brain.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.

## Where Computer actually runs

The eve app under `agent/` is compiled into the Vercel deployment, but Computer's Discord brain is not part of it. `channels/discord/index.ts` runs on the Zo host as the `computer-discord` service, admits `@Computer` mentions against the allowlists in `lib/discord-*`, and asks the Zo persona `COMPUTER_PERSONA_ID` over `/zo/ask`. The persona owns the prompt and the model, so no model or provider credential belongs in this repository.

`agent/instructions.ts` is the record of the persona's prompt text. When the persona's prompt changes in Zo, update that file to match; the persona is the runtime, the file is the record.

## Where Computer's brain lives

Computer's brain is a Zo persona, not this repository. `channels/discord/index.ts`
is the channel that reaches it: one Gateway socket, admission from the pure
modules in `lib/`, one `/zo/ask` call per admitted mention, and the reply posted
back into the channel. The persona owns the prompt and the model, so changing how
Computer thinks is a persona edit in Zo; this repository owns the transport.

The Vercel app under `app/`, `agent/`, and `lib/` is the web and GitHub surface. A
push to `main` ships it, so a change there is live once the build lands. The
Discord channel does not deploy that way: `.github/workflows/deploy.yml` restarts
the host service over Zo's MCP endpoint, and `scripts/zo-deploy.ts` is the client
it runs. The channel's source still needs `pnpm run typecheck` and `pnpm test` to
pass, the same as the app.
