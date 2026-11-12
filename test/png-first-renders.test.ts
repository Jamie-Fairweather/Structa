import { expect, it } from "vitest";
import { render } from "../src/index";
import { decodePng } from "./helpers/png";

// Its own file, so these are the first PNG renders in the process: the
// rasteriser starts up while both are waiting for it. resvg can start only
// once per process, so both must wait on the same start-up.
const borrow = {
  type: "flow",
  nodes: [
    { id: "find", label: "Find the book on the shelf", shape: "step" },
    { id: "stamp", label: "Stamp the return date", shape: "step" },
  ],
  edges: [{ from: "find", to: "stamp" }],
};

it("draws two PNGs started at the same time, then more after them", async () => {
  const [first, second] = await Promise.all([render(borrow, { formats: ["png"] }), render(borrow, { formats: ["png"], scale: 1 })]);
  const after = await render(borrow, { formats: ["png"] });

  expect(decodePng(first.png).width).toBe(2 * decodePng(second.png).width);
  expect(after.png).toEqual(first.png);
});
