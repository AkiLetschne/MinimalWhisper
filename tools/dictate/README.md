# Dictate

F8-Diktat über LiteLLM: aufnehmen → `/audio/transcriptions` (ohne Whisper-`prompt`) → Cleanup → einfügen.

Floating-Mic unten rechts auf dem Monitor unter dem Cursor. Klick oder F8 startet/stoppt.

## Setup

```bash
./setup.sh
```

Key nach `~/.config/dictate/config`. Overlay:

```bash
~/.local/bin/dictate daemon
```

Beim Login startet es über `~/.config/autostart/dictate.desktop`.

## Braucht

`python3-gi` (GTK3), `arecord`, `wl-copy`, `ydotool` (User-Socket), `notify-send`. GNOME/Wayland, Overlay über XWayland (`GDK_BACKEND=x11`).

## Config

| Key | Bedeutung |
|---|---|
| `LITELLM_BASE_URL` | OpenAI-kompatible Basis, mit `/v1` |
| `LITELLM_API_KEY` | Bearer-Token |
| `STT_MODEL` | Transcribe-Modell |
| `CLEANUP_MODEL` | Chat-Modell fürs Aufräumen |
| `TERMS` | Schreibweisen nur im Cleanup, nicht im STT-Request |

## Warum nicht OpenWhispr

OpenWhispr schickt das Wörterbuch als Whisper-`prompt`. Gemini/Vertex auf LiteLLM antwortet darauf mit 400. Dictate schickt nur `file` + `model`.
