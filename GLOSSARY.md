# Glossary

**Tree**: the repo's folders and files (`TreeNode`), sizes and changes rolled up per folder (`src/map/tree.ts`).

**Treemap**: lays the Tree out for a folder zoomed into at a size (`src/map/treemap.ts`). Remembers each folder's **arrangement** across zooms.

**Layout**: one view of the Treemap: the zoomed-in folder (**top**, the canvas), every drawn **cell**, corner radii, and `cellOf`.

**Cell**: a file's or folder's box in a Layout. A file too small to draw is shown by the cell it's **drawn in**: its nearest drawn ancestor's (`Layout.cellOf`).

**Arrangement**: a folder's squarified rows (which children, in what order, which way). Kept while the canvas and the folder keep much the same shape; a much different shape lays out afresh.

**Fate**: what the branch did to a file, as drawn (`cell.ts`): added, edited, deleted, renamed, moved here/away, same.

**Side**: one end of the diff, read (`src/map/graph.ts`): the base commit's or the working tree's files, their sizes, imports and packages. Read from a **Snapshot** (its files and how to read them) by `sideOf`; a commit's is kept while it's a base (`src/map/read.ts`).
