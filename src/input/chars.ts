/** How messages name one character. The validator and the JSON scanner both use it. */
export interface CharDescription {
  /** The code point, written `U+0009`. */
  readonly code: string;
  /** Set for U+0000–U+001F and U+007F: its name ("a tab") and what to do instead. */
  readonly control?: { readonly name: string; readonly hint: string };
  /** Whether it shows as itself in a message: a letter, digit, punctuation mark or symbol. */
  readonly visible: boolean;
}

const CONTROLS = new Map([
  [0x09, { name: "a tab", hint: "use a space instead" }],
  [0x0a, { name: "a line feed", hint: "use a space instead: text wraps by itself" }],
  [0x0d, { name: "a carriage return", hint: "use a space instead: text wraps by itself" }],
]);
const OTHER_CONTROL = { name: "a control character", hint: "remove it" };

/** Describes the character (one code point) at the start of `ch`. */
export function describeChar(ch: string): CharDescription {
  const codePoint = ch.codePointAt(0)!;
  const code = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  if (codePoint <= 0x1f || codePoint === 0x7f) {
    return { code, control: CONTROLS.get(codePoint) ?? OTHER_CONTROL, visible: false };
  }
  return { code, visible: /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(String.fromCodePoint(codePoint)) };
}
