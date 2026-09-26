import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TreeOut } from '@/types/api';
import { loadTreeModels, type TreeFactory } from './assetLoader';
import { loadRockModels, type RockKind, type RockModels } from './rockLoader';
import { accentColour, canopyColour, speciesFor, TRUNK_COLOUR } from './treeModels';

/** The forest: every saved word planted on open ground, seen from a fixed
 * corner.
 *
 * Orthographic rather than perspective. A perspective camera makes the trees at
 * the back smaller than the ones at the front, which is exactly the signal this
 * screen uses for something else — size means how well a word is known. Under
 * orthographic projection two trees at the same stage are the same size
 * wherever they stand, so height can only ever mean memory.
 *
 * Not react-three-fiber: the scene changes only when the vocabulary does, so a
 * per-frame React loop would redraw an identical picture sixty times a second.
 * It renders on demand — while the camera moves, and not otherwise.
 */

const PALETTE = {
  /** Overhead, a little above the skyline, and at the skyline itself. The
   * ground fades into the last one, so land meets sky with no seam. */
  skyTop: '#2d7cc4',
  skyMid: '#6bb4e8',
  skyHaze: '#aed5ec',
  horizon: 0xaed5ec,
  grass: 0x6fb845,
  soil: 0x8a6440,
  soilDark: 0x6d4f33,
};

/** Grey rock, in a few shades so a scattering of stones is not obviously the
 * same stone repeated. Deliberately desaturated: the trees carry every colour
 * on this screen that means something. */
const ROCK_COLOURS = [0x9a9891, 0x8b8982, 0x7e7c75, 0x93908a, 0x84827b];
/** Cooler and darker, for the hills near the skyline, which the haze then
 * takes most of the way to the colour of the sky behind them. */
const OUTCROP_COLOURS = [0x7f8b91, 0x748087, 0x88949a];

/** The sky, as a vertical strip running from below the skyline to well above it.
 *
 * Drawn once into a canvas and stretched, rather than a sky dome: the gradient
 * is one dimensional, so a few thousand triangles would draw exactly what a
 * stretched image draws.
 *
 * The stops are positioned against the strip the caller hangs this on, which
 * spans an equal distance above and below the ground — so the middle of the
 * image, 0.5, is the skyline. Everything below it is the haze colour, and the
 * blue arrives quickly above it, within about the first fifth of the strip,
 * because that is the only part a learner ever sees: at this camera angle the
 * band of visible sky is thin, and a gradient spread evenly over the whole
 * strip left all of it washed out. */
function skyTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.2, PALETTE.skyTop);
    gradient.addColorStop(0.4, PALETTE.skyMid);
    gradient.addColorStop(0.481, PALETTE.skyHaze);
    gradient.addColorStop(1, PALETTE.skyHaze);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Small deterministic PRNG. The planting must be identical every time the
 * screen opens — a forest that rearranges itself on each visit is not a place. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where each tree stands.
 *
 * Best-candidate sampling: for every tree, throw a handful of darts into the
 * clearing and keep the one furthest from everything already planted. The
 * result is blue noise — evenly spread but with no row, column or spiral in it.
 *
 * A grid was the obvious thing and looked like an orchard; jittering the grid
 * only made a wonky orchard, because the eye finds the rows anyway. Pure random
 * placement is the other trap: it clumps, and trees end up inside each other.
 */
function plantingSpots(count: number, radius: number): Array<[number, number]> {
  const rng = mulberry32(0x5eed);
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    let best: [number, number] = [0, 0];
    let bestDistance = -1;
    for (let dart = 0; dart < 12; dart += 1) {
      const angle = rng() * Math.PI * 2;
      // sqrt keeps the density even: without it everything crowds the middle.
      const r = radius * Math.sqrt(rng());
      const candidate: [number, number] = [Math.cos(angle) * r, Math.sin(angle) * r];
      let nearest = Infinity;
      for (const [x, z] of spots) {
        const d = (x - candidate[0]) ** 2 + (z - candidate[1]) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    spots.push(best);
  }
  return spots;
}

/** How much room a tree wants to itself, beyond the rock's own footprint. */
const TREE_ROOM = 0.34;

interface RockSpot {
  kind: RockKind;
  x: number;
  z: number;
  /** Half the ground the rock covers, which is also what keeps trees out. */
  radius: number;
  spin: number;
  stretch: number;
  lift: number;
}

/** Where the stones, boulders and hills go.
 *
 * Rejection sampling against the trees, which are placed first and never move.
 * The order matters and it is not arbitrary: where a word stands is the only
 * thing on this screen that carries meaning, and a word must be the same tree
 * in the same place every time the forest is opened. Scenery is not allowed to
 * push that around. So a rock that cannot find ground clear of the trees is
 * simply not placed — and nothing is ever planted inside a rock, because the
 * rock went elsewhere.
 *
 * The three bands scale with the clearing rather than being fixed, so a
 * vocabulary that grows from a dozen words to a hundred gains scenery across
 * the extra ground instead of leaving it bare.
 */
function scatterRocks(
  treeSpots: Array<[number, number]>,
  clearing: number,
  reach: number,
  count: number,
): RockSpot[] {
  const rng = mulberry32(0xb07c17);
  const placed: RockSpot[] = [];

  /* Biggest first, and it has to be that way round.
   *
   * Each rock keeps clear of everything already placed, so whatever goes down
   * first gets the run of the plot and whatever goes last fits in the gaps. A
   * mountain asks for more clear ground than everything else put together; put
   * the stones down before it and there is nowhere left wide enough, and the
   * mountains quietly fail to appear at all. Small things fit around big ones,
   * never the reverse. */
  const bands = [
    /* Mountains: rare, and very large. Only outside the wood — a rock this
     * size needs more clear ground than the gap between two trees ever offers,
     * so the ring past the last tree is not a style choice. It is also why the
     * ground has to end as far out as it does: a mountain must fit whole
     * between the outermost tree and the edge of the world, or it hangs off
     * the end of it. */
    { kind: 'outcrop' as RockKind, n: Math.min(4, 1 + Math.floor(count / 20)), min: 1.0, max: 1.45, from: clearing * 1.7, to: clearing * 1.88, tries: 80 },
    { kind: 'boulder' as RockKind, n: Math.round(count * 0.12) + 1, min: 0.16, max: 0.28, from: clearing * 0.2, to: reach, tries: 40 },
    // Small enough to sit in the gaps between trees, and much the commonest
    // thing on the ground — roughly eight of these to every boulder.
    { kind: 'pebble' as RockKind, n: Math.round(count * 0.95) + 8, min: 0.05, max: 0.13, from: 0, to: reach, tries: 40 },
  ];

  for (const band of bands) {
    for (let i = 0; i < band.n; i += 1) {
      const radius = band.min + rng() * (band.max - band.min);
      let spot: RockSpot | null = null;
      for (let attempt = 0; attempt < band.tries && !spot; attempt += 1) {
        const angle = rng() * Math.PI * 2;
        // sqrt for even density, as with the trees.
        const r = band.from + (band.to - band.from) * Math.sqrt(rng());
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const room = (radius + TREE_ROOM) ** 2;
        if (!treeSpots.every(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 > room)) continue;
        if (!placed.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (radius + o.radius + 0.06) ** 2)) continue;
        spot = {
          kind: band.kind,
          x,
          z,
          radius,
          spin: rng() * Math.PI * 2,
          // One boulder mesh and one hill mesh have to furnish the whole plot,
          // so each is turned and squashed a little to break the repetition.
          stretch: 0.85 + rng() * 0.3,
          lift: 0.8 + rng() * 0.45,
        };
      }
      if (spot) placed.push(spot);
    }
  }
  return placed;
}

export function ForestScene({
  trees,
  focusWord,
  markedWord,
  onHover,
  onSelect,
}: {
  trees: TreeOut[];
  /** The tree to centre the camera on when the screen opens — arriving from
   * "see plant" on a word's vocabulary page. Without it a learner lands on a
   * clearing of two dozen trees with no idea which they came to look at. */
  focusWord?: string | null;
  /** The tree currently ringed. Follows clicks, so the marker moves instead of
   * staying on whatever the learner arrived at. */
  markedWord?: string | null;
  onHover: (tree: TreeOut | null) => void;
  onSelect: (tree: TreeOut) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const factoryRef = useRef<TreeFactory | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const rocksRef = useRef<RockModels | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState<number | null>(null);

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* The ring lives outside the scene-building effect.
   *
   * Moving it by rebuilding the scene would work and would also throw away the
   * camera angle and zoom on every click — so selecting a tree would snap the
   * view back to its opening position. It is built once and repositioned. */
  const ringRef = useRef<THREE.Mesh | null>(null);
  const spotsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const requestRenderRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadTreeModels(), loadRockModels()]).then(([trees_, rocks]) => {
      if (cancelled) return;
      factoryRef.current = trees_.factory;
      textureRef.current = trees_.texture;
      rocksRef.current = rocks;
      setModelsLoaded(trees_.loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || modelsLoaded === null) return;
    const factory = factoryRef.current;
    if (!factory) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 480;

    const scene = new THREE.Scene();
    const sky = skyTexture();
    // Only ever seen above the top of the sky strip, which the frame does not
    // reach; it is here so that if it ever did, the seam would be invisible.
    scene.background = new THREE.Color(PALETTE.skyTop);

    /* How much ground the forest covers.
     *
     * Spacing follows the SIZE of what is planted, not just how much. A plot of
     * seedlings can stand close enough to read as a thicket; the same spacing
     * for full-grown trees would put every canopy inside its neighbour. Sized
     * off the mean stage, a young vocabulary looks like dense undergrowth and a
     * mature one like woodland, with neither looking scattered.
     *
     * sqrt(count) because area grows with the square of the radius — spacing
     * times the count would spread a large vocabulary across a prairie. */
    const meanStage =
      trees.reduce((total, t) => total + t.stage, 0) / Math.max(1, trees.length);
    /* Deliberately tighter than a tree is tall, so canopies touch and the plot
     * reads as woodland rather than as an arrangement. Shrinking the clearing
     * alone did nothing visible — `span` is derived from it, so the camera
     * zoomed in by exactly as much as the trees moved together. Density on
     * screen is tree size against spacing, not spacing on its own. */
    const spacing = 0.30 + meanStage * 0.18;
    const clearing = Math.max(1.5, spacing * Math.sqrt(trees.length + 1));
    /* Thin, because the sides are only ever glimpsed at the shallowest tilt.
     * A thick slab reads as a tabletop model rather than as ground. */
    const depth = 0.5;

    /* How far the land runs before the sky starts, and how much of it there is.
     *
     * An orthographic camera has no vanishing point, so an endless ground plane
     * does not converge to a horizon — it covers the whole frame, at every
     * tilt and every zoom. That is why this screen had no sky: what looked like
     * sky above the trees was distant GROUND, faded by the haze to a pale
     * near-white, and there was no blue anywhere because the actual sky was
     * behind all of it and never once visible.
     *
     * So the land is finite ahead of the viewer and effectively endless behind:
     * it stops at `horizonDistance` in front, and runs thirty clearings back,
     * and both it and the sky turn with the camera so that stays true from
     * every angle. The near edge is far enough away that no amount of zooming
     * out reaches it, which is what stopped the forest looking like an island.
     *
     * `horizonDistance` is the whole trade-off in one number. Under
     * orthographic projection the skyline sits at `horizonDistance * sin(tilt)`
     * up the frame, so the nearer the land ends the more sky there is — but it
     * has to clear the outermost tree AND the ring of hills beyond them, or
     * they hang over the edge into nothing. Mountains large enough to stand
     * over the trees need an annulus almost two clearings wide to sit in, and
     * 2.8 is the closest the land can end while leaving them room. The tilt is
     * flattened to pay for it: a lower angle puts the skyline further down the
     * frame, which hands back exactly the sky the wider ground cost. */
    const horizonDistance = clearing * 2.8;
    const groundSpan = clearing * 30;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    /* How far the camera stands off. Under orthographic projection this does
     * not change how big anything looks — only `span` does — but it is what
     * every fog distance has to be measured from. */
    const cameraDistance = clearing * 4;
    const span = clearing * 1.35;
    const aspect = width / height;
    const camera = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, -200, 400);
    let spin = Math.PI * 0.25;
    /* Lower than true isometric (35.26°) so the horizon is in frame.
     *
     * At the isometric angle the ground — which runs far past the view in every
     * direction — fills the picture completely and there is no sky in it at
     * all. Tilting down to about 23° brings the far distance into the top of
     * the frame, where fog has already faded it to the sky's own horizon
     * colour, so land becomes sky with no seam. */
    let tilt = 0.30;
    let zoom = 1;

    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(5, 9, 3);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8ccc4, 1.15));

    /* Open ground running past the frame in every direction, fading out at the
     * far edge so it has no visible end. */
    const soil = new THREE.MeshStandardMaterial({ color: PALETTE.soil, flatShading: true, roughness: 1 });
    const soilDark = new THREE.MeshStandardMaterial({ color: PALETTE.soilDark, flatShading: true, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: PALETTE.grass, flatShading: true, roughness: 0.95 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(groundSpan, depth, groundSpan), [
      soil, soil, grass, soilDark, soil, soil,
    ]);
    scene.add(block);

    /* The sky: a wall standing where the ground stops.
     *
     * Not `scene.background`, which is painted in screen space and so cannot
     * know where the skyline is — its gradient would slide up and down the
     * frame as the learner tilts and zooms, and meet the ground at a different
     * colour every time. Anchored in the world at the same distance the ground
     * ends, its base is always exactly the skyline, so the haze the land fades
     * into and the haze the sky rises out of are the same pixel.
     *
     * Painted first with the depth test off, so it is a backdrop rather than
     * scenery: anything solid drawn afterwards covers it, and the distance it
     * stands at never has to be reconciled against the ground in front of it. */
    const skyWall = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSpan, clearing * 8),
      new THREE.MeshBasicMaterial({
        map: sky,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    skyWall.renderOrder = -1;
    scene.add(skyWall);

    /* Haze, ending just short of where the land does.
     *
     * Its only job is to stop the ground finishing at a visible line: by the
     * time the edge arrives it is already the colour of the sky sitting behind
     * it. Both distances are set per frame in `place()`, because how much
     * ground lies between the camera and the edge depends on the tilt — from
     * overhead there is almost none, and a fixed near distance would then put
     * the haze in front of the forest instead of behind it. */
    const fog = new THREE.Fog(PALETTE.horizon, cameraDistance, cameraDistance * 2);
    scene.fog = fog;

    const picked: Array<{ tree: TreeOut; object: THREE.Object3D }> = [];
    const shadowGeometry = new THREE.CircleGeometry(0.26, 12);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x2c4a22, transparent: true, opacity: 0.16, depthWrite: false,
    });
    const spots = plantingSpots(trees.length, clearing);
    let focusAt: [number, number] | null = null;

    trees.forEach((tree, i) => {
      const [x, z] = spots[i];
      const species = speciesFor(tree.word);
      const object = factory(tree.stage, species, tree.dormant, tree.word);

      /* One material per tree, carrying the shared atlas and this word's tint.
       *
       * The tint MULTIPLIES the texture, so a healthy tree shows the colours it
       * was drawn with — green leaves, brown trunk — and a struggling one goes
       * amber throughout. Replacing the material with a flat colour, which is
       * what this did first, turned every trunk the same green as its leaves. */
      const fromPack = object.userData.fromPack === true && textureRef.current;
      const packMaterial = fromPack
        ? new THREE.MeshStandardMaterial({
            map: textureRef.current,
            color: healthTint(tree.health, tree.dormant),
            flatShading: true,
            roughness: 0.95,
          })
        : null;
      const canopy = new THREE.MeshStandardMaterial({
        color: canopyColour(tree.health, tree.dormant), flatShading: true, roughness: 0.95,
      });
      const trunk = new THREE.MeshStandardMaterial({
        color: TRUNK_COLOUR, flatShading: true, roughness: 1,
      });
      const accent = new THREE.MeshStandardMaterial({
        color: accentColour(tree.word, tree.dormant), flatShading: true, roughness: 0.9,
      });
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (packMaterial) {
          child.material = packMaterial;
          return;
        }
        child.material = child.name === 'trunk' ? trunk : child.name === 'accent' ? accent : canopy;
      });

      object.position.set(x, 0, z);
      object.rotation.y = (i % 8) * 0.78;
      scene.add(object);
      picked.push({ tree, object });

      spotsRef.current.set(tree.word, [x, z, tree.stage]);

      if (focusWord && tree.word === focusWord) focusAt = [x, z];

      // A painted shadow rather than a shadow map: at this scale a real one
      // costs a depth pass per frame to draw a soft blob, which is all the
      // stylised look wants anyway.
      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(x, 0.012, z);
      shadow.scale.setScalar(0.5 + tree.stage * 0.2);
      scene.add(shadow);
    });

    /* Scenery, on whatever ground the trees left over.
     *
     * Every rock carries a shared material rather than one of its own: there
     * are forty-odd of them and they all want to be the same few greys, so
     * five materials do the work of forty and five get disposed at the end. */
    const rockKit = rocksRef.current;
    if (rockKit && rockKit.loaded > 0) {
      const stone = ROCK_COLOURS.map(
        (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }),
      );
      const hill = OUTCROP_COLOURS.map(
        (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }),
      );
      scatterRocks(spots, clearing, horizonDistance * 0.85, trees.length).forEach((rock, i) => {
        const model = rockKit.build(rock.kind, i * 2654435761);
        if (!model) return;
        const palette = rock.kind === 'outcrop' ? hill : stone;
        const material = palette[i % palette.length];
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) child.material = material;
        });
        const width = rock.radius * 2;
        model.scale.set(width * rock.stretch, width * rock.lift, width);
        // Sunk very slightly, so a rock sits IN the ground rather than on it.
        model.position.set(rock.x, -rock.radius * 0.12, rock.z);
        model.rotation.y = rock.spin;
        scene.add(model);

        const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(rock.x, 0.008, rock.z);
        shadow.scale.setScalar(rock.radius * 3.2);
        scene.add(shadow);
      });
    }

    /* One ring, moved as the selection changes. A ring on the ground rather
     * than a tint on the tree: the tree's own colour already carries its
     * health, and overriding that would replace the information with the
     * pointer to it. */
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd35c, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    ringRef.current = ring;

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let needsRender = true;

    const place = () => {
      const r = cameraDistance;
      const [cx, cz] = focusAt ?? [0, 0];
      camera.position.set(
        cx + Math.cos(tilt) * Math.sin(spin) * r,
        Math.sin(tilt) * r,
        cz + Math.cos(tilt) * Math.cos(spin) * r,
      );
      // Centred on the singled-out tree when there is one, so it is not merely
      // ringed but actually in front of the learner.
      if (focusAt) camera.lookAt(focusAt[0], 0, focusAt[1]);
      else camera.lookAt(0, 0, 0);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();

      /* The land and the sky swing round to face the camera.
       *
       * The ground has to stop at a fixed distance IN FRONT and run far behind,
       * and which way is "in front" changes as the learner orbits. A slab that
       * simply sat there would work from one angle and show its near edge from
       * the opposite one. Rotating it keeps the far edge square to the view, so
       * the skyline stays a level line rather than a corner. */
      const fx = -Math.sin(spin);
      const fz = -Math.cos(spin);
      const back = horizonDistance - groundSpan / 2;
      block.rotation.y = spin;
      block.position.set(cx + fx * back, -depth / 2, cz + fz * back);
      skyWall.rotation.y = spin;
      skyWall.position.set(cx + fx * horizonDistance, 0, cz + fz * horizonDistance);

      /* How much ground lies between the camera and the edge, which is what the
       * haze has to cover. Shrinks towards nothing as the view tilts overhead —
       * and correctly so: from above, the edge is off the top of the frame and
       * there is nothing to hide. The floors keep the near distance beyond the
       * outermost tree and the far distance beyond the near one. */
      const edge = horizonDistance * Math.cos(tilt);
      fog.near = cameraDistance + Math.max(clearing * 1.05, edge * 0.5);
      fog.far = Math.max(fog.near + clearing * 0.45, cameraDistance + edge * 1.02);
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const el = renderer.domElement;

    /** Which tree is under the pointer, or null. */
    const treeAt = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(picked.map((p) => p.object), true)[0];
      if (!hit) return null;
      return (
        picked.find((p) => {
          let node: THREE.Object3D | null = hit.object;
          while (node) {
            if (node === p.object) return true;
            node = node.parent;
          }
          return false;
        })?.tree ?? null
      );
    };

    const onDown = (e: PointerEvent) => {
      // Otherwise an orbit that runs off the edge of the canvas turns into a
      // text selection across whatever it lands on.
      e.preventDefault();
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      // A drag that happens to end over a tree is not a click on it. Five
      // pixels of slack, because a deliberate click still moves the mouse a
      // little between press and release.
      if (dragging && moved < 5) {
        const tree = treeAt(e.clientX, e.clientY);
        if (tree) onSelectRef.current(tree);
      }
      dragging = false;
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
        spin -= (e.clientX - lastX) * 0.007;
        // Clamped short of overhead and of the horizon: past either the ground
        // turns edge-on and the forest stops being readable.
        tilt = Math.max(0.2, Math.min(1.35, tilt + (e.clientY - lastY) * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        needsRender = true;
        return;
      }
      onHoverRef.current(treeAt(e.clientX, e.clientY));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // The lower bound is what stops the learner zooming out past the fade
      // and finding the end of the world.
      zoom = Math.max(0.75, Math.min(3.5, zoom - e.deltaY * 0.0012));
      needsRender = true;
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('wheel', onWheel, { passive: false });

    requestRenderRef.current = () => {
      needsRender = true;
    };

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!needsRender) return;
      needsRender = false;
      place();
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth || width;
      const h = mount.clientHeight || height;
      const a = w / h;
      camera.left = -span * a;
      camera.right = span * a;
      camera.top = span;
      camera.bottom = -span;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      needsRender = true;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('wheel', onWheel);
      // GPU buffers are not released with the DOM node; they leak until the
      // geometry and materials are disposed by hand.
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const m = child.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      ringRef.current = null;
      spotsRef.current.clear();
      sky.dispose();
      renderer.dispose();
      mount.removeChild(el);
    };
  }, [trees, modelsLoaded, focusWord]);

  /* Move the ring when the selection changes, without touching the scene.
   *
   * Deliberately its own effect with its own deps: putting `markedWord` in the
   * scene-building effect would tear down and rebuild every tree on each
   * click, and take the camera angle and zoom with it — so selecting a tree
   * would snap the view back to where it started. */
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const spot = markedWord ? spotsRef.current.get(markedWord) : undefined;
    if (spot) {
      const [x, z, stage] = spot;
      ring.position.set(x, 0.02, z);
      ring.scale.setScalar(0.85 + stage * 0.16);
      ring.visible = true;
    } else {
      ring.visible = false;
    }
    requestRenderRef.current();
  }, [markedWord, modelsLoaded, trees]);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      {modelsLoaded === null && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-tx3">
          growing the forest…
        </div>
      )}
    </div>
  );
}

/** Multiplies a textured model's own colours rather than replacing them.
 *
 * White leaves the pack's artwork untouched, which is what a healthy tree
 * should look like. Squared, so the amber only arrives once a word is genuinely
 * in trouble: linear made a forest of 66%-health words — which is most of a
 * real vocabulary, since anything a few days overdue lands there — look
 * uniformly sickly when nothing much was wrong with it. */
function healthTint(health: number, dormant: boolean): THREE.Color {
  const base = new THREE.Color(0xffffff);
  if (!dormant) {
    const t = Math.max(0, Math.min(1, health / 100));
    base.lerp(new THREE.Color(0xd8b166), (1 - t) * (1 - t));
  }
  return base;
}
