/**
 * Vendored structural contract for the Agent File (`.af`) projection.
 *
 * Provenance (verified 2026-09-21, not copied from the proposal that cited it):
 *
 *   - The path the repo's issue cites,
 *     `letta/serialize_schemas/pydantic_agent_schema.py`, returns 404 on
 *     `letta-ai/letta@main`; the platform source left that branch.
 *   - The authoritative models now live on the `archive` branch:
 *     `letta/schemas/agent_file.py` (`AgentFileSchema`, `AgentSchema`,
 *     `BlockSchema`, `ToolSchema`, `SkillSchema`) plus
 *     `letta/schemas/{agent,tool,llm_config,embedding_config}.py`.
 *   - The emitted shape was confirmed against published gallery files
 *     (`agents/@letta-ai/loop/loop.af`, `agents/@letta-ai/ezra/ezra.af`):
 *     top level `{agents, groups, blocks, files, sources, tools, mcp_servers,
 *     skills, metadata, created_at}`, with `system`, `llm_config`, `messages`,
 *     and `tool_rules` living inside `agents[]`, and `block_ids`/`tool_ids`
 *     joining an agent to those top-level siblings.
 *
 * What this is: a contract check for the fields Computer emits, so CI can fail
 * on a malformed or drifted file without a network call.
 *
 * What this is not: the server's validator. Letta validates on import, no
 * published JSON Schema exists in any Letta repository, and there is no offline
 * `.af` validator. Fields this repo does not emit are therefore checked
 * loosely, and the import itself is proven separately (see the PR that landed
 * this file) rather than asserted here.
 */

export const AGENT_FILE_FORMAT_VERSION = "1";

const TOP_LEVEL_KEYS = [
  "agents",
  "groups",
  "blocks",
  "files",
  "sources",
  "tools",
  "mcp_servers",
  "skills",
  "metadata",
  "created_at",
] as const;

export type AgentFileBlock = {
  id: string;
  label: string;
  value: string;
  description: string;
  limit: number;
  read_only: boolean;
  is_template: boolean;
  preserve_on_migration: boolean;
  template_name: string | null;
  metadata: Record<string, string>;
  [key: string]: unknown;
};

export type AgentFileTool = {
  id: string;
  name: string;
  description: string;
  tool_type: string;
  source_type: string | null;
  source_code: string | null;
  json_schema: {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required: string[] };
  };
  args_json_schema: null;
  tags: string[];
  return_char_limit: number;
  default_requires_approval: boolean | null;
  metadata_: Record<string, string>;
  [key: string]: unknown;
};

export type AgentFileSkill = {
  name: string;
  files: Record<string, string>;
  source_url: string;
  [key: string]: unknown;
};

export type AgentFileAgent = {
  id: string;
  name: string;
  description: string;
  system: string;
  agent_type: string;
  llm_config: Record<string, unknown>;
  memory_blocks: unknown[];
  block_ids: string[];
  tool_ids: string[];
  tools: unknown[];
  tool_rules: unknown[];
  tags: string[];
  messages: unknown[];
  in_context_message_ids: string[];
  files_agents: unknown[];
  group_ids: string[];
  secrets: Record<string, string>;
  tool_exec_environment_variables: Record<string, string>;
  message_buffer_autoclear: boolean;
  metadata: Record<string, string>;
  [key: string]: unknown;
};

export type AgentFile = {
  agents: AgentFileAgent[];
  groups: unknown[];
  blocks: AgentFileBlock[];
  files: unknown[];
  sources: unknown[];
  tools: AgentFileTool[];
  mcp_servers: unknown[];
  skills: AgentFileSkill[];
  metadata: Record<string, string>;
  created_at: string | null;
};

export type AgentFileValidation = { ok: boolean; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[], path: string, errors: string[]): boolean {
  let ok = true;
  for (const key of keys) {
    if (!(key in value)) {
      errors.push(`${path} is missing required key ${key}`);
      ok = false;
    }
  }
  return ok;
}

/**
 * Structural validation of a parsed `.af`. Errors are strings that name the
 * failing path, so CI output points at the field rather than at the file.
 */
export function validateAgentFile(value: unknown): AgentFileValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["agent file must be a JSON object"] };

  requireKeys(value, TOP_LEVEL_KEYS, "agent_file", errors);
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.includes(key as (typeof TOP_LEVEL_KEYS)[number])) {
      errors.push(`agent_file has unexpected top-level key ${key}`);
    }
  }
  for (const key of ["groups", "files", "sources", "mcp_servers"] as const) {
    if (key in value && !Array.isArray(value[key])) errors.push(`agent_file.${key} must be an array`);
  }
  if ("metadata" in value && !isStringRecord(value.metadata)) {
    errors.push("agent_file.metadata must be a string-to-string map");
  }
  if (value.created_at !== null && value.created_at !== undefined && typeof value.created_at !== "string") {
    errors.push("agent_file.created_at must be null or an ISO-8601 string");
  }

  const blocks = value.blocks;
  const tools = value.tools;
  const skills = value.skills;
  if (!Array.isArray(blocks)) errors.push("agent_file.blocks must be an array");
  if (!Array.isArray(tools)) errors.push("agent_file.tools must be an array");
  if (!Array.isArray(skills)) errors.push("agent_file.skills must be an array");

  const blockIds = new Set<string>();
  if (Array.isArray(blocks)) {
    blocks.forEach((block, index) => {
      const path = `agent_file.blocks[${index}]`;
      if (!isRecord(block)) return void errors.push(`${path} must be an object`);
      requireKeys(block, ["id", "label", "value", "description", "limit"], path, errors);
      if (typeof block.id === "string") {
        if (blockIds.has(block.id)) errors.push(`${path}.id ${block.id} is duplicated`);
        blockIds.add(block.id);
      } else errors.push(`${path}.id must be a string`);
      if (typeof block.value !== "string") errors.push(`${path}.value must be a string`);
      if (typeof block.limit !== "number") errors.push(`${path}.limit must be a number`);
    });
  }

  const toolIds = new Set<string>();
  if (Array.isArray(tools)) {
    tools.forEach((tool, index) => {
      const path = `agent_file.tools[${index}]`;
      if (!isRecord(tool)) return void errors.push(`${path} must be an object`);
      requireKeys(tool, ["id", "name", "description", "tool_type", "json_schema"], path, errors);
      if (typeof tool.id === "string") {
        if (toolIds.has(tool.id)) errors.push(`${path}.id ${tool.id} is duplicated`);
        toolIds.add(tool.id);
      } else errors.push(`${path}.id must be a string`);
      if (!isRecord(tool.json_schema)) {
        errors.push(`${path}.json_schema must be an object`);
      } else {
        requireKeys(tool.json_schema, ["name", "description", "parameters"], `${path}.json_schema`, errors);
        const parameters = tool.json_schema.parameters;
        if (!isRecord(parameters)) errors.push(`${path}.json_schema.parameters must be an object`);
        else if (parameters.type !== "object") errors.push(`${path}.json_schema.parameters.type must be "object"`);
      }
    });
  }

  if (Array.isArray(skills)) {
    skills.forEach((skill, index) => {
      const path = `agent_file.skills[${index}]`;
      if (!isRecord(skill)) return void errors.push(`${path} must be an object`);
      if (typeof skill.name !== "string" || skill.name.length === 0) errors.push(`${path}.name must be a string`);
      const files = skill.files;
      const hasFiles = isRecord(files) && typeof files["SKILL.md"] === "string";
      const hasSource = typeof skill.source_url === "string" && skill.source_url.length > 0;
      if (!hasFiles && !hasSource) {
        errors.push(`${path} needs either files with a SKILL.md entry or a source_url`);
      }
    });
  }

  const agents = value.agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    errors.push("agent_file.agents must be a non-empty array");
    return { ok: errors.length === 0, errors };
  }

  agents.forEach((agent, index) => {
    const path = `agent_file.agents[${index}]`;
    if (!isRecord(agent)) return void errors.push(`${path} must be an object`);
    requireKeys(
      agent,
      [
        "id",
        "name",
        "system",
        "agent_type",
        "llm_config",
        "embedding_config",
        "block_ids",
        "tool_ids",
        "messages",
        "in_context_message_ids",
        "secrets",
        "tool_exec_environment_variables",
      ],
      path,
      errors,
    );
    if (typeof agent.system !== "string" || agent.system.length === 0) {
      errors.push(`${path}.system must be a non-empty string`);
    }
    if (agent.agent_type !== "letta_v1_agent") errors.push(`${path}.agent_type must be "letta_v1_agent"`);

    for (const [field, value_] of [
      ["block_ids", agent.block_ids],
      ["tool_ids", agent.tool_ids],
      ["in_context_message_ids", agent.in_context_message_ids],
    ] as const) {
      if (!isStringArray(value_)) errors.push(`${path}.${field} must be an array of strings`);
    }
    for (const field of ["messages", "tools", "tool_rules", "memory_blocks"] as const) {
      if (!Array.isArray(agent[field])) errors.push(`${path}.${field} must be an array`);
    }
    for (const field of ["secrets", "tool_exec_environment_variables"] as const) {
      if (!isStringRecord(agent[field])) errors.push(`${path}.${field} must be a string-to-string map`);
    }
    if (Array.isArray(agent.block_ids)) {
      for (const id of agent.block_ids) {
        if (typeof id === "string" && !blockIds.has(id)) errors.push(`${path}.block_ids references missing ${id}`);
      }
    }
    if (Array.isArray(agent.tool_ids)) {
      for (const id of agent.tool_ids) {
        if (typeof id === "string" && !toolIds.has(id)) errors.push(`${path}.tool_ids references missing ${id}`);
      }
    }

    const llm = agent.llm_config;
    if (!isRecord(llm)) errors.push(`${path}.llm_config must be an object`);
    else requireKeys(llm, ["model", "model_endpoint_type", "context_window"], `${path}.llm_config`, errors);
    const embedding = agent.embedding_config;
    if (!isRecord(embedding)) errors.push(`${path}.embedding_config must be an object`);
    else {
      requireKeys(
        embedding,
        ["embedding_endpoint_type", "embedding_model", "embedding_dim"],
        `${path}.embedding_config`,
        errors,
      );
    }
  });

  return { ok: errors.length === 0, errors };
}
