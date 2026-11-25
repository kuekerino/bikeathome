import { describe, expect, it } from 'vitest'

import { Follower, MAX_COAST_S } from './follow'

const riding = (distance: number, speedMs: number, routeDistance = 1000) => ({
  status: 'riding',
  distance,
  routeDistance,
  speedMs,
})

/** Steps a follower at 60 frames a second from `from` to `to`, seconds. */
function run(f: Follower, from: number, to: number): void {
  for (let t = from + 1 / 60; t <= to + 1e-9; t += 1 / 60) f.step(1 / 60, t)
}

describe('Follower.place', () => {
  it('scales route distance to the drawn road', () => {
    const f = new Follower(1010, false)
    expect(f.place(500, 1000)).toBeCloseTo(505)
    expect(f.place(1000, 1000)).toBeCloseTo(1010)
  })

  it('wraps on a loop and stops at the end of an open road', () => {
    expect(new Follower(1000, true).place(1250, 0)).toBeCloseTo(250)
    expect(new Follower(1000, false).place(1250, 0)).toBe(1000)
    expect(new Follower(1000, false).place(-5, 0)).toBe(0)
  })
})

describe('Follower', () => {
  it('goes straight to the first report', () => {
    const f = new Follower(1000, false)
    f.receive(riding(400, 10), 0)
    expect(f.s).toBe(400)
  })

  it('carries on at the reported speed between reports', () => {
    const f = new Follower(1000, false)
    f.receive(riding(100, 10), 0)
    run(f, 0, 0.25)
    expect(f.s).toBeCloseTo(102.5, 1)
    expect(f.speedMs).toBe(10)
  })

  it('tracks a steady ride without falling behind or running ahead', () => {
    const f = new Follower(1000, false)
    for (let k = 0; k <= 40; k++) {
      f.receive(riding(100 + k * 2.5, 10), k * 0.25)
      run(f, k * 0.25, (k + 1) * 0.25)
    }
    // the engine would now say 100 + 41 * 2.5
    expect(f.s).toBeCloseTo(202.5, 0)
  })

  it('closes a small gap gently instead of jumping', () => {
    const f = new Follower(1000, false)
    f.receive(riding(100, 0), 0)
    f.receive(riding(110, 0), 0.1) // the engine was 10 m further on than shown
    f.step(1 / 60, 0.1 + 1 / 60)
    expect(f.s).toBeGreaterThan(100)
    expect(f.s).toBeLessThan(101)
    run(f, 0.12, 3)
    expect(f.s).toBeCloseTo(110, 1)
  })

  it('jumps when the gap is too big to be drift', () => {
    const f = new Follower(1000, false)
    f.receive(riding(100, 0), 0)
    f.receive(riding(600, 0), 1)
    expect(f.s).toBe(600)
  })

  it('stops when reports stop, instead of riding on alone', () => {
    const f = new Follower(1000, false)
    f.receive(riding(100, 10), 0)
    run(f, 0, 5)
    expect(f.speedMs).toBe(0)
    expect(f.s).toBeLessThanOrEqual(100 + 10 * MAX_COAST_S + 0.5)
  })

  it('stands still while paused', () => {
    const f = new Follower(1000, false)
    f.receive({ status: 'paused', distance: 300, routeDistance: 1000, speedMs: 7 }, 0)
    run(f, 0, 1)
    expect(f.s).toBe(300)
    expect(f.speedMs).toBe(0)
  })

  it('goes round the end of a loop forwards, never back the long way', () => {
    const f = new Follower(1000, true)
    let previous = 0
    for (let k = 0; k <= 12; k++) {
      // ridden 980 m, then on across the start line at 10 m/s, reported 4 times a second
      f.receive(riding(980 + k * 2.5, 10, 0), k * 0.25)
      for (let t = k * 0.25 + 1 / 60; t <= (k + 1) * 0.25 + 1e-9; t += 1 / 60) {
        f.step(1 / 60, t)
        const moved = (((f.s - previous + 500) % 1000) + 1000) % 1000 - 500
        if (k > 0) expect(moved).toBeGreaterThanOrEqual(0)
        previous = f.s
      }
    }
    expect(f.s).toBeCloseTo(12.5, 0) // 980 + 13 × 2.5, round the loop
  })
})
