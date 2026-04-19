# NavVest Judge Dashboard

Local Web Bluetooth dashboard for demoing the NavVest hardware to judges.

## What it does

- Connects directly to the vest from Chrome or Edge on `localhost`
- Visualizes live ultrasonic sensor state and active haptic motor output
- Preserves the last known live frame after disconnect
- Includes a built-in Demo Mode for presentation without hardware

## Local development

```bash
npm install
npm run dev
```

Open the local Vite URL in Chrome or Edge.

## Build

```bash
npm run build
```

## Firmware requirement

The dashboard expects the vest firmware to expose a telemetry BLE characteristic:

- Service: `7B7E1000-7C6B-4B8F-9E2A-6B5F4F0A1000`
- Telemetry characteristic: `7B7E1002-7C6B-4B8F-9E2A-6B5F4F0A1000`

If the characteristic is not present, the app falls back to Demo Mode.
