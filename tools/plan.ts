/**
 * Plans a route through a region, from place to place along its roads, and
 * makes the files to ride it: a GPX with the region's heights, and a 3D course.
 *
 *   npm run plan -- --region public/regions/tramuntana.json "Port de Sóller" "Sa Calobra" --loop --name "Sa Calobra"
 *
 * Places are found by name, ignoring accents and case, or given as "lat,lon".
 * The route is the shortest along the roads between each pair, never against
 * a one-way street. --loop comes back to the first place.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { findStop, planRoute, toGpx, type Leg } from '../src/lib/network/plan.ts'
import { fromFile, type Region } from '../src/lib/network/region.ts'

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      region: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string', default: '.' },
      loop: { type: 'boolean', default: false },
      'no-terrain': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help || !values.region || positionals.length < (values.loop ? 2 : 2)) {
    console.log('Usage: npm run plan -- --region <region.json> <place> <place> [...] [--loop] [--name <name>] [--out <dir>]')
    process.exit(values.help ? 0 : 1)
  }
  const region = fromFile(JSON.parse(await readFile(resolve(values.region), 'utf8')))
  const stops = positionals.map((q) => findStop(region, q))
  const { points, legs } = planRoute(region, stops, { loop: values.loop })
  const name = values.name ?? stops.map((s) => s.label).join(' – ') + (values.loop ? ' loop' : '')

  let climb = 0
  for (let k = 1; k < points.length; k++) climb += Math.max(0, points[k]!.ele - points[k - 1]!.ele)
  let steepest = 0
  for (let k = 0; k + 10 < points.length; k++) steepest = Math.max(steepest, (points[k + 10]!.ele - points[k]!.ele) / 100)
  const length = legs.reduce((s, l) => s + region.roads[l.road]!.length, 0)

  console.log(`${name}: ${stops.map((s) => s.label).join(' → ')}${values.loop ? ' → back' : ''}`)
  console.log(`  distance  ${(length / 1000).toFixed(1)} km, climbing ${Math.round(climb)} m, steepest ${(steepest * 100).toFixed(1)}% over 100 m`)
  console.log(`  roads     ${roadsOf(region, legs)}`)

  const outDir = resolve(values.out!)
  await mkdir(outDir, { recursive: true })
  const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route'
  const gpx = join(outDir, `${slug}.gpx`)
  await writeFile(gpx, toGpx(name, points, region.credit))
  console.log(`  wrote     ${gpx}`)

  if (!values['no-terrain']) {
    console.log('')
    execFileSync(process.execPath, [join(import.meta.dirname, 'course.ts'), gpx, '--keep-heights', '--out', outDir], { stdio: 'inherit' })
  }
}

/** The roads in the order ridden, consecutive stretches of the same road run together. */
function roadsOf(region: Region, legs: readonly Leg[]): string {
  const runs: { label: string; metres: number }[] = []
  for (const leg of legs) {
    const road = region.roads[leg.road]!
    const label = [road.ref, road.name].filter(Boolean).join(' ') || road.highway
    const last = runs[runs.length - 1]
    if (last && last.label === label) last.metres += road.length
    else runs.push({ label, metres: road.length })
  }
  return runs
    .filter((r) => r.metres >= 300)
    .map((r) => `${r.label} ${(r.metres / 1000).toFixed(1)} km`)
    .join(' → ')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
