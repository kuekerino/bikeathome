# bikeathome

Ride your own GPX routes on a smart trainer, in the browser.

Built for a **Wahoo Kickr Core 2 with a Zwift Cog** — a single-sprocket setup where
physical shifting is impossible, so the app does the shifting in software and sends
the resulting resistance to the trainer over standard Bluetooth FTMS. A **Zwift Click**
on the handlebars acts as the shifter. Riders with a normal cassette are supported too:
switch the drivetrain setting to `cassette` and the app sends the true route gradient
while you shift with your derailleur.

Nothing here is Wahoo-specific beyond the defaults. FTMS is an open standard, so most
modern smart trainers should work.

## Status

Early construction. Current state: project scaffold only.

| Phase | |
| --- | --- |
| 1. Scaffold | done |
| 2. GPX parser and route model | |
| 3. Physics and virtual shifting | |
| 4. Ride engine and demo mode | |
| 5. Dashboard UI | |
| 6. TCX export | |
| 7. Bluetooth trainer and Zwift Click | |
| 8. Hardening and deploy | |

## Running it

Requires Node 20+.

```sh
npm install
npm run dev      # http://localhost:5173
```

| | |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | production build into `dist/` |
| `npm test` | unit tests |
| `npm run check` | typecheck Svelte and TypeScript |

Bluetooth needs **Chrome or Edge** — Safari and Firefox do not implement Web Bluetooth.
It works on `localhost` without HTTPS; any other host must be served over HTTPS.

Once deployed as a static site there is nothing to install: open the URL in Chrome and ride.

## How it works

Your virtual speed comes from the power the trainer reports and the *real* gradient of
the route, balanced against gravity, rolling resistance and air drag. The gear never
enters that calculation — it only scales the resistance you feel, which is what decides
how much power you produce at a given cadence. That split keeps recorded watts and speed
honest, and it is why cassette mode needs no separate code path: at a gear ratio of 1.0
the adjusted-grade formula reduces to the route gradient exactly.

## Credit

The virtual shifting force model follows the approach documented in
[SHIFTR](https://github.com/JuergenLeber/SHIFTR). The Zwift Click BLE protocol was
reverse-engineered by [zwiftplay](https://github.com/ajchellew/zwiftplay) and
[Zwift_click_handling](https://github.com/jat255/Zwift_click_handling).

Not affiliated with Zwift or Wahoo.
