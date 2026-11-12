import type { LayoutOptions } from "elkjs/lib/elk-api";

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

export const FLOW_PROFILE: LayoutProfile = {
  name: "flow",
  version: 1,
  options: {
    "elk.algorithm": "layered",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.randomSeed": "1",
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "48",
    "elk.spacing.edgeNode": "24",
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.spacing.edgeEdge": "16",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  },
};
