import type { Problem } from "../errors";

/**
 * Parses JSON text. On a syntax error, returns one problem at `$` giving the
 * line and column, what was wrong and a hint. JSON.parse does the parsing;
 * its messages vary between Node versions and don't always give a position,
 * so a small scanner finds and explains the first error instead.
 */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; problem: Problem } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const found = findSyntaxError(text);
    if (!found) {
      const message = `invalid JSON: ${(error as Error).message}`;
      return { ok: false, problem: { path: "$", message, hint: "check the JSON with a validator" } };
    }
    const { line, column } = lineAndColumn(text, found.at);
    const message = `invalid JSON at line ${line}, column ${column}: ${found.message}`;
    return { ok: false, problem: { path: "$", message, hint: found.hint } };
  }
}

interface SyntaxError {
  readonly at: number;
  readonly message: string;
  readonly hint: string;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
const ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

/** The first syntax error in `text`, following the JSON grammar (RFC 8259). */
function findSyntaxError(text: string): SyntaxError | undefined {
  let i = 0;
  const fail = (message: string, hint: string, at = i): SyntaxError => ({ at, message, hint });
  const skipSpace = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const endTooSoon = () => fail("the input ends too soon", "close every open list and object");

  /** Scans a string starting at its opening quote. */
  const scanString = (): SyntaxError | undefined => {
    i++;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"') {
        i++;
        return undefined;
      }
      if (ch === "\\") {
        const escape = text[i + 1];
        if (escape === undefined) break;
        if (escape === "u" && /^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
        else if (escape !== "u" && ESCAPES.has(escape)) i += 2;
        else return fail(`"\\${escape}" is not a valid escape`, "write a backslash as \\\\");
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        return fail(`found ${controlName(ch)} inside a string`, "keep each string on one line; text wraps by itself");
      }
      i++;
    }
    return fail("the input ends inside a string", 'close the string with "');
  };

  /** Scans one value that isn't a list or object. */
  const scanScalar = (afterComma: boolean): SyntaxError | undefined => {
    const ch = text[i];
    if (ch === undefined) return endTooSoon();
    if (ch === '"') return scanString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(text);
      const end = match ? i + match[0].length : i;
      if (!match || /[0-9.eE+-]/.test(text[end] ?? "")) return fail("invalid number", "write numbers like 1, 2.5 or -3");
      i = end;
      return undefined;
    }
    WORD.lastIndex = i;
    const word = WORD.exec(text)?.[0];
    if (word === "true" || word === "false" || word === "null") {
      i += word.length;
      return undefined;
    }
    let hint = "a value is a string, a number, a list, an object, true, false or null";
    if (word !== undefined) hint = "put text in double quotes";
    else if (ch === "'") hint = "JSON uses double quotes, not single quotes";
    else if (afterComma && (ch === "]" || ch === "}")) hint = "remove the comma before it";
    else if (i === 0 && ch.charCodeAt(0) === 0xfeff) hint = "remove the byte-order mark at the start";
    return fail(`expected a value but found ${describe(text, i)}`, hint);
  };

  skipSpace();
  if (i === text.length) return fail("the input is empty", "pass one JSON object describing the diagram");

  // Lists and objects are tracked on a stack rather than by recursion, so deep nesting can't overflow.
  const open: ("list" | "object")[] = [];
  let expect: "value" | "key" | "after" = "value";
  let afterComma = false;
  for (;;) {
    skipSpace();
    const ch = text[i];
    if (expect === "value") {
      if (ch === "{" || ch === "[") {
        open.push(ch === "{" ? "object" : "list");
        i++;
        skipSpace();
        const close = ch === "{" ? "}" : "]";
        if (text[i] === close) {
          open.pop();
          i++;
          expect = "after";
        } else expect = ch === "{" ? "key" : "value";
        afterComma = false;
        continue;
      }
      const error = scanScalar(afterComma);
      if (error) return error;
      expect = "after";
    } else if (expect === "key") {
      if (ch === undefined) return endTooSoon();
      if (ch !== '"') {
        let hint = "put field names in double quotes";
        if (ch === "'") hint = "JSON uses double quotes, not single quotes";
        else if (afterComma && ch === "}") hint = "remove the comma before it";
        return fail(`expected a field name in double quotes but found ${describe(text, i)}`, hint);
      }
      const error = scanString();
      if (error) return error;
      skipSpace();
      if (text[i] === undefined) return endTooSoon();
      if (text[i] !== ":") {
        return fail(`expected ":" but found ${describe(text, i)}`, "put a colon between a field name and its value");
      }
      i++;
      expect = "value";
      afterComma = false;
    } else {
      const inside = open.at(-1);
      if (inside === undefined) {
        if (ch === undefined) return undefined;
        return fail(`expected the end of the input but found ${describe(text, i)}`, "the input must be exactly one JSON object");
      }
      if (ch === undefined) return endTooSoon();
      const close = inside === "object" ? "}" : "]";
      if (ch === ",") {
        i++;
        expect = inside === "object" ? "key" : "value";
        afterComma = true;
      } else if (ch === close) {
        open.pop();
        i++;
      } else {
        const between = inside === "object" ? "fields" : "items";
        return fail(`expected "," or "${close}" but found ${describe(text, i)}`, `put a comma between ${between}`);
      }
    }
  }
}

/** What is at `i`, for a message: a string, a number, a bare word, a visible character or a code. */
function describe(text: string, i: number): string {
  const ch = text[i]!;
  if (ch === '"') return "a string";
  if (ch === "-" || (ch >= "0" && ch <= "9")) return "a number";
  WORD.lastIndex = i;
  const word = WORD.exec(text)?.[0];
  if (word !== undefined) return JSON.stringify(word.length > 20 ? `${word.slice(0, 20)}…` : word);
  const whole = String.fromCodePoint(text.codePointAt(i)!);
  return /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(whole) ? JSON.stringify(whole) : codeOf(whole);
}

const CONTROL_NAMES = new Map([
  ["\t", "a tab"],
  ["\n", "a line feed"],
  ["\r", "a carriage return"],
]);

function controlName(ch: string): string {
  return `${CONTROL_NAMES.get(ch) ?? "a control character"} (${codeOf(ch)})`;
}

function codeOf(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** 1-based line and column of `index`. A line break is LF, CRLF or a lone CR. */
function lineAndColumn(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}
