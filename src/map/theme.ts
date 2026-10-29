/** The Tree's colours as named roles, so the scheme lives in one place. */
import { amber, black, gray, green, red, white } from '../palette.js'

export interface Theme {
  /** Behind the treemap */
  canvas: string
  /** The neutral the fills are made from: files' translucent ones, folders' solid blends */
  ink: string
  /** File names, hover text */
  text: string
  /** Folder names, quieter labels */
  muted: string
  /** Sizes, line counts */
  dim: string
  added: string
  /** A new file's line count, over its green fill */
  addedSize: string
  modified: string
  removed: string
  moved: string
  /** Import lines: what the hovered item imports, and what imports it */
  importOut: string
  importIn: string
  /** A hovered file's outline */
  hover: string
  /** A hovered folder's name row and subfolder outlines */
  accent: string
  /** Text on the name row: name, the quieter share and size, and the change counts */
  onAccent: string
  onAccentMuted: string
  addedOnAccent: string
  removedOnAccent: string
  /** Darkest: under counts, casings */
  shade: string
}

/** The colours in use */
export const T: Theme = {
  canvas: gray[950],
  ink: gray[400],
  text: gray[300],
  muted: gray[400],
  dim: gray[500],
  added: green[500],
  addedSize: green[400],
  modified: amber[500],
  removed: red[500],
  moved: gray[200],
  // Picked to sit apart from the amber of changes (not Tailwind's).
  importOut: '#5ac8fa',
  importIn: '#7cf7b8',
  hover: white,
  accent: gray[600],
  onAccent: white,
  onAccentMuted: gray[300],
  addedOnAccent: green[500],
  removedOnAccent: red[500],
  shade: black,
}
