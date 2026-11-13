import { expect } from "vitest";
import { render, StructaError, type Problem } from "../../src/index";

/** What `promise` rejects with, failing the test unless it rejects with a StructaError. */
export async function rejection(promise: Promise<unknown>): Promise<StructaError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  return error as StructaError;
}

/** The problems render() finds in `input`, failing the test unless it rejects it as INVALID_INPUT. */
export async function problems(input: unknown): Promise<readonly Problem[]> {
  const error = await rejection(render(input as object));
  expect(error.code).toBe("INVALID_INPUT");
  return error.problems;
}
