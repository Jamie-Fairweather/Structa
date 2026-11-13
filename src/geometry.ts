/**
 * The shapes positions and sizes are given in, shared by layout, the card
 * shapes and the painter. Every coordinate is in SVG pixels, y pointing down.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A box with its top-left corner at (x, y): a card's, a label's, an area's, or the flat box a straight run fills. */
export interface Box extends Point, Size {}
