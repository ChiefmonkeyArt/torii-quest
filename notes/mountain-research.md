# Mountain & Landscape Rendering Research: Making Torii Quest's Mountains Look Fantastic

**Context:** Torii Quest currently renders a 3-ring distant mountain range in `src/atmosphere.js` (`_buildMtnPeak` / `_buildMountains`, ~v0.2.250). Each peak is a procedurally-generated low-poly pyramid: concentric vertex rings (10–12 segs × 4–6 levels) displaced by deterministic fractal noise, with per-triangle face normals dot-shaded against a fixed dawn sun direction, and vertex colors encoding snow caps, valley floors, crevices, and elevation haze. The material is `MeshBasicMaterial({ vertexColors: true, fog: true, side: DoubleSide })` — **no textures, no normal maps, no lighting, no shader code**. Three draw calls total (one BufferGeometry per ring). Heights 10–58 units, distances 78–116 units. This is already a strong, cheap silhouette system; the goal is to make it look fantastic **without** replacing it, within a ~50 KB code budget, at 60 fps on mid-range hardware, with no paid assets.

This report catalogs every credible technique, names real projects and demos to study, gives specific low-poly improvements that build on the existing vertex-color system, and ends with 3–5 ordered, actionable recommendations.

---

## 1. Techniques Catalog — Every Credible Approach for Browser Mountains

Each entry has: how it works, pros/cons **for a 60 fps browser game with a tight budget**, and a verdict for Torii Quest.

### 1.1 Heightmap-based terrain (PlaneGeometry displaced by a heightmap texture)
- **How it works:** A grayscale image encodes elevation (black = low, white = high). A subdivided `THREE.PlaneGeometry` is displaced either in JS (read pixels, set `position.array[i*3+1] = data[i] * scale`) or in the vertex shader via `displacementMap`. Three.js' `MeshPhongMaterial`/`MeshStandardMaterial` support `displacementMap` + `displacementScale` + `displacementBias` natively ([Three.js University heightmap tutorial](https://en.threejs-university.com/2022/07/19/heightmap-easily-create-a-three-js-terrain/)).
- **Pros:** Trivial to author (paint in any image editor, or export from [Tangrams Heightmapper](https://tangrams.github.io/heightmapper/)), gives you a real height field you can sample for object placement and collision, and the same heightmap can drive **both** geometry and a derived normal map (see §6.4). Deterministic and seedable.
- **Cons:** A 2D heightmap **cannot represent overhangs, caves, or true vertical cliffs** — exactly the features that make alpine mountains dramatic ([Nathan Pointer, "Rendering semi-realistic Landscapes in the browser"](https://nathanpointer.com/blog/landscapes)). Needs ≥1 vertex subdivision per heightmap pixel or you get stairstepping; 8-bit heightmaps band (use 16-bit EXR via `EXRLoader` with `type = THREE.FloatType` to avoid banding, per [this three.js forum thread](https://discourse.threejs.org/t/terrain-height-map-banding/53849)).
- **Verdict for Torii Quest:** Not a replacement for the existing ring-of-pyramids system (which gives real 3D silhouettes and asymmetric apexes a heightmap can't). But a heightmap is the right **input** for generating a normal map from the existing geometry (§6.4), and a low-res heightmap could drive a future ground mesh inside the arena. **Use as a data source, not as the mountain mesh itself.**

### 1.2 Procedural noise terrain (Perlin/Simplex/fbm in vertex shader or JS)
- **How it works:** Generate elevation analytically from a noise function. The canonical Three.js example, [`webgl_geometry_terrain`](https://threejs.org/examples/webgl_geometry_terrain) ([source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_terrain.html)), uses `ImprovedNoise` (a Perlin variant from `three/addons/math/ImprovedNoise.js`), accumulating **4 octaves** of `Math.abs(perlin.noise(x/quality, y/quality, z) * quality * 1.75)` with `quality *= 5` each octave — classic fractional Brownian motion (fbm). Heights go into a `Uint8Array`, then displace a 256×256 `PlaneGeometry`. The shading is **baked into a canvas texture** (`generateTexture`) by computing a per-pixel normal from neighboring height samples and dotting it with a fixed sun vector — no runtime lighting at all.
- **Pros:** Zero asset download, infinite variety from a seed, deterministic. The fbm approach (sum of octaves with `quality *= lacunarity`) is the foundation of nearly all procedural terrain. Ridged multifractal noise (1 − abs(noise)) gives sharp mountain ridgelines instead of rounded hills.
- **Cons:** Pure Perlin/fbm gives rounded, blobby hills — not jagged alpine peaks. Needs ridged noise, domain warping, or erosion simulation to look mountainous ([The Mountains of Madness — interactive terrain algorithms](https://amanpriyanshu.github.io/The-Mountains-of-Madness/)). Doing it in the vertex shader is fast but WebGL1 vertex textures are limited; doing it in JS is simple but blocks the main thread for large grids.
- **Verdict:** Torii Quest **already does this** — `_buildMtnPeak` uses deterministic `sin`-hash noise per vertex ring, which is a cheap fbm substitute. The existing system is good. Improvements: add **ridged** noise (invert abs) for sharper peaks, and **domain warping** (offset noise coordinates by a second noise field) for more organic ridgelines.

### 1.3 Normal mapping on terrain (tangent-space normals from a heightmap)
- **How it works:** A normal map encodes per-pixel surface direction in tangent space (RGB = XYZ, with Z biased to 128). The fragment shader perturbs the interpolated vertex normal by the sampled normal map to add fine surface detail **without adding geometry**. Three.js' `MeshStandardMaterial`/`MeshPhongMaterial` support `normalMap` + `normalScale` natively. For custom shaders, you compute the perturbed normal in the fragment shader.
- **Pros:** This is the **single highest-leverage technique for making low-poly geometry look detailed**. A 256×256 normal map adds the apparent complexity of tens of thousands of triangles for ~0.25 MB of texture and zero extra vertex cost. It's why Nathan Pointer writes "normal maps on detailed objects such as rocks [are] more important than having the highest-resolution diffuse texture available" ([nathanpointer.com](https://nathanpointer.com/blog/landscapes)).
- **Cons:** Tangent-space normal maps need UVs and tangents (Three.js can compute tangents via `BufferGeometryUtils.computeMikkTSpaceTangents`). On steep cliffs, UV-based normal maps stretch and seam — that's where **triplanar** normal mapping (§1.5) wins. A normal map alone doesn't change the silhouette — edges stay low-poly.
- **Verdict:** **Strongly recommended for Torii Quest**, but with a twist: generate the normal map **from the existing geometry itself** at load time (§6.1, §6.4) so it matches the silhouette perfectly and costs zero asset download. Or use a procedural normal in the fragment shader (§6.3).

### 1.4 Splat mapping / texture blending (multiple textures by height/slope)
- **How it works:** Several small tileable textures (grass, rock, snow, sand) are blended per fragment by a **splat map** — a texture whose RGBA channels are blend weights — or by analytic rules (height → snow, slope → rock). Nathan Pointer's implementation samples the splat at unscaled UVs while tiling the diffuse textures at `uv * 100.0`, then does `color = diffuse1 * splat.r + diffuse2 * splat.g` in the fragment shader ([nathanpointer.com](https://nathanpointer.com/blog/landscapes)). The splat can be tiny (e.g. 128×128) because the tiled textures carry the detail.
- **Pros:** Lets a few small textures cover a huge area with natural variation — grass in valleys, rock on steep faces, snow up high. **Vertex colors can serve as the splat weights** with zero texture cost (§1.12), which is exactly what Torii Quest already does implicitly.
- **Cons:** Needs UVs (or triplanar fallback), needs multiple texture slots, blending can look like "Minecraft layers" if the splat is too binary — use smoothstep on the weights.
- **Verdict:** Torii Quest's existing vertex-color system is **already a form of splat mapping** (snow by height, rock by face direction, valley by flag). The improvement is to make the blending **smoother and noisier** (§3.2) rather than to add texture files.

### 1.5 Triplanar texturing (project textures from 3 axes — no UV seams on cliffs)
- **How it works:** Instead of UV-mapping, sample the same texture on the XY, YZ, and XZ planes using world position, and blend the three samples by the surface normal's dominant axis. A working Three.js fragment shader from the forum:
  ```glsl
  vec3 blendNormal(vec3 normal){
    vec3 blending = abs(normal);
    blending = normalize(max(blending, 0.00001));
    blending /= vec3(blending.x + blending.y + blending.z);
    return blending;
  }
  vec3 triplanarMapping(sampler2D tex, vec3 normal, vec3 position) {
    vec3 normalBlend = blendNormal(normal);
    vec3 xColor = texture(tex, position.yz).rgb;
    vec3 yColor = texture(tex, position.xz).rgb;
    vec3 zColor = texture(tex, position.xy).rgb;
    return xColor * normalBlend.x + yColor * normalBlend.y + zColor * normalBlend.z;
  }
  ```
  ([three.js forum — "Tri plannar mapping in three.js"](https://discourse.threejs.org/t/tri-plannar-mapping-in-three-js/40335))
- **Pros:** Eliminates UV seams and stretching on vertical cliffs — the single biggest problem with UV-based terrain texturing. Works with **procedural noise** too (sample noise on 3 planes), so you can have triplanar rock detail with **zero texture files** (§6.3). The procedural-planet demo [prolearner/procedural-planet](https://github.com/prolearner/procedural-planet) uses triplanar texturing as its default for exactly this reason.
- **Cons:** 3× the texture/noise samples per fragment (one per axis). On a low-poly mountain where the whole range is 3 draw calls, that's fine; on a full terrain mesh it adds up.
- **Verdict:** **Excellent fit for Torii Quest's cliffs.** Because the mountains have no UVs, triplanar is the only sane way to apply any texture or procedural detail to the vertical faces. Pair it with procedural noise (§6.3) to keep zero-asset-download.

### 1.6 Parallax occlusion mapping (fake depth on flat geometry)
- **How it works:** The fragment shader ray-marches through a height map along the view direction to find the apparent surface offset, giving flat geometry the illusion of deep relief. Three.js has examples: [pixy.js parallax occlusion](http://mebiusbox.github.io/contents/pixyjs/samples/shader_parallax_occlusion.html) and a [Three.js Blocks parallaxOcclusion node](https://www.threejs-blocks.com/docs/parallaxOcclusion).
- **Pros:** Dramatic fake depth on flat surfaces (cobblestones, brick) without geometry.
- **Cons:** Expensive (multiple height samples per fragment), silhouettes are still flat (the illusion breaks at edges), and it's overkill for distant mountains where the camera never gets close. Best for ground you walk on, not for backdrop ranges.
- **Verdict:** **Skip for the mountain rings.** Consider later for the arena ground plane if it ever feels flat.

### 1.7 Tessellation / geometry shaders (GPU subdivision for real detail)
- **How it works:** The GPU subdivides triangles at render time and displaces the new vertices by a height/displacement map, adding real geometric detail where the camera is close. WebGL2 exposes tessellation shaders on some hardware.
- **Pros:** Real silhouette detail (unlike normal maps), adaptive density.
- **Cons:** **WebGL2 tessellation support is inconsistent across browsers/GPUs** — not reliable for a 60 fps browser game targeting mid-range hardware. Geometry shaders are even less supported. This is a desktop-AAA technique (Far Cry 5's terrain uses GPU-compute LOD and displacement, per [GDC: "Terrain Rendering in Far Cry 5"](https://gdcvault.com/play/1025480/Terrain-Rendering-in-Far-Cry)).
- **Verdict:** **No.** Unreliable in browser, over budget. The "diorama trick" (§1.11) and normal mapping give 90% of the visual gain for 1% of the cost.

### 1.8 Instanced detail meshes (rocks, trees on mountain faces)
- **How it works:** Scatter small rock/tree meshes on the mountain surface using `THREE.InstancedMesh` — one draw call for thousands of instances. `THREE.Terrain`'s `ScatterMeshes` helper does exactly this ([IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)). Bruno Simon's portfolio uses instancing heavily for performance ([Bruno Simon — Performance devlog](https://www.youtube.com/watch?v=EhZwt9P4GP4)).
- **Pros:** Adds real 3D silhouette clutter (boulders, pines) that breaks up the smooth pyramid faces. One draw call. Torii Quest already uses `InstancedMesh` for trees (currently disabled) and could do the same for rocks.
- **Cons:** Need rock geometry (procedural or a free CC0 model), need to place on the mountain surface (sample the height field or raycast), and instanced meshes can't easily have per-instance vertex colors for snow variation without a custom shader or instanceColor.
- **Verdict:** **Good phase-2 addition.** A handful of instanced boulders on the near ring would add a lot of life. Use procedural low-poly rock geometry (an icosahedron with noise displacement) to stay asset-free.

### 1.9 Volumetric rock formations (raymarched)
- **How it works:** Raymarch signed distance fields (SDFs) to render rocks as pure volumetric shapes — no polygons. [Adam-Gleave/sdf-terrain](https://github.com/Adam-Gleave/sdf-terrain) experiments with this.
- **Pros:** Infinite detail, perfect overhangs/caves, no geometry at all.
- **Cons:** **Far too expensive for a 60 fps browser game** with multiple mountain ranges. Raymarching every fragment of a full-screen mountain is a high-end-GPU technique. The [100K Procedural Rocks forum post](https://discourse.threejs.org/t/100k-procedural-rocks-brutally-optimized/89578) shows the practical alternative: SDF→marching-cubes→polygonized meshes with LOD, not per-frame raymarching.
- **Verdict:** **No.** Too heavy. The SDF-to-mesh approach in that forum post is worth studying for a future rock system, though.

### 1.10 LOD terrain (clipmaps, CDLOD, geometry clipmaps)
- **How it works:** Terrain is split into tiles at multiple resolutions; tiles near the camera use high-res geometry, distant tiles use low-res. Geometry clipmaps (Hoppe) and CDLOD (Continuous Distance-Dependent LOD) are the AAA standards. [prolearner/procedural-planet](https://github.com/prolearner/procedural-planet) implements Chunked LOD (`CLOD=true`).
- **Pros:** Lets you have a huge terrain at constant frame rate — essential for a real open world you can walk across.
- **Cons:** Significant engineering complexity (stitching tiles, morphing between LODs, streaming). Overkill for a fixed 3-ring backdrop that the player never approaches.
- **Verdict:** **Not now.** Torii Quest's mountains are a distant backdrop at 78–116 units; the player never reaches them, so LOD is unnecessary. Revisit if mountains ever become walkable terrain.

### 1.11 The "diorama" trick: low-poly silhouettes + high-quality normal maps
- **How it works:** Keep the geometry low-poly (cheap, great silhouettes) but add a **high-quality normal map** (either authored or generated from a high-poly sculpt) so the faces read as detailed rock even though they're flat triangles. This is the standard stylized-game approach: Breath of the Wild, Genshin Impact, and Firewatch all use relatively low geometric complexity with strong normal/texture work to sell the detail.
- **Pros:** Best of both worlds — low vertex cost, high apparent detail. The normal map can be **generated from the geometry itself** (§6.4) or procedurally in the shader (§6.3), so no asset download.
- **Cons:** Silhouettes stay low-poly (edges are still faceted), which is actually fine for a stylized look. Requires either a normal map texture or shader work.
- **Verdict:** **This is the core recommendation for Torii Quest.** The existing system is already the low-poly silhouette half of the diorama trick; adding the normal-map half (procedurally, §6.3) is the highest-impact, lowest-cost improvement.

### 1.12 Vertex color + normal combination (what they have + what they could add)
- **How it works:** Torii Quest already uses vertex colors for snow/rock/valley/crevice/haze. The combination is: vertex color provides the **base palette and large-scale variation** (snow line, valley floors, crevice darkening), and a normal map (or procedural normal perturbation in the fragment shader) provides the **fine surface detail** that makes each face read as rock rather than flat plastic.
- **Pros:** Keeps the existing system (zero rewrite), adds detail where it's missing (flat faces), and the two systems don't fight — vertex color is low-frequency, normal detail is high-frequency.
- **Cons:** Requires moving from `MeshBasicMaterial` to a custom `ShaderMaterial` (or `MeshStandardMaterial` with `normalMap`) to actually use the normals — `MeshBasicMaterial` ignores normals entirely (it's unlit).
- **Verdict:** **The exact upgrade path.** See §3 and §6 for the specific implementation.

---

## 2. Named Three.js Projects & Games with Great Landscapes (with links)

### Three.js official examples
- **[`webgl_geometry_terrain`](https://threejs.org/examples/webgl_geometry_terrain)** — the canonical Three.js terrain demo. `ImprovedNoise` Perlin, 4 octaves of fbm, 256×256 `PlaneGeometry`, shading **baked into a CanvasTexture** by dotting a per-pixel normal (computed from neighboring height samples) with a fixed sun vector, rendered with `MeshBasicMaterial({ map: texture })` — **no runtime lighting**. This is the closest official example to Torii Quest's approach and a great reference for "bake the shading, keep the material cheap." ([source on GitHub](https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_terrain.html))
- **[`TerrainGenerator` (three.js docs)](https://threejs.org/docs/pages/TerrainGenerator.html)** — a newer addon (`examples/jsm/generators/TerrainGenerator.js`) that "bakes a procedural mountain range into a single `THREE.BufferGeometry`" and exposes `sampleHeight` so scattered forests can sit on the surface. Directly relevant architecture (one baked geometry, sampleable height).
- **Three.js `Sky` addon** ([docs](https://threejs.org/docs/examples/en/objects/Sky.html)) — Preetham atmospheric scattering; relevant for the haze/atmospheric-perspective layer on distant mountains (already covered in `sky-research.md`).

### Named developers & projects
- **Bruno Simon's portfolio ([bruno-simon.com](https://bruno-simon.com/))** — the famous Three.js racing-game portfolio. His [Performance devlog](https://www.youtube.com/watch?v=EhZwt9P4GP4) details the terrain approach: **vertex colors** (merge geometries, one material, paint vertices), a **palette texture** (one pixel per scene color, sampled by vertex-color index — a tiny texture that acts as a LUT), terrain texture, and heavy use of `InstancedMesh`/`BatchedMesh`. His [experiment-holographic-terrain](https://github.com/brunosimon/experiment-holographic-terrain) (live: [experiment-holographic-terrain.vercel.app](https://experiment-holographic-terrain.vercel.app)) renders elevation-line terrain with custom depth shaders. He also teaches the full terrain pipeline in the **Three.js Journey** course.
- **Maxime Heckel** — [On Rendering the Sky, Sunsets, and Planets](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/) (ray-marched Rayleigh+Mie atmosphere with LUT optimization, already cited in `sky-research.md`) and [Building a Vaporwave scene with Three.js](https://blog.maximeheckel.com/posts/vaporwave-3d-scene-with-threejs/) (displaced PlaneGeometry terrain). Strong reference for shader-driven atmosphere that interacts with mountain color.
- **Nathan Pointer — [Rendering semi-realistic Landscapes in the browser](https://nathanpointer.com/blog/landscapes)** — the single best matched reference for Torii Quest. Covers height/displacement maps, **splat texturing** (with fragment-shader code), **no-tile texture repetition** fix (Inigo Quilez–derived, with full `textureNoTile` GLSL), **multi-scale normal blending** (`blend_normals` function), and the key insight that "most of the detail that makes the terrain look good comes from the normal and diffuse maps," not the heightmap.
- **Codrops** — while a direct "Codrops terrain" tutorial wasn't isolated in research, Codrops regularly publishes Three.js shader work; the Nathan Pointer and Maxime Heckel articles fill the same niche (deep, code-heavy Three.js landscape writeups).
- **Josh Marinacci — [Low Poly style Terrain Generation](https://medium.com/@joshmarinacci/low-poly-style-terrain-generation-8a017ab02e7b)** (Medium) — a clean walk-through of exactly Torii Quest's current approach: noise → heightmap → `PlaneGeometry` displacement → per-face vertex colors by height band (water/grass/sand/rock/snow) → `flatShading: true` → `MeshLambertMaterial({ vertexColors })`. Great reference for the low-poly vertex-color style.

### Open-source Three.js terrain repos
- **[IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)** — procedural terrain engine with `DiamondSquare` heightmaps, `ScatterMeshes` for foliage, and `toHeightmap` export. Live demo: [icecreamyou.github.io/THREE.Terrain](https://icecreamyou.github.io/THREE.Terrain/). Good reference for scatter + heightmap export.
- **[jeromeetienne/threex.terrain](https://github.com/jeromeetienne/threex.terrain)** — Simplex/Perlin terrain with `heightMapToVertexColor` (water/grass/snow zones by height) — the same vertex-color-by-height approach Torii Quest uses. ([demo](https://jeromeetienne.github.io/threex.terrain/examples/planegeometry.html))
- **[prolearner/procedural-planet](https://github.com/prolearner/procedural-planet)** — 3D procedural planet with **triplanar texturing** (default), Perlin/Ridged/Simplex noise, and Chunked LOD. Best reference for triplanar in Three.js.
- **[QC20/Endless-Mountains](https://github.com/QC20/Endless-Mountains/)** — WebGL terrain visualization that dynamically generates mountains/valleys evolving over time.
- **[fracali/terrain_generation_threejs](https://github.com/fracali/terrain_generation_threejs)** — infinite terrain generation algorithm demo.
- **[erichlof/THREE.js-PathTracing-Renderer](https://github.com/erichlof/THREE.js-PathTracing-Renderer)** — includes a Terrain Demo combining raytracing + raymarching for outdoor environments (heavy, but shows the high end).

### Sketchfab models with great mountains (study references, not assets)
- **[Stylized Low-Poly Mountain by ARTEL_3D](https://sketchfab.com/3d-models/stylized-low-poly-mountain-7b0ca3b09bf34bf49cc54e73278d8bd5)** — clean stylized low-poly.
- **[Low Poly Mountain Range by Inditrion](https://sketchfab.com/3d-models/low-poly-mountain-range-1dbb2ab49ea547e4afae1fd81c985e2d)** — stylized geometric peaks.
- **[Mountain low poly for distant mountains by Mehdi Shahsavan](https://sketchfab.com/3d-models/mountain-low-poly-for-distant-mountains-cb7f28b5ee0e4ddfb12700ff9d9d35c8)** — explicitly a distant-mountain backdrop model, the same use case as Torii Quest.
- **[Snow Mountain - Low Poly (Free) by Zihaan](https://sketchfab.com/3d-models/snow-mountain-low-poly-free-754502c167d0431e9041fc2ea43475fe)** — a low-poly reduction of a higher-res snow mountain.
- **[Free Pack - Rocks Stylized by PolyOne](https://sketchfab.com/3d-models/free-pack-rocks-stylized-7c60b4d1b8ab4187965f30c5e0212fc0)** — 11 stylized low-poly rocks (100–1k tris) — reference for instanced detail meshes (§1.8).

### AAA references for stylized mountain rendering
- **Journey (thatgamecompany)** — the gold standard for stylized sand/dune rendering. Alan Zucconi's [A Journey Into Journey's Sand Shader](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/) breaks down the exact techniques from John Edwards' GDC talk:
  - **Diffuse contrast reflectance** — a Lambertian-derived lighting model with enhanced contrast for stylized readability.
  - **Bump mapping** (normal perturbation) for sand grains — the geometry is completely smooth; all surface detail comes from perturbed normals in the shader. Two perturbation passes: `RipplesNormal` then `SandNormal`, applied sequentially.
  - **Fresnel rim lighting** — "a subtle shimmering effect visible only along the edge of a dune," based on Fresnel reflectance at grazing angles. This is what makes dune edges pop against a limited color palette.
  - **Ocean specular** (Blinn-Phong) — gives sand a near-liquid reflectivity.
  - **Glitter reflection** — random per-grain specular sparkle, added separately.
  - **Triplanar-like blending of 4 textures** by dune orientation and steepness — so ripples can vary with wind direction without authoring every dune.
  - **All of these are directly portable to a stylized mountain ShaderMaterial** (§3.3, §3.4, §6.3).
- **Breath of the Wild (Nintendo)** — stylized open-world mountains. The art direction uses **low geometric complexity with strong, hand-tuned normal maps and vertex/texture color** to sell detail — the "diorama" approach (§1.11). Cliffs use spline-generated meshes along heightmap contours with procedural materials blended on top ([r/proceduralgeneration discussion](https://www.reddit.com/r/proceduralgeneration/comments/1ti1oen/ways_to_generate_cliffs_mountains_in_this/)). The key takeaway: **one consistent rock color, not a variety of grays and browns** — unity of palette is what reads as "stylized" rather than "muddy."
- **Genshin Impact (miHoYo)** — [GDC 2021: "Crafting an Anime-Style Open World"](https://media.gdcvault.com/GDC+2021/2021GDC+_+Haoyu+Cai+_+presentation+file.pdf) and [parsers.vc deep dive](https://parsers.vc/news/250124-the-art-of-game-rendering--a-deep-dive-into/). Technique: **normal heightmap terrain with steep cliffs made of separate rock meshes** jammed into the steep areas — heightmaps can't do overhangs, so cliffs are hand-placed mesh assets on top of a heightmap base ([r/gamedev breakdown](https://www.reddit.com/r/gamedev/comments/jut7xi/question_on_terrain_from_genshin_impact/)). Uses **custom normals on characters** to aid shading, deferred rendering, terrain tint, and grass-filling. The lesson for Torii Quest: **heightmap base + instanced cliff-mesh detail** is the AAA pattern (§1.8 + §1.1 combined).
- **Firewatch (Campo Santo)** — stylized low-poly wilderness with a strong limited palette. The mountain/backdrop style is explicitly low-poly silhouettes with painterly color gradients and atmospheric perspective — very close to Torii Quest's current approach. The visual quality comes from **color theory, fog/atmospheric depth, and careful lighting**, not from geometric complexity. Reinforces §3.5 (depth fog between rings) and §3.2 (vertex color gradients).

---

## 3. Specific Techniques for Improving LOW-POLY Mountains (building on what they have)

Torii Quest's mountains are non-indexed `BufferGeometry` (each triangle pushes 3 separate vertices) with `MeshBasicMaterial({ vertexColors: true })`. `MeshBasicMaterial` is **unlit** — it ignores normals entirely, which is why all shading is baked into vertex colors via `_mtnFaceShade`. The single biggest constraint: **to use any normal-based effect (normal maps, fresnel, real lighting), the material must change.**

### 3.1 Add normal variation to flat-shaded low-poly (face normals vs smooth normals)
- **Current state:** `geo.computeVertexNormals()` is called, but since the geometry is **non-indexed** (each triangle has its own 3 vertices), `computeVertexNormals` on non-indexed geometry sets each vertex normal to the **face normal** — so the geometry is already effectively flat-shaded. But `MeshBasicMaterial` ignores normals, so this has no visual effect today.
- **The fix:** Switch to a material that uses normals. Two options:
  1. **`MeshPhongMaterial`/`MeshStandardMaterial` with `flatShading: true`** — uses the geometry's face normals for real per-face lighting. Cheapest path to real shading. Keep `vertexColors: true` for the base palette; the lighting multiplies on top.
  2. **Custom `ShaderMaterial`** — full control, can combine the existing baked vertex-color shading with a normal-map perturbation and fresnel (§3.3, §3.4). This is the recommended path because it preserves the existing art direction while adding detail.
- **Face normals vs smooth normals:** For craggy mountains, **flat shading (face normals) is correct** — smooth normals would blur the craggy silhouette into mush. The existing non-indexed geometry already gives flat normals for free. Don't merge vertices (`BufferGeometryUtils.mergeVertices`) — that would smooth-shade the peaks.

### 3.2 Use vertex color gradients more effectively (snow line variation, rock color by height/angle)
The existing system already blends by height (snow line) and face direction (sun-facing). Improvements:
- **Noisy snow line:** The current `snowEdge` already jitters with `Math.sin(seed + yAvg * 1.7)` — good. Make the jitter **stronger and 2D** (vary by both height and angular position around the peak) so the snow line rambles rather than forming a horizontal band. Snow accumulates more on leeward (away-from-sun) faces in reality — bias the snow line lower on faces pointing away from `sunDir`.
- **Rock color by height AND slope, not just height:** Currently rock is `base` (cool plum) below `h*0.5` and a `base→foothill` blend above. Add a **slope term**: steep faces (low `normal.y`) get darker, weathered rock; gentle faces get lighter, talus/grass. Compute slope from the face normal's Y component (already available as `_mtnNr.y` in `pushTri`).
- **Snow-in-crevices:** Use the existing `creviceFactor` as a **snow accumulator** — crevices should catch snow (lighter) near the top and stay dark (shadowed) lower down, rather than uniformly dark. This is a cheap, high-readability change (§6.6).
- **Atmospheric color by altitude:** The existing haze blend (`hazeMix = ring.haze * (0.4 + ht * 0.6)`) is good. Add a subtle **cool-to-warm shift** with altitude: low rock slightly cooler/desaturated, mid rock the base palette, high rock warmer (catching dawn light) — mimicking atmospheric scattering on the faces themselves (§6.5).

### 3.3 Add ambient occlusion to vertex colors (darkening crevices, valley floors)
- **Current state:** Crevices darken toward `_MTN_DAWN.crevice` by `crv * 0.85` — a hand-painted AO approximation. Valleys use a flat `valleyFloor` color.
- **Improvement — geometric AO:** Compute a real (cheap) ambient-occlusion term per vertex by sampling how "surrounded" each vertex is. The simplest browser-appropriate method: for each vertex, count nearby vertices below it within a radius — vertices in valley floors and crevice bottoms have more neighbors above them and get darkened. This is a one-time cost at build time, stored in vertex color (zero runtime cost). The [three.js forum thread on baking AO into vertex color](https://discourse.threejs.org/t/how-would-i-begin-to-bake-lighting-ao-into-vertex-color-data/48689) suggests `geo-ambient-occlusion` (npm) which returns per-vertex AO values from positions + cells.
- **Cheaper heuristic AO (no dependency):** Darken vertices whose face normal points down (`normal.y < 0`, overhangs/crevice walls) and vertices whose height is in the bottom 20% of the peak (valley floors). This is already partially done; make it explicit and stronger.
- **Store as a separate vertex attribute** (`ao`) if using a ShaderMaterial, so it can modulate both color and the snow mask (§6.6) independently.

### 3.4 Add rim lighting / fresnel on mountain edges
- **How:** In a fragment shader, compute `fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), power)` and add a warm rim color where the fresnel is high — exactly Journey's approach ([alanzucconi.com](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/)). This makes mountain edges catch the dawn light and separates silhouettes from the background.
- **For Torii Quest's dawn palette:** Use `_MTN_DAWN.snowLit` or a warm peach as the rim color, so edges glow against the cool shadowed faces. This is the single most effective way to make the mountains read as "catching dawn light" without changing geometry.
- **Cost:** One `dot` + one `pow` per fragment. Negligible.
- **Requires:** A `ShaderMaterial` (or extend the material's `onBeforeCompile`) to access `viewDir` and `normal` in the fragment shader. `MeshBasicMaterial` can't do this.

### 3.5 Use a second pass for snow (separate mesh with slightly different geometry)
- **How:** Render a second, slightly inflated copy of the snow-capped peaks with a white/snow material and **backface culling flipped** or **depth-biased**, so the snow sits as a thin shell on the snow-facing surfaces. This gives snow real thickness at the silhouette and lets it have its own shader (sparkle, fresnel) without affecting rock.
- **Pros:** Snow gets its own material/normal detail; rock faces stay clean. The shell can be lower-poly than the base mesh.
- **Cons:** Doubles draw calls for snow peaks (only 3 peaks in the far ring have snow, so +3 draw calls max — acceptable). Needs careful depth bias to avoid z-fighting.
- **Verdict:** Optional polish. The existing vertex-color snow is already good; a snow shell is a phase-2 enhancement if the flat snow reads as painted-on.

### 3.6 Add subtle parallax or depth fog between mountain rings
- **Current state:** `fog: true` on the material + a per-vertex haze blend by altitude. Good.
- **Improvement — atmospheric perspective per ring:** The three rings already have different `haze` values (0.07 / 0.17 / 0.30). Push this further: the **far ring should desaturate and shift toward the sky/horizon color** more aggressively, the near ring stays grounded. This is the Firewatch technique — depth comes from color and fog, not geometry. Use `FogExp2` (exponential) rather than linear `Fog` for more natural distance falloff ([CS 307 Fog reading](https://cs.wellesley.edu/~cs307/readings/fog/)).
- **Layered fog trick:** Add a large, semi-transparent plane between rings at each ring's distance, tinted toward the haze color — cheap "atmospheric layering" that reads as depth haze between ranges. Torii Quest already has mist planes (`_buildMist`); extend the concept to inter-ring haze planes.

---

## 4. Texture-Based Approaches That Work in Browser

### 4.1 Procedural texture generation (canvas/canvas2D → DataTexture/CanvasTexture)
- **How:** Draw to a `<canvas>` 2D context at load time, then wrap as `THREE.CanvasTexture` (or read pixels into a `THREE.DataTexture`). The official `webgl_geometry_terrain` example does exactly this — `generateTexture()` paints shading into a canvas, scales it 4×, adds random per-pixel noise, and uses it as the `MeshBasicMaterial` map ([source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_terrain.html)). Torii Quest already does this for the puff texture (`_buildPuffTexture`).
- **For mountains:** Generate a tileable rock normal map on a canvas by drawing random noise, blurring, and computing the Sobel-filter normal from the grayscale height. Or generate a rock color texture with layered noise. Zero download, full control, ~1–2 KB of code.
- **`THREE.DataTexture`** ([docs](https://threejs.org/docs/pages/DataTexture.html)) — for when you need raw float/byte data (heightmaps, normal maps computed in JS) rather than a painted image.

### 4.2 Normal map generation from a heightmap in JS
- **The Sobel approach:** For each pixel in a grayscale heightmap, sample the 8 neighbors, compute the x and y gradients (Sobel operator), and set the normal map RGB to `(gradientX, gradientY, 1) normalized → (0.5, 0.5, 1) * 0.5 + 0.5`. The [lachoseparis/height-to-normal-map](https://github.com/lachoseparis/height-to-normal-map) library does this with configurable strength/blur/sharpen and can be used as a library or CLI.
- **The vertex-shader approach (for runtime):** Sample the heightmap texture at `uv ± texelSize` in the vertex shader and compute the normal from the 4-neighbor differences:
  ```glsl
  vec2 texelSize = vec2(1.0 / WIDTH, 1.0 / HEIGHT);
  vec3 n = normalize(vec3(
    texture2D(heightmap, uv + vec2(-texelSize.x, 0)).x - texture2D(heightmap, uv + vec2(texelSize.x, 0)).x,
    texture2D(heightmap, uv + vec2(0, -texelSize.y)).x - texture2D(heightmap, uv + vec2(0, texelSize.y)).x,
    1.0
  ));
  ```
  ([three.js forum — "Calculating normals from heightmap in vertex shader"](https://discourse.threejs.org/t/calculating-normals-from-heightmap-in-vertex-shader/13014)). But the forum consensus is: **if the terrain is static, compute normals once in JS and store them, don't recompute every frame in the shader.**
- **For Torii Quest (§6.4):** The mountain geometry is already generated in JS. After building it, render the geometry's depth/silhouette to an offscreen render target from a top-down or per-face orthographic camera, read back the height, and Sobel-filter it into a normal map. Or simpler: since the geometry is a known height field per peak, compute normals analytically from the same noise function used to displace the vertices.

### 4.3 Splat map approaches using vertex colors as blend weights
- Torii Quest **already does this** — vertex colors encode snow/rock/valley/crevice. The upgrade is to treat the vertex color channels as **blend weights** for multiple procedural texture layers in a fragment shader, rather than as final colors. E.g.:
  ```glsl
  // vertexColor.r = snow weight, .g = rock weight, .b = valley weight
  vec3 snow  = proceduralSnow(normal, worldPos);
  vec3 rock  = proceduralRock(normal, worldPos);
  vec3 valley = proceduralGrass(normal, worldPos);
  vec3 col = snow*vColor.r + rock*vColor.g + valley*vColor.b;
  ```
  This keeps the existing vertex-color authoring but lets each layer have its own procedural detail (§6.3).

### 4.4 Small tileable rock/grass/snow textures — free CC0 sources
All of these are **CC0 (public domain), no attribution required, commercial-ok** — safe for Torii Quest's no-paid-assets constraint:
- **[ambientCG](https://ambientcg.com/)** — the largest CC0 library, 2000+ PBR materials including [rocks](https://ambientcg.com/list?type=Rock), snow, ice, moss, grass. 1K–8K, channel-packed variants. No API key needed.
- **[Poly Haven](https://polyhaven.com/)** — CC0 PBR textures, HDRIs, models. [Ground & Terrain category](https://polyhaven.com/textures/ground-terrain), e.g. [Rocky Terrain 02](https://polyhaven.com/a/rocky_terrain_02). Up to 8K. Donation-funded, no catch ([license](https://polyhaven.com/license)).
- **[ShareTextures](https://www.sharetextures.com/)** — 1700+ CC0 textures at 4K with full PBR map sets (diffuse, normal, AO, displacement, roughness). [Ground category](https://www.sharetextures.com/textures/ground/), e.g. [Forest ground](https://www.sharetextures.com/textures/ground/forest).
- **[cgbookcase.com](https://www.cgbookcase.com/textures)** — 380+ CC0 PBR texture sets up to 4K ([CG Channel coverage](https://www.cgchannel.com/2019/03/download-380-free-pbr-texture-sets-from-cgbookcase-com/)).
- **[3DTextures.me](https://www.3dtextures.me/)** — CC0 hand-authored sets, strong stylized/sci-fi selection.
- **[cc0-textures.com](https://cc0-textures.com/)** — 3300+ CC0 textures.
- **[Mixos](https://www.mixos.io/free-textures)** — aggregator, 2669 CC0 materials from ambientCG + Poly Haven, browseable by material (stone, ground, snow & ice). Good for one-stop browsing.
- **[OpenGameArt](https://opengameart.org/)** — CC0 texture packs (e.g. [50 free textures with normal maps](https://opengameart.org/content/50-free-textures-5-with-normalmaps)).
- **Budget tip:** For a browser game, download at **1K or 2K** (not 4K/8K) and use a single rock texture + a single snow texture — two small JPGs, ~100–300 KB total, cover the whole range via tiling + triplanar. Or skip textures entirely and go procedural (§6.3).

---

## 5. Curated Link List (8–12 links to click through)

**Three.js terrain examples (official):**
1. [`webgl_geometry_terrain` — live demo](https://threejs.org/examples/webgl_geometry_terrain) and [source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_terrain.html) — Perlin fbm, baked-shading canvas texture, `MeshBasicMaterial`. The closest official analog to Torii Quest.
2. [`TerrainGenerator` docs](https://threejs.org/docs/pages/TerrainGenerator.html) — newer baked-mountain-range addon with `sampleHeight`.

**Tutorials & deep dives (Three.js landscape/terrain):**
3. **[Nathan Pointer — Rendering semi-realistic Landscapes in the browser](https://nathanpointer.com/blog/landscapes)** — splat texturing, no-tile repetition fix, multi-scale normal blending. The single best matched reference.
4. **[Josh Marinacci — Low Poly style Terrain Generation (Medium)](https://medium.com/@joshmarinacci/low-poly-style-terrain-generation-8a017ab02e7b)** — the low-poly vertex-color-by-height approach Torii Quest already uses, with `flatShading`.
5. **[Maxime Heckel — On Rendering the Sky, Sunsets, and Planets](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/)** — shader atmosphere that interacts with terrain color.

**Open-source repos with good mountain/terrain implementations:**
6. **[IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)** — procedural terrain + `ScatterMeshes` for detail objects. Live: [icecreamyou.github.io/THREE.Terrain](https://icecreamyou.github.io/THREE.Terrain/).
7. **[prolearner/procedural-planet](https://github.com/prolearner/procedural-planet)** — triplanar texturing + Chunked LOD in Three.js.
8. **[Bruno Simon — experiment-holographic-terrain](https://github.com/brunosimon/experiment-holographic-terrain)** (live: [vercel app](https://experiment-holographic-terrain.vercel.app)) and his [Performance devlog](https://www.youtube.com/watch?v=EhZwt9P4GP4) (vertex colors, palette texture, instancing).

**AAA stylized mountain tech breakdowns:**
9. **[Alan Zucconi — A Journey Into Journey's Sand Shader](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/)** — diffuse contrast reflectance, bump mapping, Fresnel rim lighting, ocean specular, glitter. Directly portable to a mountain shader.
10. **[Genshin Impact GDC 2021 — Crafting an Anime-Style Open World (PDF)](https://media.gdcvault.com/GDC+2021/2021GDC+_+Haoyu+Cai+_+presentation+file.pdf)** and the [parsers.vc rendering deep dive](https://parsers.vc/news/250124-the-art-of-game-rendering--a-deep-dive-into/) — heightmap + cliff meshes, custom normals, deferred rendering.

**Free texture resources (CC0):**
11. **[ambientCG](https://ambientcg.com/)** — largest CC0 PBR library (rocks, snow, ice, moss, grass).
12. **[Poly Haven — Ground & Terrain textures](https://polyhaven.com/textures/ground-terrain)** — CC0, up to 8K, full PBR map sets.

---

## 6. Novel Approaches — Creative Ideas a Stronger AI Might Propose

These are the highest-leverage ideas that build **specifically on Torii Quest's existing system** rather than replacing it.

### 6.1 Use the existing vertex color system but add a normal-map pass computed from the geometry itself
- **Idea:** After `_buildMtnPeak` generates the geometry, render the geometry from an orthographic top-down camera (and/or a per-face camera) into a `WebGLRenderTarget` as a height/depth pass. Read it back (or Sobel-filter it in a shader) into a normal map `DataTexture`. Bind that normal map to the mountain material. The normal map now **exactly matches the silhouette** the artist already authored — no hand-painting, no asset download, perfect correspondence.
- **Why it's novel:** Most tutorials assume you author the normal map separately. Generating it from the live geometry means the detail always matches, even when the procedural noise seed changes. It's a one-time build cost, zero per-frame cost, zero asset bytes.
- **Simpler variant:** Since the geometry is displaced by a known noise function, compute the normal analytically from the **same noise function's gradient** at each vertex — no render pass needed. Store as a per-vertex tangent-space normal or bake into a small texture.

### 6.2 Dual-mesh trick: low-poly collision/visual mesh + higher-poly normal-only mesh
- **Idea:** Keep the current low-poly mesh for the silhouette, draw calls, and collision. Add a **second, higher-poly mesh** (same peaks, more subdivisions) that is rendered with **only its normals contributing** — either as a normal-map source rendered once, or as a second draw pass that writes only to the normal buffer (via `material.normalMap`-only rendering or MRT). The high-poly mesh never affects the silhouette or depth, only the shading detail.
- **Why it's novel:** Decouples silhouette cost from shading detail. The low-poly mesh stays at 3 draw calls; the high-poly normal source can be generated once and discarded. This is the "diorama" trick (§1.11) taken to its logical extreme.
- **Browser caveat:** MRT/normal-only rendering is fiddly in WebGL. The simpler version: generate the high-poly mesh once, bake its normals to a texture, discard the mesh, use the texture on the low-poly mesh. Same result, simpler pipeline.

### 6.3 Procedural rock texture from noise in the fragment shader (no texture files needed)
- **Idea:** In the mountain fragment shader, compute rock surface detail from **3D noise sampled in triplanar fashion** (§1.5) — no texture files at all. Use fbm (sum of octaves of a hash/noise function) to perturb the normal and modulate the color. The [100K Procedural Rocks forum post](https://discourse.threejs.org/t/100k-procedural-rocks-brutally-optimized/89578) does exactly this: "FBM noise for color mixing, normal perturbation for surface bumps, and a wetness-driven specular/fresnel model," with a distance-based LOD that drops the noise for distant fragments. The [Procedural Textures tutorial on mysimulator.uk](https://www.mysimulator.uk/content/tutorials/procedural-textures-tutorial.html) gives the hash→noise→fbm→warp pipeline with GLSL for rock, marble, wood.
- **Why it's novel for Torii Quest:** It keeps the zero-asset-download constraint perfectly. The rock detail is infinite-resolution, tiles seamlessly by construction, and can be tuned by changing noise parameters. Pair with the existing vertex colors as the base palette (§4.3).
- **Cost:** A few octaves of noise per fragment is cheap on modern GPUs; the 100K-rocks demo proves it scales. Add a distance-based LOD (skip noise for fragments beyond ~100 units) to protect the 60 fps budget.
- **Sketch of the fragment shader:**
  ```glsl
  // vColor = existing vertex color (snow/rock/valley weights + baked dawn shading)
  // vNormal = geometry face normal
  // vWorldPos = world position
  varying vec3 vColor, vNormal, vWorldPos;
  uniform vec3 uSunDir, uCameraPos;

  // cheap hash + value noise (or import a simplex noise glsl function)
  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
  float noise(vec3 p){ /* trilinear interpolation of hash at floor corners */ }
  float fbm(vec3 p){ float v=0.,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }

  void main(){
    // triplanar fbm for rock detail — no UVs needed
    vec3 blend = abs(normalize(vNormal));
    blend /= dot(blend, vec3(1.0));
    float n = fbm(vWorldPos*0.3);
    n = n*blend.x*fbm(vWorldPos.yzx*0.3) + n*blend.y*fbm(vWorldPos.xzy*0.3) + n*blend.z*fbm(vWorldPos.xyz*0.3);
    n /= dot(blend, vec3(1.0));

    // perturb the normal by the noise gradient for surface bumps
    vec3 perturbed = normalize(vNormal + (n-0.5)*0.6);

    // existing baked shading from vertex color, re-lit by perturbed normal
    float facing = dot(perturbed, uSunDir);
    vec3 base = vColor;
    vec3 lit = base * (0.5 + 0.5*facing);  // cheap diffuse contrast

    // fresnel rim — Journey-style edge glow
    float fres = pow(1.0 - max(dot(perturbed, normalize(uCameraPos - vWorldPos)), 0.0), 3.0);
    lit += vec3(0.82,0.66,0.52) * fres * 0.4;  // warm dawn rim

    // noise modulates color slightly for rock grain
    lit *= 0.85 + 0.3*n;

    gl_FragColor = vec4(lit, 1.0);
  }
  ```

### 6.4 Use the heightmap to generate both geometry AND a normal map at load time
- **Idea:** Generalizes 6.1. Whatever generates the mountain height (currently per-peak noise in `_buildMtnPeak`) is also rendered/rasterized into a small heightmap texture per peak (or per ring). That heightmap is Sobel-filtered into a normal map once at load. The geometry uses the heightmap for displacement; the material uses the derived normal map for detail. One noise function → two outputs (geometry + normals), perfectly consistent.
- **Why it's novel:** Most projects author heightmap and normal map separately and they drift. Generating both from the same field guarantees they match. The official `webgl_geometry_terrain` does a version of this (bakes shading into a canvas from the same height data) but bakes **color**, not a reusable normal map.
- **For Torii Quest:** Since the geometry is per-peak pyramidal (not a single height field), the "heightmap" would be per-peak or per-ring. A small 64×64 heightmap per peak, rendered from a top-down ortho camera looking at the peak, is enough to derive crisp normals for the faces.

### 6.5 Atmospheric scattering on mountain faces (different rock color by altitude)
- **Idea:** Beyond the existing haze blend (which tints peaks toward `haze` color), add a **physically-motivated altitude tint**: low faces get more scattered blue skylight (cool), high faces get more direct warm sunlight and less atmosphere between them and the sun. This mimics real atmospheric perspective but applied to the **faces** of a single mountain, not just between mountains. It's the Journey/Firewatch look — color does the depth work.
- **Implementation:** In the fragment shader, mix the base rock color toward a cool sky-tint at low altitude and toward a warm sun-tint at high altitude, modulated by the face's sun-facing. Cheap, huge readability gain.
- **Why it's novel:** Most browser terrain uses flat fog. Per-face altitude scattering is an AAA trick (Horizon/RDR2 do it per-pixel via aerial-perspective LUTs) distilled to a 2-line shader.

### 6.6 Snow that accumulates in crevices (using ambient occlusion as a snow mask)
- **Idea:** Invert the existing crevice logic for snow: instead of crevices always being dark, **crevices catch snow** near the top (where snow falls in) and stay shadowed lower down. Use the AO term (§3.3) as a snow-accumulation mask: `snowAmount = ao * heightFactor`. Snow pools in concave areas (crevices, valley floors, leeward hollows) and is absent on convex protruding rock — exactly how real snow behaves.
- **Why it's novel:** The current system treats crevices and snow as independent. Coupling them via AO makes the snow look like it **fell and settled** rather than being painted on a height band. Zero extra cost if AO is already computed.
- **Bonus:** Combine with slope — snow only sticks to faces with `normal.y > 0.6` (gentle/upward), and slides off steep faces. This is the standard AAA snow shader and it's ~5 lines of GLSL.

---

## 7. Recommended Improvements for Torii Quest

Ordered by **impact ÷ effort**, each builds on the existing system without replacing it. All stay within the ~50 KB code budget and the zero-asset-download constraint unless explicitly opted into.

### 1. Switch the mountain material to a custom `ShaderMaterial` and add Fresnel rim lighting + procedural normal perturbation (§3.4, §6.3)
**Why first:** This is the single highest-leverage change. `MeshBasicMaterial` ignores normals, so the mountains are currently flat-shaded by baked vertex color only — every face is a flat color with no surface detail. Moving to a `ShaderMaterial` unlocks: (a) Fresnel rim lighting that makes edges catch the dawn light (Journey's signature look), (b) procedural triplanar noise that perturbs the normal per-fragment for rock grain without any texture file, (c) altitude-based atmospheric tint per face (§6.5), and (d) the ability to use the existing vertex colors as blend weights (§4.3) rather than final colors. The fragment-shader sketch in §6.3 is the starting point. Keep the existing `_buildMtnPeak` geometry and vertex colors exactly as-is — only the material changes. Estimated cost: ~3–5 KB of shader code, zero new assets, negligible per-frame GPU cost (a few noise octaves + a fresnel term per fragment, with a distance LOD to skip noise on the far ring).

### 2. Improve the vertex-color authoring: slope-based rock color, 2D noisy snow line, and crevice-snow coupling (§3.2, §6.6)
**Why second:** Cheapest change (pure JS in `_buildMtnPeak`, no material change needed), immediate readability gain. (a) Add a slope term to rock color: steep faces (`normal.y` low) get darker weathered rock, gentle faces get lighter talus. (b) Make the snow line vary 2D (by height AND angular position) and bias it lower on leeward faces — snow rambles instead of banding. (c) Use the crevice factor as a snow accumulator near peaks: crevices catch snow up high, stay shadowed down low. (d) Add a cheap geometric AO darkening to valley floors and crevice bottoms (§3.3). All of this is a few lines in `pushTri` and costs nothing at runtime.

### 3. Generate a normal map from the geometry itself at load time and bind it to the new material (§6.1, §6.4)
**Why third:** Once the material is a `ShaderMaterial` (step 1), it can consume a normal map. Generate one from the existing geometry by rendering each peak from a top-down ortho camera into a small `WebGLRenderTarget`, Sobel-filtering to normals, and storing as a `DataTexture` — or compute normals analytically from the same noise function that displaces the vertices. The normal map exactly matches the authored silhouette and adds the surface detail that procedural fragment noise (step 1) alone can't. This is the "diorama" trick (§1.11) completed. Cost: one-time at load, ~1–2 KB of code, ~64×64–128×128 normal map per ring in VRAM (negligible).

### 4. Strengthen atmospheric perspective between rings and add inter-ring haze planes (§3.6)
**Why fourth:** The Firewatch/Journey depth cue. Push the far ring harder toward desaturated sky color, keep the near ring grounded, switch to `FogExp2` for natural falloff, and add 2–3 large semi-transparent haze-tinted planes between the rings. This makes the 3-ring system read as genuine distance (atmospheric perspective) rather than 3 copies of the same mountains at different scales. Pure material/scene work, no geometry change, ~1 KB.

### 5. (Optional, phase 2) Add instanced procedural boulders on the near ring (§1.8)
**Why last:** Adds real 3D silhouette clutter that breaks up the smooth pyramid faces. Use a procedural low-poly rock (icosahedron + noise displacement, or the SDF-to-marching-cubes approach from the [100K Procedural Rocks](https://discourse.threejs.org/t/100k-procedural-rocks-brutally-optimized/89578) post) as the instanced mesh, scattered on the near-ring faces via the existing height sample. One draw call, ~20–50 instances, zero asset download. Skip if the first four steps already deliver the desired quality — this is the polish layer.

---

## Appendix: Key Code References (quick links back to sources)

- **Official terrain noise + baked shading:** [`webgl_geometry_terrain.html` source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_terrain.html) — `ImprovedNoise`, 4-octave fbm, canvas-baked shading via per-pixel normal·sun.
- **Triplanar mapping GLSL:** [three.js forum — "Tri plannar mapping in three.js"](https://discourse.threejs.org/t/tri-plannar-mapping-in-three-js/40335) — full `_VS`/`_FS` with `triplanarMapping()` and `blendNormal()`.
- **Splat texturing + no-tile repetition + multi-scale normal blend:** [Nathan Pointer — Landscapes](https://nathanpointer.com/blog/landscapes) — `textureNoTile()`, `blend_normals()`.
- **Normal from heightmap in vertex shader:** [three.js forum — "Calculating normals from heightmap in vertex shader"](https://discourse.threejs.org/t/calculating-normals-from-heightmap-in-vertex-shader/13014) — 4-neighbor sample, `texelSize` handling.
- **Height→normal JS library:** [lachoseparis/height-to-normal-map](https://github.com/lachoseparis/height-to-normal-map) — Sobel, configurable strength/blur.
- **Procedural rock shader (FBM + normal perturbation + fresnel + LOD):** [three.js forum — "100K Procedural Rocks, Brutally Optimized"](https://discourse.threejs.org/t/100k-procedural-rocks-brutally-optimized/89578).
- **Procedural texture theory (hash→noise→fbm→warp, rock/marble/wood GLSL):** [mysimulator.uk — Procedural Textures: Theory to Shader](https://www.mysimulator.uk/content/tutorials/procedural-textures-tutorial.html).
- **Journey sand shader (diffuse contrast, bump, fresnel rim, ocean specular, glitter):** [Alan Zucconi — A Journey Into Journey's Sand Shader](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/).
- **Flat vs smooth normals on BufferGeometry:** [three.js docs — BufferGeometry.computeVertexNormals](https://threejs.org/docs/pages/BufferGeometry.html) (non-indexed → face normals = flat shading); [SO — Three.js getting the low poly look](https://stackoverflow.com/questions/25428063/three-js-getting-the-low-poly-look) (`flatShading: true`).
- **Baking AO into vertex color:** [three.js forum — "How would I begin to bake lighting/ao into vertex color data"](https://discourse.threejs.org/t/how-would-i-begin-to-bake-lighting-ao-into-vertex-color-data/48689) (suggests `geo-ambient-occlusion` npm).
- **CC0 textures:** [ambientCG](https://ambientcg.com/), [Poly Haven ground/terrain](https://polyhaven.com/textures/ground-terrain), [ShareTextures](https://www.sharetextures.com/), [cgbookcase](https://www.cgbookcase.com/textures).
