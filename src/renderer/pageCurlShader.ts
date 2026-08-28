/**
 * Page-curl runtime shader.
 *
 * The curl is a cylinder the page wraps around, evaluated per pixel on the
 * GPU: no mesh, no per-frame vertex work, and the backside shading, contact
 * shadow and anti-aliased page edge come for free.
 *
 * Original: Hewlett-Packard (BSD 3-Clause), adapted by Sergey Kosarevsky from
 * http://rectalogic.github.io/webvfx/examples_2transition-shader-pagecurl_8html-example.html
 * Ported to SkSL by the react-native-skia example app:
 * https://github.com/Shopify/react-native-skia/blob/main/apps/example/src/Examples/Transitions/transitions/pageCurl.ts
 *
 * `image1` is the page being turned, `image2` what is underneath it.
 * `progress` runs 0 (flat) to 1 (fully turned).
 */
export const PAGE_CURL_SKSL = `
uniform shader fromLeft;
uniform shader fromRight;
uniform shader toLeft;
uniform shader toRight;

uniform float progress;
uniform float2 resolution;
uniform float halfW;
// 1 = turning forward (right leaf lifts), -1 = turning back (left leaf lifts).
uniform float dir;

// The sheet spans the whole spread so the curl can travel across the spine
// onto the other page, the way a real leaf does. Each half is a separate
// image, so no offscreen compositing is needed.
float2 sheetToScreen(float2 uv) {
  float2 p = uv;
  if (dir < 0.0) { p.x = 1.0 - p.x; }
  return p * resolution;
}

half4 getFromColor(float2 uv) {
  float2 p = sheetToScreen(uv);
  return p.x < halfW ? fromLeft.eval(p) : fromRight.eval(p);
}

half4 getToColor(float2 uv) {
  float2 p = sheetToScreen(uv);
  return p.x < halfW ? toLeft.eval(p) : toRight.eval(p);
}

const float MIN_AMOUNT = -0.16;
const float MAX_AMOUNT = 1.5;

const float PI = 3.141592653589793;

const float scale = 512.0;
const float sharpness = 3.0;

const float cylinderRadius = 1.0 / PI / 2.0;

vec3 hitPoint(float hitAngle, float yc, vec3 point, mat3 rrotation)
{
        float hitPoint = hitAngle / (2.0 * PI);
        point.y = hitPoint;
        return rrotation * point;
}

vec4 antiAlias(vec4 color1, vec4 color2, float distanc)
{
        distanc *= scale;
        if (distanc < 0.0) return color2;
        if (distanc > 2.0) return color1;
        float dd = pow(1.0 - distanc / 2.0, sharpness);
        return ((color2 - color1) * dd) + color1;
}

float distanceToEdge(vec3 point)
{
        float dx = abs(point.x > 0.5 ? 1.0 - point.x : point.x);
        float dy = abs(point.y > 0.5 ? 1.0 - point.y : point.y);
        if (point.x < 0.0) dx = -point.x;
        if (point.x > 1.0) dx = point.x - 1.0;
        if (point.y < 0.0) dy = -point.y;
        if (point.y > 1.0) dy = point.y - 1.0;
        if ((point.x < 0.0 || point.x > 1.0) && (point.y < 0.0 || point.y > 1.0)) return sqrt(dx * dx + dy * dy);
        return min(dx, dy);
}

vec4 seeThrough(float yc, vec2 p, mat3 rotation, mat3 rrotation)
{
        float amount = progress * (MAX_AMOUNT - MIN_AMOUNT) + MIN_AMOUNT;
        float cylinderAngle = 2.0 * PI * amount;
        float hitAngle = PI - (acos(yc / cylinderRadius) - cylinderAngle);
        vec3 point = hitPoint(hitAngle, yc, rotation * vec3(p, 1.0), rrotation);
        if (yc <= 0.0 && (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0))
        {
            return getToColor(p);
        }

        if (yc > 0.0) return getFromColor(p);

        vec4 color = getFromColor(point.xy);
        vec4 tcolor = vec4(0.0);

        return antiAlias(color, tcolor, distanceToEdge(point));
}

vec4 seeThroughWithShadow(float yc, vec2 p, vec3 point, mat3 rotation, mat3 rrotation)
{
        float amount = progress * (MAX_AMOUNT - MIN_AMOUNT) + MIN_AMOUNT;
        float shadow = distanceToEdge(point) * 30.0;
        shadow = (1.0 - shadow) / 3.0;

        if (shadow < 0.0) shadow = 0.0; else shadow *= amount;

        vec4 shadowColor = seeThrough(yc, p, rotation, rrotation);
        shadowColor.r -= shadow;
        shadowColor.g -= shadow;
        shadowColor.b -= shadow;

        return shadowColor;
}

vec4 backside(float yc, vec3 point)
{
        // The reverse of a leaf in a book is the next page, printed — not
        // blank stock. The original desaturates getFromColor to fake paper;
        // we show the real page and only shade it by the roll's curvature.
        vec4 color = getToColor(point.xy);
        float shade = 0.55 + 0.45 * pow(1.0 - abs(yc / cylinderRadius), 0.2);
        color.rgb *= shade;
        return color;
}

vec4 behindSurface(vec2 p, float yc, vec3 point, mat3 rrotation)
{
        float amount = progress * (MAX_AMOUNT - MIN_AMOUNT) + MIN_AMOUNT;
        float cylinderAngle = 2.0 * PI * amount;

        float shado = (1.0 - ((-cylinderRadius - yc) / amount * 7.0)) / 6.0;
        shado *= 1.0 - abs(point.x - 0.5);

        yc = (-cylinderRadius - cylinderRadius - yc);

        float hitAngle = (acos(yc / cylinderRadius) + cylinderAngle) - PI;
        point = hitPoint(hitAngle, yc, point, rrotation);

        if (yc < 0.0 && point.x >= 0.0 && point.y >= 0.0 && point.x <= 1.0 && point.y <= 1.0 && (hitAngle < PI || amount > 0.5))
        {
                shado = 1.0 - (sqrt(pow(point.x - 0.5, 2.0) + pow(point.y - 0.5, 2.0)) / (71.0 / 100.0));
                shado *= pow(-yc / cylinderRadius, 3.0);
                shado *= 0.5;
        }
        else
        {
                shado = 0.0;
        }
        return vec4(getToColor(p).rgb - shado, 1.0);
}

vec4 transition(vec2 p) {
        float amount = progress * (MAX_AMOUNT - MIN_AMOUNT) + MIN_AMOUNT;
        const float angle = 100.0 * PI / 180.0;
        float c = cos(-angle);
        float s = sin(-angle);

        mat3 rotation = mat3( c, s, 0,
                                                                -s, c, 0,
                                                                -0.801, 0.8900, 1
                                                                );
        c = cos(angle);
        s = sin(angle);

        mat3 rrotation = mat3(	c, s, 0,
                                                                        -s, c, 0,
                                                                        0.98500, 0.985, 1
                                                                );

        vec3 point = rotation * vec3(p, 1.0);
        float cylinderCenter = amount;
        float yc = point.y - cylinderCenter;

        if (yc < -cylinderRadius)
        {
                // Behind surface
                return behindSurface(p,yc, point, rrotation);
        }

        if (yc > cylinderRadius)
        {
                // Flat surface
                return getFromColor(p);
        }
        float cylinderAngle = 2.0 * PI * amount;
        float hitAngle = (acos(yc / cylinderRadius) + cylinderAngle) - PI;

        float hitAngleMod = mod(hitAngle, 2.0 * PI);
        if ((hitAngleMod > PI && amount < 0.5) || (hitAngleMod > PI/2.0 && amount < 0.0))
        {
                return seeThrough(yc, p, rotation, rrotation);
        }

        point = hitPoint(hitAngle, yc, point, rrotation);

        if (point.x < 0.0 || point.y < 0.0 || point.x > 1.0 || point.y > 1.0)
        {
                return seeThroughWithShadow(yc, p, point, rotation, rrotation);
        }

        vec4 color = backside(yc, point);

        vec4 otherColor;
        if (yc < 0.0)
        {
                float shado = 1.0 - (sqrt(pow(point.x - 0.5, 2.0) + pow(point.y - 0.5, 2.0)) / 0.71);
                shado *= pow(-yc / cylinderRadius, 3.0);
                shado *= 0.5;
                otherColor = vec4(0.0, 0.0, 0.0, shado);
        }
        else
        {
                otherColor = getFromColor(p);
        }

        color = antiAlias(color, otherColor, cylinderRadius - abs(yc));

        vec4 cl = seeThroughWithShadow(yc, p, point, rotation, rrotation);
        float dist = distanceToEdge(point);

        return antiAlias(color, cl, dist);
}


half4 main(vec2 xy) {
  vec2 uv = xy / resolution;
  // Turning back is the same curl mirrored about the spine.
  if (dir < 0.0) { uv.x = 1.0 - uv.x; }
  return half4(transition(uv));
}
`;
