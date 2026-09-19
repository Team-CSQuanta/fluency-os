import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** The scenery: stones, boulders and hill outcrops strewn over the ground.
 *
 *     public/models/rocks/stones.glb      six small stones, one node each
 *     public/models/rocks/stone-slab.glb  a single flat boulder
 *     public/models/rocks/outcrop.glb     a terrain ridge, used as a far hill
 *
 * None of these carry a texture — the packs shipped without their material
 * files — so the scene paints them itself. That is an advantage here rather
 * than a loss: a handful of shared flat greys keeps the rocks quiet next to the
 * trees, which are the only thing on this screen that means anything.
 *
 * Loaded once and cloned per rock, exactly as the trees are.
 */

const ROCK_ROOT = 'models/rocks';

export type RockKind = 'pebble' | 'boulder' | 'outcrop';

/** Vertical exaggeration applied while normalising.
 *
 * `outcrop.glb` is a landscape tile — 2448 x 3927 across and only 683 tall, so
 * scaled honestly it lies on the grass as a barely-there swell. Stretched, the
 * same mesh reads as a hill on the skyline, which is the job it is doing.
 * Stones are already rock-shaped and are left alone. */
const HEIGHT_BOOST: Record<RockKind, number> = { pebble: 1, boulder: 1, outcrop: 4.2 };

const STONE_NODES = ['stone1', 'stone2', 'stone3', 'stone4', 'stone5', 'stone6'];

export interface RockModels {
  /** A clone scaled so its footprint is one unit across and its base sits at
   * y=0, or null when that class of rock did not load. The caller scales it to
   * the size it wants, which is why the footprint rather than the height is
   * what gets normalised: the placement needs to know how much ground a rock
   * covers, so that it can keep trees out of it. */
  build: (kind: RockKind, seed: number) => THREE.Object3D | null;
  loaded: number;
}

/** Fits a model to a one-unit footprint, centres it on its own origin and
 * stands it on the ground.
 *
 * Footprint rather than height, unlike the trees: a tree means its height, and
 * a rock means the ground it takes up. */
function normalise(node: THREE.Object3D, heightBoost: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(node);
  const size = new THREE.Vector3();
  box.getSize(size);

  const footprint = Math.max(size.x, size.z) || 1;
  node.scale.set(1 / footprint, heightBoost / footprint, 1 / footprint);

  const scaled = new THREE.Box3().setFromObject(node);
  const centre = new THREE.Vector3();
  scaled.getCenter(centre);
  node.position.set(-centre.x, -scaled.min.y, -centre.z);

  // Wrapped so the offsets survive `clone()`, for the same reason the trees are.
  const wrapper = new THREE.Group();
  wrapper.add(node);
  return wrapper;
}

export async function loadRockModels(): Promise<RockModels> {
  const loader = new GLTFLoader();
  const cache: Record<RockKind, THREE.Object3D[]> = { pebble: [], boulder: [], outcrop: [] };
  let loaded = 0;

  /* `names` splits one file into several models.
   *
   * The stone pack is a single glb holding six separate stones as top-level
   * nodes. Keeping the whole file and hiding all but one — rather than cutting
   * the .obj into six files before conversion — means no index surgery on the
   * source, and the root's own transform comes along with each stone. */
  const take = async (file: string, kind: RockKind, names: string[] | null) => {
    try {
      const gltf = await loader.loadAsync(`${ROCK_ROOT}/${file}`);
      for (const name of names ?? [null]) {
        const root = gltf.scene.clone(true);
        if (name) {
          for (const child of [...root.children]) if (child.name !== name) root.remove(child);
          if (root.children.length === 0) continue;
        }
        cache[kind].push(normalise(root, HEIGHT_BOOST[kind]));
        loaded += 1;
      }
    } catch {
      // Absent scenery just means bare ground. The trees are the screen.
    }
  };

  await Promise.all([
    take('stones.glb', 'pebble', STONE_NODES),
    take('stone-slab.glb', 'boulder', null),
    take('outcrop.glb', 'outcrop', null),
  ]);

  const build = (kind: RockKind, seed: number) => {
    const list = cache[kind];
    if (list.length === 0) return null;
    return list[Math.abs(seed) % list.length].clone(true);
  };

  return { build, loaded };
}
