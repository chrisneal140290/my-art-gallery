// Pure geometry for hanging a picture on a wall in WebXR. No DOM or XR objects
// here, so it can be tested on its own.
import { Matrix4, Vector3 } from 'three';

export const UP = new Vector3(0, 1, 0);
/** Gallery hanging height: the centre of the piece 57 in (145 cm) above the floor. */
export const HANG_CENTRE_M = 1.45;

export interface SurfaceSample {
  pos: Vector3;
  /** Horizontal unit vector pointing out of the wall, towards the viewer. */
  normal: Vector3;
  distance: number;
}

// A WebXR hit-test pose is a column-major 4×4 matrix whose Y axis is the
// surface normal and whose translation is the hit point.
function hitNormal(m: ArrayLike<number>) {
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

/**
 * Accepts a hit on the floor (an upward-facing surface well below the phone).
 * The wall is taken to stand on that point, square to where the phone faces.
 */
export function floorSample(
  m: ArrayLike<number>,
  camPos: Vector3,
  camForward: Vector3,
  { minDrop = 0.6, max = 6 } = {},
): SurfaceSample | null {
  const n = hitNormal(m);
  if (n.y < 0.9) return null;
  const pos = hitPoint(m);
  if (camPos.y - pos.y < minDrop) return null;
  const distance = pos.distanceTo(camPos);
  if (distance > max) return null;
  const normal = new Vector3(-camForward.x, 0, -camForward.z);
  if (normal.lengthSq() < 1e-6) return null;
  return { pos, normal: normal.normalize(), distance };
}

/**
 * Collects samples from consecutive frames. The surface counts as found only
 * once several samples agree on its direction, so one stray hit can't place it.
 */
export class Stabilizer {
  private samples: SurfaceSample[] = [];
  private misses = 0;

  constructor(
    private readonly keep = 10,
    private readonly need = 5,
    private readonly agree = (5 * Math.PI) / 180,
    private readonly newSurface = (12 * Math.PI) / 180,
    private readonly maxMisses = 8,
  ) {}

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

/** Keeps the position but turns the pose back to level and upright. */
export function levelled(m: Matrix4, out = new Matrix4()) {
  const pos = new Vector3().setFromMatrixPosition(m);
  const z = new Vector3().setFromMatrixColumn(m, 2);
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
