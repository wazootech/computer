import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_SECRET_NAMES,
  loadHostSecrets,
  parseHostSecrets,
} from "./host-secrets.ts";

const SECRETS = [
  "# Zo secrets",
  "DISCORD_BOT_TOKEN=bot-token",
  'export ZO_CLIENT_IDENTITY_TOKEN="zo-token"',
  "export DISCORD_INTERNAL_GUILD_IDS='1525763491712737310'",
  "",
  "DISCORD_INTERNAL_CHANNEL_IDS=1525763492431331362,",
  "NOT_A_BRIDGE_NAME=ignored",
  "MALFORMED",
].join("\n");

test("parses key=value lines, skipping comments and malformed entries", () => {
  const values = parseHostSecrets(SECRETS);
  assert.equal(values.get("DISCORD_BOT_TOKEN"), "bot-token");
  assert.equal(values.get("MALFORMED"), undefined);
  assert.equal(values.get("NOT_A_BRIDGE_NAME"), "ignored");
});

test("strips quotes and an export prefix", () => {
  const values = parseHostSecrets(SECRETS);
  assert.equal(values.get("ZO_CLIENT_IDENTITY_TOKEN"), "zo-token");
  assert.equal(values.get("DISCORD_INTERNAL_GUILD_IDS"), "1525763491712737310");
});

test("fills an unset variable from the host file", () => {
  const env: Record<string, string | undefined> = { COMPUTER_BASE_URL: "https://example.test" };
  const source = loadHostSecrets(env, ["/secrets"], () => true, () => SECRETS);
  assert.equal(env.DISCORD_BOT_TOKEN, "bot-token");
  assert.equal(source.skipped, false);
  assert.equal(source.path, "/secrets");
  assert.deepEqual(source.loaded, [
    "DISCORD_BOT_TOKEN",
    "ZO_CLIENT_IDENTITY_TOKEN",
    "DISCORD_INTERNAL_GUILD_IDS",
    "DISCORD_INTERNAL_CHANNEL_IDS",
  ]);
});

test("never overwrites a variable the service already set", () => {
  const env: Record<string, string | undefined> = { DISCORD_BOT_TOKEN: "from-service" };
  const source = loadHostSecrets(env, ["/secrets"], () => true, () => SECRETS);
  assert.equal(env.DISCORD_BOT_TOKEN, "from-service");
  assert.ok(!source.loaded.includes("DISCORD_BOT_TOKEN"));
  assert.ok(source.loaded.includes("ZO_CLIENT_IDENTITY_TOKEN"));
});

test("treats an empty variable as unset", () => {
  const env: Record<string, string | undefined> = { DISCORD_BOT_TOKEN: "" };
  loadHostSecrets(env, ["/secrets"], () => true, () => SECRETS);
  assert.equal(env.DISCORD_BOT_TOKEN, "bot-token");
});

test("skips quietly when no secrets file exists", () => {
  const env: Record<string, string | undefined> = {};
  const source = loadHostSecrets(env, ["/secrets"], () => false, () => SECRETS);
  assert.equal(source.skipped, true);
  assert.deepEqual(source.loaded, []);
  assert.equal(env.DISCORD_BOT_TOKEN, undefined);
});

test("honors ZO_SECRETS_PATH ahead of the default location", () => {
  const env: Record<string, string | undefined> = { ZO_SECRETS_PATH: "/custom" };
  const source = loadHostSecrets(
    env,
    ["/root/.zo_secrets"],
    (candidate) => candidate === "/custom",
    () => "DISCORD_BOT_TOKEN=custom-token",
  );
  assert.equal(source.path, "/custom");
  assert.equal(env.DISCORD_BOT_TOKEN, "custom-token");
});

test("leaves unrelated names alone", () => {
  const env: Record<string, string | undefined> = {};
  loadHostSecrets(env, ["/secrets"], () => true, () => SECRETS);
  assert.equal(env.NOT_A_BRIDGE_NAME, undefined);
  assert.ok(CHANNEL_SECRET_NAMES.includes("DISCORD_BOT_TOKEN"));
  assert.ok(CHANNEL_SECRET_NAMES.includes("ZO_CLIENT_IDENTITY_TOKEN"));
});
