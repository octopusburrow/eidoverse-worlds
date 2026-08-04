// picture — a COMPONENT, not an entity kind: attach `picture: {src}` to any
// spawned thing and its meshes take the image as their face, with the mesh
// scaled so the surface matches the image's aspect ratio.
//
// The aspect is DERIVED, never logged. The log says only "this entity shows
// these bytes" — every client reads the same content-addressed image, measures
// the same width/height, and derives the same shape. Same doctrine as grass:
// params in the log, determinism in the client. And the split composes with
// `place`: the entity's logged (uniform) scale stays the SIZE knob; the mesh's
// derived non-uniform scale is the SHAPE. A 4:3 photo re-uploaded as 16:9
// reshapes everywhere the moment the comp is re-spoken — that's the whole
// "automatic" of it.
//
// Pair with assets/models/unit_quad_picture_plane.glb (a 1×1 white quad) for
// the classic picture-in-space; but nothing stops a picture comp on a crate.

import { THREE, bus, report } from './core.js';
import { entities, comps } from './world.js';

const loader = new THREE.TextureLoader();
const applied = new Map();   // id -> src currently on the meshes

function apply(id, data) {
  if (!data || !data.src) { applied.delete(id); return; }   // removed: next spawn/replay repaints stock
  const obj = entities.get(id);
  if (!obj) {
    // the GLB is still in flight (spawn reserves the id first) — retry while
    // the component is still the current word in the bag
    setTimeout(() => { if (comps.get(id)?.picture?.src === data.src) apply(id, data); }, 300);
    return;
  }
  if (applied.get(id) === data.src) return;
  applied.set(id, data.src);
  loader.load('/library/' + data.src, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const aspect = tex.image.width / tex.image.height;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      // UNLIT on purpose: a photograph should read as itself at any hour of
      // the world's day — image fidelity outranks scene lighting for pictures
      o.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
      o.scale.set(aspect, 1, 1);
      o.userData.pictureAspect = aspect;
    });
  }, undefined, (e) => report(`picture ${data.src}`, e));
}

bus.on('comp', ({ id, type, data }) => { if (type === 'picture') apply(id, data); });
