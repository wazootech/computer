import { createHash } from "node:crypto";

export const MAX_FACTORY_BRAIN_LENGTH = 40_000;

export function factoryBrainKey(): string {
  const id = createHash("sha256").update("wazootech/computer").digest("hex").slice(0, 16);
  return `wiki/Computer_Factory_Brain_${id}.md`;
}
