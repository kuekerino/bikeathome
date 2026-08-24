# bikeathome

Ride your own GPX routes on a smart trainer, in the browser.

**[Open it →](https://kuekerino.github.io/bikeathome/)** — Chrome or Edge, desktop or Android
to pair a trainer, any browser for the demo ride.

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

## Two ways to ride

**A route.** Load a GPX, or try the demo climb, and the trainer follows the real
gradient while your speed follows the road.

**Just pedal.** No route at all: set a wattage and hold it, the way an exercise bike
works. Flat and endless, so there is no gradient, no elevation and nothing to finish —
it still records, and still exports as a ride. Pick it from **Just pedal** on the
opening screen. Resistance follows the flat road and the gears work as they always do;
tick **Hold a set power** if you would rather pedal against a fixed wattage.

Everything below applies to both.

## Riding it for real

Requires **Chrome or Edge** — on Windows, macOS, Linux or Android. Safari and Firefox do
not implement Web Bluetooth, and no browser on iPhone or iPad can, because iOS makes them
all Safari underneath. Installing Chrome on an iPad will not help. It works on
`localhost` without HTTPS; any other host must be served over HTTPS.

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

### Holding a set power

Tick **Hold a set power** — on a route or on a free ride — and the trainer holds that
wattage, whatever gear you are in and whatever cadence you turn. ERG, in the usual
jargon. Three step buttons either side of the number move it by 1, 10 or 50 W, because
setting an effort mid-interval is not a job for a text field.

**Shifting stops changing your effort while this is on.** That is what holding a power
means: pick a taller gear and the trainer takes resistance away to keep you at the
number. Gears become a way to choose a comfortable cadence, nothing more. The gear
readout dims to say so. Turn the hold off and the gear decides everything again.

Speed is unaffected either way: it still comes from the watts the trainer reports and
the gradient, so a session in watt mode is still a ride and still exports as one.

### Structured workouts

Load a Zwift **`.zwo`** and it drives the target power: warmups, ramps, intervals with
their repeats intact, cooldowns, cadence targets and free-ride blocks. The panel shows
the current step, what is left of it, and what comes next — and says "interval 4 of 6"
rather than "step 8 of 13", because a repeat stays a repeat rather than being flattened
on import.

**Skip step** and **Back a step** are there because sessions get interrupted. Both are
actions, so they can be put on a key or a shifter button under **Controls**.

Two things worth knowing:

- **A `.zwo` written in percentages needs an FTP**, set in the same panel. Nothing is
  guessed — riding 70% of a number nobody chose is worse than not starting.
- **Absolute watts work too.** A value above 10 is read as watts and below it as a
  fraction of FTP, which is the usual convention. It matters because **an FTP test
  cannot be written as a percentage of FTP**, so a test protocol has to be expressible
  in plain watts.

The workout says how hard; the route still says how far. Speed comes from the watts you
actually produce against the real gradient, exactly as it does on any other ride.

### Training to heart rate

Pair a strap and the rate shows on the dashboard — with a heart that beats in time with
it — and goes into the export. With **Hold a
set power** on you can also set a **ceiling**: hold 145 W but never above 137 bpm, and
the target eases off by itself when your heart disagrees — then comes back once you are
clear of it.

This exists because the same wattage costs a different heart rate on a hot day, on tired
legs or after bad sleep, so an endurance ride prescribed in watts quietly stops being an
endurance ride. The ceiling comes down faster than it goes back up, holds inside a small
deadband rather than hunting, and never pushes above what you asked for. Untick **Ease
the watts off automatically** to get the warning without the intervention.

### Remapping the controls

Under **Controls**, every key and every shifter button can be pointed at any action —
shifting, the watt steps, pausing. Add a key by pressing it rather than typing its name.

Shifter buttons work the same way, but they have to introduce themselves first: press
one and it appears in the list under its own id, and you say what it does. Nothing is
guessed. A button matching a documented Zwift layout arrives already shifting; anything
else does nothing until you bind it, because guessing wrong means shifting the wrong
way at the wrong moment.

### Appearance and accessibility

Under **Appearance and accessibility**: **light, dark or follow the system**, a **high
contrast** switch that applies on top of either, and **text size** up to 150%. The theme
is applied before the first paint, so choosing light does not mean a dark flash on every
load.

Colours were picked against measured contrast rather than by eye — every text pair clears
4.5:1 and control borders clear 3:1, in all four combinations. The layout was checked for
horizontal scrolling down to 320 pixels wide at 150% text, and connection state is shown
by shape as well as colour, since green against grey is no indicator at all to a rider who
cannot separate the two.

If your operating system asks for more contrast, the app honours that without you finding
the switch, and it redraws its borders in the system palette under Windows High Contrast.

**Announce what changes** reads out new intervals, the heart rate ceiling being crossed,
and the ride starting or finishing. Deliberately *not* the live numbers: a dashboard
where the power changes four times a second is unusable read aloud. For those, bind
**Read the numbers aloud** to a key or a shifter button under **Controls** and hear them
when you ask.

### Past rides

Rides are saved as you go — every thirty seconds and again when you close the tab — so a
browser crash or a shut laptop costs you nothing. **Past rides** lists them newest first
with time, distance, average power and average heart rate. Each one can be exported to
TCX long after the fact, deleted, or, if it followed a workout, ridden again.

Stored in the browser with IndexedDB, not cookies: a cookie holds about 4 KB and is sent
to the server on every request, and a forty-minute ride is several hundred kilobytes.
Local storage would fill after a handful of rides and take the settings with it. The app
also asks the browser to keep the data rather than treat it as disposable cache.

It is still per-browser and still never uploaded. Export anything you would mind losing.

### Pairing once instead of every time

Enable `chrome://flags/#enable-web-bluetooth-new-permissions-backend` and devices you
have paired come back on their own when you reopen the page — no chooser, no clicking.
Without the flag Chrome forgets the permission when the tab closes, and there is no way
around that from a web page.

It is best-effort either way. A trainer that is asleep, out of range or held by another
app just stays disconnected, silently, and the pairing buttons work as they always did.

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
- **Settings and routes are per-browser.** No account, no sync. Switching from a laptop
  to a tablet means loading your GPX again.
- **Elevation is smoothed** over 25 m either side of each point, and gradients are
  clamped to 25%. Raw GPS elevation is noisy enough that per-segment gradients are
  meaningless without it.

## Self-hosting it

Once built, the app is 140 KB of static files — no Node at run time, no backend, no
database, nothing kept on the server. The browser does all the work, including the
Bluetooth. Hosting it just means you can open a bookmark and ride, with nothing
installed on the riding machine.

```sh
SITE_ADDRESS=192.168.1.50:8443 docker compose up -d --build
```

Set `SITE_ADDRESS` to the address you will actually type into the browser. The
certificate is issued for exactly that name, so `192.168.1.50:8443` and
`bikeathome.lan:8443` are not interchangeable.

### Trust the certificate — this step is not optional

**Web Bluetooth only works in a secure context.** `localhost` counts; a bare LAN address
over plain HTTP does not. Serve this over `http://192.168.1.50:8443` and the app will
load, look completely healthy, and simply never offer to pair your trainer. The failure
is a missing button, not an error message.

Caddy issues a certificate from its own local certificate authority. Trust that
authority once on each machine you ride from:

```sh
docker compose cp bikeathome:/data/caddy/pki/authorities/local/root.crt .
sudo security add-trusted-cert -d -k /Library/Keychains/System.keychain root.crt   # macOS
```

The `caddy-data` volume keeps that authority across restarts. Remove the volume and a
fresh root is minted, and every machine has to be told to trust it again.

Two ways to skip all of this:

- **Run the container on the machine you ride at.** `https://localhost:8443` needs no
  trust step at all, and even plain `http://localhost` would be a secure context. The
  TLS work only buys the ability to ride from a different machine than the host.
- **Use Tailscale.** `tailscale serve` issues a genuinely trusted certificate with no
  local CA to juggle.

### Hosted alternatives

The build is static files with relative asset paths, so it works from any host, at a
domain root or a subpath, with no configuration.

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`. Turn
Pages on first under **Settings → Pages → Source: GitHub Actions** — the workflow cannot
do it for you, because creating a Pages site needs repository-admin rights that
`GITHUB_TOKEN` does not have. Until you do, the deploy fails on a 404 with a green
build above it. Cloudflare Pages and Netlify work just as well; the build command is
`npm run build` and the output directory is `dist`.

## What is not here yet

Structured intervals, customisable gear ratios and a few smaller things are sketched in
[ROADMAP.md](ROADMAP.md), including which workout format is likely to win and why.

## Licence

MIT — see [LICENSE](LICENSE). Use it, change it, ship it. No warranty, and no
obligation on either side.

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

No source code here is copied from another project; what was used is factual. FTMS is
an open Bluetooth SIG standard. The Zwift Click's UUIDs, `RideOn` handshake and message
encoding come from the reverse-engineering published by
[zwiftplay](https://github.com/ajchellew/zwiftplay) (no declared licence) and
[Zwift_click_handling](https://github.com/jat255/Zwift_click_handling) (MIT). The
"track resistance" force model follows the approach documented in
[SHIFTR](https://github.com/JuergenLeber/SHIFTR) (GPL-3.0); the formulas here were
derived and written independently from that description.

Not affiliated with Zwift or Wahoo.
