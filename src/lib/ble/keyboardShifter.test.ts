// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyboardShifter } from './keyboardShifter'

let shifter: KeyboardShifter
let shifts: number[]

beforeEach(async () => {
  shifter = new KeyboardShifter()
  shifts = []
  shifter.onshift = (direction) => shifts.push(direction)
  await shifter.connect()
})

afterEach(async () => {
  await shifter.disconnect()
  document.body.innerHTML = ''
})

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('KeyboardShifter', () => {
  it('connects and disconnects', async () => {
    expect(shifter.state).toBe('connected')
    await shifter.disconnect()
    expect(shifter.state).toBe('disconnected')
  })

  it('shifts up on plus and equals', () => {
    press('+')
    press('=')
    expect(shifts).toEqual([1, 1])
  })

  it('shifts down on minus and underscore', () => {
    press('-')
    press('_')
    expect(shifts).toEqual([-1, -1])
  })

  it('shifts on the arrow keys', () => {
    press('ArrowUp')
    press('ArrowDown')
    expect(shifts).toEqual([1, -1])
  })

  it('ignores keys that are not shifts', () => {
    press('a')
    press('Enter')
    press(' ')
    expect(shifts).toEqual([])
  })

  it('ignores held keys so one press is one gear', () => {
    press('+', { repeat: true })
    expect(shifts).toEqual([])
  })

  it('keeps out of the way of browser shortcuts', () => {
    press('+', { metaKey: true })
    press('+', { ctrlKey: true })
    press('-', { altKey: true })
    expect(shifts).toEqual([])
  })

  it('leaves typing alone', () => {
    const input = document.createElement('input')
    document.body.append(input)
    press('-', {}, input)
    expect(shifts).toEqual([])
  })

  it('stops listening once disconnected', async () => {
    await shifter.disconnect()
    press('+')
    expect(shifts).toEqual([])
  })
})
