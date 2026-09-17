/**
 * Page-curl runtime shader: one leaf, hinged at the spine.
 *
 * A book has no free-floating sheet. Every leaf is bound along the spine, so a
 * turn is a fold about that hinge: the outer edge lifts, the crease travels
 * inward, and when the crease reaches the spine the leaf has landed face-down
 * on the facing page. The page on the other side of the spine never moves.
 *
 * Working in leaf coordinates -- u = 0 at the spine, u = 1 at the free edge --
 * makes all of that fall out of one number. With turn progress `t`:
 *
 *   free edge   d = 1 - 2t     travels from the outer edge, across the spine,
 *                              to the far edge of the facing page
 *   crease      f = 1 - t - pi*r/2
 *   curl radius r = R0 * sin(pi * t)   zero at both ends, so the leaf starts
 *                                      flat and lands flat
 *
 * Paper inside the crease (u < f) has not moved. Paper beyond it is wrapped
 * around a cylinder of radius r at the crease and then lies flat, face-down,
 * back toward the spine. Feeding the arc length through `f` above makes the
 * free edge land exactly on `d`, and at t = 1 gives f = 0, r = 0, d = -1: the
 * crease is on the spine and the leaf covers the facing page precisely. That
 * is what lets the flat endpoints below be exact rather than approximate.
 *
 * Per pixel on the GPU: no mesh, no per-frame vertex work.
 *
 * The cylinder-fold construction is the classic one described by W. Dana Nuon,
 * "Implementing iBooks page curling using a conical deformation algorithm".
 * Page-edge anti-aliasing and the contact-shadow treatment follow the
 * Hewlett-Packard curl transition (BSD 3-Clause) this file previously adapted
 * from, via Sergey Kosarevsky and the react-native-skia example app.
 *
 * `spineX` is the hinge in pixels, `leafW` the leaf's width at rest, and
 * `leafSign` which side of the hinge the leaf rests on (+1 right, -1 left).
 * Those three cover both a two-page spread hinged down the middle and a single
 * centred page hinged on its own inner edge. `backSign` says where to read the
 * page printed on the leaf's back, which is not always the mirror of the front:
 * see the uniform.
 */
export const PAGE_CURL_SKSL = `
uniform shader fromLeft;
uniform shader fromRight;
uniform shader toLeft;
uniform shader toRight;
uniform shader prevLeft;
uniform shader prevRight;

uniform float progress;
// x that divides the left and right image slots -- the spine on a spread.
uniform float halfW;
// 1 = turning forward (reveals toLeft/toRight), -1 = back (prevLeft/prevRight).
uniform float dir;
// The hinge, in pixels. The turning leaf pivots here and nothing crosses it.
uniform float spineX;
// Width of the turning leaf at rest, in pixels.
uniform float leafW;
// Which side of the hinge the leaf rests on: +1 right of it, -1 left of it.
uniform float leafSign;
// Which side of the hinge the leaf's printed back is drawn on in the
// destination layout. Landing on a spread it is the far page, so this is
// -leafSign; landing on a single centred page the destination occupies the
// leaf's own side, so it is +leafSign and the back reads from there instead
// of off the edge of the layout.
uniform float backSign;
// The view transform: viewport = zoomScale * fittedPoint + zoomTranslate.
// Undone once at the top of main, so the curl geometry, page sampling and
// shadows below all work in fitted-page space and never learn zoom exists.
uniform float zoomScale;
uniform float2 zoomTranslate;
// The reading pane magnification is confined to. A spread is two leaves that
// happen to be visible together, not one picture: inspecting one must leave the
// other exactly where it is, so the transform applies inside this rect only.
uniform float2 paneMin;
uniform float2 paneMax;

const float PI = 3.141592653589793;
// Curl radius at mid-turn, in leaf widths. Above 2/pi^2 the crease would
// outrun the paper feeding it and the fold would tear away from the spine.
const float CURL_RADIUS = 0.14;
const half3 PAPER = half3(0.93, 0.91, 0.87);
const float LIGHT_X = -0.35;

// Six children are bound, and each of these picks one. Written as an early
// return rather than a ternary over two eval calls so the unpicked child is
// unambiguously not sampled: a select is an expression, and whether its arms
// are folded away is left to the driver. Both splits are cheap to branch on --
// dir is a uniform, and halfW divides the screen in two coherent halves.
half4 fromColor(float x, float y) {
  float2 p = float2(x, y);
  if (x < halfW) { return fromLeft.eval(p); }
  return fromRight.eval(p);
}

// Forward reveals the next spread, back the previous one. Both are bound so
// the direction is a uniform, not a rebuild.
half4 toColor(float x, float y) {
  float2 p = float2(x, y);
  if (dir < 0.0) {
    if (x < halfW) { return prevLeft.eval(p); }
    return prevRight.eval(p);
  }
  if (x < halfW) { return toLeft.eval(p); }
  return toRight.eval(p);
}

// Leaf coordinate u -> the pixel it occupies when flat, and the pixel holding
// the page printed on its back. Both are measured from the hinge; only the
// side differs.
float leafX(float u) { return spineX + leafSign * u * leafW; }
float backX(float u) { return spineX + backSign * u * leafW; }

half4 main(float2 xy) {
  bool inPane = xy.x >= paneMin.x && xy.x <= paneMax.x
             && xy.y >= paneMin.y && xy.y <= paneMax.y;
  float2 page = inPane ? (xy - zoomTranslate) / zoomScale : xy;

  // Exact endpoints: no cylinder work at rest, and no shaded destination
  // flashing to a different flat image when the turn commits.
  if (progress <= 0.0) return fromColor(page.x, page.y);
  if (progress >= 1.0) return toColor(page.x, page.y);

  float t = progress;
  float y = page.y;
  float u = (page.x - spineX) * leafSign / leafW;

  float r = CURL_RADIUS * sin(PI * t);
  float crease = 1.0 - t - PI * r * 0.5;
  float edge = 1.0 - 2.0 * t;
  // One device pixel, in leaf units -- the width every silhouette is feathered
  // over, so page edges stay smooth at any leaf size. Enlarged, a device pixel
  // covers less of the leaf, so the feather narrows with it and the page edge
  // stays a crisp edge instead of a soft band that grows with the zoom.
  float aa = 1.0 / max(leafW * zoomScale, 1.0);

  // The leaf's silhouette: 1 where turned paper is in front of the reader, 0
  // where it is not. It costs four scalars and decides which half of the work
  // below a pixel needs, so it is computed before either half rather than
  // after both. Away from the one-pixel feather every pixel is on exactly one
  // side of it, so the two branches never both run over almost the whole
  // viewport -- and that halves the child-shader samples per pixel.
  float covered = smoothstep(edge - aa, edge + aa, u)
    * (1.0 - smoothstep(crease + r - aa, crease + r + aa, u));

  half3 rgb = half3(0.0);
  half a = half(0.0);

  if (covered < 1.0) {
    // Under the leaf: the revealed page past the crease, the leaf's own flat
    // part before it, and -- for u < 0, where the crease never reaches -- the
    // facing page, which this expression leaves untouched. The crease is a
    // hard boundary, so on all but a pixel of it one of the two is weighted to
    // nothing; sampling only the other one is the same colour for half the
    // cost.
    float creasing = smoothstep(crease - aa, crease + aa, u);
    half4 under;
    if (creasing <= 0.0) { under = fromColor(page.x, y); }
    else if (creasing >= 1.0) { under = toColor(page.x, y); }
    else { under = mix(fromColor(page.x, y), toColor(page.x, y), half(creasing)); }

    // Two contact shadows: the roll onto the page it is uncovering, and the
    // lifted paper onto whatever lies under its free edge.
    float reach = 0.06 * sin(PI * t) + 0.004;
    float fromRoll = clamp(1.0 - (u - crease - r) / reach, 0.0, 1.0) * step(crease + r, u);
    float fromEdge = clamp(1.0 - (edge - u) / reach, 0.0, 1.0) * step(u, edge);
    half lit = half(1.0 - 0.45 * max(fromRoll, fromEdge));

    rgb = under.rgb * lit;
    a = under.a;
  }

  if (covered > 0.0) {
    // Where the turned paper is: wrapped on the cylinder for u in [crease,
    // crease + r], flat and face-down from there back to the free edge.
    float paper;
    float shade;
    if (u >= crease) {
      float angle = PI - asin(clamp((u - crease) / max(r, 1e-5), 0.0, 1.0));
      paper = crease + r * angle;
      // Lambert against a light above and slightly outboard. At the shoulder of
      // the roll the surface turns edge-on and darkens; by the time it lies flat
      // it faces the reader again.
      float2 normal = float2(sin(angle), -cos(angle));
      float lambert = clamp(dot(normal, normalize(float2(LIGHT_X * leafSign, 1.0))), 0.0, 1.0);
      shade = 0.42 + 0.58 * pow(lambert, 0.6);
    } else {
      paper = crease + PI * r + (crease - u);
      shade = 1.0;
    }

    // The back of a leaf is the next page, printed -- not blank stock. Where the
    // document has no pixel for it (a single page turning, or a facing page of a
    // different size) it falls back to paper rather than punching a hole.
    half4 printed = toColor(backX(paper), y);
    // A leaf whose landing page is laid out differently -- a wide single page
    // turning onto a spread -- has nothing drawn where its back should be. Try
    // the other side of the hinge before giving up, so the leaf shows printed
    // paper rather than turning blank halfway through.
    // ponytail: approximate when the leaf and its back page are different widths
    // -- the back is stretched to the leaf. Exact whenever they match, which is
    // every turn in a book of uniform pages. Upgrade path: pass the destination
    // back-page's own rect as uniforms and map onto that instead of the hinge.
    if (printed.a < 0.5) { printed = toColor(spineX - backSign * paper * leafW, y); }
    half3 back = mix(PAPER, printed.rgb, printed.a) * half(shade);
    // The leaf is exactly as tall and wide as its own page, so its own alpha is
    // the silhouette -- the destination's would letterbox it differently.
    half alpha = fromColor(leafX(paper), y).a;

    rgb = mix(rgb, back * alpha, half(covered));
    a = mix(a, alpha, half(covered));
  }

  return half4(rgb, a);
}
`;
