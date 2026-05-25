# mdv

Fast, beautiful Markdown viewing from the terminal.

```sh
mdv lecture.md
mdv README.md
mdv .
```

`mdv` opens a Markdown file or directory in a lightweight Tauri desktop viewer. It is viewer-only: no vault setup, no account, no editing surface, and no knowledge-management system.

## Status

This repository is the v0.1 implementation scaffold:

- Tauri v2 desktop app with a Rust backend
- React + TypeScript frontend
- GitHub-flavored Markdown through `react-markdown`, `remark-gfm`, and `github-markdown-css`
- Mermaid diagrams
- KaTeX math
- Shiki code highlighting
- File watching and auto reload
- npm CLI wrapper that exposes the `mdv` command

## Development

```sh
pnpm install
pnpm dev
```

To link the local CLI:

```sh
pnpm link:cli
mdv examples/lecture.md
```

The CLI forwards the selected path and options into the Tauri desktop app.

## CLI

```sh
mdv [path] [options]
```

Options:

- `--theme <light|dark|system>`
- `--no-watch`
- `--allow-html`
- `--version`
- `--help`

If `path` is omitted, `mdv` opens the current directory and resolves a Markdown file in this order:

1. `README.md`
2. `readme.md`
3. `index.md`
4. The first `.md` or `.markdown` file alphabetically

## Product Principle

Every feature must pass this question:

> Does this make reading Markdown files faster, clearer, or more beautiful?

If not, it does not belong in `mdv`.
