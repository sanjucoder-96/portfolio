# Experiment — cursor particle field

Isolated from the production build. **Nothing here is loaded by the live site.**

| path | role |
|---|---|
| `index.html` | standalone page; `<base href="../../">` so shared assets resolve from the project root |
| `particle-field.js` | the experimental hero field (fork of `assets/js/computational-robot.js`) |
| `_baseline-snapshot.js` | copy of the stable module taken 2026-08-28 15:16:13, kept for diffing |

## Run

    python -m http.server 8788 --bind 127.0.0.1
    # stable:     http://127.0.0.1:8788/
    # experiment: http://127.0.0.1:8788/experiments/cursor-field/

## What differs from stable

Only the cursor→particle field. Geometry, pose, reference sampling, graph
anchoring, constellations, typography and theming are untouched.

1. **`CFG` block** — every tunable in one place, live-adjustable:
   `__computationalCore._cfg({ REPULSION_STRENGTH: 0.03 })` returns the config
   plus the radius converted to px.
2. **`MAX_DISPLACEMENT` clamp** in the velocity pass — caps `|pos - home|` so
   locality is structural rather than a consequence of a well-chosen force.
   Measured: raising force 14x only doubles the disturbed area instead of
   scaling with it.
3. **`WAVE_STRENGTH`** — optional outward ripple. **Defaults to 0; never
   visually assessed.** Do not merge without looking at it.

## Tuning findings

Measured with `_dispStats()` (reads the GPGPU position texture back and compares
against home). Pane was 63 px per world unit; ~82 px/unit at 1440x900.

**Why it felt like a zoom.** At the old default force 0.021 the mean particle
displacement was only **6px**. A small, near-uniform displacement across a
region reads as lens distortion, not as individual particles moving. Raising it
to 0.13 gives ~14px mean / 35px peak — visibly per-particle.

| force | mean displacement | moved | returns |
|---|---|---|---|
| 0.021 | 6px | 14.5% | exact |
| 0.08 | 12.5px | 16.7% | exact |
| **0.13** | **14.8px** | **17.3%** | exact |
| 0.22 | 17px | 18.2% | exact |

**MAX_DISPLACEMENT now binds exactly** — caps of 0.25 / 0.55 / 0.90 measured
15.7 / 34.6 / 56.7 px. It previously did not: the clamp lived in the velocity
pass, but the position pass can integrate a velocity the clamp has not yet
corrected, so a fast pointer overshot well past the cap (85px against a 44px
cap). Moving the clamp into the position pass fixed it.

**SPRING_STRENGTH must stay low.** The integrator is semi-implicit Euler at
dt≈1. Raising spring to 0.16+ makes particles overshoot through home every step
and ring forever, pinned at MAX_DISPLACEMENT — they never return. Counter-
intuitively, higher spring = slower return. Use DAMPING instead:

| damping | return to ~1px | fully home |
|---|---|---|
| 0.90 | 4s | 8s |
| 0.86 | 1s | 2s |
| **0.82** | **1s** | **2s** |

**Locality, final defaults:**

| cursor | disturbed box | mean displacement | after release |
|---|---|---|---|
| head | 120 x 106 px | 14.8px | **0** |
| palm | 124 x 90 px | 23.4px | **0** |
| shoulder | 140 x 138 px | 9.7px | **0** |
| off-body | none | 0 | **0** |

Cyan response: 14.9% of lit pixels at rest, 20.3% while interacting.

`CYAN_THRESHOLD` and `PARTICLE_BRIGHTNESS` were dead config — declared but never
referenced. Now wired to the render shader, along with a new `SPEED_SCALE`.

## Known issues (present in stable too)

* `_bounds()` throws — references `body.home`, which no longer exists after the
  move to GPGPU. Debug-only.

## Caveat

`_baseline-snapshot.js` is already stale: the stable module was edited at
15:17:06, 53s after the snapshot (cyan threshold 1.62 -> 1.44). Re-copy from
`assets/js/computational-robot.js` for a current baseline.
