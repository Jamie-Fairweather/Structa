import type { LayoutOptions } from "elkjs/lib/elk-api";
import type { Diagram } from "../input";

/**
 * A fixed ELK option profile for one diagram type, passed whole as global
 * layout options. The direction isn't part of it: it comes from the input.
 * Bump `version` whenever an option changes: every snapshot of that type must
 * then be re-reviewed.
 */
export interface LayoutProfile {
  readonly name: string;
  readonly version: number;
  readonly options: LayoutOptions;
}

/** What every profile shares. Each one sets its own spacing between cards. */
const LAYERED: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  // JSON node order is a soft hint: ELK keeps it unless that adds crossings.
  "elk.layered.considerModelOrder.strategy": "PREFER_NODES",
  "elk.spacing.edgeNode": "24",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.edgeEdge": "16",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
  // Line labels are pills drawn on top of their line, so ELK centres them on it.
  "elk.edgeLabels.inline": "true",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
};

export const CLASS_PROFILE: LayoutProfile = {
  name: "class",
  version: 1,
  options: {
    ...LAYERED,
    "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  },
};

export const FLOW_PROFILE: LayoutProfile = {
  name: "flow",
  version: 3,
  options: {
    ...LAYERED,
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "48",
  },
};

/** Each diagram type's profile. */
export const PROFILES: ReadonlyMap<Diagram["type"], LayoutProfile> = new Map([
  ["class", CLASS_PROFILE],
  ["flow", FLOW_PROFILE],
]);
