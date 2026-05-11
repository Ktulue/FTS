# Driver Inputs Overlay

Browser-source overlay served at `GET /overlays/driver-inputs/`. Visualizes wheel, three pedal bars, gear, shifter, and e-brake from Forza Horizon telemetry.

## Use in OBS

Add a Browser Source pointing at `http://localhost:5780/overlays/driver-inputs/`. Sizes via CSS to its viewport — pick whatever browser-source dimensions you like.

## Configuration (`config.jsonc`)

```jsonc
"driver-inputs": {
  "enabled": true,
  "config": {
    "userAssetDir": null,                  // or "C:/.../my-assets"
    "wheelRotationRangeDeg": 450,          // visual degrees each way at steer = ±1
    "shifterPoseDurationMs": 350,          // right-hand 'shifter' pose duration after a gear change
    "handbrakeEngageThreshold": 0.1        // handbrake above this → right-hand 'ebrake' pose
  }
}
```

## Replacing the placeholder art

The overlay ships with neutral SVG placeholders so it works out of the box. To use your own art, set `userAssetDir` to a directory containing an `assets/` subfolder with any of:

- `wheel.png`
- `hand_left.png`
- `hand_right_steering.png`, `hand_right_shifter.png`, `hand_right_ebrake.png`, `hand_right_floating.png`
- `shifter_base.png`, `shifter_knob.png`
- `ebrake.png`, `ebrake_base.png`, `ebrake_effect.png`
- `pedal_base.png`, `pedal_fill.png`
- `foot_left.png`, `foot_right.png`

Any slot you don't provide falls back to the built-in SVG placeholder. Reload the OBS browser source after dropping new files in.
