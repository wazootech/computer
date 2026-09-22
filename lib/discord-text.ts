/**
 * Discord text normalization shared by the mention admission policy and the
 * reply chunker.
 *
 * Discord content is untrusted input in both directions. Inbound, an admitted
 * mention becomes the first user message of a session, so it must not carry
 * characters that render as invisible or reorder glyphs. Outbound, the same
 * characters can hide part of a reply from a reader.
 *
 * Kept in its own module so the pure policy can import it without pulling in
 * `node:crypto` or any other runtime dependency.
 */

const CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008], // C0 controls
  [0x000b, 0x000c], // vertical tab, form feed
  [0x000e, 0x001f], // remaining C0 controls
  [0x007f, 0x009f], // DEL and C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x200b, 0x200f], // zero-width space/joiners and direction marks
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner and invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // zero-width no-break space
];

const CODE_POINT_PATTERN = new RegExp(
  `[${CODE_POINT_RANGES.map(([start, end]) => `\\u{${start.toString(16)}}-\\u{${end.toString(16)}}`).join("")}]`,
  "gu",
);

/**
 * Removes control, zero-width, and bidirectional code points.
 *
 * Tabs become a space and newlines survive, so ordinary formatting is preserved.
 */
export function withDiscordControlCharactersStripped(content: string): string {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CODE_POINT_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n");
}
