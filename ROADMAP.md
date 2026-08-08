# Roadmap

Not promises. A record of what has been thought through, so the thinking does not have
to happen twice.

## Done since this was written

**Heart rate**, which was filed under "smaller things" and should not have been. The
argument that moved it: this app can hold a wattage, but the same wattage costs a
different heart rate on a hot day, on tired legs or after bad sleep — so a session
prescribed in watts drifts out of its zone through no fault of the rider. If the problem
is zone discipline, watts alone cannot fix it. Standard BLE service, no protocol
archaeology, and it now reaches the dashboard and the export.

**A heart rate ceiling**, which came with it: hold 145 W but never above 137 bpm, and the
target eases off by itself when the rate crosses. Rare in other software, and it turns a
discipline problem into a setting.

One correction to the note that was here: the TCX writer did *not* already have a slot
for heart rate. It does now, along with a fix the free ride mode had quietly introduced —
a ride with no route was writing `0,0` positions, which plots an hour of pedalling off
the coast of Africa.

## The FTP circularity

Worth stating plainly because it dictates the order of everything below: **an FTP test
cannot be expressed as a percentage of FTP.** Any workout format that only carries
relative intensities cannot describe the test that produces the number it depends on.

Two consequences:

- Steps must carry **absolute watts** as a first-class option, not as an afterthought.
  Internally that means a discriminated union — `{ watts }` or `{ fractionOfFtp }` —
  rather than one number and a convention.
- The `.zwo` convention of reading values above 10 as watts and below 10 as a fraction is
  worth honouring, but only at *import*, where it belongs. Baking a magic threshold into
  the internal model would spread it everywhere.

A **built-in ramp test** breaks the circularity: a fixed watt ramp, and 75% of the best
minute as the result. It also happens to be the smallest useful workout, so it is a good
first thing to build once steps and ramps exist. It should write the FTP it measures
straight into settings, so every relative workout comes alive at the end of it.

## Structured intervals

Manual watt mode is the machinery an interval session needs — something has to hold a
number, and now something does. What is missing is anything that changes the number on a
schedule.

### The shape

A workout is a list of steps, each holding a power for a duration. Nesting matters more
than it first appears: `6 × (3 min @ 300 W, 3 min @ 150 W)` is how people actually think
about a session, and flattening it at authoring time makes the display lie — a rider
wants to see "interval 4 of 6", not "step 8 of 13".

So: a tree at rest, flattened for execution, with each flattened step keeping a
reference back to the repeat it came from.

### Absolute or relative

Both, for the reason above. Percentages are how published sessions are written and how a
session stays useful as fitness changes; absolute watts are how a test protocol is
written and how anything gets measured in the first place. Watts stay the storage format;
percentages resolve against the FTP setting on load.

### Ramps

A step that goes from 200 W to 300 W over five minutes is a different thing from a step
that holds 250 W, and warm-ups are almost always ramps. Cheap to add if steps carry a
start and an end power from the beginning, and awkward to retrofit if they do not, so it
should go in from the start even if the editor exposes it later.

### Which format

Three candidates, in rough order of preference:

- **Zwift `.zwo`** — XML, widely published, and there are thousands of existing workouts
  to import. Warmup/SteadyState/IntervalsT/Ramp/Cooldown covers everything above.
  Parsing it is the same shape of job as the GPX parser already here: `DOMParser`, no
  dependency.
- **A plain-text DSL** — `3min @ 300W`, one step per line, `6x` for repeats. Faster to
  author, trivial to diff, and it can be a textarea rather than a UI. Nothing else reads
  it, which is the whole objection.
- **`.erg` / `.mrc`** — simple and old, but they are flat time/power point lists with no
  notion of a repeat, so the structure is lost on import.

Doing `.zwo` first and the text DSL second looks right: import what exists, then make
authoring pleasant.

### Interaction with the route

Two modes that must not be confused:

- **Workout drives resistance, route drives distance.** The trainer holds the workout's
  power; speed still comes from the reported watts and the real gradient, exactly as
  everything else here does. The rider covers whatever distance that effort earns them.
  This is the mode that fits what is already built.
- **Route drives resistance, workout is a target to chase.** No ERG at all — the gradient
  is simulated and the workout is just a number on screen to aim at.

The first should be the default. The second is a display feature and costs almost
nothing once the first exists.

### Cadence targets

`IntervalsT` in `.zwo` carries a `Cadence` attribute, and it earns its place: holding a
power in ERG invites grinding, and the same watts at a low cadence load the legs far
more. A target range shown next to the live cadence — 85 to 95 for endurance work — costs
almost nothing once steps exist, and changes what the session actually trains.

### What it needs from the UI

A step list with the current step highlighted, time remaining in the step, and next
step's target. Skip and extend controls — sessions get interrupted, and being unable to
skip a step is the fastest way to make someone close the tab. Both are actions, so they
belong in the bindings table and get remapped like everything else.

The recorded TCX should keep the workout's laps, since intervals are what lap structure
is for.

## How the ride felt

A ride that looks unremarkable in the data can have been terrible, and the file does not
say so. Garmin will not carry a rating added after the fact into its export either, so
the observation is lost exactly when it would be most useful — reading the week back.

Two fields on finishing, free text and an RPE from 1 to 10, written into the TCX
`<Notes>`. Small, self-contained, and it makes the file tell the whole story instead of
half of it. There is a question worth settling first: `<Notes>` is already used for the
route name, so the two need a format rather than one overwriting the other.

## Customisable gear ratios

The virtual block is currently the 24 ratios Zwift uses. Reasonable defaults, not
universal ones: a rider who wants 12 wide-spaced gears, or a block centred somewhere
else, cannot have it.

The change is small — the ratio table is already data — but it needs care over what
happens to the current gear when the block changes underneath a moving rider. Holding
the *ratio* rather than the *index* across a change is almost certainly right.

## Smaller things

- **Offline.** A service worker would make this a PWA and remove the dependency on the
  wifi holding up in the garage. Worth doing on any hosted deployment.
- **Heart rate zones.** With a strap connected and thresholds known, the dashboard could
  name the zone rather than only the number. Cheap once the thresholds are a setting,
  which the FTP work will need anyway.
- **A screenshot in the README.** Has to be taken on a real machine: a headless browser
  cannot pair Bluetooth and so renders a misleading banner.
