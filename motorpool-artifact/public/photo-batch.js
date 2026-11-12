/**
 * How many VRF pictures travel in one request.
 *
 * Opening a VRF used to download every attachment as its own base64 document,
 * two at a time, and each of those reads also probed the records table.
 * Printing fired one of those reads per picture and waited for all of them.
 * This plans the batches the page asks for instead. The bytes still have to
 * cross the link; the batch just stops a form with ten pictures from paying
 * for ten round trips.
 *
 * Works in the browser (window.PhotoBatch) and under node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PhotoBatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Same character class as photoKey() in the page. */
  var PHOTO_ID = /^vrf-[A-Za-z0-9_.~:@+-]+__\d+$/;

  /* maxEdge 0 means "do not recompress". byteBudget is the data-URL length
     under which a JPEG is already small enough to send as stored.
     maxCount / maxBytes cap one Netlify response so a batch stays under the
     platform body limit and under a short function timeout. */
  var PHOTO_FIT = {
    thumb: { maxEdge: 160, quality: 55, maxCount: 6, maxBytes: 1600000, byteBudget: 28000 },
    print: { maxEdge: 800, quality: 55, maxCount: 3, maxBytes: 1200000, byteBudget: 140000 },
    full: { maxEdge: 0, quality: 0, maxCount: 1, maxBytes: 1500000, byteBudget: 0 },
  };

  function limitsFor(fit) {
    if (fit === "print" || fit === "full") return PHOTO_FIT[fit];
    return PHOTO_FIT.thumb;
  }

  function normalizePhotoIds(ids) {
    var out = [];
    var seen = {};
    var list = Array.isArray(ids) ? ids : [];
    for (var i = 0; i < list.length; i++) {
      var id = String(list[i] == null ? "" : list[i]).trim();
      if (!PHOTO_ID.test(id) || seen[id]) continue;
      seen[id] = 1;
      out.push(id);
    }
    return out;
  }

  function assertPhotoBatch(ids, fit) {
    var clean = normalizePhotoIds(ids);
    var cap = limitsFor(fit).maxCount;
    if (clean.length > cap) {
      var err = new Error("Too many pictures in one request");
      err.statusCode = 400;
      throw err;
    }
    return clean;
  }

  /* PostgREST primary-key lookup. Selecting data->>data returns the image
     string only. Filtering data->>vrf would seq-scan every photo blob. */
  function photoDataQuery(ids) {
    var clean = normalizePhotoIds(ids);
    var list = clean.map(function (id) { return '"' + id + '"'; }).join(",");
    return (
      "collection=eq.photos" +
      "&id=in.(" +
      encodeURIComponent(list) +
      ")" +
      "&select=" +
      encodeURIComponent("id,data:data->>data")
    );
  }

  /* items: { id, bytes }. bytes is the stored binary size; the data URL is
     about 1.37× that. A picture larger than maxBytes still goes alone. */
  function planPhotoBatches(items, limits) {
    var maxCount = (limits && limits.maxCount) || 4;
    var maxBytes = (limits && limits.maxBytes) || 1000000;
    var chunks = [];
    var cur = [];
    var used = 0;
    var seen = {};
    (items || []).forEach(function (item) {
      var id = String(item && item.id != null ? item.id : "").trim();
      if (!PHOTO_ID.test(id) || seen[id]) return;
      seen[id] = 1;
      var n = Number(item && item.bytes);
      if (!isFinite(n) || n <= 0) n = 180000;
      else n = Math.round(n * 1.37);
      if (cur.length && (cur.length >= maxCount || used + n > maxBytes)) {
        chunks.push(cur);
        cur = [];
        used = 0;
      }
      cur.push({ id: id, bytes: n });
      used += n;
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  /* Shared-link model: a wave starts together, then the bytes in that wave
     take turns on one pipe. tripsPerRequest is the database reads inside one
     function call (a photo get used to probe records, then read the blob). */
  function estimateAttachMs(spec) {
    spec = spec || {};
    var count = Math.max(0, spec.count | 0);
    if (!count) return 0;
    var bytesEach = spec.bytesEach > 0 ? spec.bytesEach : 1;
    var bandwidth = spec.bytesPerSec > 0 ? spec.bytesPerSec : 1;
    var rtt = spec.rttMs > 0 ? spec.rttMs : 0;
    var trips = spec.tripsPerRequest > 0 ? spec.tripsPerRequest : 1;
    var concurrency = spec.concurrency > 0 ? spec.concurrency : 1;
    var waves = Math.ceil(count / concurrency);
    var perWave = Math.min(concurrency, count);
    var transfer = ((bytesEach * perWave) / bandwidth) * 1000;
    return Math.round(waves * (rtt * trips + transfer));
  }

  /* Reads (shrink a chosen file, fetch a thumb) can overlap. A rejection is
     recorded on that item so one bad file does not cancel the rest. */
  function mapLimit(items, limit, fn) {
    var list = Array.isArray(items) ? items : [];
    var cap = Math.max(1, limit | 0);
    var results = new Array(list.length);
    var next = 0;
    var active = 0;
    return new Promise(function (resolve) {
      if (!list.length) {
        resolve(results);
        return;
      }
      function pump() {
        if (next >= list.length && active === 0) {
          resolve(results);
          return;
        }
        while (active < cap && next < list.length) {
          (function (idx) {
            active++;
            Promise.resolve()
              .then(function () {
                return fn(list[idx], idx);
              })
              .then(
                function (value) {
                  results[idx] = { ok: true, value: value };
                },
                function (error) {
                  results[idx] = { ok: false, error: error };
                }
              )
              .then(function () {
                active--;
                pump();
              });
          })(next++);
        }
      }
      pump();
    });
  }

  return {
    PHOTO_ID: PHOTO_ID,
    PHOTO_FIT: PHOTO_FIT,
    limitsFor: limitsFor,
    normalizePhotoIds: normalizePhotoIds,
    assertPhotoBatch: assertPhotoBatch,
    photoDataQuery: photoDataQuery,
    planPhotoBatches: planPhotoBatches,
    estimateAttachMs: estimateAttachMs,
    mapLimit: mapLimit,
  };
});
