# Minimal Whispr

Dictation only. A slimmed-down fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) 1.10.3.

Press a hotkey, speak, get a cleaned-up transcript pasted where your cursor is. History,
dictionary, one speech-to-text provider and an optional cleanup LLM. Works with Groq or OpenAI
Whisper and with any OpenAI-compatible endpoint such as a LiteLLM proxy.

## Run

Requires Node.js 24+ (see `.nvmrc`).

```bash
npm install
npm run dev
```

`npm run dev` runs the Vite dev server with hot reload. To run Electron on the built renderer
instead (what a desktop launcher would do):

```bash
npm run build:renderer
npx electron .
```

`npm run test:ci` runs the fork's own tests (what CI runs). The full upstream suite
(`npm test`) still has failures in features this fork hides.

Run `npm run build:renderer` again after UI changes. Icons come from `src/assets/logo.svg` and
`logo-mark.svg`; see `src/assets/README.md` for regenerating them.

### Linux

Pasting needs one of `ydotool` (with `ydotoold` running), `wtype` or `xdotool`, plus
`wl-clipboard` or `xclip`. On GNOME the hotkey is registered as a GNOME custom shortcut
("Minimal Whispr Toggle") while the app is running; KDE and Hyprland use their own shortcut
systems.

A minimal desktop entry for a source checkout
(`~/.local/share/applications/minimal-whispr.desktop`):

```ini
[Desktop Entry]
Type=Application
Name=Minimal Whispr
Exec="/path/to/MinimalWhisper/node_modules/electron/dist/electron" --ozone-platform=x11 "/path/to/MinimalWhisper"
Path=/path/to/MinimalWhisper
Terminal=false
Categories=Utility;
StartupWMClass=minimal-whispr
```

## Config

`~/.config/minimal-whispr/config.json` syncs both ways with the Settings UI. See
`config.example.json`:

```json
{
  "stt": {
    "mode": "providers",
    "provider": "custom",
    "model": "gemini/gemini-2.5-flash",
    "baseUrl": "https://litellm.example.com/v1",
    "apiKey": ""
  },
  "cleanup": {
    "enabled": true,
    "mode": "providers",
    "provider": "custom",
    "model": "gemini/gemini-2.5-flash-lite",
    "baseUrl": "https://litellm.example.com/v1",
    "apiKey": "",
    "prompt": ""
  },
  "hotkey": "F8"
}
```

API keys stay in that file (mode 600) and are never part of the repository.

Custom/LiteLLM STT does not send the Whisper `prompt`; Groq and OpenAI still do.

## Scope

The UI covers dictation, history, dictionary and STT/cleanup settings
(`src/components/MinimalSettings.tsx`). Notes, meetings, chat, the voice assistant, cloud
accounts and auto-updates are hidden or switched off (`src/config/slimFork.ts`,
`src/config/releaseRepo.js`). Shared upstream code and dependencies remain in the tree until they can be
removed separately, so much of `src/` and `test/` still refers to OpenWhispr features.

Downloaded local models live in `~/.cache/openwhispr`, the same place upstream OpenWhispr uses,
so both apps share them; uninstalling Minimal Whispr leaves that cache alone.

Releases are not published yet. To enable auto-updates for your own builds, set
`RELEASE_REPO` in `src/config/releaseRepo.js` and `publish` in `electron-builder.json`.

`tools/dictate` holds an earlier standalone Python/GTK prototype
([README](tools/dictate/README.md)). It is independent of the Electron app.

## Credits and license

Based on [OpenWhispr](https://github.com/OpenWhispr/openwhispr) by the OpenWhispr Team
(upstream baseline `a00123b`, version 1.10.3), released under the MIT license. This fork is
MIT-licensed as well; see `LICENSE`. Bundled Noto Sans fonts are under the SIL Open Font
License (`src/assets/fonts/NotoSans-OFL.txt`).

Minimal Whispr is not affiliated with or endorsed by OpenWhispr.
