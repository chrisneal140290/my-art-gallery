// Everything the wall preview loads on demand, as one chunk: the inline 3D
// viewer (and iPhone Quick Look), the model builder and the Android AR session.
import '@google/model-viewer';

export { buildPieceModel, type PieceSize } from './wall-model';
export { startWallXr, type WallXrHandle } from './wall-xr';
