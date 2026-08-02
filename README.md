# bikeathome

Ride your own GPX routes on a smart trainer, in the browser.

Built for a **Wahoo Kickr Core 2 with a Zwift Cog** — a single-sprocket setup where
physical shifting is impossible, so the app shifts in software and sends the resulting
resistance to the trainer over standard Bluetooth FTMS. A **Zwift Click** on the
handlebars is the shifter; the keyboard works too, and stays live as a fallback.

Riders with a normal cassette are supported: switch the drivetrain setting to
`cassette` and the app sends the true route gradient while you shift on the bike.

Nothing here is Wahoo-specific beyond the defaults. FTMS is an open standard, so most
modern smart trainers should work.

There is no backend. Your GPX files and your rides are read and kept in your browser
and never sent anywhere.

## Try it without a trainer

```sh
npm install
npm run dev      # http://localhost:5173
```

Click **Or try the demo climb**, then **Use demo trainer**, then **Start ride**. The
simulated rider holds a target power and adjusts cadence, so shifting behaves the way
it would on the road: too tall a gear and it grinds, too small and it spins out. Demo
mode works in any browser, including Safari.

## Riding it for real

Requires **Chrome or Edge** — Safari and Firefox do not implement Web Bluetooth. It
works on `localhost` without HTTPS; any other host must be served over HTTPS.

1. Wake the trainer by turning the cranks, and press the Click until it flashes.
2. **Quit Zwift, MyWhoosh and the Wahoo app first.** Only one application can hold the
   trainer's Bluetooth connection, and a background app will quietly keep it.
3. Load your GPX, then **Pair trainer** and **Pair Zwift Click**. Each opens the
   browser's device chooser, which is why they need a click rather than happening on
   their own.
4. Set your rider and bike weight under **Rider and drivetrain**, and set the same
   figure in the Wahoo app so the trainer's own model agrees with this one.

Shift with the Click, or with <kbd>+</kbd> / <kbd>−</kbd> / the arrow keys. Export
writes a TCX file that Strava, intervals.icu and Garmin Connect all accept.

## How it works

Your speed comes from the watts the trainer reports and the **real** gradient of the
route, balanced against gravity, rolling resistance and air drag. The gear never
enters that calculation — it only scales the resistance you feel, which is what
decides how much power a given cadence produces.

That split is deliberate. It keeps recorded watts and speed honest, so an exported
ride is a real ride. It is also why cassette mode needs no separate code path: at a
gear ratio of 1.0 the adjusted-gradient formula reduces to the route gradient exactly.

Climbing, a harder gear raises the gradient sent to the trainer. Descending it lowers
it *towards* zero, restoring something to push against instead of spinning out.

The virtual gears are the same 24 ratios Zwift uses, measured against whatever
chainring and cog your bike is actually in, so the middle of the block feels neutral.

## Things worth knowing

- **The trainer cannot push.** On a steep descent it is already at zero resistance, so
  shifting up is the only way to get anything to press against. The app still moves you
  at proper descent speed either way.
- **The Kickr Core 2 tops out around 16% simulated gradient.** Beyond that — a steep
  climb in a very tall virtual gear — the trainer clips, and the highest gears stop
  feeling different from one another.
- **Click v2 support is best-effort.** The original Click's protocol is well
  documented; newer firmware moved to a different service and button encoding that is
  less firmly established. If shifting misbehaves, the keyboard still works.
- **Settings and routes are per-browser.** No account, no sync. Switching from your Mac
  to a tablet means loading your GPX again.
- **Elevation is smoothed** over 25 m either side of each point, and gradients are
  clamped to 25%. Raw GPS elevation is noisy enough that per-segment gradients are
  meaningless without it.

## Hosting it

Once built, the app is static files — no Node at run time. Publishing it means you can
open a bookmark and ride, with nothing installed.

`.github/workflows/pages.yml` deploys to GitHub Pages on a push to `main`, once Pages
is enabled under **Settings → Pages → Source: GitHub Actions**. On a private repository
that needs a paid GitHub plan. Cloudflare Pages and Netlify both deploy from a private
repo for free and work just as well; the build command is `npm run build` and the
output directory is `dist`.

The build uses relative asset paths, so it works from a subpath or a domain root
without configuration.

## Development

| | |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | production build into `dist/` |
| `npm test` | unit tests |
| `npm run check` | typecheck Svelte and TypeScript |

No runtime dependencies. GPX parsing uses the browser's `DOMParser`, TCX is built with
template strings, the charts are hand-rolled SVG, and the Click's protobuf messages are
read by about twenty lines of varint decoder.

The physics, the route model, the TCX writer and both Bluetooth protocols are pure
functions with no I/O, and are tested as such — which matters because no test here can
reach a radio. The force model is cross-checked against an independently derived
closed-form solution, and the reference values are ones a rider would recognise: 250 W
gives 34.6 km/h on the flat, and coasting a 6% descent settles at 49.6 km/h.

## Credit

The virtual shifting force model follows the approach documented in
[SHIFTR](https://github.com/JuergenLeber/SHIFTR). The Zwift Click BLE protocol was
reverse-engineered by [zwiftplay](https://github.com/ajchellew/zwiftplay) and
[Zwift_click_handling](https://github.com/jat255/Zwift_click_handling).

Not affiliated with Zwift or Wahoo.
