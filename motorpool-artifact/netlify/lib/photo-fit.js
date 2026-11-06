"use strict";

const jpeg = require("jpeg-js");
const { limitsFor } = require("../../public/photo-batch");

/* Area average, sampling at most 4×4 source pixels per output pixel so a
   phone-sized original does not spend seconds shrinking inside the function. */
function scaleRgba(src, sw, sh, maxEdge) {
  var edge = Math.max(sw, sh);
  if (!src || edge <= maxEdge) return { data: src, width: sw, height: sh };
  if (src.length < sw * sh * 4) {
    var err = new Error("short image");
    throw err;
  }
  var scale = maxEdge / edge;
  var dw = Math.max(1, Math.round(sw * scale));
  var dh = Math.max(1, Math.round(sh * scale));
  var dst = new Uint8Array(dw * dh * 4);
  var y, x, yy, xx, y0, y1, x0, x1, r, g, b, a, n, i, o, stepY, stepX;
  for (y = 0; y < dh; y++) {
    y0 = (y * sh / dh) | 0;
    y1 = Math.max(y0 + 1, ((y + 1) * sh / dh) | 0);
    stepY = Math.max(1, ((y1 - y0) / 4) | 0);
    for (x = 0; x < dw; x++) {
      x0 = (x * sw / dw) | 0;
      x1 = Math.max(x0 + 1, ((x + 1) * sw / dw) | 0);
      stepX = Math.max(1, ((x1 - x0) / 4) | 0);
      r = 0;
      g = 0;
      b = 0;
      a = 0;
      n = 0;
      for (yy = y0; yy < y1; yy += stepY) {
        for (xx = x0; xx < x1; xx += stepX) {
          i = (yy * sw + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      o = (y * dw + x) * 4;
      dst[o] = Math.max(0, Math.min(255, Math.round(r / n)));
      dst[o + 1] = Math.max(0, Math.min(255, Math.round(g / n)));
      dst[o + 2] = Math.max(0, Math.min(255, Math.round(b / n)));
      dst[o + 3] = Math.max(0, Math.min(255, Math.round(a / n)));
    }
  }
  return { data: dst, width: dw, height: dh };
}

/**
 * Gallery and print do not need the stored original. A JPEG over the fit's
 * budget is recompressed; anything else (PDF, video, a small JPEG, a decode
 * miss) is returned unchanged so the caller can still show it.
 */
function fitPhotoPayload(dataUrl, fit) {
  var spec = limitsFor(fit);
  var raw = String(dataUrl || "");
  if (!raw) return "";
  if (!spec.maxEdge) return raw;
  if (raw.length <= spec.byteBudget) return raw;
  if (!/^data:image\/jpe?g;base64,/i.test(raw)) return raw;
  try {
    var comma = raw.indexOf(",");
    var buf = Buffer.from(raw.slice(comma + 1), "base64");
    if (!buf.length || buf.length > 12 * 1024 * 1024) return raw;
    var decoded = jpeg.decode(buf, {
      useTArray: true,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 128,
      tolerantDecoding: true,
    });
    if (!decoded || !decoded.width || !decoded.height || !decoded.data) return raw;
    var scaled = scaleRgba(decoded.data, decoded.width, decoded.height, spec.maxEdge);
    var encoded = jpeg.encode(
      { data: scaled.data, width: scaled.width, height: scaled.height },
      spec.quality
    );
    if (!encoded || !encoded.data || !encoded.data.length) return raw;
    var out = "data:image/jpeg;base64," + Buffer.from(encoded.data).toString("base64");
    return out.length < raw.length ? out : raw;
  } catch (e) {
    return raw;
  }
}

module.exports = {
  scaleRgba: scaleRgba,
  fitPhotoPayload: fitPhotoPayload,
};
