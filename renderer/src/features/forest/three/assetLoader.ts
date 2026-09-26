import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildTree, type Species } from './treeModels';

/** Real models where they exist, procedural ones where they do not.
 *
 *     public/models/trees/<kind>-<stage>-<variant>.glb
 *
 * `kind` is `leafy` or `bare`, `stage` is 0-5, and `variant` distinguishes the
 * several trees available at each stage. Anything missing falls back to the
 * built-in geometry, so a partly converted pack still works.
 *
 * **Why variants rather than one model per species.** Which species a word
 * grows into is a hash of the word, so it was always arbitrary — nothing reads
 * "this is a conifer because the word is conifer-ish". What a learner actually
 * notices is repetition: a plot where every tree at the same stage is the same
 * tree looks printed. So the whole pack is binned by how developed each tree
 * looks, and the word picks one of the several at its stage.
 *
 * Everything is fetched once and cloned per tree; a pack parsed per tree would
 * be parsed hundreds of times.
 */

const MODEL_ROOT = 'models/trees';
const STAGES = 6;
const VARIANTS = 8; // probed; missing ones are simply absent from the cache
/** A forgotten word stands as bare wood rather than a duller green. */
const LEAFY = 'leafy';
const BARE = 'bare';

/** `seed` is the word itself: a word must be the same tree every time the
 * screen opens, and keying the variant on species+stage alone gave every word
 * at a stage the identical model — which is the repetition variants exist to
 * remove. */
export type TreeFactory = (
  stage: number,
  species: Species,
  dormant?: boolean,
  seed?: string,
) => THREE.Object3D;

/** Scales a model to the height its stage should be, centres it on its own
 * origin, and stands it on the ground.
 *
 * The centring is not optional. A pack lays its models out side by side in one
 * scene, so each tree's vertices carry the position it had in that row — split
 * them apart and every tree still "remembers" where it stood. Planting one then
 * puts the ORIGIN at the intended spot and the tree somewhere off in the
 * distance: a plot of correctly placed shadows with nothing above them.
 *
 * Wrapped in a Group so the offsets survive `clone()`.
 */
function normalise(scene: THREE.Object3D, targetHeight: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  /* Fit to height AND to width, whichever binds.
   *
   * A few entries in the pack are not single trees but small clusters. Scaled
   * by height alone a cluster comes out the right height and four times too
   * wide, and it swallows its neighbours — one of them covered a quarter of the
   * plot. Capping the footprint costs a correct-looking tree nothing, because
   * for a real single tree the height is what binds anyway. */
  const byHeight = size.y > 0 ? targetHeight / size.y : 1;
  const footprint = Math.max(size.x, size.z);
  const byWidth = footprint > 0 ? (targetHeight * 0.95) / footprint : byHeight;
  scene.scale.setScalar(Math.min(byHeight, byWidth));

  const scaled = new THREE.Box3().setFromObject(scene);
  const centre = new THREE.Vector3();
  scaled.getCenter(centre);
  scene.position.set(-centre.x, -scaled.min.y, -centre.z);

  const wrapper = new THREE.Group();
  wrapper.add(scene);
  return wrapper;
}

/* Sized against the planting cell (0.95), not in the abstract.
 *
 * An Ancient tree at 1.8 on a 0.82 cell is over twice its plot and its canopy
 * sits on top of its neighbours — a mature forest turned into one green mass
 * with the trees underneath unreadable. Capped a little above one cell, the
 * tallest tree still towers over a seedling without eating it. */
const TARGET_HEIGHT = [0.40, 0.58, 0.80, 1.05, 1.35, 1.7];

export async function loadTreeModels(): Promise<{
  factory: TreeFactory;
  loaded: number;
  texture: THREE.Texture | null;
}> {
  /* The pack's colour atlas, loaded once and applied by the caller.
   *
   * Not left to GLTFLoader. It handles an embedded texture by extracting it to
   * a blob: URL, and a referenced one by resolving a relative URI — both paths
   * failed here, the second without even issuing a request, and the only
   * symptom was every tree coming out one flat colour with its trunk the same
   * green as its leaves. One plain image load, shared by all sixty models, has
   * none of that machinery to go wrong and costs one request instead of sixty.
   */
  const texture = await new THREE.TextureLoader()
    .loadAsync(`${MODEL_ROOT}/color.jpg`)
    .then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // glTF UVs have the origin at the top left.
      return t;
    })
    .catch(() => null);

  const loader = new GLTFLoader();
  const cache = new Map<string, THREE.Object3D[]>();
  let loaded = 0;

  const jobs: Array<Promise<void>> = [];
  for (const kind of [LEAFY, BARE]) {
    for (let stage = 0; stage < STAGES; stage += 1) {
      for (let variant = 0; variant < VARIANTS; variant += 1) {
        jobs.push(
          loader
            .loadAsync(`${MODEL_ROOT}/${kind}-${stage}-${variant}.glb`)
            .then((gltf) => {
              const key = `${kind}-${stage}`;
              const list = cache.get(key) ?? [];
              list.push(normalise(gltf.scene, TARGET_HEIGHT[stage]));
              cache.set(key, list);
              loaded += 1;
            })
            // Absent is the expected case past the last variant, so it is silent.
            .catch(() => undefined),
        );
      }
    }
  }
  await Promise.all(jobs);

  const factory: TreeFactory = (stage, species, dormant = false, seed = '') => {
    const s = Math.max(0, Math.min(STAGES - 1, stage));
    const list = cache.get(`${dormant ? BARE : LEAFY}-${s}`);
    if (!list || list.length === 0) return buildTree(s, species);
    const index = Math.abs(hash(seed || species)) % list.length;
    const clone = list[index].clone(true);
    // Tells the scene this came from the pack, so it gets the atlas rather
    // than the flat materials the procedural fallbacks are built for.
    clone.userData.fromPack = true;
    return clone;
  };
  return { factory, loaded, texture };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}
