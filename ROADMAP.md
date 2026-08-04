# Roadmap

Not promises. A record of what has been thought through, so the thinking does not have
to happen twice.

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

Steps should be expressible as a percentage of FTP as well as in watts, because that is
how published sessions are written and how a session stays useful as fitness changes.
That means an FTP setting, which the app does not have yet, and a rule for what happens
when it is missing. Watts stay the storage format; percentages resolve on load.

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

### What it needs from the UI

A step list with the current step highlighted, time remaining in the step, and next
step's target. Skip and extend controls — sessions get interrupted, and being unable to
skip a step is the fastest way to make someone close the tab. Both are actions, so they
belong in the bindings table and get remapped like everything else.

The recorded TCX should keep the workout's laps, since intervals are what lap structure
is for.

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
- **Heart rate.** A second BLE device, standard service, no protocol archaeology needed.
  It belongs in the TCX export, which already has a slot for it.
- **A screenshot in the README.** Has to be taken on a real machine: a headless browser
  cannot pair Bluetooth and so renders a misleading banner.
