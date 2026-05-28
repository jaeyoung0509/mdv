# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

`mdv` is a read-first Markdown desktop app launched from the terminal. It opens a file or directory in a lightweight Tauri v2 app, renders Markdown quickly, and provides an optional writing mode for the current file.

The product principle is:

> Every feature must make reading or writing Markdown files faster, clearer, or more beautiful.

Avoid turning `mdv` into a vault, knowledge-management system, collaboration tool, or account-based product.

## Repository Layout

- `apps/desktop`: Tauri desktop app with a Nuxt 4, Vue 3, Pinia, and TypeScript frontend.
- `apps/desktop/src-tauri`: Rust backend and Tauri commands.
- `packages/cli`: npm CLI wrapper that exposes the `mdv` command.
- `examples`: sample Markdown files for manual testing.
- `scripts`: workspace maintenance scripts, including version bumping.

Generated outputs such as `.nuxt`, `.output`, `target`, and cache directories should not be edited manually.

## Development Commands

Use `pnpm` from the repository root.

```sh
pnpm install
pnpm dev
pnpm --filter @ejaebbang/mdv-desktop dev:frontend
pnpm --filter @ejaebbang/mdv-desktop test
pnpm --filter @ejaebbang/mdv-desktop typecheck
pnpm --filter @ejaebbang/mdv-desktop build
```

For Rust backend changes:

```sh
cd apps/desktop/src-tauri
cargo test
```

For full packaged builds:

```sh
pnpm build
```

## Architecture Notes

- Keep `useAppStore()` as the app-facing facade. Put behavior into feature slices instead of growing one large store file.
- Read mode should remain fast. Lazy-load writing-only dependencies such as Milkdown and CodeMirror.
- `MarkdownView` owns read-only rendering, heading enhancement, bookmarks, text selection, Mermaid, KaTeX, and code highlighting.
- `MarkdownEditor` owns writing UI. Live editing uses Milkdown Crepe; Source mode uses CodeMirror Markdown. Both write through the same draft/autosave state.
- Tauri commands should stay domain-oriented. Keep document, asset, preference, and AI command code separated enough that each area can be reasoned about independently.
- Preserve existing command names and payload shapes unless a change is explicitly required and covered by tests.

## Writing Mode Requirements

- Writing edits only the currently opened Markdown file.
- Manual save uses `Cmd/Ctrl+S`.
- Autosave is debounced and must not overwrite external edits without conflict handling.
- `modifiedMillis` is the conflict guard between frontend draft state and backend file writes.
- If an external file update arrives while dirty, pause autosave and expose `Reload` and `Overwrite`.
- Source mode must preserve the same draft content as Live mode.
- Image insertion should produce relative Markdown paths when importing local image assets.

## Testing Expectations

Before handing off substantial changes, run the smallest relevant checks and expand based on risk.

For frontend or store changes:

```sh
pnpm --filter @ejaebbang/mdv-desktop test
pnpm --filter @ejaebbang/mdv-desktop typecheck
pnpm --filter @ejaebbang/mdv-desktop build
```

For Rust command changes:

```sh
cd apps/desktop/src-tauri
cargo test
```

Keep or add regression coverage for:

- Markdown rendering and heading/bookmark behavior.
- Ask AI performance: typing in Ask AI must not re-render the document.
- Writing mode transitions, dirty state, autosave, manual save, and conflict handling.
- Source/Live writing mode draft preservation.

## Code Style

- Prefer small, feature-scoped modules over broad rewrites.
- Follow existing Vue Composition API, Pinia, and Tauri command patterns.
- Use TypeScript types for public app-facing state and command payloads.
- Keep UI text short and functional.
- Keep icons from `@lucide/vue` for toolbar and button actions.
- Do not introduce unrelated formatting churn.
- Do not commit, branch, or push unless explicitly asked.

## Product Guardrails

- Prioritize the reader experience over configuration surface.
- Keep writing mode Markdown-first and file-based.
- Do not add cloud sync, accounts, backlinks, vault indexing, collaboration, or multi-file authoring unless explicitly requested.
- Preserve local-first behavior and avoid network dependencies in core reading/writing flows.
