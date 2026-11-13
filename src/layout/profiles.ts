import type { LayoutOptions } from "elkjs/lib/elk-api";

/**
 * A fixed ELK option profile for one diagram type, given it by the registry
 * of diagram types, and passed whole as global layout options. The direction
 * isn't part of it: it comes from the input. Bump `version` whenever an
 * option changes: every snapshot of that type must then be re-reviewed.
 */
export interface LayoutProfile {
  readonly version: number;
  readonly options: LayoutOptions;
  /**
   * Added to `options` for a pass that keeps an earlier pass's arrangement: it
   * starts from where that pass put the cards, and moves them only as far as
   * the lines need.
   */
  readonly keepArrangement?: LayoutOptions;
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
  version: 1,
  options: {
    ...LAYERED,
    "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  },
};

export const ER_PROFILE: LayoutProfile = {
  version: 2,
  options: {
    ...LAYERED,
    "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
    // Every line leaves a table straight for at least this far: room for the crow's foot at its end before it turns.
    "elk.spacing.edgeNode": "36",
    "elk.layered.spacing.edgeNodeBetweenLayers": "36",
    // A table's link to itself loops out a little further, as its two ends sit close together.
    "elk.spacing.nodeSelfLoop": "40",
  },
  // Layers, the order within them and positions across the flow all come from the earlier pass.
  keepArrangement: {
    "elk.layered.layering.strategy": "INTERACTIVE",
    "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
    "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  },
};

export const FLOW_PROFILE: LayoutProfile = {
  version: 4,
  options: {
    ...LAYERED,
    // A loop runs back against the flow from the line that closes it, walking
    // from the start, so the steps stay in the order a reader follows them.
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "48",
    // A note sits this far from the card it's about, and from the other notes about it.
    "elk.spacing.commentNode": "24",
    "elk.spacing.commentComment": "16",
  },
};

export const ARCHITECTURE_PROFILE: LayoutProfile = {
  version: 1,
  options: {
    ...LAYERED,
    "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  },
};

/**
 * Added to every profile when area boxes are drawn: areas are compound nodes,
 * laid out with their cards as one graph, so lines can cross from one area
 * into another. Lines of different statuses never share a segment, and every
 * position comes back relative to the root.
 */
export const GROUPED: LayoutOptions = {
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.mergeHierarchyEdges": "false",
  "elk.json.shapeCoords": "ROOT",
  "elk.json.edgeCoords": "ROOT",
};
