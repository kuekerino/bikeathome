/**
 * Coordinates for course building: a flat local frame around the route, and
 * the British National Grid for the Environment Agency's LiDAR.
 *
 * Pure. Relative imports in this folder carry their `.ts` extension so that
 * `tools/course.ts` can run them under plain Node, without a build step.
 */

export const EARTH_RADIUS_M = 6371000

export interface LatLon {
  lat: number
  lon: number
}

/** A point in the local frame: metres east (`x`) and south (`z`) of the centre. */
export interface Local {
  x: number
  z: number
}

export interface LocalFrame {
  centre: LatLon
  toLocal(p: LatLon): Local
  toLatLon(x: number, z: number): LatLon
}

/**
 * A flat frame centred on the route: x east, z south, in metres.
 *
 * Z points south because that is the convention the golden-hour-ride renderer
 * uses (Three.js looks down -z, so north is "into the screen"). The projection
 * is equirectangular about the centre: across a 20 km course its east-west
 * scale drifts by about 0.1%, which nothing that rides on it can notice, and
 * the road and the terrain share the frame, so they always agree.
 */
export function localFrame(centre: LatLon): LocalFrame {
  const k = (Math.PI / 180) * EARTH_RADIUS_M
  const kx = k * Math.cos(toRadians(centre.lat))
  return {
    centre,
    toLocal: (p) => ({ x: (p.lon - centre.lon) * kx, z: -(p.lat - centre.lat) * k }),
    toLatLon: (x, z) => ({ lat: centre.lat - z / k, lon: centre.lon + x / kx }),
  }
}

/**
 * WGS84 latitude and longitude to British National Grid easting and northing.
 *
 * A seven-parameter Helmert shift to OSGB36 followed by the Ordnance Survey's
 * transverse Mercator series. Good to a few metres, which is what the
 * Helmert shift allows; the road sampling searches a few metres either side
 * of the line for exactly that reason. OSTN15 would be centimetre-accurate
 * and is not worth its grid file here.
 *
 * Ported from golden-hour-ride's `tools/build_leckhampton.py`,
 * Copyright (c) 2026 Jamie Marsland, MIT licence (see LICENSE.golden-hour-ride).
 */
export function wgs84ToBng(lat: number, lon: number): [easting: number, northing: number] {
  // WGS84 geodetic to Cartesian, ignoring ellipsoidal height
  let a = 6378137.0
  let b = 6356752.3142
  let e2 = 1 - (b * b) / (a * a)
  const p = toRadians(lat)
  const l = toRadians(lon)
  let nu = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2)
  const x = nu * Math.cos(p) * Math.cos(l)
  const y = nu * Math.cos(p) * Math.sin(l)
  const z = (1 - e2) * nu * Math.sin(p)

  // Helmert shift to OSGB36
  const s = 20.4894e-6
  const sec = Math.PI / 648000
  const rx = -0.1502 * sec
  const ry = -0.247 * sec
  const rz = -0.8421 * sec
  const x2 = -446.448 + (1 + s) * x - rz * y + ry * z
  const y2 = 125.157 + rz * x + (1 + s) * y - rx * z
  const z2 = -542.06 - ry * x + rx * y + (1 + s) * z

  // Cartesian back to geodetic on Airy 1830
  a = 6377563.396
  b = 6356256.909
  e2 = 1 - (b * b) / (a * a)
  const pr = Math.hypot(x2, y2)
  let phi = Math.atan2(z2, pr * (1 - e2))
  for (let i = 0; i < 10; i++) {
    nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
    phi = Math.atan2(z2 + e2 * nu * Math.sin(phi), pr)
  }
  const lam = Math.atan2(y2, x2)

  // Transverse Mercator, National Grid parameters
  const F0 = 0.9996012717
  const phi0 = toRadians(49)
  const lam0 = toRadians(-2)
  const n = (a - b) / (a + b)
  const sn = Math.sin(phi)
  const c = Math.cos(phi)
  const t = Math.tan(phi)
  nu = (a * F0) / Math.sqrt(1 - e2 * sn * sn)
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * sn * sn) ** 1.5
  const eta2 = nu / rho - 1
  const dp = phi - phi0
  const sp = phi + phi0
  const M =
    b *
    F0 *
    ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp -
      (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp) +
      (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp) -
      (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp))
  const d = lam - lam0
  const northing =
    M -
    100000 +
    (nu / 2) * sn * c * d * d +
    (nu / 24) * sn * c ** 3 * (5 - t * t + 9 * eta2) * d ** 4 +
    (nu / 720) * sn * c ** 5 * (61 - 58 * t * t + t ** 4) * d ** 6
  const easting =
    400000 +
    nu * c * d +
    (nu / 6) * c ** 3 * (nu / rho - t * t) * d ** 3 +
    (nu / 120) * c ** 5 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2) * d ** 5
  return [easting, northing]
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}
