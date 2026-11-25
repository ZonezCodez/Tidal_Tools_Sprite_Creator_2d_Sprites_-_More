# Changelog

## 1.11.1 — Official branding and artboard finish

- Introduced the official neon pixel-brush application mark.
- Applied the mark to the Windows icon, top-bar brand lockup, browser favicon, exit screen, and portable build.
- Included a standalone logo PNG and brand guide in both distribution paths.
- Kept the Onyx artboard gray while changing the surrounding workspace to neutral graphite (`#25282E`).
- Refined the Prism artboard surround to a neutral light gray (`#C5C9CF`).
- Kept interface colors and artboard colors independent across all four themes.

## 1.11.0 — Stability, cleanup, and production packaging

- Restored the full original CSS cascade from 1.10.2 and split it into ordered base, theme, canvas, and selection stylesheets without deleting older declarations.
- Explicitly loaded every stylesheet module from the editor HTML; added a final theme-polish layer.
- Reworked Onyx into a near-black interface with stronger neutral text and restrained electric accents.
- Changed the Onyx artboard to a neutral medium-gray workspace with compact transparency checks, distinct from the dark UI.
- Preserved the four UI/artboard theme combinations and saved preference migration.
- Externalized the pre-paint theme initializer and added a restrictive local-content policy for the Electron renderer.
- Hardened the Electron shell with a single-instance lock, trusted-document IPC checks, blocked unexpected navigation/window opens, denied permission prompts, and retained context isolation/sandboxing.
- Pinned Electron 45.5.0 and electron-builder 26.18.0 exactly.
- Added a repeatable source audit, developer launch, Windows release build, and GitHub Actions Windows packaging workflow.
- Added a self-contained single-HTML share build and a separate Windows launcher ZIP for recipients who do not need the source.
- Kept the 1.10.2 `.spritecreator` document format and existing editor workflows unchanged.

## 1.10.2 — Windowed startup and selection dock

- Starts in a familiar maximized window with native title-bar controls.
- Places selection actions in a dedicated side dock beside the canvas.
- Preserves the existing 2D game-asset workflow, animation tags, selection transforms, and engine helpers.

## 1.9.x — Theme and artboard foundations

- Added Onyx, Prism, and two hybrid theme combinations.
- Separated transparency checkerboard and pixel-grid colors from the application UI theme.
- Added focus drawing mode, canvas fitting, animation clips, engine export helpers, and the cinematic intro/exit experience.
