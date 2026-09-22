/**
 * Projection from Computer's authored source to a Letta Agent File (`.af`).
 *
 * The direction is one-way and stays that way: eve is authoritative for
 * behavior, and the `.af` is a generated, diffable, importable declaration of
 * the agent layer. Nothing generated here is ever read back into `agent/`.
 *
 * Fidelity is deliberately partial, and the gaps are named rather than filled
 * in with guesses:
 *
 *   - `system` is the compiled prompt, byte for byte.
 *   - `llm_config` is declared in `agent/agent-file-declaration.json`; the model
 *     handle is cross-checked against `lib/gateway.ts` by the test suite.
 *   - `blocks[]` are curated and allowlisted. Private surfaces export as
 *     schema-only, with the reason recorded in the declaration.
 *   - `tools[]` declare the bound surface (name, description, source path).
 *     Parameter schemas are NOT projected: the compiled manifest carries no
 *     schemas, and reading them would mean importing eve tool modules. Every
 *     exported tool says so in `metadata_.schema_fidelity`.
 *   - `skills[]` carry their real `SKILL.md` content plus a source URL.
 *   - `embedding_config` is Letta's own default, not ours: Computer has no
 *     Letta-side embedding model (its retrieval is eve/MemFS plus Postgres
 *     full-text search), and `LLMConfig`/`EmbeddingConfig` are required fields,
 *     so the file carries the default rather than inventing a mapping.
 *   - `messages`, `secrets`, and tool environment variables are always empty.
 *   - Channels, subagents, schedules, sandboxes, approval tiers, and hooks have
 *     no `.af` counterpart and stay eve-only.
 */

import type {
  AgentFile,
  AgentFileAgent,
  AgentFileBlock,
  AgentFileSkill,
  AgentFileTool,
} from "./agent-file-schema.ts";
import { AGENT_FILE_FORMAT_VERSION } from "./agent-file-schema.ts";

export type MemoryBlockDeclaration = {
  label: string;
  description: string;
  limit: number;
  readOnly: boolean;
  shareable: boolean;
  /** Required for private blocks: why this surface never publishes. */
  privateBecause: string | null;
  /** Required for shareable blocks: the exact exported value. */
  value: string | null;
};

export type ModelDeclaration = {
  provider: string;
  model: string;
  handle: string;
  endpoint: string;
  endpointType: string;
  contextWindow: number;
  maxTokens: number | null;
  /** Optional note when the provider API id and the framework handle differ. */
  modelNote: string | null;
  reasoning: boolean;
  temperature: number;
  contextWindowSource: string;
};

export type AgentFileDeclaration = {
  agentName: string;
  agentDescription: string;
  model: ModelDeclaration;
  blocks: MemoryBlockDeclaration[];
};

export type AgentFileToolInput = {
  name: string;
  description: string;
  sourcePath: string | null;
  /**
   * `true` for tools the GitHub SDK classifies as writes, `false` for reads,
   * `null` when the tool is not part of the GitHub surface and the distinction
   * does not apply. Carried in `metadata_` rather than in
   * `default_requires_approval`: this repository's approval policy is tiered and
   * risk-scaled, and flattening it into a per-tool boolean would misstate it.
   */
  write?: boolean | null;
};
export type AgentFileSkillInput = { name: string; sourcePath: string; content: string };

export type AgentFileSource = {
  declaration: AgentFileDeclaration;
  instructions: string;
  tools: AgentFileToolInput[];
  skills: AgentFileSkillInput[];
  repositoryUrl: string;
  projectPath: string;
  projectionMode: "eve-manifest" | "source";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path}.${key} must be a non-empty string`);
  return value;
}

function readNumber(raw: Record<string, unknown>, key: string, path: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path}.${key} must be a positive number`);
  }
  return value;
}

function readOptionalNumber(raw: Record<string, unknown>, key: string, path: string): number | null {
  const value = raw[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path}.${key} must be a positive number when present`);
  }
  return value;
}

/** Parse and validate the declaration file. Throws with the offending path. */
export function parseAgentFileDeclaration(raw: unknown): AgentFileDeclaration {
  if (!isRecord(raw)) throw new Error("declaration must be a JSON object");

  const model = raw.model;
  if (!isRecord(model)) throw new Error("declaration.model must be an object");
  const blocksRaw = raw.blocks;
  if (!Array.isArray(blocksRaw)) throw new Error("declaration.blocks must be an array");

  const blocks = blocksRaw.map((entry, index) => {
    const path = `declaration.blocks[${index}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    const shareable = entry.shareable;
    if (typeof shareable !== "boolean") throw new Error(`${path}.shareable must be a boolean`);
    const limit = entry.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw new Error(`${path}.limit must be a positive integer`);
    }
    const value = entry.value;
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new Error(`${path}.value must be a string when present`);
    }
    const privateBecause = entry.privateBecause;
    if (privateBecause !== undefined && privateBecause !== null && typeof privateBecause !== "string") {
      throw new Error(`${path}.privateBecause must be a string when present`);
    }
    if (shareable && (typeof value !== "string" || value.length === 0)) {
      throw new Error(`${path} is declared shareable, so it needs a value`);
    }
    if (!shareable && (typeof privateBecause !== "string" || privateBecause.length === 0)) {
      throw new Error(`${path} is private, so it needs a privateBecause reason`);
    }
    const readOnly = entry.readOnly;
    if (readOnly !== undefined && typeof readOnly !== "boolean") throw new Error(`${path}.readOnly must be a boolean`);
    return {
      label: readString(entry, "label", path),
      description: readString(entry, "description", path),
      limit,
      readOnly: readOnly === true,
      shareable,
      privateBecause: typeof privateBecause === "string" ? privateBecause : null,
      value: typeof value === "string" ? value : null,
    } satisfies MemoryBlockDeclaration;
  });

  const labels = new Set<string>();
  for (const block of blocks) {
    if (labels.has(block.label)) throw new Error(`declaration.blocks has two entries labeled ${block.label}`);
    labels.add(block.label);
  }

  return {
    agentName: readString(raw, "agentName", "declaration"),
    agentDescription: readString(raw, "agentDescription", "declaration"),
    model: {
      provider: readString(model, "provider", "declaration.model"),
      model: readString(model, "model", "declaration.model"),
      handle: readString(model, "handle", "declaration.model"),
      endpoint: readString(model, "endpoint", "declaration.model"),
      endpointType: readString(model, "endpointType", "declaration.model"),
      contextWindow: readNumber(model, "contextWindow", "declaration.model"),
      maxTokens: readOptionalNumber(model, "maxTokens", "declaration.model"),
      modelNote: typeof model.modelNote === "string" && model.modelNote.length > 0 ? model.modelNote : null,
      reasoning: model.reasoning === true,
      temperature: typeof model.temperature === "number" ? model.temperature : 1,
      contextWindowSource: readString(model, "contextWindowSource", "declaration.model"),
    },
    blocks,
  };
}

function projectBlock(block: MemoryBlockDeclaration): AgentFileBlock {
  return {
    id: `block-${block.label}`,
    label: block.label,
    value: block.shareable && block.value !== null ? block.value : "",
    description: block.description,
    limit: block.limit,
    read_only: block.readOnly,
    is_template: false,
    preserve_on_migration: false,
    template_name: null,
    metadata: {},
  };
}

function projectTool(tool: AgentFileToolInput, index: number, repositoryUrl: string): AgentFileTool {
  return {
    id: `tool-${index}`,
    name: tool.name,
    description: tool.description,
    tool_type: "custom",
    source_type: null,
    source_code: null,
    json_schema: {
      name: tool.name,
      description: tool.description,
      // Declared, not projected: see the module note. An importer that needs the
      // real interface should read the source path in `metadata_`.
      parameters: { type: "object", properties: {}, required: [] },
    },
    args_json_schema: null,
    tags: [],
    // Letta's FUNCTION_RETURN_CHAR_LIMIT default. eve's per-tool limits have no
    // counterpart here, so the projection does not claim to carry ours.
    return_char_limit: 50000,
    default_requires_approval: null,
    metadata_: {
      runnable: "false",
      schema_fidelity: "declared",
      source_path: tool.sourcePath ?? "",
      source_repository: repositoryUrl,
      write: tool.write === undefined || tool.write === null ? "" : String(tool.write),
    },
  };
}

function projectAgent(source: AgentFileSource, blockIds: string[], toolIds: string[]): AgentFileAgent {
  const { model } = source.declaration;
  return {
    id: "agent-0",
    name: source.declaration.agentName,
    description: source.declaration.agentDescription,
    system: source.instructions,
    agent_type: "letta_v1_agent",
    llm_config: {
      model: model.model,
      display_name: null,
      model_endpoint_type: model.endpointType,
      model_endpoint: model.endpoint,
      provider_name: model.provider,
      provider_category: "base",
      context_window: model.contextWindow,
      put_inner_thoughts_in_kwargs: false,
      handle: model.handle,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      enable_reasoner: model.reasoning,
      reasoning_effort: null,
      max_reasoning_tokens: model.reasoning ? 1024 : 0,
      parallel_tool_calls: true,
    },
    // Required by the format; carried as Letta's default (see the module note).
    embedding_config: {
      embedding_endpoint_type: "openai",
      embedding_endpoint: "https://api.openai.com/v1",
      embedding_model: "text-embedding-3-small",
      embedding_dim: 1536,
      embedding_chunk_size: 300,
      handle: "openai/text-embedding-3-small",
      batch_size: 32,
    },
    memory_blocks: [],
    block_ids: blockIds,
    tool_ids: toolIds,
    tools: [],
    tool_rules: [],
    tags: [],
    messages: [],
    in_context_message_ids: [],
    files_agents: [],
    group_ids: [],
    secrets: {},
    tool_exec_environment_variables: {},
    message_buffer_autoclear: false,
    metadata: { projection: "wazootech/computer scripts/export-agent-file.ts" },
  };
}

/**
 * Build the `.af` value. Pure and deterministic: same source in, same bytes
 * out, so the committed file can be regenerated and diffed in CI.
 */
export function projectAgentFile(source: AgentFileSource): AgentFile {
  const blocks = source.declaration.blocks.map(projectBlock);
  const tools = [...source.tools]
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"))
    .map((tool, index) => {
      return projectTool(tool, index, source.repositoryUrl);
    });
  const skills: AgentFileSkill[] = [...source.skills]
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"))
    .map((skill) => ({
      name: skill.name,
      files: { "SKILL.md": skill.content },
      source_url: `${source.repositoryUrl}/blob/main/${skill.sourcePath}`,
    }));

  return {
    agents: [
      projectAgent(
        source,
        blocks.map((block) => block.id),
        tools.map((tool) => tool.id),
      ),
    ],
    groups: [],
    blocks,
    files: [],
    sources: [],
    tools,
    mcp_servers: [],
    skills,
    metadata: {
      generator: "wazootech/computer scripts/export-agent-file.ts",
      source_repository: source.repositoryUrl,
      project_path: source.projectPath,
      projection_mode: source.projectionMode,
      agent_file_format_version: AGENT_FILE_FORMAT_VERSION,
      embedding_config: "letta-default",
      ...(source.declaration.model.modelNote === null ? {} : { model_note: source.declaration.model.modelNote }),
    },
    created_at: null,
  };
}

/**
 * Canonical serialization: two-space indent, fixed key order from the object
 * literals above, trailing newline. `JSON.stringify` preserves insertion order,
 * so the ordering guarantees come from how the objects are built.
 */
export function serializeAgentFile(file: AgentFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
