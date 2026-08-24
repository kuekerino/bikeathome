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

**Structured workouts**, reading Zwift `.zwo`: steps, ramps, repeats that stay repeats,
cadence targets, free-ride blocks, skip and back. Absolute watts are first-class
alongside percentages, and the FTP setting exists. What is still missing from the
section below is the **ramp test** — the thing that produces the FTP in the first place
— and lap structure in the export.

**A heart rate ceiling**, which came with it: hold 145 W but never above 137 bpm, and the
target eases off by itself when the rate crosses. Rare in other software, and it turns a
discipline problem into a setting.

One correction to the note that was here: the TCX writer did *not* already have a slot
for heart rate. It does now, along with a fix the free ride mode had quietly introduced —
a ride with no route was writing `0,0` positions, which plots an hour of pedalling off
the coast of Africa.

**Light and dark themes, high contrast, larger text and spoken announcements.** The
contrast work turned up a real defect on the way: control borders were at 1.48:1 where
WCAG asks for 3:1, so buttons and inputs had no visible boundary in either theme.

**A ride history**, saved automatically to IndexedDB and re-exportable long afterwards.
Before it, closing the tab without exporting lost the ride outright.

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

A **built-in ramp test** breaks the circularity, and now that steps and ramps exist it is
the next thing worth building. Its own section is below.

## The ramp test

The smallest workout that is worth having, and the one that makes every relative workout
usable. Everything it needs already exists — absolute watts, ramps, ERG, a ride history —
so what is left is the protocol and the arithmetic.

### The protocol

Warm up, then one-minute steps rising by a fixed increment until the rider cannot hold
the target any longer. Written in **absolute watts**, necessarily: the whole point is
that it cannot be expressed as a share of the number it measures.

Sensible defaults, both adjustable: start at **100 W**, rise **20 W each minute**. A
rider who already has an FTP and wants a retest is better served starting nearer their
level — around 40% of it — so the test does not spend twenty minutes being easy.

### The result

**75% of the best one-minute average power.** The samples are already recorded at 1 Hz,
so this is a rolling 60-second mean over the power series and the maximum of it — a pure
function over `RideSample[]`, testable without a trainer, and worth writing that way
because a wrong FTP quietly poisons every session that follows.

Two details that decide whether the number is right:

- **The window must be a real 60 seconds**, not 60 samples. The recorder throttles to
  roughly 1 Hz but does not promise it, and a dropout would otherwise shorten the window
  and inflate the result.
- **Partial final minutes count.** A rider who fails 40 seconds into a step still did
  those 40 seconds, and the best full minute usually straddles the step boundary anyway.

### Ending it

The rider presses a button. Auto-detection — cadence collapsing for several seconds — is
tempting and would be kinder at the moment of failure, when nobody wants to find a
control, but it needs a threshold that does not fire on a brief soft-pedal. Manual first,
automatic later if it proves annoying.

Worth naming a known objection: a ramp test in ERG can end in the "spiral of death",
where cadence drops, the trainer holds the watts, and the effort collapses in seconds
rather than degrading gracefully. That is how most platforms run it, so it is defensible,
but a fixed-resistance variant would give a cleaner failure and is the fallback if it
feels wrong on real legs.

### What it writes

The measured FTP goes to the rider for confirmation, not straight into settings — a test
abandoned early, or one where the strap died, should not silently redefine every future
workout. Once accepted it lands in `ftpW`, and every `.zwo` written in percentages comes
alive at once.

The test is a ride like any other, so it saves to the history by itself. Storing the
result **with** that ride is what turns a single number into a progression: three ramp
tests over a winter is the most useful thing this app could show.

## Structured intervals — mostly done

What is left: the ramp test, TCX laps, and a text DSL for authoring. The design notes
below are kept because they are what the implementation follows.

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

## Carrying a setup to another computer

Everything is per-browser: settings in local storage, rides in IndexedDB. Ride from a
second machine and it starts blank.

**Syncing cannot work as this is hosted.** GitHub Pages is a static file host — it serves
bytes and has nowhere to put any. Cross-browser state needs something that accepts a
write, which means one of:

- a small backend, and with it an account, a database and somewhere to run it;
- a third-party store the browser can write to directly — a GitHub Gist under the rider's
  own token, or a Dropbox or Drive app folder — which trades the server for a token to
  manage and a service to depend on;
- a peer-to-peer or CRDT arrangement, which is a large amount of machinery for a
  single-user training log.

All three are real dependencies and a privacy question, in exchange for solving a problem
that needs two computers in two places sharing one bike.

**The proportionate answer is a file you carry.** An export button producing a single
JSON document, and an import that reads it back:

- **Setup only** — settings, bindings, appearance, FTP, the heart-rate ceiling. A few
  kilobytes, and the common case: a new laptop that should feel like the old one.
- **Everything** — the same plus the ride history and its tracks. Tens of megabytes once
  a season has accumulated, which is fine for a deliberate one-off.

Two details worth settling before writing it. Import should **merge rides by id rather
than replace**, so carrying last year's log onto a machine that already has this month's
does not destroy one of them. And everything read back has to be **re-validated, not
trusted** — the file has been off the machine and may have been edited, and a bad rider
mass or a NaN in a sample poisons the physics with no obvious cause. `sanitizeSettings`
already exists for exactly that reason and would do half the job.

A format marker and a version number in the file, so a future version can refuse a
newer one cleanly rather than misreading it.

## How the ride felt — RPE and a note

A ride that looks unremarkable in the data can have been terrible, and nothing in the
file says so. Garmin will not carry a rating added afterwards into its export either, so
the observation is lost exactly when it would be most useful: reading the week back.

Two fields when a ride ends — free text, and an **RPE from 1 to 10**. Deliberately asked
*at the end*, while the legs still remember; a rating added three days later is a guess.

**Where it belongs has changed since this was first written.** The ride history now
exists, so RPE is not only a TCX field: it belongs on the stored ride, where it can be
edited later, shown in the list, and carried into every future export of that ride rather
than only the one taken on the day. That also makes it answerable — "every session above
RPE 8 last month" is a question the history can answer and a file cannot.

Two things to settle before building it:

- **`<Notes>` already carries the route name.** The two need an agreed layout rather than
  one overwriting the other — most likely the name, then the note, then `RPE n/10` on its
  own line, so a human reads it naturally and a parser can still find the number.
- **Never block the end of a ride.** The prompt has to be skippable in one press. A rider
  who has just finished hard intervals is in no state to fill in a form, and a dialog
  standing between them and getting off the bike is a dialog that gets dismissed
  unanswered forever.

The pairing with the heart rate ceiling is where this earns its place. A session that
sat comfortably under the ceiling but felt like 9/10 is the clearest signal available
that something else is wrong — sleep, heat, illness — and neither number says it alone.

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
