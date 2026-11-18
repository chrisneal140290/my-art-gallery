// Builds a framed print or a stretched canvas as a 3D model at its real size.
// The same geometry feeds the in-browser AR session (wall-xr.ts) and the .glb
// that <model-viewer> shows inline and turns into a USDZ for iPhone Quick Look.
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export type Finish = 'framed' | 'canvas';

export interface PieceSize {
  /** Printed artwork size in inches, without frame or mount. */
  printW: number;
  printH: number;
  finish: Finish;
  /** Frame moulding width in inches (framed only). */
  mould: number;
  /** Mount width in inches (framed only). */
  mat: number;
}

export interface PieceSpec extends PieceSize {
  image: HTMLImageElement;
}

// Units are metres, which is what AR uses for real-world size.
export const INCH = 0.0254;
const FRAME_DEPTH = 0.9 * INCH;
const MOUNT_RECESS = 0.3 * INCH;
const CANVAS_DEPTH = 1.5 * INCH;
// How much of each image edge is stretched round the canvas sides.
const WRAP = 0.035;

export function artTexture(image: HTMLImageElement) {
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  // Embed the art as JPEG in the .glb: PNG would make it several times larger.
  texture.userData.mimeType = 'image/jpeg';
  texture.needsUpdate = true;
  return texture;
}

/** Outside size of the finished piece in metres. */
export function outerSize(size: PieceSize) {
  if (size.finish === 'canvas') {
    return { w: size.printW * INCH, h: size.printH * INCH, depth: CANVAS_DEPTH };
  }
  const border = 2 * (size.mould + size.mat) * INCH;
  return { w: size.printW * INCH + border, h: size.printH * INCH + border, depth: FRAME_DEPTH };
}

function framedPiece(size: PieceSize, texture: Texture) {
  const pw = size.printW * INCH;
  const ph = size.printH * INCH;
  const m = size.mould * INCH;
  const { w: ow, h: oh } = outerSize(size);

  const group = new Group();
  const frame = new MeshStandardMaterial({ color: 0xb98d5f, metalness: 0.35, roughness: 0.42 });
  const mount = new MeshStandardMaterial({ color: 0xf7f0e6, roughness: 0.92 });
  const print = new MeshStandardMaterial({ map: texture, roughness: 0.7 });

  const bar = (w: number, h: number, x: number, y: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, FRAME_DEPTH), frame);
    mesh.position.set(x, y, FRAME_DEPTH / 2);
    group.add(mesh);
  };
  bar(ow, m, 0, oh / 2 - m / 2);
  bar(ow, m, 0, -(oh / 2 - m / 2));
  bar(m, oh - 2 * m, ow / 2 - m / 2, 0);
  bar(m, oh - 2 * m, -(ow / 2 - m / 2), 0);

  // The mount fills the frame from the back up to just behind the frame face.
  const mountFront = FRAME_DEPTH - MOUNT_RECESS;
  const board = new Mesh(new BoxGeometry(ow - 2 * m, oh - 2 * m, mountFront), mount);
  board.position.z = mountFront / 2;
  group.add(board);

  const art = new Mesh(new PlaneGeometry(pw, ph), print);
  art.position.z = mountFront + 0.0005;
  group.add(art);

  return group;
}

function canvasPiece(size: PieceSize, texture: Texture) {
  const w = size.printW * INCH;
  const h = size.printH * INCH;
  const d = CANVAS_DEPTH;
  const geometry = new BoxGeometry(w, h, d);

  // Gallery wrap: each side shows a thin strip from the matching image edge.
  // BoxGeometry faces come in the order +x, -x, +y, -y, +z, -z, four vertices each.
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      const u0 = pos.getX(i) / w + 0.5;
      const v0 = pos.getY(i) / h + 0.5;
      const back = 0.5 - pos.getZ(i) / d; // 0 at the front face, 1 at the back
      let u = u0;
      let v = v0;
      if (face === 0) u = 1 - WRAP * back;
      else if (face === 1) u = WRAP * back;
      else if (face === 2) v = 1 - WRAP * back;
      else if (face === 3) v = WRAP * back;
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;

  const front = new MeshStandardMaterial({ map: texture, roughness: 0.82 });
  const side = new MeshStandardMaterial({ map: texture, roughness: 0.85, color: 0xb0b0b0 });
  const backing = new MeshStandardMaterial({ color: 0x5a4a3c, roughness: 1 });
  const mesh = new Mesh(geometry, [side, side, side, side, front, backing]);
  mesh.position.z = d / 2;

  const group = new Group();
  group.add(mesh);
  return group;
}

/** The piece as a three.js group: back at z = 0, facing +Z, centred on x and y. */
export function buildPieceGroup(size: PieceSize, texture: Texture) {
  return size.finish === 'canvas' ? canvasPiece(size, texture) : framedPiece(size, texture);
}

/** Returns a blob: URL of a binary glTF (.glb) of the piece at real size. */
export async function buildPieceModel(spec: PieceSpec): Promise<string> {
  const piece = buildPieceGroup(spec, artTexture(spec.image));
  const glb = (await new GLTFExporter().parseAsync(piece, {
    binary: true,
    maxTextureSize: 2048,
  })) as ArrayBuffer;
  return URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
}
