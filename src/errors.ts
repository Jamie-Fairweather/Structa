export type ErrorCode = "INVALID_INPUT" | "INVALID_OPTIONS" | "TOO_LARGE" | "LAYOUT_FAILED";

/** One thing wrong, with where it is (`edges[3].to`, or `$` for the whole input). */
export interface Problem {
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
}

/** The one error type render() rejects with. Its message lists every problem, one per line. */
export class StructaError extends Error {
  override readonly name = "StructaError";
  readonly code: ErrorCode;
  readonly problems: readonly Problem[];

  constructor(code: ErrorCode, problems: readonly Problem[]) {
    super(problems.map(formatProblem).join("\n"));
    this.code = code;
    this.problems = problems;
  }
}

function formatProblem({ path, message, hint }: Problem): string {
  return hint ? `${path}: ${message} (${hint})` : `${path}: ${message}`;
}
