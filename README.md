# Target Designer

Standalone React + Vite app for the AcoustiX Target Designer screen.

## Quick Start

1. Install dependencies:
	- `npm install`
2. Run development mode:
	- `npm run dev`

## Available Scripts

- `npm run dev`
- `npm run build:pkg:host`
- `npm run build:pkg:mac`
- `npm run build:pkg:win`
- `npm run build:pkg:linux`
- `npm run build:pkg:all`
- `npm run build:pkg:zip` (alias of `build:pkg:all`)

## Packaging Output

Each `build:pkg:*` command creates zip artifact(s) in `release/`.
Zip names include a version suffix: `-v<version>.zip`.

Version source:

- default: `version` in `package.json`
- optional override for a single build: `TD_RELEASE_VERSION=<value>`

Each zip contains:

- one executable for its target platform
- `target_curves/` folder (runtime templates)

Examples:

- `release/target-designer-macos-arm64-v1.0.0.zip`
- `release/target-designer-macos-x64-v1.0.0.zip`
- `release/target-designer-linux-x64-v1.0.0.zip`
- `release/target-designer-win-v1.0.0.zip`

Release workflow:

1. Bump `version` in `package.json`.
2. Run your desired `build:pkg:*` command.

## Running the Packaged App

1. Unzip the artifact for your platform.
2. Run the extracted executable.
3. The app opens in your browser automatically.
4. Stop with `q` in the terminal (or `Ctrl+C`).

Runtime behavior:

- UI assets are served from inside the executable.
- Templates are served from `target_curves/` next to the executable at `/target_curves/*`.
- Template index/save API is available at `/api/target-curves`.
- Save as Template writes `.txt` files into that same `target_curves/` folder.
- If the configured port is already in use, the app opens the existing instance in the browser and exits.

## Runtime Environment Variables

- `TD_HOST` (default: `127.0.0.1`)
- `TD_PORT` (default: `5180`)
- `TD_OPEN_BROWSER=0` to disable browser auto-open

## Notes

- Built-in templates are loaded at runtime (not embedded in the JS bundle).
- In dev mode, templates are served from `src/target_curves`.
