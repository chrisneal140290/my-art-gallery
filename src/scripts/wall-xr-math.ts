// Pure geometry for hanging a picture on a wall in WebXR. No DOM or XR objects
// here, so it can be tested on its own.
import { Matrix4, Vector3 } from 'three';

export const UP = new Vector3(0, 1, 0);
/** Gallery hanging height: the centre of the piece 57 in (145 cm) above the floor. */
export const HANG_CENTRE_M = 1.45;
/** A horizontal surface counts as the floor only if it is at least this far below the phone. */
export const MIN_FLOOR_DROP = 0.5;
/** The two marks along the foot of the wall must be at least this far apart to fix its angle. */
export const MIN_LINE_M = 0.3;

export interface SurfaceSample {
  pos: Vector3;
  /** Horizontal unit vector pointing out of the wall, towards the viewer. */
  normal: Vector3;
  distance: number;
}

/** A detected plane: its pose (Y axis = normal) and its outline in that pose's XZ plane. */
export interface PlaneOutline {
  matrix: ArrayLike<number>;
  polygon: ArrayLike<{ x: number; z: number }>;
}

// A WebXR hit-test pose is a column-major 4×4 matrix whose Y axis is the
// surface normal and whose translation is the hit point.
export function hitNormal(m: ArrayLike<number>) {
  return new Vector3(m[4], m[5], m[6]).normalize();
}

function hitPoint(m: ArrayLike<number>) {
  return new Vector3(m[12], m[13], m[14]);
}

/**
 * Accepts a hit only if it is on a near-vertical surface (within about 14°)
 * at a sensible distance. Returns the wall normal flattened and facing the viewer.
 */
export function wallSample(
  m: ArrayLike<number>,
  camPos: Vector3,
  { maxTilt = 0.25, min = 0.3, max = 5 } = {},
): SurfaceSample | null {
  const n = hitNormal(m);
  if (Math.abs(n.y) > maxTilt) return null;
  const pos = hitPoint(m);
  const distance = pos.distanceTo(camPos);
  if (distance < min || distance > max) return null;
  const normal = new Vector3(n.x, 0, n.z).normalize();
  const toViewer = new Vector3(camPos.x - pos.x, 0, camPos.z - pos.z);
  if (normal.dot(toViewer) < 0) normal.negate();
  return { pos, normal, distance };
}

/** Height of an upward-facing hit far enough below the phone to be the floor, else null. */
export function floorHeight(m: ArrayLike<number>, camPos: Vector3, minDrop = MIN_FLOOR_DROP) {
  if (hitNormal(m).y < 0.9) return null;
  const y = m[13];
  return camPos.y - y >= minDrop ? y : null;
}

/** Where a ray meets the (endless) floor plane, if it does so ahead and within reach. */
export function rayFloor(origin: Vector3, dir: Vector3, floorY: number, maxDistance = 6) {
  // Level or upward rays never reach the floor in front.
  if (dir.y > -0.02) return null;
  const t = (floorY - origin.y) / dir.y;
  if (t <= 0) return null;
  const point = origin.clone().addScaledVector(dir, t);
  return Math.hypot(point.x - origin.x, point.z - origin.z) <= maxDistance ? point : null;
}

/**
 * The wall standing on a line marked along its foot, from a to b on the floor.
 * Returns the midpoint of the line and the level normal facing the viewer.
 */
export function wallFromLine(a: Vector3, b: Vector3, camPos: Vector3, minLength = MIN_LINE_M) {
  const along = new Vector3(b.x - a.x, 0, b.z - a.z);
  const length = along.length();
  if (length < minLength || length === 0) return null;
  along.divideScalar(length);
  const normal = new Vector3(-along.z, 0, along.x);
  const foot = a.clone().add(b).multiplyScalar(0.5);
  if (normal.dot(new Vector3(camPos.x - foot.x, 0, camPos.z - foot.z)) < 0) normal.negate();
  return { foot, normal, length };
}

function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq)) : 0;
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
}

/** Inside the polygon, or within `margin` of its edge. */
export function nearPolygon(x: number, z: number, polygon: ArrayLike<{ x: number; z: number }>, margin = 0) {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    nearest = Math.min(nearest, segmentDistance(x, z, a, b));
  }
  return inside || nearest <= margin;
}

/**
 * True if the point lies on one of the detected planes (within `margin` of its
 * outline) and that plane faces the same way as `normal`. Chrome also reports
 * hits on the endless extension of a plane found elsewhere in the room, which
 * puts the picture at that surface's angle and distance instead of the wall's.
 */
export function onDetectedPlane(
  point: Vector3,
  normal: Vector3,
  planes: Iterable<PlaneOutline>,
  { margin = 0.1, maxGap = 0.05, maxAngle = (10 * Math.PI) / 180 } = {},
) {
  const minDot = Math.cos(maxAngle);
  for (const plane of planes) {
    const pose = new Matrix4().fromArray(Array.from(plane.matrix));
    const planeNormal = new Vector3().setFromMatrixColumn(pose, 1).normalize();
    if (Math.abs(planeNormal.dot(normal)) < minDot) continue;
    const local = point.clone().applyMatrix4(pose.invert());
    if (Math.abs(local.y) > maxGap) continue;
    if (nearPolygon(local.x, local.z, plane.polygon, margin)) return true;
  }
  return false;
}

/**
 * Collects samples from consecutive frames. The surface counts as found only
 * once several samples agree on its direction, so one stray hit can't place it.
 */
export class Stabilizer {
  private samples: SurfaceSample[] = [];
  private misses = 0;
  private readonly keep: number;
  private readonly need: number;
  private readonly agree: number;
  private readonly newSurface: number;
  private readonly maxMisses: number;

  constructor(keep = 10, need = 5, agree = (5 * Math.PI) / 180, newSurface = (12 * Math.PI) / 180, maxMisses = 8) {
    this.keep = keep;
    this.need = need;
    this.agree = agree;
    this.newSurface = newSurface;
    this.maxMisses = maxMisses;
  }

  reset() {
    this.samples = [];
    this.misses = 0;
  }

  push(sample: SurfaceSample | null) {
    if (!sample) {
      if (++this.misses > this.maxMisses) this.samples = [];
      return;
    }
    this.misses = 0;
    const normal = this.meanNormal();
    if (normal && normal.angleTo(sample.normal) > this.newSurface) this.samples = [];
    this.samples.push(sample);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get count() {
    return this.samples.length;
  }

  meanNormal(): Vector3 | null {
    if (!this.samples.length) return null;
    const sum = new Vector3();
    for (const s of this.samples) sum.add(s.normal);
    return sum.normalize();
  }

  /** Latest position with the averaged direction: follows the aim without lag. */
  target(): { pos: Vector3; normal: Vector3; distance: number } | null {
    const normal = this.meanNormal();
    const last = this.samples[this.samples.length - 1];
    return normal && last ? { pos: last.pos.clone(), normal, distance: last.distance } : null;
  }

  get ready() {
    if (this.samples.length < this.need) return false;
    const normal = this.meanNormal()!;
    return this.samples.every((s) => s.normal.angleTo(normal) <= this.agree);
  }
}

/** A level, upright pose on the wall: +Z out of the wall, +Y straight up. */
export function wallMatrix(pos: Vector3, normal: Vector3, out = new Matrix4()) {
  const z = new Vector3(normal.x, 0, normal.z);
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  const x = new Vector3().crossVectors(UP, z).normalize();
  out.makeBasis(x, UP, z);
  out.setPosition(pos);
  return out;
}

/**
 * Keeps the position but turns the pose back to level and upright. If its
 * Z axis points almost straight up or down there's no direction to keep, so
 * `out` keeps the orientation it already had.
 */
export function levelled(m: Matrix4, out = new Matrix4()) {
  const pos = new Vector3().setFromMatrixPosition(m);
  const z = new Vector3().setFromMatrixColumn(m, 2);
  if (z.x * z.x + z.z * z.z < 0.04) return out.setPosition(pos);
  return wallMatrix(pos, z, out);
}

/** The same pose moved along its own wall: `x` sideways, `y` straight up. */
export function slid(m: Matrix4, x: number, y: number, out = new Matrix4()) {
  const pos = new Vector3().setFromMatrixPosition(m);
  pos.addScaledVector(new Vector3().setFromMatrixColumn(m, 0), x).addScaledVector(UP, y);
  return out.copy(m).setPosition(pos);
}

/** The same pose turned about the vertical line through its centre (positive = anticlockwise from above). */
export function turned(m: Matrix4, angle: number, out = new Matrix4()) {
  const pos = new Vector3().setFromMatrixPosition(m);
  const z = new Vector3().setFromMatrixColumn(m, 2).applyAxisAngle(UP, angle);
  return wallMatrix(pos, z, out);
}

/** World-space ray through a screen point given in normalised device coordinates. */
export function screenRay(
  ndcX: number,
  ndcY: number,
  projection: ArrayLike<number>,
  viewTransform: ArrayLike<number>,
) {
  const inverseProjection = new Matrix4().fromArray(Array.from(projection)).invert();
  const world = new Matrix4().fromArray(Array.from(viewTransform));
  const origin = new Vector3().setFromMatrixPosition(world);
  const through = new Vector3(ndcX, ndcY, 0.5).applyMatrix4(inverseProjection).applyMatrix4(world);
  return { origin, dir: through.sub(origin).normalize() };
}

export function rayPlane(origin: Vector3, dir: Vector3, planePoint: Vector3, planeNormal: Vector3) {
  const denom = planeNormal.dot(dir);
  if (Math.abs(denom) < 1e-6) return null;
  const t = planePoint.clone().sub(origin).dot(planeNormal) / denom;
  return t > 0 ? origin.clone().addScaledVector(dir, t) : null;
}
