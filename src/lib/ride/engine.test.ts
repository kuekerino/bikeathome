import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DRIVETRAIN } from '../physics/gears'
import { climbRoute, FakeShifter, FakeTrainer, flatRoute } from '../../testing/fixtures'
import { POWER_LIMITS, RideEngine, type RideSnapshot } from './engine'

/** Drives the engine forward in fixed steps from a fixed start time. */
class Clock {
  private t = 10_000
  constructor(private readonly engine: RideEngine) {
    engine.tick(this.t)
  }

  advance(seconds: number, dt = 0.25): void {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
      this.t += dt * 1000
      this.engine.tick(this.t)
    }
  }
}

function setup(route = flatRoute(5000)) {
  const engine = new RideEngine()
  const trainer = new FakeTrainer()
  engine.attachTrainer(trainer)
  engine.setRoute(route)
  return { engine, trainer }
}

describe('ride lifecycle', () => {
  it('starts idle and becomes ready once a route is loaded', () => {
    const engine = new RideEngine()
    expect(engine.snapshot().status).toBe('idle')
    engine.setRoute(flatRoute(1000))
    expect(engine.snapshot().status).toBe('ready')
    expect(engine.snapshot().routeDistance).toBeCloseTo(1000, 3)
  })

  it('stays put until the ride is started', () => {
    const { engine, trainer } = setup()
    trainer.send({ powerW: 250 })
    new Clock(engine).advance(10)
    expect(engine.snapshot().distance).toBe(0)
    expect(engine.snapshot().elapsedSeconds).toBe(0)
  })

  it('moves the rider along the route once started', () => {
    const { engine, trainer } = setup()
    engine.start()
    trainer.send({ powerW: 250, cadenceRpm: 85 })
    new Clock(engine).advance(60)

    const snapshot = engine.snapshot()
    expect(snapshot.status).toBe('riding')
    expect(snapshot.distance).toBeGreaterThan(400)
    expect(snapshot.speedMs).toBeGreaterThan(8)
    expect(snapshot.elapsedSeconds).toBeCloseTo(60, 1)
    expect(snapshot.powerW).toBe(250)
    expect(snapshot.cadenceRpm).toBe(85)
  })

  it('finishes when the route runs out', () => {
    const { engine, trainer } = setup(flatRoute(500))
    engine.start()
    trainer.send({ powerW: 300 })
    new Clock(engine).advance(300)

    const snapshot = engine.snapshot()
    expect(snapshot.status).toBe('finished')
    expect(snapshot.distance).toBeCloseTo(snapshot.routeDistance, 6)
    expect(snapshot.speedMs).toBe(0)
    expect(trainer.lastGradient).toBe(0)
  })

  it('stops the clock and the rider when paused', () => {
    const { engine, trainer } = setup()
    engine.start()
    trainer.send({ powerW: 250 })
    const clock = new Clock(engine)
    clock.advance(30)

    const atPause = engine.snapshot()
    engine.pause()
    clock.advance(30)

    expect(engine.snapshot().status).toBe('paused')
    expect(engine.snapshot().distance).toBeCloseTo(atPause.distance, 6)
    expect(engine.snapshot().elapsedSeconds).toBeCloseTo(atPause.elapsedSeconds, 6)
  })

  it('resets when restarted after finishing', () => {
    const { engine, trainer } = setup(flatRoute(300))
    engine.start()
    trainer.send({ powerW: 300 })
    new Clock(engine).advance(200)
    expect(engine.snapshot().status).toBe('finished')

    engine.start()
    expect(engine.snapshot().status).toBe('riding')
    expect(engine.snapshot().distance).toBe(0)
    expect(engine.snapshot().elapsedSeconds).toBe(0)
  })
})

describe('auto-pause', () => {
  it('pauses after the rider stops pedalling', () => {
    const { engine, trainer } = setup()
    engine.start()
    trainer.send({ powerW: 250 })
    const clock = new Clock(engine)
    clock.advance(30)

    trainer.send({ powerW: 0 })
    clock.advance(120)

    expect(engine.snapshot().status).toBe('paused')
  })

  it('picks back up when the rider does', () => {
    const { engine, trainer } = setup()
    engine.start()
    trainer.send({ powerW: 0 })
    const clock = new Clock(engine)
    clock.advance(30)
    expect(engine.snapshot().status).toBe('paused')

    trainer.send({ powerW: 200 })
    clock.advance(5)
    expect(engine.snapshot().status).toBe('riding')
  })

  it('does not lift a manual pause just because the rider keeps spinning', () => {
    const { engine, trainer } = setup()
    engine.start()
    trainer.send({ powerW: 250 })
    const clock = new Clock(engine)
    clock.advance(10)

    engine.pause()
    clock.advance(60)

    expect(engine.snapshot().status).toBe('paused')
  })

  it('can be switched off', () => {
    const { engine, trainer } = setup()
    engine.autoPauseSeconds = 0
    engine.start()
    trainer.send({ powerW: 0 })
    new Clock(engine).advance(120)
    expect(engine.snapshot().status).toBe('riding')
  })
})

describe('gearing', () => {
  let engine: RideEngine
  let trainer: FakeTrainer

  beforeEach(() => {
    ;({ engine, trainer } = setup(climbRoute(5000, 5)))
  })

  // The invariant the whole design rests on. Someone may one day feel that
  // gearing "should" affect speed; it must not, or recorded rides become
  // fiction.
  it('does not let the gear change how far the same power carries the rider', () => {
    const distances = [1, 12, 24].map((gear) => {
      const fresh = setup(climbRoute(5000, 5))
      fresh.engine.setGear(gear)
      fresh.engine.start()
      fresh.trainer.send({ powerW: 220 })
      new Clock(fresh.engine).advance(120)
      return fresh.engine.snapshot().distance
    })

    expect(distances[1]!).toBeCloseTo(distances[0]!, 6)
    expect(distances[2]!).toBeCloseTo(distances[0]!, 6)
  })

  it('does change what the trainer is asked for', () => {
    engine.start()
    trainer.send({ powerW: 220 })
    new Clock(engine).advance(30)

    engine.setGear(1)
    const easy = engine.snapshot().trainerGradient
    engine.setGear(24)
    const hard = engine.snapshot().trainerGradient

    expect(easy).toBeLessThan(5)
    expect(hard).toBeGreaterThan(5)
  })

  it('sends the new resistance immediately on a shift', () => {
    engine.start()
    trainer.send({ powerW: 220 })
    new Clock(engine).advance(10)

    const before = trainer.gradients.length
    engine.setGear(20)
    expect(trainer.gradients.length).toBe(before + 1)
    expect(trainer.lastGradient).toBeCloseTo(engine.snapshot().trainerGradient, 9)
  })

  it('asks for the plain route gradient in cassette mode, in any gear', () => {
    engine.configure({ drivetrain: { ...DEFAULT_DRIVETRAIN, mode: 'cassette' } })
    engine.start()
    trainer.send({ powerW: 220 })
    new Clock(engine).advance(30)

    for (const gear of [1, 12, 24]) {
      engine.setGear(gear)
      const snapshot = engine.snapshot()
      expect(snapshot.trainerGradient).toBeCloseTo(snapshot.routeGradient, 9)
    }
  })

  it('clamps shifting at both ends of the block', () => {
    engine.setGear(1)
    engine.shift(-1)
    expect(engine.snapshot().gear).toBe(1)

    engine.setGear(24)
    engine.shift(1)
    expect(engine.snapshot().gear).toBe(24)
  })
})

describe('shifter wiring', () => {
  it('shifts on a button press', () => {
    const { engine } = setup()
    const shifter = new FakeShifter()
    engine.addShifter(shifter)

    const start = engine.snapshot().gear
    shifter.press(1)
    expect(engine.snapshot().gear).toBe(start + 1)
    shifter.press(-1)
    shifter.press(-1)
    expect(engine.snapshot().gear).toBe(start - 1)
  })

  it('stops listening to a detached shifter', () => {
    const { engine } = setup()
    const shifter = new FakeShifter()
    const detach = engine.addShifter(shifter)
    detach()

    const start = engine.snapshot().gear
    shifter.press(1)
    expect(engine.snapshot().gear).toBe(start)
  })

  // A paired Click must not cost the rider their keyboard fallback.
  it('listens to several shifters at once', () => {
    const { engine } = setup()
    const click = new FakeShifter()
    const keyboard = new FakeShifter()
    engine.addShifter(click)
    engine.addShifter(keyboard)

    const start = engine.snapshot().gear
    click.press(1)
    keyboard.press(1)
    expect(engine.snapshot().gear).toBe(start + 2)
  })
})

describe('elevation tracking', () => {
  it('accumulates the climbing actually done', () => {
    const { engine, trainer } = setup(climbRoute(2000, 5))
    engine.start()
    trainer.send({ powerW: 250 })
    new Clock(engine).advance(200)

    const snapshot = engine.snapshot()
    // 5% of the distance covered, give or take the profile smoothing.
    expect(snapshot.climbed).toBeGreaterThan(0)
    expect(snapshot.climbed).toBeCloseTo(snapshot.distance * 0.05, 0)
  })

  it('reports the route summary alongside progress', () => {
    const { engine } = setup(climbRoute(2000, 5))
    const snapshot = engine.snapshot()
    expect(snapshot.routeName).toBe('Test route')
    expect(snapshot.routeAscent).toBeCloseTo(100, 0)
  })
})

describe('subscription', () => {
  it('pushes a snapshot immediately and on every change', () => {
    const { engine, trainer } = setup()
    const seen: RideSnapshot[] = []
    const stop = engine.subscribe((snapshot) => seen.push(snapshot))

    expect(seen).toHaveLength(1)
    expect(seen[0]!.status).toBe('ready')

    engine.start()
    trainer.send({ powerW: 200 })
    new Clock(engine).advance(1)
    expect(seen.length).toBeGreaterThan(2)
    expect(seen[seen.length - 1]!.distance).toBeGreaterThan(0)

    const count = seen.length
    stop()
    new Clock(engine).advance(1)
    expect(seen).toHaveLength(count)
  })
})

describe('manual watt mode', () => {
  function riding() {
    const engine = new RideEngine({ autoPauseSeconds: 0 })
    const trainer = new FakeTrainer()
    engine.attachTrainer(trainer)
    engine.setRoute(climbRoute(2000, 5))
    engine.start()
    engine.tick(0)
    engine.tick(1000)
    return { engine, trainer }
  }

  it('sends watts instead of a gradient once engaged', () => {
    const { engine, trainer } = riding()
    const gradientsBefore = trainer.gradients.length

    engine.setTargetPower(200)
    expect(trainer.lastPowerTarget).toBe(200)

    engine.tick(2000)
    // The trainer cannot be in both modes; the slope stops going out.
    expect(trainer.gradients.length).toBe(gradientsBefore)
  })

  it('hands the gradient back when switched off', () => {
    const { engine, trainer } = riding()
    engine.setTargetPower(200)
    engine.setTargetPower(null)

    expect(trainer.lastPowerTarget).toBeNull()
    engine.tick(2000)
    expect(trainer.lastGradient).toBeCloseTo(engine.snapshot().trainerGradient, 6)
  })

  it('does not repeat the mode change on every tick', () => {
    const { engine, trainer } = riding()
    const before = trainer.powerTargets.length
    engine.tick(2000)
    engine.tick(3000)
    expect(trainer.powerTargets.length).toBe(before)
  })

  it('steps from the current effort when nothing is set yet', () => {
    const { engine, trainer } = riding()
    trainer.send({ powerW: 187 })
    engine.nudgeTargetPower(10)
    expect(engine.snapshot().targetPowerW).toBe(197)
  })

  it('steps from the target once there is one, not from what the rider is doing', () => {
    const { engine, trainer } = riding()
    engine.setTargetPower(200)
    trainer.send({ powerW: 150 })
    engine.nudgeTargetPower(50)
    expect(engine.snapshot().targetPowerW).toBe(250)
  })

  it('refuses a target that no flywheel should be given', () => {
    const { engine } = riding()
    engine.setTargetPower(-40)
    expect(engine.snapshot().targetPowerW).toBe(0)
    engine.setTargetPower(99_999)
    expect(engine.snapshot().targetPowerW).toBe(POWER_LIMITS.max)
  })

  it('still moves the rider on the route gradient, not the target', () => {
    // ERG changes what the legs feel; where the rider ends up still comes from
    // the watts reported and the real slope.
    const { engine, trainer } = riding()
    engine.setTargetPower(250)
    trainer.send({ powerW: 250 })
    engine.tick(2000)
    engine.tick(3000)
    expect(engine.snapshot().distance).toBeGreaterThan(0)
    expect(engine.snapshot().routeGradient).toBeCloseTo(5, 1)
  })
})

describe('bound controls', () => {
  function riding() {
    const engine = new RideEngine({ autoPauseSeconds: 0 })
    const trainer = new FakeTrainer()
    engine.attachTrainer(trainer)
    engine.setRoute(flatRoute(2000))
    engine.start()
    engine.tick(0)
    return { engine, trainer }
  }

  it('runs whatever the action says', () => {
    const { engine } = riding()
    const gear = engine.snapshot().gear
    engine.perform('shiftUp')
    expect(engine.snapshot().gear).toBe(gear + 1)
    engine.perform('powerUp50')
    expect(engine.snapshot().targetPowerW).toBeGreaterThan(0)
  })

  it('does nothing for the action that means nothing', () => {
    const { engine } = riding()
    const before = engine.snapshot()
    engine.perform('nothing')
    expect(engine.snapshot().gear).toBe(before.gear)
    expect(engine.snapshot().targetPowerW).toBeNull()
  })

  it('sends a shifter button through the bindings, not straight to the gears', () => {
    const engine = new RideEngine({ autoPauseSeconds: 0 })
    engine.setRoute(flatRoute(2000))
    engine.bindings = { keys: {}, click: { up: 'powerUp10', down: 'shiftDown' } }

    const shifter = new FakeShifter()
    engine.addShifter(shifter)

    const gear = engine.snapshot().gear
    shifter.press(1)
    // The "up" button was bound to watts, so the gear must not have moved.
    expect(engine.snapshot().gear).toBe(gear)
    expect(engine.snapshot().targetPowerW).toBe(10)

    shifter.press(-1)
    expect(engine.snapshot().gear).toBe(gear - 1)
  })

  it('toggles pause both ways', () => {
    const { engine } = riding()
    engine.perform('togglePause')
    expect(engine.snapshot().status).toBe('paused')
    engine.perform('togglePause')
    expect(engine.snapshot().status).toBe('riding')
  })
})

describe('free ride', () => {
  function free() {
    const engine = new RideEngine({ autoPauseSeconds: 0 })
    const trainer = new FakeTrainer()
    engine.attachTrainer(trainer)
    engine.setFreeRide()
    return { engine, trainer }
  }

  it('is rideable with no route loaded', () => {
    const { engine } = free()
    expect(engine.snapshot().mode).toBe('free')
    expect(engine.snapshot().status).toBe('ready')
    engine.start()
    expect(engine.snapshot().status).toBe('riding')
  })

  it('covers ground at the speed the watts earn on the flat', () => {
    const { engine, trainer } = free()
    engine.start()
    engine.tick(0)
    trainer.send({ powerW: 250 })
    // At the app's own tick rate. Anything slower is clamped by the
    // integrator's maximum step, so the clock would outrun the rider.
    for (let t = 250; t <= 60_000; t += 250) engine.tick(t)

    // 250 W on the flat settles near 9.6 m/s; over a minute, allowing for the
    // acceleration from a standstill, that is well over 400 m.
    expect(engine.snapshot().speedMs).toBeGreaterThan(9)
    expect(engine.snapshot().distance).toBeGreaterThan(400)
  })

  it('never finishes, because there is nothing to reach', () => {
    const { engine, trainer } = free()
    engine.start()
    engine.tick(0)
    trainer.send({ powerW: 300 })
    for (let t = 250; t <= 600_000; t += 250) engine.tick(t)

    expect(engine.snapshot().status).toBe('riding')
    expect(engine.snapshot().routeDistance).toBe(0)
  })

  it('reports no gradient and no climbing', () => {
    const { engine, trainer } = free()
    engine.start()
    engine.tick(0)
    trainer.send({ powerW: 200 })
    engine.tick(1000)

    expect(engine.snapshot().routeGradient).toBe(0)
    expect(engine.snapshot().climbed).toBe(0)
    expect(engine.snapshot().routeAscent).toBe(0)
  })

  it('lets the gear scale what the legs feel, with the power hold off', () => {
    // Flat road, but a taller gear is still harder — the trainer is told so.
    const { engine } = free()
    engine.start()
    engine.tick(0)
    engine.setGear(1)
    const easy = engine.snapshot().trainerGradient
    engine.setGear(24)
    expect(engine.snapshot().trainerGradient).toBeGreaterThan(easy)
  })

  it('goes back to a route without carrying the free ride over', () => {
    const { engine } = free()
    engine.start()
    engine.setRoute(climbRoute(1000, 5))

    expect(engine.snapshot().mode).toBe('route')
    expect(engine.snapshot().distance).toBe(0)
    expect(engine.snapshot().routeDistance).toBeGreaterThan(0)
  })
})

describe('the gear while holding a power', () => {
  /**
   * Holding a power means holding it. Shifting moves cadence, not effort — so
   * a gear change must not reach the trainer at all, or the two instructions
   * would be fighting over the same flywheel.
   */
  function holding(watts: number) {
    const engine = new RideEngine({ autoPauseSeconds: 0 })
    const trainer = new FakeTrainer()
    engine.attachTrainer(trainer)
    engine.setRoute(climbRoute(2000, 6))
    engine.start()
    engine.tick(0)
    engine.setTargetPower(watts)
    return { engine, trainer }
  }

  it('sends nothing to the trainer when the rider shifts', () => {
    const { engine, trainer } = holding(160)
    const gradients = trainer.gradients.length
    const targets = trainer.powerTargets.length

    engine.setGear(1)
    engine.setGear(24)

    expect(trainer.gradients.length).toBe(gradients)
    // Still 160: the target did not move because the gear did.
    expect(trainer.lastPowerTarget).toBe(160)
    expect(trainer.powerTargets.length).toBeGreaterThanOrEqual(targets)
  })

  it('reports no trainer gradient, rather than a gradient nobody is sent', () => {
    const { engine } = holding(160)
    engine.setGear(24)
    expect(engine.snapshot().trainerGradient).toBe(0)
  })

  it('gives the gear its meaning back when the hold comes off', () => {
    const { engine } = holding(160)
    engine.setGear(24)
    engine.setTargetPower(null)
    expect(engine.snapshot().trainerGradient).toBeGreaterThan(0)
  })
})
