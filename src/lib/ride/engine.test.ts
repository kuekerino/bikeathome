import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DRIVETRAIN } from '../physics/gears'
import { climbRoute, FakeShifter, FakeTrainer, flatRoute } from '../../testing/fixtures'
import { RideEngine, type RideSnapshot } from './engine'

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
