# deltaviz

A live treemap of a git repo: the whole codebase sized by lines, the branch's changes coloured in, imports on hover. It updates as you edit.

```sh
npx deltaviz          # in any folder of a git repo
npm i -g deltaviz     # or install it, then: deltaviz
```

It opens `http://127.0.0.1:4848` (or the next free port) and keeps running until Ctrl-C. Run it again in the same repo and it opens the running one.

- **Branch** compares against where the branch left the default branch (`origin/HEAD`, else `main`/`master`); **Uncommitted** against `HEAD`.
- Click a folder to zoom in, a file for its diff (or its code). Run it in a subfolder to start zoomed into it.
- Imports are read from JS/TS sources.

```
deltaviz [dir] [--port <n>] [--base <ref>] [--no-open]
```

Needs Node 24 and git.

## Develop

```sh
npm install
npm run dev           # build, then serve this repo
```

MIT
