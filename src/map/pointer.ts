/** What the Summary, Map and Tree share: the file or folder under the pointer, and opening a file's diff */
export interface Pointer {
  /** File or folder id; '' is the whole repo */
  hover: string | null
  onHover: (id: string | null) => void
  onOpen: (id: string) => void
}

/** Whether a file is lit by the hovered file or a folder holding it */
export const lit = (file: string, hover: string | null) => hover !== null && (hover === '' || file === hover || file.startsWith(hover + '/'))
