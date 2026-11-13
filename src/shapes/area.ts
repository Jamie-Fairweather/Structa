// The area's name is drawn in the face the input definitions check it against.
import { AREA_LABEL_FACE, type Area } from "../input";
import { baseline, measure } from "../text";
import type { Sizes } from "../theme";
import type { Box, TextLine } from "./frame";

/**
 * An area's box, sized before layout as far as it can be: ELK sizes it round
 * its cards and the areas inside it, with `padding` inside its edges, and no
 * narrower than `minWidth`, so its name always fits.
 */
export interface AreaBox {
  readonly id: string;
  /** The id of the area it's inside. */
  readonly parent?: string;
  readonly tooltip: string;
  readonly minWidth: number;
  /** The top padding holds the name and a gap under it. */
  readonly padding: { readonly top: number; readonly side: number; readonly bottom: number };
  /** The area's name at the top-left, relative to the box's top-left corner. */
  readonly name: Omit<TextLine, "color">;
  /** Round the name, a little wider than it: covered in the box's colour, so a line under it doesn't cut through it. */
  readonly nameBox: Box;
}

/**
 * A box for each area, in the order they're laid out and drawn: each parent
 * before the areas inside it, and the areas inside one in the order given.
 */
export function buildAreaBoxes(areas: readonly Area[], sizes: Sizes): AreaBox[] {
  const s = sizes.area;
  const ordered: Area[] = [];
  const addInside = (parent: string | undefined) => {
    for (const area of areas) {
      if (area.parent !== parent) continue;
      ordered.push(area);
      addInside(area.id);
    }
  };
  addInside(undefined);
  return ordered.map((area) => {
    const nameWidth = measure(area.label, AREA_LABEL_FACE, s.nameSize);
    return {
      id: area.id,
      ...(area.parent === undefined ? {} : { parent: area.parent }),
      tooltip: area.label,
      minWidth: Math.ceil(nameWidth + 2 * s.padding),
      padding: { top: s.nameTop + s.nameLineHeight + s.nameGap, side: s.padding, bottom: s.padding },
      name: {
        text: area.label,
        x: s.padding,
        y: s.nameTop + baseline(AREA_LABEL_FACE, s.nameSize, s.nameLineHeight),
        face: AREA_LABEL_FACE,
        size: s.nameSize,
        anchor: "start",
      },
      nameBox: { x: s.padding - s.nameMargin, y: s.nameTop, width: nameWidth + 2 * s.nameMargin, height: s.nameLineHeight },
    };
  });
}
