# computer-discord

Computer's Discord channel, and Computer's whole runtime.

It holds one Gateway socket as the Computer application, admits ordinary
`@Computer` mentions against a default-deny policy, runs each admitted mention as
a turn on the Computer Zo persona, and posts the answer back into the channel or
thread it arrived in.

The persona owns the prompt and the model; this process owns only transport. That
is the point of the split: Computer's brain is a Zo persona, so no model
credential lives in this repository or on any deployment, and a revoked provider
key cannot take the surface down.

## Running it

```sh
COMPUTER_DISCORD_BOT_TOKEN=... \
COMPUTER_PERSONA_ID=... \
DISCORD_INTERNAL_GUILD_IDS=... \
DISCORD_INTERNAL_CHANNEL_IDS=... \
DISCORD_INTERNAL_ROLE_IDS=... \
node --experimental-strip-types channels/discord/index.ts
```

From the repository root that is `pnpm discord:channel`.

Environment:

| Name | Meaning |
| --- | --- |
| `COMPUTER_DISCORD_BOT_TOKEN` | Bot token for the Gateway connection and reply posts. Falls back to `DISCORD_BOT_TOKEN`. |
| `COMPUTER_PERSONA_ID` | The Computer Zo persona. Defaults to the deployed persona id. |
| `ZO_API_TOKEN` | Zo credential for `/zo/ask`. Falls back to `ZO_CLIENT_IDENTITY_TOKEN`. |
| `DISCORD_INTERNAL_GUILD_IDS` | Allowlisted guild(s), comma-separated. |
| `DISCORD_INTERNAL_CHANNEL_IDS` | Allowlisted channel(s), comma-separated. |
| `DISCORD_INTERNAL_USER_IDS` | Allowlisted user id(s), comma-separated. |
| `DISCORD_INTERNAL_ROLE_IDS` | Allowlisted role id(s), comma-separated. |
| `DISCORD_INTERNAL_GUILD_WIDE` | `1` or `true` admits an allowlisted user or role in any channel of an allowlisted guild. |
| `COMPUTER_ZO_API` | Override the Zo base URL. Defaults to `https://api.zo.computer`. |
| `COMPUTER_TURN_TIMEOUT_MS` | Per-turn deadline. Defaults to 600000. |

A managed service inherits neither the host shell nor any deployment's
environment, so `COMPUTER_DISCORD_BOT_TOKEN` and `ZO_CLIENT_IDENTITY_TOKEN` are
read from `/root/.zo_secrets` when they are unset (override the path with
`ZO_SECRETS_PATH`). An environment value always wins over the file.

## Admission

Default deny, fail closed. A message dispatches only when it arrives in an
allowlisted guild, in an allowlisted channel (or a thread whose parent channel is
allowlisted), from an allowlisted user or role, from a person rather than a bot or
webhook, and with an explicit `@Computer` mention that leaves a non-empty
request. Mention text is untrusted: it cannot change the allowlists, permissions,
or the persona, invisible characters are stripped before the model sees it, and an
over-long message is truncated rather than dispatched whole. Replies never ping
anyone and every bot-authored message is ignored, so a self-mention loop cannot
start.

The admission matrix lives in the tested modules next to this channel:
`lib/discord-mention-policy.ts` (mention parsing, thread-to-parent mapping,
self-loop prevention, hostile input), `lib/discord-policy.ts` (tier resolution),
and `lib/discord-bridge.ts` (intents, reconnect backoff, duplicate suppression,
per-user rate limit).

## Conversation state

One Zo conversation per Discord channel or thread, keyed by guild and channel id,
kept in `data/conversations.json` beside this file. That directory is runtime
state and is gitignored; deleting it starts every channel a fresh conversation.

## Operator setup

1. Create the Discord application and bot, and enable the privileged **Message
   Content** intent. Without it `content` never arrives, and a socket that asks
   for it anyway is closed with code 4014 (the log says so, and retries slowly
   rather than hot-looping).
2. Give the bot View Channels, Send Messages, Send Messages in Threads, Read
   Message History, and Embed Links. No administrator permission is needed.
3. Leave the application's **Interactions Endpoint URL unset**. Nothing here
   verifies an inbound interaction signature, so no `DISCORD_PUBLIC_KEY` is
   needed either.
4. Deploy it as an always-on Zo service (`mode: "process"`, no public port). See
   the repository README for the service definition and the CI deploy path.
