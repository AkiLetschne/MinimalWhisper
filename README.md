# Minimal Whispr

Dictation only. A slimmed-down fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) 1.10.3.

Press a hotkey, speak, get a cleaned-up transcript pasted where your cursor is. History,
dictionary, one speech-to-text provider and an optional cleanup LLM. Bring your own API key
for a supported provider, or use an OpenAI-compatible endpoint such as a LiteLLM proxy.
Both speech-to-text and cleanup use APIs; running local models inside the app is currently
not supported.

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

`~/.config/minimal-whispr/config.json` syncs both ways with the Settings UI. If
`XDG_CONFIG_HOME` is set, the file lives at `$XDG_CONFIG_HOME/minimal-whispr/config.json`
instead. See `config.example.json`:

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

The config file contains API keys and is written with mode `600`. Keep it private;
the repository includes only an example with empty keys. A root-level `config.json` and
local `.env` files are ignored by Git.

Custom/LiteLLM STT does not send the Whisper `prompt`; Groq and OpenAI still do.

## Scope

The UI covers dictation, history, dictionary and STT/cleanup settings
(`src/components/MinimalSettings.tsx`). Notes, meetings, chat, the voice assistant, cloud
accounts, local-model controls and auto-updates are hidden or switched off. The current
settings UI uses API providers for both transcription and cleanup.

Shared upstream code, dependencies and build scripts remain in the tree, including
local-model infrastructure. Some startup and packaging scripts still download upstream
helpers and model assets; this does not make local inference a supported feature. No model
weights or model cache are included in this repository.

Releases are not published yet; run the app from source using the instructions above.

## Credits and license

Based on [OpenWhispr](https://github.com/OpenWhispr/openwhispr) by the OpenWhispr Team
(upstream baseline `a00123b`, version 1.10.3), released under the MIT license. This fork is
MIT-licensed as well; see `LICENSE`. Bundled Noto Sans fonts are under the SIL Open Font
License (`src/assets/fonts/NotoSans-OFL.txt`).

Minimal Whispr is not affiliated with or endorsed by OpenWhispr.
