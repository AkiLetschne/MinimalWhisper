# Assets

App icons are generated from `logo.svg` (app icon) and `logo-mark.svg` (tray icon):

```bash
npx electron scripts/render-icons.js   # icon.png, iconTemplate@3x.png
python3 -c "from PIL import Image; i = Image.open('src/assets/icon.png'); i.save('src/assets/icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]); i.save('src/assets/icon.icns')"
```

- `icon.png` – Linux and window icon (1024×1024)
- `icon.ico` – Windows
- `icon.icns` – macOS
- `iconTemplate@3x.png` – tray icon
