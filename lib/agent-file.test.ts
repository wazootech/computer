import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { checkAgentFilePrivacy, checkProjectionIntegrity } from "./agent-file-privacy.ts";
import {
  parseAgentFileDeclaration,
  projectAgentFile,
  serializeAgentFile,
  type AgentFileSource,
} from "./agent-file-project.ts";
import { validateAgentFile } from "./agent-file-schema.ts";
import { DEFAULT_GATEWAY_MODEL, GATEWAY_BASE_URL } from "./gateway.ts";

/**
 * The projection is a public artifact generated from private source, so these
 * tests are written as guards rather than as a happy path: each one fails if a
 * future change lets something out of the file that should not be there, or
 * lets the file drift from the source it claims to describe.
 */

const DECLARATION_PATH = "agent/agent-file-declaration.json";
const AGENT_FILE_PATH = "agents/@wazootech/computer/computer.af";
const DATA_DECLARATION_PATH = "agents/data/agent/agent-file-declaration.json";
const DATA_AGENT_FILE_PATH = "agents/@wazootech/data/data.af";

function fixtureDeclaration() {
  return parseAgentFileDeclaration({
    agentName: "fixture",
    agentDescription: "A fixture agent.",
    model: {
      provider: "deepseek",
      model: "deepseek-flash",
      handle: "deepseek/deepseek-v4.1-flash",
      endpoint: "https://api.deepseek.com",
      endpointType: "deepseek",
      contextWindow: 1048576,
      maxTokens: null,
      reasoning: false,
      temperature: 1,
      contextWindowSource: "fixture",
    },
    blocks: [
      {
        label: "persona",
        description: "Public persona.",
        limit: 100,
        readOnly: true,
        shareable: true,
        value: "The fixture agent answers questions.",
      },
      {
        label: "run_history",
        description: "Private run records.",
        limit: 100,
        readOnly: false,
        shareable: false,
        privateBecause: "Operational data about private repositories.",
      },
    ],
  });
}

function fixtureSource(overrides: Partial<AgentFileSource> = {}): AgentFileSource {
  return {
    declaration: fixtureDeclaration(),
    instructions: "You are the fixture agent.",
    tools: [],
    skills: [],
    repositoryUrl: "https://github.com/wazootech/fixture",
    projectPath: "agent",
    projectionMode: "source",
    ...overrides,
  };
}

test("projects a declaration into a schema-valid agent file", () => {
  const file = projectAgentFile(fixtureSource());
  const validation = validateAgentFile(file);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);
});

test("serialization is byte-stable across regenerations", () => {
  const first = serializeAgentFile(projectAgentFile(fixtureSource()));
  const second = serializeAgentFile(projectAgentFile(fixtureSource()));
  assert.equal(first, second);
  assert.ok(first.endsWith("\n"), "the file ends with exactly one newline");
  assert.equal(first.trimEnd().endsWith("\n"), false);
});

test("carries shareable block values verbatim and private ones as schema only", () => {
  const source = fixtureSource();
  const file = projectAgentFile(source);
  const persona = file.blocks.find((block) => block.label === "persona");
  const runHistory = file.blocks.find((block) => block.label === "run_history");

  assert.equal(persona?.value, "The fixture agent answers questions.");
  assert.equal(persona?.read_only, true);
  assert.equal(runHistory?.value, "");
  assert.equal(runHistory?.read_only, false);
  assert.equal(runHistory?.description, "Private run records.");

  const serialized = serializeAgentFile(file);
  assert.equal(serialized.includes("Operational data about private repositories."), false);
});

test("exports no messages, no in-context ids, and no credentials", () => {
  const file = projectAgentFile(fixtureSource());
  for (const agent of file.agents) {
    assert.deepEqual(agent.messages, []);
    assert.deepEqual(agent.in_context_message_ids, []);
    assert.deepEqual(agent.secrets, {});
    assert.deepEqual(agent.tool_exec_environment_variables, {});
  }
});

test("keeps the exported prompt byte-identical to the source prompt", () => {
  const instructions = "Line one.\n\nLine two.\n";
  const file = projectAgentFile(fixtureSource({ instructions }));
  assert.equal(file.agents[0]?.system, instructions);
  assert.deepEqual(checkProjectionIntegrity(file, instructions), []);
});

test("a reworded prompt is caught as drift, not accepted silently", () => {
  const file = projectAgentFile(fixtureSource({ instructions: "Original prompt." }));
  const findings = checkProjectionIntegrity(file, "Different prompt.");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "system-prompt-drift");
});

test("a non-null created_at is caught, because it would break byte stability", () => {
  const file = projectAgentFile(fixtureSource());
  const findings = checkProjectionIntegrity({ ...file, created_at: "2026-09-21T00:00:00Z" }, file.agents[0]?.system ?? "");
  assert.deepEqual(findings.map((finding) => finding.rule), ["unstable-timestamp"]);
});

test("the committed declaration and file pass every privacy and integrity check", async () => {
  const declaration = parseAgentFileDeclaration(JSON.parse(await readFile(DECLARATION_PATH, "utf8")));
  const file = validateCommitted(JSON.parse(await readFile(AGENT_FILE_PATH, "utf8")));

  assert.deepEqual(checkAgentFilePrivacy(file, declaration), []);
  assert.deepEqual(checkProjectionIntegrity(file, file.agents[0]?.system ?? ""), []);

  for (const block of declaration.blocks) {
    const exported = file.blocks.find((entry) => entry.label === block.label);
    assert.ok(exported, `block ${block.label} is declared but missing from the export`);
    assert.equal(
      exported.value.length > 0,
      block.shareable,
      `block ${block.label} exports a value if and only if it is declared shareable`,
    );
  }
});

test("Data's committed declaration and file pass the same checks, in source mode", async () => {
  const declaration = parseAgentFileDeclaration(JSON.parse(await readFile(DATA_DECLARATION_PATH, "utf8")));
  const file = validateCommitted(JSON.parse(await readFile(DATA_AGENT_FILE_PATH, "utf8")));

  assert.deepEqual(checkAgentFilePrivacy(file, declaration), []);
  assert.deepEqual(checkProjectionIntegrity(file, file.agents[0]?.system ?? ""), []);

  // Data has no eve build yet, so the projection mode records that fact rather
  // than presenting a source-only projection as a compiled one.
  assert.equal(file.metadata.projection_mode, "source");
  assert.equal(file.metadata.project_path, "agents/data/agent");

  for (const block of declaration.blocks) {
    const exported = file.blocks.find((entry) => entry.label === block.label);
    assert.ok(exported, `block ${block.label} is declared but missing from the export`);
    assert.equal(
      exported.value.length > 0,
      block.shareable,
      `block ${block.label} exports a value if and only if it is declared shareable`,
    );
  }

  // Read-only by construction: none of the declared tools is a write.
  assert.ok(file.tools.length > 0, "Data declares a tool surface");
  for (const tool of file.tools) {
    assert.equal(tool.metadata_.write, "false", `${tool.name} would let Data write`);
  }
});

test("rejects a file that is not an agent file", () => {
  const validation = validateAgentFile({});
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length > 0);
});

test("fails closed on a block whose shareability was never decided", () => {
  const declaration = fixtureDeclaration();
  const file = projectAgentFile(fixtureSource({ declaration }));
  const smuggled = {
    ...file,
    blocks: [...file.blocks, { ...file.blocks[0]!, id: "block-undeclared", label: "undeclared", value: "leak" }],
  };
  const findings = checkAgentFilePrivacy(smuggled, declaration);
  assert.deepEqual(findings.map((finding) => finding.rule), ["block-not-declared"]);
});

test("flags a private block that somehow carries a value", () => {
  const declaration = fixtureDeclaration();
  const file = projectAgentFile(fixtureSource({ declaration }));
  const leaked = {
    ...file,
    blocks: file.blocks.map((block) => (block.label === "run_history" ? { ...block, value: "a private run" } : block)),
  };
  const findings = checkAgentFilePrivacy(leaked, declaration);
  assert.deepEqual(findings.map((finding) => finding.rule), ["private-block-value-exported"]);
});

test("flags credentials and secret-shaped strings anywhere in the file", () => {
  const declaration = fixtureDeclaration();
  const file = projectAgentFile(fixtureSource({ declaration }));
  const credentialed = {
    ...file,
    agents: [{ ...file.agents[0]!, secrets: { OPENAI_API_KEY: "sk-abcdefghijklmnopqrstuvwxyz" } }],
  };
  const findings = checkAgentFilePrivacy(credentialed, declaration);
  assert.ok(findings.some((finding) => finding.rule === "credentials-present"));
  assert.ok(findings.some((finding) => finding.rule === "openai-style-key"));
});

test("flags message history, which must never be exported", () => {
  const declaration = fixtureDeclaration();
  const file = projectAgentFile(fixtureSource({ declaration }));
  const transcript = {
    ...file,
    agents: [{ ...file.agents[0]!, messages: [{ id: "message-0", role: "user", content: "hello" }] }],
  };
  const findings = checkAgentFilePrivacy(transcript as typeof file, declaration);
  assert.ok(findings.some((finding) => finding.rule === "messages-not-empty"));
});

test("a declaration that leaves a shareable block empty is rejected at parse time", () => {
  assert.throws(
    () =>
      parseAgentFileDeclaration({
        agentName: "fixture",
        agentDescription: "A fixture agent.",
        model: {
          provider: "deepseek",
          model: "deepseek-flash",
          handle: "deepseek/deepseek-v4.1-flash",
          endpoint: "https://api.deepseek.com",
          endpointType: "deepseek",
          contextWindow: 1000,
          contextWindowSource: "fixture",
        },
        blocks: [{ label: "persona", description: "Persona.", limit: 10, readOnly: true, shareable: true }],
      }),
    /declared shareable, so it needs a value/u,
  );
});

test("a private block without a recorded reason is rejected at parse time", () => {
  assert.throws(
    () =>
      parseAgentFileDeclaration({
        agentName: "fixture",
        agentDescription: "A fixture agent.",
        model: {
          provider: "deepseek",
          model: "deepseek-flash",
          handle: "deepseek/deepseek-v4.1-flash",
          endpoint: "https://api.deepseek.com",
          endpointType: "deepseek",
          contextWindow: 1000,
          contextWindowSource: "fixture",
        },
        blocks: [{ label: "secrets", description: "Private.", limit: 10, readOnly: false, shareable: false }],
      }),
    /private, so it needs a privateBecause reason/u,
  );
});

test("projects an agent that has no eve build, from its source directory alone", () => {
  const file = projectAgentFile(
    fixtureSource({
      tools: [
        { name: "read_issue", description: "Read an issue.", sourcePath: "agent/tools/read_issue.ts" },
        { name: "search_docs", description: "Search the docs.", sourcePath: null },
      ],
    }),
  );

  assert.equal(file.metadata.projection_mode, "source");
  assert.deepEqual(file.agents[0]?.tool_ids, ["tool-0", "tool-1"]);
  // Sorted by name, so the ids stay stable no matter who authored the list.
  assert.deepEqual(file.tools.map((tool) => tool.name), ["read_issue", "search_docs"]);
  assert.equal(file.tools[0]?.metadata_.source_path, "agent/tools/read_issue.ts");
  assert.equal(file.tools[0]?.metadata_.source_repository, "https://github.com/wazootech/fixture");
  assert.equal(file.tools[0]?.metadata_.runnable, "false");
  assert.equal(file.tools[1]?.metadata_.source_path, "");
  assert.equal(validateAgentFile(file).ok, true);
});

test("declares the model the runtime actually runs", () => {
  const declaration = parseAgentFileDeclaration(
    JSON.parse(readFileSync(DECLARATION_PATH, "utf8")),
  );
  assert.equal(
    declaration.model.handle,
    DEFAULT_GATEWAY_MODEL,
    "the published handle must be the gateway model the runtime resolves, or the file describes a model nobody runs",
  );
  assert.equal(
    declaration.model.endpoint,
    GATEWAY_BASE_URL,
    "the declared endpoint must be the one the agent authenticates against",
  );
});

function validateCommitted(value: unknown) {
  const validation = validateAgentFile(value);
  assert.deepEqual(validation.errors, [], "the committed .af validates against the vendored schema");
  return value as ReturnType<typeof projectAgentFile>;
}
