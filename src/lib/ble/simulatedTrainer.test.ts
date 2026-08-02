import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIMULATION,
  simulateRider,
  SimulatedTrainer,
  WHEEL_CIRCUMFERENCE_M,
} from './simulatedTrainer'
import type { TrainerData } from './types'

const { targetPowerW, minCadenceRpm, maxCadenceRpm, drivetrain } = DEFAULT_SIMULATION

describe('simulateRider', () => {
  it('holds the target power when the gear suits the gradient', () => {
    const flat = simulateRider(0, DEFAULT_SIMULATION)
    expect(flat.powerW).toBeCloseTo(targetPowerW, 0)
    expect(flat.cadenceRpm).toBeGreaterThan(minCadenceRpm)
    expect(flat.cadenceRpm).toBeLessThan(maxCadenceRpm)
  })

  // The two interesting cases: the gear being wrong for the gradient is
  // exactly what virtual shifting exists to fix.
  it('grinds at the bottom of the range when the gear is too tall', () => {
    const steep = simulateRider(8, DEFAULT_SIMULATION)
    expect(steep.cadenceRpm).toBe(minCadenceRpm)
    expect(steep.powerW).toBeGreaterThan(targetPowerW)
  })

  it('spins out with nothing to push against on a descent', () => {
    const descent = simulateRider(-8, DEFAULT_SIMULATION)
    expect(descent.cadenceRpm).toBe(maxCadenceRpm)
    expect(descent.powerW).toBe(0)
  })

  it('keeps cadence within human limits at any gradient', () => {
    for (let gradient = -20; gradient <= 20; gradient += 0.5) {
      const { cadenceRpm, powerW } = simulateRider(gradient, DEFAULT_SIMULATION)
      expect(cadenceRpm).toBeGreaterThanOrEqual(minCadenceRpm)
      expect(cadenceRpm).toBeLessThanOrEqual(maxCadenceRpm)
      expect(powerW).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(powerW)).toBe(true)
    }
  })

  it('needs a lower cadence as the road tilts up', () => {
    let previous = Number.POSITIVE_INFINITY
    for (const gradient of [-2, 0, 1, 2, 3]) {
      const { cadenceRpm } = simulateRider(gradient, DEFAULT_SIMULATION)
      expect(cadenceRpm).toBeLessThanOrEqual(previous)
      previous = cadenceRpm
    }
  })

  it('ties wheel speed to cadence through the fitted drivetrain', () => {
    const { cadenceRpm, speedKmh } = simulateRider(0, DEFAULT_SIMULATION)
    const ratio = drivetrain.chainringTeeth / drivetrain.cogTeeth
    const expected = (cadenceRpm / 60) * ratio * WHEEL_CIRCUMFERENCE_M * 3.6
    expect(speedKmh).toBeCloseTo(expected, 6)
  })

  it('works harder for a stronger target', () => {
    const easy = simulateRider(0, { ...DEFAULT_SIMULATION, targetPowerW: 120 })
    const hard = simulateRider(0, { ...DEFAULT_SIMULATION, targetPowerW: 240 })
    expect(hard.powerW).toBeGreaterThan(easy.powerW)
    expect(hard.cadenceRpm).toBeGreaterThan(easy.cadenceRpm)
  })
})

describe('SimulatedTrainer', () => {
  afterEach(() => vi.useRealTimers())

  it('reports data once connected and stops once disconnected', async () => {
    vi.useFakeTimers()
    const trainer = new SimulatedTrainer()
    const seen: TrainerData[] = []
    trainer.ondata = (data) => seen.push(data)

    expect(trainer.state).toBe('disconnected')
    await trainer.connect()
    expect(trainer.state).toBe('connected')

    vi.advanceTimersByTime(2000)
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(seen[0]!.powerW).toBeGreaterThan(0)

    await trainer.disconnect()
    const count = seen.length
    vi.advanceTimersByTime(2000)
    expect(seen).toHaveLength(count)
    expect(trainer.state).toBe('disconnected')
  })

  it('responds to the resistance it is asked for', async () => {
    vi.useFakeTimers()
    const trainer = new SimulatedTrainer({ ...DEFAULT_SIMULATION, targetPowerW: 180 })
    const seen: TrainerData[] = []
    trainer.ondata = (data) => seen.push(data)
    await trainer.connect()

    await trainer.setSimulation(10)
    vi.advanceTimersByTime(600)
    const climbing = seen[seen.length - 1]!

    await trainer.setSimulation(-10)
    vi.advanceTimersByTime(600)
    const descending = seen[seen.length - 1]!

    expect(climbing.powerW!).toBeGreaterThan(descending.powerW!)
    expect(climbing.cadenceRpm!).toBeLessThan(descending.cadenceRpm!)

    await trainer.disconnect()
  })

  it('reports whole numbers, as a real trainer does', async () => {
    vi.useFakeTimers()
    const trainer = new SimulatedTrainer()
    const seen: TrainerData[] = []
    trainer.ondata = (data) => seen.push(data)
    await trainer.connect()
    vi.advanceTimersByTime(1000)

    for (const sample of seen) {
      expect(Number.isInteger(sample.powerW)).toBe(true)
      expect(Number.isInteger(sample.cadenceRpm)).toBe(true)
    }
    await trainer.disconnect()
  })
})
