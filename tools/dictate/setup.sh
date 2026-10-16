#!/usr/bin/env bash
# Installiert Dictate: Symlink, Config, Autostart, F8.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin/dictate"
CFG_DIR="$HOME/.config/dictate"
AUTOSTART="$HOME/.config/autostart/dictate.desktop"
KB="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/openwhispr/"

need() { command -v "$1" >/dev/null || { echo "Fehlt: $1"; exit 1; }; }
need python3
need arecord
need wl-copy
need ydotool
need notify-send
python3 -c "import gi; gi.require_version('Gtk','3.0')" 2>/dev/null || {
  echo "Fehlt: python3-gi + GTK3"
  exit 1
}
python3 -m py_compile "$SRC/dictate"

mkdir -p "$HOME/.local/bin" "$CFG_DIR" "$HOME/.config/autostart"
ln -sfn "$SRC/dictate" "$BIN"

if [ ! -f "$CFG_DIR/config" ]; then
  cp "$SRC/config.example" "$CFG_DIR/config"
  chmod 600 "$CFG_DIR/config"
  echo "Config angelegt: $CFG_DIR/config  — API-Key eintragen."
fi

cat > "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Dictate
Comment=LiteLLM dictation overlay
Exec=env GDK_BACKEND=x11 $BIN daemon
Icon=audio-input-microphone
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
EOF

SCHEMA="org.gnome.settings-daemon.plugins.media-keys"
gsettings set "$SCHEMA".custom-keybinding:"$KB" name "Dictate"
gsettings set "$SCHEMA".custom-keybinding:"$KB" command "$BIN"
gsettings set "$SCHEMA".custom-keybinding:"$KB" binding "F8"
existing=$(gsettings get "$SCHEMA" custom-keybindings)
if ! grep -q "$KB" <<<"$existing"; then
  # shellcheck disable=SC2001
  gsettings set "$SCHEMA" custom-keybindings "$(sed "s|]$|, '$KB']|" <<<"$existing" | sed "s|\[, |[|")"
fi

echo "Fertig. Overlay:  $BIN daemon"
echo "Toggle:           $BIN   (oder F8)"
echo "Config:           $CFG_DIR/config"
