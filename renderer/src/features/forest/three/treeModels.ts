import * as THREE from 'three';

/** The flora, built from primitives.
 *
 * These are the fallback, and a real one: flat shading on a few cones and a
 * tapered cylinder is how low-poly foliage is made, so the diorama looks
 * finished with nothing downloaded. Converted OBJ packs drop in alongside —
 * see assetLoader and docs/forest-models.md.
 *
 * Five species rather than three, because a plot of one shape repeated reads
 * as wallpaper however well it is lit. Species comes from the word, size comes
 * from the stage, and the two are independent: a word is always the same plant,
 * and it only ever gets bigger by being remembered for longer.
 */

export type Species = 'broadleaf' | 'conifer' | 'shrub' | 'flower' | 'mushroom';
/** Only the three the model pack covers are planted. Flower and mushroom stay
 * in the type because their procedural builders are still the fallback when a
 * GLB is missing — but a diorama mixing textured trees with flat-shaded blobs
 * reads as two art styles rather than one garden. */
export const SPECIES: Species[] = ['broadleaf', 'conifer', 'shrub'];

/** Six stages: Seed, Sprout, Seedling, Sapling, Young tree, Ancient tree. */
const SCALE = [0.42, 0.68, 0.92, 1.18, 1.5, 1.9];

/** Part names the scene looks for when applying materials. A mesh named
 * `accent` keeps its own colour — a mushroom cap stays red whatever the
 * health of the word is, or the plot stops reading as a garden. */
const TRUNK = 'trunk';
const CANOPY = 'canopy';
const ACCENT = 'accent';

function mesh(geometry: THREE.BufferGeometry, name: string, y: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry);
  m.name = name;
  m.position.y = y;
  return m;
}

function conifer(group: THREE.Group): void {
  const trunkHeight = 0.35;
  group.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, trunkHeight, 6), TRUNK, trunkHeight / 2));
  // Three stacked cones, each narrower — the silhouette that reads as "pine"
  // at any size, which matters when a plot holds plants a tenth of each other.
  for (let tier = 0; tier < 3; tier += 1) {
    const r = 0.36 - tier * 0.09;
    group.add(mesh(new THREE.ConeGeometry(r, 0.42, 7), CANOPY, trunkHeight + 0.16 + tier * 0.26));
  }
}

function broadleaf(group: THREE.Group): void {
  const trunkHeight = 0.42;
  group.add(mesh(new THREE.CylinderGeometry(0.05, 0.075, trunkHeight, 6), TRUNK, trunkHeight / 2));
  const crown = mesh(new THREE.DodecahedronGeometry(0.34, 0), CANOPY, trunkHeight + 0.26);
  crown.scale.set(1.15, 0.85, 1.15);
  group.add(crown);
  const side = mesh(new THREE.DodecahedronGeometry(0.2, 0), CANOPY, trunkHeight + 0.14);
  side.position.x = 0.22;
  group.add(side);
}

function shrub(group: THREE.Group): void {
  // A clump of blades. Six is enough to read as grass and cheap enough to
  // repeat across a whole plot.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const blade = mesh(new THREE.ConeGeometry(0.055, 0.42 + (i % 3) * 0.1, 3), CANOPY, 0.2);
    blade.position.set(Math.cos(angle) * 0.1, 0.21, Math.sin(angle) * 0.1);
    blade.rotation.z = Math.cos(angle) * 0.35;
    blade.rotation.x = Math.sin(angle) * 0.35;
    group.add(blade);
  }
}

function flower(group: THREE.Group): void {
  const stemHeight = 0.42;
  group.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, stemHeight, 5), CANOPY, stemHeight / 2));
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const petal = mesh(new THREE.SphereGeometry(0.09, 5, 4), ACCENT, stemHeight + 0.03);
    petal.scale.set(1, 0.4, 1.5);
    petal.position.set(Math.cos(angle) * 0.11, stemHeight + 0.03, Math.sin(angle) * 0.11);
    petal.rotation.y = -angle;
    group.add(petal);
  }
  const heart = mesh(new THREE.SphereGeometry(0.06, 6, 5), TRUNK, stemHeight + 0.06);
  group.add(heart);
}

function mushroom(group: THREE.Group): void {
  const stemHeight = 0.26;
  group.add(mesh(new THREE.CylinderGeometry(0.055, 0.075, stemHeight, 6), TRUNK, stemHeight / 2));
  const cap = mesh(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), ACCENT, stemHeight);
  cap.scale.set(1, 0.75, 1);
  group.add(cap);
}

const BUILDERS: Record<Species, (g: THREE.Group) => void> = {
  conifer,
  broadleaf,
  shrub,
  flower,
  mushroom,
};

/** One plant, meshes only — the caller applies materials so colour can carry
 * the word's health without rebuilding any geometry. */
export function buildTree(stage: number, species: Species): THREE.Group {
  const s = Math.max(0, Math.min(5, stage));
  const group = new THREE.Group();

  if (s === 0) {
    // A seed is a mound of earth with one shoot. Drawing a small tree for a
    // word that has never been recalled would overstate what the learner has.
    const mound = mesh(new THREE.SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), TRUNK, 0);
    mound.scale.set(1, 0.45, 1);
    group.add(mound);
    const shoot = mesh(new THREE.ConeGeometry(0.03, 0.14, 4), CANOPY, 0.11);
    group.add(shoot);
    return group;
  }

  BUILDERS[species](group);
  group.scale.setScalar(SCALE[s]);
  return group;
}

/** Which plant a word grows into.
 *
 * Derived from the word rather than stored: the same word must be the same
 * plant every time the screen opens, and a `species` column would be one more
 * thing to keep in step with nothing.
 */
export function speciesFor(word: string): Species {
  let hash = 0;
  for (let i = 0; i < word.length; i += 1) hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
  return SPECIES[hash % SPECIES.length];
}

/** Foliage: healthy green through to the grey of a dormant plant.
 *
 * Health and dormancy read differently on purpose. A wilting plant is still
 * green, only duller — it is recoverable. A dormant one has no colour left,
 * because the word has effectively been lost. */
export function canopyColour(health: number, dormant: boolean): THREE.Color {
  if (dormant) return new THREE.Color(0x9a9a8e);
  const t = Math.max(0, Math.min(1, health / 100));
  return new THREE.Color(0xc2a85a).lerp(new THREE.Color(0x63b355), t);
}

/** Petals and mushroom caps keep their own colour whatever the health, or the
 * plot stops reading as a garden. Picked from the word so it is stable. */
export function accentColour(word: string, dormant: boolean): THREE.Color {
  if (dormant) return new THREE.Color(0xa3a396);
  const palette = [0xe05a4e, 0x4a90d9, 0xf2b134, 0xe8739f, 0xf07a34];
  let hash = 0;
  for (let i = 0; i < word.length; i += 1) hash = (hash * 17 + word.charCodeAt(i)) >>> 0;
  const c = new THREE.Color(palette[hash % palette.length]);
  return c;
}

export const TRUNK_COLOUR = 0x8a6a45;
