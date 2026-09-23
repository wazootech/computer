1: # eve Agent App
2: 
3: This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.
4: 
5: For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.
6: 
7: ## Read the docs before writing code
8: 
9: ```sh
10: ls node_modules/eve/docs
11: ```
12: 
13: Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.
14: 
15: Use a bounded authoring loop:
16: 
17: 1. Read the relevant page and inspect only files you will modify or need to imitate.
18: 2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
19: 3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.
20: 
21: Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.
22: 
23: ## Prefer an existing integration
24: 
25: When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.
26: 
27: ```sh
28: eve registry search <query> --json
29: eve registry view <item>
30: ```
31: 
32: Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.
33: 
34: Install without driving interactive prompts:
35: 
36: ```sh
37: eve add <item> --non-interactive
38: ```
39: 
40: Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.
41: 
42: ## Use eve for Vercel operations
43: 
44: Use eve to link and deploy Vercel projects:
45: 
46: ```sh
47: eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
48: eve deploy --non-interactive --yes [--project <name-or-id>]
49: ```
50: 
51: A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.
52: 
53: ## Validate the change
54: 
55: Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.