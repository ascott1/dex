export interface FontFace {
  family: string;
  /** The CSS `font-weight` descriptor: `400`, or a range such as `100 1000`. */
  weight: string;
  /** `bold` faces are embedded only when the SVG asks for a weight of 500 or more. */
  when: 'always' | 'bold';
  /** The CSS `unicode-range` descriptor, and the same as pairs of code points. */
  range: string;
  ranges: [number, number][];
  /** The woff2 file as base64. */
  data: string;
}

export interface Embedded {
  svg: string;
  /** The families embedded; empty when the SVG has no text in DM Sans or DM Mono. */
  families: string[];
  /** Characters in the text that the embedded fonts do not have. */
  missing: string[];
}

export declare const STYLE_ID: string;
export declare function loadFaces(): FontFace[];
export declare function embedFonts(svg: string, faces: FontFace[]): Embedded;
