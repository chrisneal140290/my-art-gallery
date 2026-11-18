// Hangs a real-size picture on a real wall with WebXR (Chrome on Android, ARCore).
//
// Phones track texture, not walls. A plain painted wall gives ARCore almost
// nothing to work with, so it either finds no wall or guesses one at the wrong
// angle and distance, and then the picture looks crooked and the wrong size.
// So there are two ways to place it:
//
//  - Mark the wall (the default). The user runs a ring along the line where the
//    wall meets the floor and taps at each end. Floors are what phones track
//    best, and two points on the wall's foot fix both its angle and its
//    distance, so the picture sits flat on it, centred 145 cm up.
//  - Find the wall, for walls with some pattern or objects on them. The picture
//    is the cursor and only lands on a vertical surface ARCore has really mapped:
//    Chrome also reports hits on the endless extension of a plane found
//    elsewhere (another wall, a cupboard side), and those are thrown away.
//
// Once placed, it's pinned with an AR anchor so it stays put as ARCore refines its
// map. Dragging slides it along the wall; a two-finger twist turns it flat to the
// wall if the wall was misjudged.
import {
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RingGeometry,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { artTexture, buildPieceGroup, outerSize, type PieceSize } from './wall-model';
import {
  HANG_CENTRE_M,
  MIN_FLOOR_DROP,
  MIN_LINE_M,
  Stabilizer,
  UP,
  floorHeight,
  levelled,
  onDetectedPlane,
  rayFloor,
  rayPlane,
  screenRay,
  slid,
  turned,
  wallFromLine,
  wallMatrix,
  wallSample,
  type PlaneOutline,
  type SurfaceSample,
} from './wall-xr-math';

// WebXR types aren't in TypeScript's DOM library; keep them loose here.
type XRSessionLike = any;
type XRFrameLike = any;

export interface WallXrUi {
  /** Element shown over the camera view (WebXR DOM overlay root). */
  root: HTMLElement;
  status: HTMLElement;
  info: HTMLElement;
  place: HTMLButtonElement;
  mode: HTMLButtonElement;
  done: HTMLButtonElement;
}

export interface WallXrOptions {
  image: HTMLImageElement;
  size: PieceSize;
  ui: WallXrUi;
  onStart(): void;
  onEnd(result: { error?: unknown }): void;
}

export interface WallXrHandle {
  setSize(size: PieceSize): void;
  end(): void;
}

type Mode = 'line' | 'wall';
type Wall = { foot: Vector3; normal: Vector3; length: number };
type Gesture =
  | { kind: 'drag'; start: Vector3; pose: Matrix4 }
  | { kind: 'twist'; angle: number; pose: Matrix4 };

/** Gap between the wall and the back of the piece, so the two never flicker. */
const WALL_GAP = 0.003;
const PREVIEW_OPACITY = 0.82;
const PLACE_GRACE_MS = 600;
const SLOW_SCAN_MS = 8000;
/** Height of the see-through wall drawn up from the marked line. */
const BAND_H = 1.1;

export function startWallXr(options: WallXrOptions): WallXrHandle {
  const xr = (navigator as Navigator & { xr?: any }).xr;
  // Browsers only allow an AR session from inside a tap, so ask before anything else.
  let request: Promise<XRSessionLike>;
  try {
    request = xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'dom-overlay'],
      optionalFeatures: ['anchors', 'plane-detection'],
      domOverlay: { root: options.ui.root },
    });
  } catch (error) {
    request = Promise.reject(error);
  }
  const controller = new WallXr(options);
  request.then(
    (session) => void controller.begin(session),
    (error) => controller.fail(error),
  );
  return controller;
}

function isControl(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('button, a, input, label, .wall-options');
}

function formatMetres(m: number) {
  return m < 0.995 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`;
}

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function guideMaterial(opacity = 0.95) {
  return new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, side: DoubleSide });
}

class WallXr implements WallXrHandle {
  private readonly options: WallXrOptions;
  private readonly ui: WallXrUi;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly holder = new Group();
  private readonly shadow: Mesh;
  private readonly texture: Texture;
  private piece: Group | null = null;
  private size: PieceSize;

  // Guides for marking the wall's foot.
  private readonly ringMarker = new Group();
  private readonly startMarker: Mesh;
  private readonly lineGuide = new Group();
  private readonly lineStrip: Mesh;
  private readonly wallBand: Mesh;

  private renderer: WebGLRenderer | null = null;
  private session: XRSessionLike = null;
  private refSpace: any = null;
  private hitSource: any = null;

  private mode: Mode = 'line';
  private phase: 'aiming' | 'placed' = 'aiming';
  private placeRequestedAt = 0;
  private scanStart = 0;

  // Finding the wall.
  private readonly stab = new Stabilizer();
  private readonly display = { pos: new Vector3(), normal: new Vector3(0, 0, 1), valid: false };
  private lastSample: SurfaceSample | null = null;

  // Marking the wall at the floor.
  private floorY: number | null = null;
  private readonly ring = { pos: new Vector3(), valid: false };
  private lineStart: Vector3 | null = null;

  // Placed: pose = anchorMatrix × offset, kept level.
  private anchor: any = null;
  private anchorSeen = false;
  private placement = 0;
  private readonly anchorMatrix = new Matrix4();
  private readonly offset = new Matrix4();
  private readonly pose = new Matrix4();
  private readonly scratch = new Matrix4();
  private placedFloorY: number | null = null;

  private readonly camPos = new Vector3();
  private readonly camForward = new Vector3();
  private viewProjection: Float32Array | null = null;
  private viewTransform: Float32Array | null = null;
  private frameCount = 0;

  private readonly pointers = new Map<number, { x: number; y: number; sx: number; sy: number; moved: boolean }>();
  private multiTouch = false;
  private gesture: Gesture | null = null;
  private ended = false;
  private cleaned = false;
  private lastStatus = '';
  private lastInfo = '';

  constructor(options: WallXrOptions) {
    this.options = options;
    this.ui = options.ui;
    this.size = options.size;
    this.texture = artTexture(options.image);

    this.scene.add(new HemisphereLight(0xffffff, 0x8a7f78, 0.7));
    this.holder.matrixAutoUpdate = false;
    this.holder.visible = false;
    this.scene.add(this.holder);

    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.shadow.visible = false;
    this.holder.add(this.shadow);
    this.rebuildPiece();

    // A ring on the floor where the phone points, like a spirit level's bubble.
    const ring = new Mesh(new RingGeometry(0.045, 0.06, 48), guideMaterial());
    const dot = new Mesh(new CircleGeometry(0.008, 16), guideMaterial());
    ring.rotation.x = dot.rotation.x = -Math.PI / 2;
    this.ringMarker.add(ring, dot);
    this.ringMarker.matrixAutoUpdate = false;
    this.ringMarker.visible = false;

    this.startMarker = new Mesh(new CircleGeometry(0.025, 24), guideMaterial());
    this.startMarker.rotation.x = -Math.PI / 2;
    this.startMarker.visible = false;

    // The marked line, with a see-through wall standing on it so the user can
    // check it lines up with the real one.
    this.lineStrip = new Mesh(new PlaneGeometry(1, 0.02), guideMaterial());
    this.lineStrip.rotation.x = -Math.PI / 2;
    this.wallBand = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: bandTexture(), transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.lineGuide.add(this.lineStrip, this.wallBand);
    this.lineGuide.matrixAutoUpdate = false;
    this.lineGuide.visible = false;

    this.scene.add(this.ringMarker, this.startMarker, this.lineGuide);
    this.attachUi();
  }

  // —— session lifecycle ————————————————————————————————————————————

  async begin(session: XRSessionLike) {
    if (this.ended) {
      void session.end();
      return;
    }
    this.session = session;
    session.addEventListener('end', () => this.cleanup());

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    this.renderer = renderer;
    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    try {
      await renderer.xr.setSession(session);
      this.refSpace = renderer.xr.getReferenceSpace();
      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource({ space: viewer });
    } catch (error) {
      this.cleanup(error);
      void session.end().catch(() => {});
      return;
    }

    this.options.onStart();
    this.scanStart = performance.now();
    this.updateUi();
    renderer.setAnimationLoop((_time: number, frame: XRFrameLike) => this.onFrame(frame));
  }

  fail(error: unknown) {
    this.cleanup(error);
  }

  end() {
    if (this.session) void this.session.end().catch(() => {});
    else this.cleanup();
  }

  private cleanup(error?: unknown) {
    if (this.cleaned) return;
    this.cleaned = true;
    this.ended = true;
    this.hitSource?.cancel?.();
    this.anchor?.delete?.();
    this.anchor = null;
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      // Each AR visit makes a new WebGL context; give this one back so repeat visits don't run out.
      this.renderer.forceContextLoss();
    }
    this.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        (material as MeshBasicMaterial).map?.dispose();
        material.dispose();
      });
    });
    this.scene.environment?.dispose();
    this.detachUi();
    this.options.onEnd(error === undefined ? {} : { error });
  }

  setSize(size: PieceSize) {
    this.size = size;
    if (!this.cleaned) this.rebuildPiece();
  }

  // —— per-frame work ———————————————————————————————————————————————

  private onFrame(frame: XRFrameLike) {
    const renderer = this.renderer;
    // three.js also calls this from the page's own animation loop, with no AR frame.
    if (!frame || !renderer || !this.refSpace) return;
    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) {
      this.setStatus('Hold on, finding your room again. Move your phone slowly.');
      renderer.render(this.scene, this.camera);
      return;
    }

    const { position, orientation } = pose.transform;
    this.camPos.set(position.x, position.y, position.z);
    this.camForward
      .set(0, 0, -1)
      .applyQuaternion(new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));
    const view = pose.views[0];
    this.viewProjection = Float32Array.from(view.projectionMatrix);
    this.viewTransform = Float32Array.from(view.transform.matrix);

    this.frameCount++;
    if (frame.detectedPlanes && this.frameCount % 10 === 1) this.estimateFloor(frame);

    if (this.phase === 'placed') this.follow(frame);
    else if (this.mode === 'line') this.aimLine(frame);
    else this.aimWall(frame);

    renderer.render(this.scene, this.camera);
  }

  private hitResults(frame: XRFrameLike): any[] {
    return this.hitSource ? frame.getHitTestResults(this.hitSource) : [];
  }

  /** True once a tap asked to place and that request is still fresh. */
  private placeWanted() {
    if (!this.placeRequestedAt) return false;
    if (performance.now() - this.placeRequestedAt > PLACE_GRACE_MS) {
      this.placeRequestedAt = 0;
      return false;
    }
    return true;
  }

  // Marking the wall at the floor ——————————————————————————————————————

  private aimLine(frame: XRFrameLike) {
    // Without plane detection, learn the floor height from the hit test instead.
    if (!frame.detectedPlanes) {
      for (const result of this.hitResults(frame)) {
        const p = result.getPose(this.refSpace);
        const y = p ? floorHeight(p.transform.matrix, this.camPos) : null;
        if (y !== null && (this.floorY === null || y < this.floorY)) this.floorY = y;
      }
    }

    // The ring sits where the phone points on the floor plane. Using the endless
    // plane, not just the patch ARCore has mapped, lets it reach the very foot of the wall.
    const point = this.floorY === null ? null : rayFloor(this.camPos, this.camForward, this.floorY);
    if (point) {
      if (this.ring.valid) this.ring.pos.lerp(point, 0.5);
      else this.ring.pos.copy(point);
      this.ring.valid = true;
      this.ringMarker.matrix.makeTranslation(this.ring.pos.x, this.ring.pos.y + 0.003, this.ring.pos.z);
      this.ringMarker.matrixWorldNeedsUpdate = true;
    } else {
      this.ring.valid = false;
    }
    this.ringMarker.visible = this.ring.valid;

    const wall = this.lineStart && this.ring.valid ? wallFromLine(this.lineStart, this.ring.pos, this.camPos, 0.02) : null;
    const longEnough = !!wall && wall.length >= MIN_LINE_M;
    if (wall) this.showLine(wall);
    this.lineGuide.visible = !!wall;

    // Once the line is long enough, show the picture hanging on it.
    if (wall && longEnough) {
      this.hangingPose(wall, this.holder.matrix);
      this.holder.matrixWorldNeedsUpdate = true;
    }
    this.holder.visible = longEnough;

    const ready = this.ring.valid && (!this.lineStart || longEnough);
    if (ready && this.placeWanted()) {
      this.placeRequestedAt = 0;
      if (!this.lineStart) {
        this.lineStart = this.ring.pos.clone();
        this.startMarker.position.set(this.lineStart.x, this.lineStart.y + 0.004, this.lineStart.z);
        this.startMarker.visible = true;
      } else if (wall) {
        this.placedFloorY = wall.foot.y;
        this.place(this.hangingPose(wall, new Matrix4()), null, frame);
        return;
      }
    } else {
      this.placeWanted();
    }

    this.updateAimUi(ready);
    if (this.ring.valid && this.frameCount % 10 === 0) {
      this.setInfo(wall ? `Line ${formatMetres(wall.length)} long` : `${formatMetres(this.ring.pos.distanceTo(this.camPos))} away`);
    } else if (!this.ring.valid) {
      this.setInfo('');
    }
  }

  private showLine(wall: Wall) {
    wallMatrix(wall.foot.clone().addScaledVector(UP, 0.003), wall.normal, this.lineGuide.matrix);
    this.lineGuide.matrixWorldNeedsUpdate = true;
    this.lineStrip.scale.set(wall.length, 1, 1);
    this.wallBand.scale.set(wall.length, BAND_H, 1);
    this.wallBand.position.set(0, BAND_H / 2, 0);
  }

  /** Centred on the marked line, at gallery height, flat on the wall. */
  private hangingPose(wall: Wall, out: Matrix4) {
    const centre = wall.foot.clone().addScaledVector(wall.normal, WALL_GAP).addScaledVector(UP, HANG_CENTRE_M);
    return wallMatrix(centre, wall.normal, out);
  }

  // Finding the wall ————————————————————————————————————————————————

  private aimWall(frame: XRFrameLike) {
    const outlines = frame.detectedPlanes ? this.wallOutlines(frame) : null;
    let sample: SurfaceSample | null = null;
    let hit: any = null;
    for (const result of this.hitResults(frame)) {
      const p = result.getPose(this.refSpace);
      if (!p) continue;
      const s = wallSample(p.transform.matrix, this.camPos);
      if (!s) continue;
      // Only surfaces ARCore has actually mapped, not the extension of one elsewhere.
      if (outlines && !onDetectedPlane(s.pos, s.normal, outlines)) continue;
      sample = s;
      hit = result;
      break;
    }
    this.stab.push(sample);
    this.lastSample = sample;

    const target = this.stab.target();
    if (target && this.stab.count >= 3) {
      if (!this.display.valid) {
        this.display.pos.copy(target.pos);
        this.display.normal.copy(target.normal);
        this.display.valid = true;
      } else {
        this.display.pos.lerp(target.pos, 0.35);
        this.display.normal.lerp(target.normal, 0.35).normalize();
      }
      this.previewPose(this.holder.matrix);
      this.holder.matrixWorldNeedsUpdate = true;
      this.holder.visible = true;
    } else if (this.stab.count === 0) {
      this.display.valid = false;
      this.holder.visible = false;
    }

    const ready = this.stab.ready && this.display.valid;
    if (ready && hit && this.placeWanted()) {
      this.placeRequestedAt = 0;
      this.placedFloorY = this.floorY;
      this.place(this.previewPose(new Matrix4()), hit, frame);
      return;
    }
    this.placeWanted();
    this.updateAimUi(ready);
    if (this.frameCount % 10 === 0) {
      this.setInfo(ready && this.lastSample ? `Wall ${formatMetres(this.lastSample.distance)} away` : '');
    }
  }

  private previewPose(out: Matrix4) {
    const at = this.display.pos.clone().addScaledVector(this.display.normal, WALL_GAP);
    return wallMatrix(at, this.display.normal, out);
  }

  private wallOutlines(frame: XRFrameLike) {
    const outlines: PlaneOutline[] = [];
    frame.detectedPlanes.forEach((plane: any) => {
      if (plane.orientation !== 'vertical') return;
      const p = frame.getPose(plane.planeSpace, this.refSpace);
      if (p) outlines.push({ matrix: p.transform.matrix, polygon: plane.polygon });
    });
    return outlines;
  }

  private estimateFloor(frame: XRFrameLike) {
    // The lowest upward surface well below the phone is the floor: tables and sofas stand on it.
    let lowest: number | null = null;
    frame.detectedPlanes.forEach((plane: any) => {
      if (plane.orientation !== 'horizontal') return;
      const p = frame.getPose(plane.planeSpace, this.refSpace);
      if (!p) return;
      const y = p.transform.position.y;
      if (this.camPos.y - y >= MIN_FLOOR_DROP && (lowest === null || y < lowest)) lowest = y;
    });
    if (lowest !== null) this.floorY = lowest;
  }

  // Placed —————————————————————————————————————————————————————————————

  private place(world: Matrix4, hit: any, frame: XRFrameLike) {
    this.anchor?.delete?.();
    this.anchor = null;
    this.anchorSeen = false;
    this.anchorMatrix.identity();
    this.offset.copy(world);
    this.pose.copy(world);

    // Pin it. A hit on a wall plane gives an anchor that moves with that plane as
    // ARCore refines it; otherwise pin the spot itself.
    const placement = ++this.placement;
    let request: Promise<any> | undefined;
    try {
      const RigidTransform = (globalThis as any).XRRigidTransform;
      if (hit && typeof hit.createAnchor === 'function') {
        request = hit.createAnchor();
      } else if (typeof frame.createAnchor === 'function' && RigidTransform) {
        const p = new Vector3().setFromMatrixPosition(world);
        const q = new Quaternion().setFromRotationMatrix(world);
        request = frame.createAnchor(new RigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), this.refSpace);
      }
    } catch {
      request = undefined;
    }
    request?.then(
      (anchor: any) => {
        if (placement === this.placement && !this.cleaned) this.anchor = anchor;
        else anchor.delete?.();
      },
      () => {},
    );

    this.phase = 'placed';
    this.ringMarker.visible = false;
    this.startMarker.visible = false;
    this.lineGuide.visible = false;
    this.holder.matrix.copy(world);
    this.holder.matrixWorldNeedsUpdate = true;
    this.holder.visible = true;
    this.shadow.visible = true;
    this.setPieceOpacity(1);
    this.updateUi();
  }

  private follow(frame: XRFrameLike) {
    if (this.anchor) {
      const p = frame.getPose(this.anchor.anchorSpace, this.refSpace);
      if (p) {
        this.scratch.fromArray(p.transform.matrix);
        // Measure the piece from wherever the anchor really is the first time we see
        // it, so the anchor's own axes can never turn the picture.
        if (!this.anchorSeen) {
          this.offset.copy(this.scratch).invert().multiply(this.pose);
          this.anchorSeen = true;
        }
        this.anchorMatrix.copy(this.scratch);
      }
    }
    levelled(this.scratch.multiplyMatrices(this.anchorMatrix, this.offset), this.pose);
    this.holder.matrix.copy(this.pose);
    this.holder.matrixWorldNeedsUpdate = true;

    if (this.frameCount % 10 === 0) {
      const pos = new Vector3().setFromMatrixPosition(this.pose);
      const parts = [`${formatMetres(pos.distanceTo(this.camPos))} away`];
      const floor = this.placedFloorY ?? this.floorY;
      if (floor !== null) parts.push(`centre ${Math.round((pos.y - floor) * 100)} cm above the floor`);
      this.setInfo(parts.join(' · '));
    }
  }

  /** Moves the placed piece to a new world pose, keeping it pinned to the anchor. */
  private setPose(world: Matrix4) {
    this.offset.copy(this.anchorMatrix).invert().multiply(world);
    this.pose.copy(world);
  }

  // —— the piece ————————————————————————————————————————————————————

  private rebuildPiece() {
    this.disposePiece();
    this.piece = buildPieceGroup(this.size, this.texture);
    this.holder.add(this.piece);
    const { w, h } = outerSize(this.size);
    // A soft shadow on the wall, a little below and behind: it's what makes it look hung.
    // The texture's solid core covers about 77% of it, so this leaves a soft edge round the piece.
    this.shadow.scale.set(w * 1.32, h * 1.34, 1);
    this.shadow.position.set(0.004, -Math.min(0.03, h * 0.04), -WALL_GAP + 0.0008);
    this.setPieceOpacity(this.phase === 'placed' ? 1 : PREVIEW_OPACITY);
  }

  private disposePiece() {
    if (!this.piece) return;
    this.holder.remove(this.piece);
    this.piece.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
    this.piece = null;
  }

  private setPieceOpacity(opacity: number) {
    this.piece?.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const m = material as MeshStandardMaterial;
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.depthWrite = opacity >= 1;
        m.needsUpdate = true;
      });
    });
  }

  // —— user input ———————————————————————————————————————————————————

  private requestPlace() {
    this.placeRequestedAt = performance.now();
  }

  private readonly onPlace = () => {
    if (this.phase === 'placed') this.reaim();
    else this.requestPlace();
  };

  private readonly onMode = () => {
    if (this.phase === 'aiming' && this.mode === 'line' && this.lineStart) {
      // Mid-line, this link starts the line again.
      this.clearLine();
    } else {
      this.mode = this.mode === 'wall' ? 'line' : 'wall';
      this.reaim();
    }
    this.updateUi();
  };

  private readonly onDone = () => this.end();

  // Taps on our overlay must not also count as AR "select" input.
  private readonly onBeforeSelect = (event: Event) => event.preventDefault();

  private readonly onPointerDown = (event: PointerEvent) => {
    if (isControl(event.target)) return;
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
      moved: false,
    });
    // A second finger turns this touch into a gesture, never a tap.
    if (this.pointers.size > 1) this.multiTouch = true;
    if (this.phase !== 'placed') return;
    if (this.pointers.size === 1) {
      const start = this.screenToWall(event.clientX, event.clientY, this.pose);
      this.gesture = start ? { kind: 'drag', start, pose: this.pose.clone() } : null;
    } else if (this.pointers.size === 2) {
      this.gesture = { kind: 'twist', angle: this.twistAngle(), pose: this.pose.clone() };
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (Math.hypot(pointer.x - pointer.sx, pointer.y - pointer.sy) > 10) pointer.moved = true;
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.kind === 'drag') {
      const now = this.screenToWall(pointer.x, pointer.y, gesture.pose);
      if (!now) return;
      const delta = now.sub(gesture.start);
      const along = new Vector3().setFromMatrixColumn(gesture.pose, 0);
      this.setPose(slid(gesture.pose, clamp(delta.dot(along), -4, 4), clamp(delta.y, -2.5, 2.5)));
    } else if (this.pointers.size >= 2) {
      let turn = this.twistAngle() - gesture.angle;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      // Fingers turning clockwise on screen turn the picture clockwise seen from above.
      this.setPose(turned(gesture.pose, -turn));
    }
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (pointer && !pointer.moved && !this.multiTouch && this.pointers.size === 0 && this.phase === 'aiming') {
      this.requestPlace();
    }
    if (this.pointers.size === 0) {
      this.gesture = null;
      this.multiTouch = false;
    } else if (this.gesture?.kind === 'twist') {
      this.gesture = null;
    }
  };

  private twistAngle() {
    const [a, b] = [...this.pointers.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private screenToWall(clientX: number, clientY: number, pose: Matrix4) {
    if (!this.viewProjection || !this.viewTransform) return null;
    const ndcX = (clientX / window.innerWidth) * 2 - 1;
    const ndcY = -((clientY / window.innerHeight) * 2 - 1);
    const { origin, dir } = screenRay(ndcX, ndcY, this.viewProjection, this.viewTransform);
    const wallPoint = new Vector3().setFromMatrixPosition(pose);
    const wallNormal = new Vector3().setFromMatrixColumn(pose, 2);
    return rayPlane(origin, dir, wallPoint, wallNormal);
  }

  private clearLine() {
    this.lineStart = null;
    this.startMarker.visible = false;
    this.lineGuide.visible = false;
    this.holder.visible = false;
  }

  private reaim() {
    this.phase = 'aiming';
    this.placement++;
    this.anchor?.delete?.();
    this.anchor = null;
    this.stab.reset();
    this.display.valid = false;
    this.ring.valid = false;
    this.clearLine();
    this.shadow.visible = false;
    this.placeRequestedAt = 0;
    this.gesture = null;
    this.scanStart = performance.now();
    this.setPieceOpacity(PREVIEW_OPACITY);
    this.setInfo('');
    this.updateUi();
  }

  private attachUi() {
    const { root, place, mode, done } = this.ui;
    place.addEventListener('click', this.onPlace);
    mode.addEventListener('click', this.onMode);
    done.addEventListener('click', this.onDone);
    root.addEventListener('beforexrselect', this.onBeforeSelect);
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerUp);
  }

  private detachUi() {
    const { root, place, mode, done } = this.ui;
    place.removeEventListener('click', this.onPlace);
    mode.removeEventListener('click', this.onMode);
    done.removeEventListener('click', this.onDone);
    root.removeEventListener('beforexrselect', this.onBeforeSelect);
    root.removeEventListener('pointerdown', this.onPointerDown);
    root.removeEventListener('pointermove', this.onPointerMove);
    root.removeEventListener('pointerup', this.onPointerUp);
    root.removeEventListener('pointercancel', this.onPointerUp);
  }

  // —— on-screen text ———————————————————————————————————————————————

  private updateUi() {
    const { place, mode } = this.ui;
    if (this.phase === 'placed') {
      this.setStatus('Hung at its real size. Drag to slide it. If it isn’t flat to the wall, twist with two fingers.');
      place.disabled = false;
      setText(place, 'Move it somewhere else');
      mode.hidden = true;
    } else {
      mode.hidden = false;
      this.updateAimUi(false);
    }
  }

  private updateAimUi(ready: boolean) {
    const { place, mode } = this.ui;
    const slow = performance.now() - this.scanStart > SLOW_SCAN_MS;
    let message: string;
    if (this.mode === 'line') {
      setText(place, this.lineStart ? 'Set the wall' : 'Mark this point');
      setText(mode, this.lineStart ? 'Start the line again' : 'Find the wall automatically instead');
      if (this.floorY === null) {
        message = slow
          ? 'Still looking for the floor. Put a light on and sweep your phone slowly over the floor.'
          : 'Point your phone at the floor and sweep it slowly until a ring appears.';
      } else if (!this.ring.valid) {
        message = 'Tilt your phone down to where the wall meets the floor.';
      } else if (!this.lineStart) {
        message = 'Put the ring where the wall meets the floor, at one side, then tap.';
      } else if (!ready) {
        message = 'Now move the ring along the bottom of the wall…';
      } else {
        message = 'Keep the line on the bottom of the wall, then tap to set it.';
      }
    } else {
      setText(place, 'Hang it here');
      setText(mode, 'Plain wall? Mark it at the floor instead');
      if (ready && this.lastSample && this.lastSample.distance < 0.6) {
        message = 'Step back a little: 1 to 2 m from the wall works best.';
      } else if (ready) {
        message = 'Wall found. Tap Hang it here, or tap the screen.';
      } else if (this.stab.count) {
        message = 'Hold steady on the wall…';
      } else if (slow) {
        message = 'Still looking. Aim at something on the wall, like a light switch or a frame, or mark the wall at the floor instead.';
      } else {
        message = 'Point at the wall and move your phone slowly from side to side.';
      }
    }
    this.setStatus(message);
    place.disabled = !ready;
  }

  private setStatus(text: string) {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.ui.status.textContent = text;
  }

  private setInfo(text: string) {
    if (text === this.lastInfo) return;
    this.lastInfo = text;
    this.ui.info.textContent = text;
  }
}

/** A soft-edged rectangle: the shadow a picture casts on the wall behind it. */
function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.filter = 'blur(14px)';
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(30, 30, 196, 196);
  return new CanvasTexture(canvas);
}

/** White fading upwards: the see-through wall drawn on the marked line. */
function bandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 128, 0, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0.38)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 128);
  return new CanvasTexture(canvas);
}
