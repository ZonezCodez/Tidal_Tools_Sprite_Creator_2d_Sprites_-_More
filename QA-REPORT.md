# Sprite Creator 1.11.1 — QA and release notes

## Automated source checks

Run `npm run check` from this folder. The check currently passes all of the following:

- Package version and exact top-level Electron/electron-builder pins
- HTML duplicate-ID audit (102 unique IDs)
- All local stylesheet and script references resolve
- Electron renderer HTML contains no inline executable scripts
- CSS delimiter/string/comment balance for all five stylesheets
- Required stylesheet loading order
- All four UI/artboard theme mappings and Onyx near-black/gray tokens
- Node syntax checks for main, preload, renderer, brand config, theme initializer, and audit script
- Electron context isolation, renderer sandbox, disabled Node integration, navigation/window-open restrictions, single-instance lock, and preload-to-main IPC channel matching
- Official PNG/ICO application mark and Windows CI workflow
- Portable builder embeds the logo so the share application remains self-contained
- Top bar, exit screen, favicon, Electron window, Windows installer/shortcut icon, and portable share package use the official brand mark

## Additional static checks performed for this release

- All five CSS files parsed with `tinycss2`: zero CSS parse errors
- The Onyx foreground/body text pairs have WCAG contrast ratios above 11:1; primary text is above 17:1 on the main surface
- Onyx uses near-black application chrome (`#050608`), a graphite canvas surround (`#25282E`), and a separate medium-gray transparent artboard (`#747B84` / `#636A73`)
- Portable single-file HTML generated successfully (approximately 352 KB before ZIP compression)
- The portable HTML has its application CSS and JavaScript embedded; no remote library dependency is required
- Both distribution ZIPs are integrity-tested after packaging
- Windows `.ico`, PNG mark, and browser tab icon use the official neon pixel-brush application logo
- Onyx retains a gray checker artboard (`#747B84` / `#636A73`) on a distinct graphite surround (`#25282E`)

## Visual and platform test limitations

A full interactive Chromium smoke test could not be completed in this environment: browser navigation to local `file://` and loopback HTTP pages is blocked by the runtime policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). Therefore this report does **not** claim that a live browser screenshot or full visual interaction suite passed in this run.

The native Windows NSIS installer and Electron portable `.exe` have not been compiled in this Linux packaging environment. They are configured in `package.json` and can be built on Windows with `Build Windows Release.bat` or by the included Windows GitHub Actions workflow. The delivered developer ZIP is source/build tooling; it is not itself a precompiled native installer.

GameMaker imports, native Windows file dialogs, native close animation, and full mouse interaction should be smoke-tested on a clean Windows 10/11 machine before public distribution.

## CSS cleanup decision

The original 1.10.2 CSS cascade was split into ordered base, theme, canvas, and selection files without deleting legacy declarations. This was intentionally conservative: some repeated selectors are historical overrides whose order affects the appearance of existing controls. All stylesheets parse cleanly, and the final theme layer centralizes the new Onyx/Prism palette. Further selector deduplication should only be done with visual regression tests available.

## Dependency reproducibility

Electron and electron-builder are pinned to exact top-level versions. A `package-lock.json` was not generated in this environment because the package registry could not be reached during packaging. Run `npm install` on the Windows developer machine and commit the generated lockfile before establishing a public CI release baseline; this will pin the complete transitive dependency tree.

## Data and compatibility safeguards

- The 1.10.2 `.spritecreator` document format and existing renderer logic were retained.
- Saved theme preference names and four theme combinations are preserved.
- Existing project data is not modified by the build or packaging scripts.
- PNG exports retain alpha transparency; empty pixels remain alpha 0.
- The portable browser build stores its settings/autosave in the dedicated browser profile launched by its BAT file; users should still use Save Project for durable project files.
