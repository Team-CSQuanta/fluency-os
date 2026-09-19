# Using real 3D tree models in the Forest

The Forest ships with procedural low-poly trees built from three.js primitives.
They are a genuine fallback, not a placeholder — flat-shaded cones and a tapered
trunk is how low-poly foliage is made — so the feature is complete without any
downloaded assets. This describes how to swap in real ones.

## Why the models are not already here

The three packs you linked are on CGTrader, which requires a signed-in browser
session to download. There is no direct asset URL, so I could not fetch them:
the page returns nothing at all to a non-browser client. You will need to
download them yourself.

Check the licence on each before committing the files. CGTrader's free models
are usually under their Royalty Free License, which permits use in a product
but restricts **redistributing the model files themselves** — which is what
committing them to a public repository does. For coursework this is very likely
fine; for anything public, read the licence on the model page.

## What the loader looks for

    renderer/public/models/trees/<species>-<stage>.glb

`species` is one of `broadleaf`, `conifer`, `shrub`. `stage` is `0`–`5`:

| stage | name         | meaning                                   |
|-------|--------------|-------------------------------------------|
| 0     | Seed         | never successfully recalled                |
| 1     | Sprout       | holds for under 3 days                     |
| 2     | Seedling     | under a week                               |
| 3     | Sapling      | under three weeks                          |
| 4     | Young tree   | under two months                           |
| 5     | Ancient tree | two months or more                         |

Eighteen files fills every slot. **Anything missing falls back to the
procedural tree**, so a half-converted pack works: convert `broadleaf-5.glb`
alone and the biggest broadleaf trees become real models while everything else
keeps growing as before.

You do not need to match sizes. The loader measures each model and rescales it
so its height matches the stage, because these packs disagree about units —
one of them is in centimetres.

## Which download to take

CGTrader offers several. Take **`obj.zip`** (and `texture.zip`, which is tiny).

| file        | verdict                                                          |
|-------------|------------------------------------------------------------------|
| `obj.zip`   | **This one.** Converts with `obj2gltf`, a pure-JS tool — no extra software. Keeps separate named objects, which is what lets a 200-tree pack be split into individual trees. |
| `texture.zip` | Worth taking. The Forest applies its own materials so colour can carry a word's health, but the source colours are useful to sample. |
| `fbx.zip`   | Backup. `fbx2gltf` needs a native binary that may not run everywhere. |
| `trees.blend` | Needs Blender installed — about 300 MB for a conversion `obj2gltf` does in milliseconds. |
| `stl.zip`   | No use here. STL carries no colour, no materials and no object separation; it is a 3D-printing format. |

## Converting OBJ to GLB

Browsers cannot read `.obj` directly. `obj2gltf` handles it with no install:

```bash
npx obj2gltf -i pack/Tree_01.obj -o renderer/public/models/trees/conifer-5.glb
```

Verified on a multi-object OBJ: named objects and materials both survive, which
is what makes splitting a large pack possible.

### If you only have FBX or .blend

Blender does every format and is scriptable, so it needs no clicking:

```bash
blender --background --python-expr "
import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath='pack/Tree_01.fbx')   # or import_scene.obj
bpy.ops.export_scene.gltf(
    filepath='renderer/public/models/trees/broadleaf-5.glb',
    export_format='GLB', export_apply=True)
"
```

Two things worth doing while you are in there:

- **Drop the textures.** The Forest applies its own material to every mesh, so
  a tree's colour can carry its health. A textured model will be recoloured
  anyway, and the texture is dead weight in the bundle.
- **Keep the polygon count low.** A learner with two thousand words has two
  thousand trees on screen. The procedural trees are 20–80 triangles each; a
  10,000-triangle model is fine for one hero tree and not for a forest.

## Which pack suits which slot

From the three you linked:

- **Lowpoly Tree Collection (200 trees)** — the obvious source for stages 3–5,
  where a tree should look like a specific tree.
- **Low Poly Nature Pack** — usually has rocks, bushes and grass alongside the
  trees; the bushes suit `shrub`, the small plants suit stages 1–2.
- **Low Poly Trees** — a good source for `conifer`.

The mapping is yours to choose: the loader only cares about the filename.

## Checking it worked

Open the Forest. The loader counts what it found, and the scene is rebuilt when
that count changes, so a model appearing mid-session is picked up on the next
visit to the screen. If a tree looks wrong-sized, the model's origin is probably
not at its base — the loader corrects for that by measuring the bounding box,
but a model with stray geometry far from the trunk will measure wrongly.
