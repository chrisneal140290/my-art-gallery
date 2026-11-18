// Hangs a real-size picture on a real wall with WebXR (Chrome on Android, ARCore).
//
// How it stays put, following what reliable wall-art apps do:
//  - The picture itself is the cursor, at true size. It only shows on surfaces
//    within about 14° of vertical, and only once several frames agree.
//  - Nothing is placed until the user taps. Then it is pinned with an AR anchor,
//    so ARCore keeps it on the wall as its map of the room improves.
//  - Dragging slides it along that fixed wall plane, so it can't drift off.
//  - For plain walls, which phones struggle to see, the user marks where the wall
//    meets the floor instead, and it hangs at gallery height above that line.
import {
  CanvasTexture,
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
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { artTexture, buildPieceGroup, outerSize, type PieceSize } from './wall-model';
import {
  HANG_CENTRE_M,
  Stabilizer,
  UP,
  floorSample,
  levelled,
  rayPlane,
  screenRay,
  wallMatrix,
  wallSample,
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

/** Gap between the wall and the back of the piece, so the two never flicker. */
const WALL_GAP = 0.003;
const PREVIEW_OPACITY = 0.82;
const PLACE_GRACE_MS = 600;
const SLOW_SCAN_MS = 8000;

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
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`;
}

class WallXr implements WallXrHandle {
  private readonly ui: WallXrUi;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly holder = new Group();
  private readonly floorMarker = new Group();
  private readonly shadow: Mesh;
  private readonly texture;
  private piece: Group | null = null;
  private size: PieceSize;

  private renderer: WebGLRenderer | null = null;
  private session: XRSessionLike = null;
  private refSpace: any = null;
  private hitSource: any = null;

  private mode: 'wall' | 'floor' = 'wall';
  private phase: 'aiming' | 'placed' = 'aiming';
  private readonly stab = new Stabilizer();
  private readonly display = { pos: new Vector3(), normal: new Vector3(0, 0, 1), valid: false };
  private lastSample: SurfaceSample | null = null;
  private readonly hitMatrix = new Matrix4();
  private placeRequestedAt = 0;
  private scanStart = 0;

  private anchor: any = null;
  private placement = 0;
  private readonly anchorMatrix = new Matrix4();
  private readonly offset = new Matrix4();
  private readonly base = new Matrix4();
  private readonly slide = { x: 0, y: 0 };
  private floorY: number | null = null;
  private placedFloorY: number | null = null;

  private readonly camPos = new Vector3();
  private readonly camForward = new Vector3();
  private viewProjection: Float32Array | null = null;
  private viewTransform: Float32Array | null = null;
  private frameCount = 0;

  private pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
  private drag: { start: Vector3; x: number; y: number } | null = null;
  private ended = false;
  private cleaned = false;
  private lastStatus = '';
  private lastInfo = '';

  constructor(private readonly options: WallXrOptions) {
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

    const line = new Mesh(
      new PlaneGeometry(1.4, 0.018),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    line.rotation.x = -Math.PI / 2;
    this.floorMarker.add(line);
    this.floorMarker.matrixAutoUpdate = false;
    this.floorMarker.visible = false;
    this.scene.add(this.floorMarker);

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
    this.disposePiece();
    this.texture.dispose();
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
    if (!renderer || !this.refSpace) return;
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
    if (frame.detectedPlanes && this.frameCount % 15 === 0) this.estimateFloor(frame);

    if (this.phase === 'aiming') this.aim(frame);
    else this.follow(frame);

    renderer.render(this.scene, this.camera);
  }

  private aim(frame: XRFrameLike) {
    let sample: SurfaceSample | null = null;
    let hit: any = null;
    for (const result of this.hitSource ? frame.getHitTestResults(this.hitSource) : []) {
      const p = result.getPose(this.refSpace);
      if (!p) continue;
      const m = p.transform.matrix;
      sample = this.mode === 'wall'
        ? wallSample(m, this.camPos)
        : floorSample(m, this.camPos, this.camForward);
      if (sample) {
        hit = result;
        this.hitMatrix.fromArray(m);
        break;
      }
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
      this.previewMatrix(this.holder.matrix);
      this.holder.matrixWorldNeedsUpdate = true;
      this.holder.visible = true;
      if (this.mode === 'floor') {
        const at = this.display.pos.clone().addScaledVector(UP, 0.002);
        wallMatrix(at, this.display.normal, this.floorMarker.matrix);
        this.floorMarker.matrixWorldNeedsUpdate = true;
        this.floorMarker.visible = true;
      }
    } else if (this.stab.count === 0) {
      this.display.valid = false;
      this.holder.visible = false;
      this.floorMarker.visible = false;
    }

    const ready = this.stab.ready && this.display.valid;
    if (this.placeRequestedAt) {
      if (ready && hit) {
        this.placeRequestedAt = 0;
        this.place(hit);
        return;
      }
      if (performance.now() - this.placeRequestedAt > PLACE_GRACE_MS) this.placeRequestedAt = 0;
    }
    this.updateAimUi(ready);
  }

  /** Where the preview sits: on the aimed wall point, or at gallery height above the floor line. */
  private previewMatrix(out: Matrix4) {
    const at = this.display.pos.clone().addScaledVector(this.display.normal, WALL_GAP);
    if (this.mode === 'floor') at.addScaledVector(UP, HANG_CENTRE_M);
    return wallMatrix(at, this.display.normal, out);
  }

  private place(hit: any) {
    const target = this.previewMatrix(new Matrix4());
    // Remember the piece relative to the surface hit, so it follows the anchor.
    this.anchorMatrix.copy(this.hitMatrix);
    this.offset.copy(this.hitMatrix).invert().multiply(target);
    this.anchor?.delete?.();
    this.anchor = null;
    const placement = ++this.placement;
    if (typeof hit.createAnchor === 'function') {
      hit.createAnchor().then(
        (anchor: any) => {
          if (placement === this.placement && !this.cleaned) this.anchor = anchor;
          else anchor.delete?.();
        },
        () => {},
      );
    }
    this.placedFloorY = this.mode === 'floor' ? this.display.pos.y : this.floorY;
    this.slide.x = 0;
    this.slide.y = 0;
    this.phase = 'placed';
    this.floorMarker.visible = false;
    this.shadow.visible = true;
    this.setPieceOpacity(1);
    this.updateUi();
  }

  private follow(frame: XRFrameLike) {
    if (this.anchor) {
      const p = frame.getPose(this.anchor.anchorSpace, this.refSpace);
      if (p) this.anchorMatrix.fromArray(p.transform.matrix);
    }
    levelled(new Matrix4().multiplyMatrices(this.anchorMatrix, this.offset), this.base);
    const pos = new Vector3().setFromMatrixPosition(this.base);
    const along = new Vector3().setFromMatrixColumn(this.base, 0);
    pos.addScaledVector(along, this.slide.x).addScaledVector(UP, this.slide.y);
    this.holder.matrix.copy(this.base).setPosition(pos);
    this.holder.matrixWorldNeedsUpdate = true;

    if (this.frameCount % 10 === 0) {
      const parts = [`${formatMetres(pos.distanceTo(this.camPos))} from you`];
      const floor = this.placedFloorY ?? this.floorY;
      if (floor !== null) parts.push(`centre ${Math.round((pos.y - floor) * 100)} cm above the floor`);
      this.setInfo(parts.join(' · '));
    }
  }

  private estimateFloor(frame: XRFrameLike) {
    let lowest: number | null = null;
    frame.detectedPlanes.forEach((plane: any) => {
      if (plane.orientation !== 'horizontal') return;
      const p = frame.getPose(plane.planeSpace, this.refSpace);
      if (!p) return;
      const y = p.transform.position.y;
      if (this.camPos.y - y > 0.7 && (lowest === null || y < lowest)) lowest = y;
    });
    if (lowest !== null) this.floorY = lowest;
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

  private readonly onPlace = () => {
    if (this.phase === 'placed') this.reaim();
    else this.placeRequestedAt = performance.now();
  };

  private readonly onMode = () => {
    this.mode = this.mode === 'wall' ? 'floor' : 'wall';
    this.reaim();
  };

  private readonly onDone = () => this.end();

  // Taps on our overlay must not also count as AR "select" input.
  private readonly onBeforeSelect = (event: Event) => event.preventDefault();

  private readonly onPointerDown = (event: PointerEvent) => {
    if (isControl(event.target)) return;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    if (this.phase === 'placed') {
      const start = this.screenToWall(event.clientX, event.clientY);
      if (start) this.drag = { start, x: this.slide.x, y: this.slide.y };
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointer;
    if (!pointer || event.pointerId !== pointer.id) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) pointer.moved = true;
    if (!this.drag) return;
    const now = this.screenToWall(event.clientX, event.clientY);
    if (!now) return;
    const delta = now.sub(this.drag.start);
    const along = new Vector3().setFromMatrixColumn(this.base, 0);
    this.slide.x = Math.max(-4, Math.min(4, this.drag.x + delta.dot(along)));
    this.slide.y = Math.max(-2, Math.min(2.5, this.drag.y + delta.y));
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const pointer = this.pointer;
    if (pointer && event.pointerId === pointer.id && !pointer.moved && this.phase === 'aiming') {
      this.placeRequestedAt = performance.now();
    }
    this.pointer = null;
    this.drag = null;
  };

  private screenToWall(clientX: number, clientY: number) {
    if (!this.viewProjection || !this.viewTransform) return null;
    const ndcX = (clientX / window.innerWidth) * 2 - 1;
    const ndcY = -((clientY / window.innerHeight) * 2 - 1);
    const { origin, dir } = screenRay(ndcX, ndcY, this.viewProjection, this.viewTransform);
    const wallPoint = new Vector3().setFromMatrixPosition(this.base);
    const wallNormal = new Vector3().setFromMatrixColumn(this.base, 2);
    return rayPlane(origin, dir, wallPoint, wallNormal);
  }

  private reaim() {
    this.phase = 'aiming';
    this.placement++;
    this.anchor?.delete?.();
    this.anchor = null;
    this.stab.reset();
    this.display.valid = false;
    this.holder.visible = false;
    this.shadow.visible = false;
    this.floorMarker.visible = false;
    this.placeRequestedAt = 0;
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
      this.setStatus('Hung at its real size. Drag to slide it along the wall.');
      place.disabled = false;
      place.textContent = 'Move it somewhere else';
      mode.hidden = true;
    } else {
      place.textContent = 'Hang it here';
      mode.hidden = false;
      mode.textContent = this.mode === 'wall' ? 'Plain wall? Use the floor line' : 'Aim at the wall instead';
      this.updateAimUi(false);
    }
  }

  private updateAimUi(ready: boolean) {
    const slow = performance.now() - this.scanStart > SLOW_SCAN_MS;
    let message: string;
    if (this.mode === 'wall') {
      if (ready && this.lastSample && this.lastSample.distance < 0.6) {
        message = 'Step back a little: 1 to 2 m from the wall works best.';
      } else if (ready) {
        message = 'Wall found. Tap Hang it here, or tap the screen.';
      } else if (this.stab.count) {
        message = 'Hold steady on the wall…';
      } else if (slow) {
        message = 'Still looking. Aim at something on the wall, like a light switch or a frame. For a plain wall, use the floor line.';
      } else {
        message = 'Point at the wall and move your phone slowly from side to side.';
      }
    } else if (ready) {
      message = 'Line the marker up with the bottom of the wall, then tap Hang it here.';
    } else if (slow) {
      message = 'Still looking for the floor. Make sure it is well lit, then sweep your phone slowly over it.';
    } else {
      message = 'Point down at the floor, right where it meets the wall.';
    }
    this.setStatus(message);
    this.ui.place.disabled = !ready;
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
