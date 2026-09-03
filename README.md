# Optic X Studio v1.3.2

You wanted your phone's camera on your PC without paying for a $40 webcam or trusting a sketchy app with root access. Congratulations, this is that, minus the nonsense.

Windows desktop client for a phone camera stream, with a DirectShow virtual camera named **OpticX Cam**. No AI upscaling snake oil, no "neural enhancement" marketing slide — we ripped that whole subsystem out. It added latency, dependency hell, and a native NVIDIA addon nobody asked to compile. Now it just decodes H.264 and puts pixels on screen. Revolutionary.

## What it actually does
- Pulls a DroidCam-compatible video stream off your phone.
- Renders it through WebGL2, not some duct-taped `<video>` tag.
- Exposes a real DirectShow virtual camera so Discord/OBS/Zoom see it like any other webcam.
- Shows you an actual connection state (`Disconnected` / `Connecting…` / `Connected` / `Connection failed`), because a spinning dot lying to you forever is not a UI.

## Scripts
zero-fluff, does what it says:

```bash
npm install
npm run dev
npm run dist       # Build production app and NSIS Windows installer
```

## Production Build & Installer
`npm run dist` compiles the virtual camera DirectShow filter (`opticx-vcam.dll`), the native N-API writers, and bundles a distributable 64-bit Windows NSIS installer into `release/`. If it doesn't build, check your Visual Studio Build Tools + Python setup before opening an issue — checkmate tech debt.
