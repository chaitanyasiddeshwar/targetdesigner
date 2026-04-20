# Target Designer (Standalone)

Independent React + Vite project for the AcoustiX Target Designer screen.

## Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run build:zip`
- `npm run preview`
- `npm run standalone`
- `npm run build:pkg`
- `npm run build:pkg:host`
- `npm run build:pkg:mac`
- `npm run build:pkg:win`
- `npm run build:pkg:linux`
- `npm run build:pkg:all`
- `npm run build:pkg:zip`

## Running the Production Build

Do not open `dist/index.html` directly with `file://` in a browser.
Modern browsers apply CORS/security rules to module scripts for file origins, which can produce a blank page.

Use an HTTP server instead:

- `npm run build`
- `npm run preview`

If you only have the zipped artifact, unzip it and serve the extracted folder with any static HTTP server.

## Standalone Executable (pkg)

`npm run build:pkg` (alias for `build:pkg:all`) now creates zip artifacts in `release`.
Each zip contains:

- one platform executable
- `target_curves/` (external template files loaded at runtime)

Typical outputs:

- `release/target-designer-macos-arm64.zip`
- `release/target-designer-macos-x64.zip`
- `release/target-designer-linux-x64.zip`
- `release/target-designer-win.zip`

Use the executable by unzipping the target platform zip and running the extracted binary.

Behavior:

- Starts an HTTP server and opens the browser automatically.
- Serves built UI from inside the executable.
- Serves templates from the extracted `target_curves` folder at `/target_curves/*`.
- Exposes template metadata at `/api/target-curves`.
- Save as Template writes `.txt` files into the extracted `target_curves` folder.
- Press `q` in the terminal to stop (or `Ctrl+C`).

Optional environment variables:

- `TD_HOST` (default: `127.0.0.1`)
- `TD_PORT` (default: `5180`)
- `TD_OPEN_BROWSER=0` to disable auto-open.

## Notes

- This project is fully isolated from the root workspace package configuration.
- Built-in templates are loaded at runtime (not embedded in compiled JS).
- In dev/preview mode, templates are served from `src/target_curves`.
- In pkg mode, templates are served from and saved to the executable-adjacent `target_curves` folder.
- Saved templates are stored in browser localStorage.
