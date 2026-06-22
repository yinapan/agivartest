export type CoordinateSpace =
  | 'screen-logical'
  | 'screen-physical'
  | 'window-logical'
  | 'image-pixel';

export interface Point {
  x: number;
  y: number;
  space: CoordinateSpace;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  space: CoordinateSpace;
}
