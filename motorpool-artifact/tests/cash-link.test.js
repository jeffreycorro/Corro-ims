"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createHandler, fileReceipts } = require("../netlify/functions/cash-link");

function store() {
  const docs = {}, photos = [];
  return {
    docs, photos,
    getDoc: async (c, id) => (docs[c + "/" + id] ? { data: docs[c + "/" + id] } : null),
    setDoc: async (c, id, data) => { docs[c + "/" + id] = data; if (c === "photos") photos.push(Object.assign({ id }, data)); return { data }; },
    listPhotoMeta: async (owner) => photos.filter((p) => p.vrf === owner),
  };
}

test("refuses without the secret", async () => {
  const h = createHandler({ secret: "s3cret" });
  const r = await h({ httpMethod: "POST", headers: {}, body: "{}" });
  assert.strictEqual(r.statusCode, 401);
  const r2 = await h({ httpMethod: "POST", headers: { "x-cash-link-secret": "nope" }, body: "{}" });
  assert.strictEqual(r2.statusCode, 401);
});

test("not configured answers 503", async () => {
  const h = createHandler({ secret: "" });
  const r = await h({ httpMethod: "GET", headers: { "x-cash-link-secret": "x" } });
  assert.strictEqual(r.statusCode, 503);
});

test("files receipt links under LIQ-<vrf>, once, and counts them", async () => {
  const s = store();
  const body = { vrf: "6352", voucherNo: "PC2026-2703", fund: "Petty Cash", batch: "PCB44", orNo: "123", actual: 150,
    receipts: ["https://drive.google.com/file/d/abc/view", "javascript:alert(1)", "https://drive.google.com/file/d/def/view"], by: "Crispel Eliseo" };
  const r = await fileReceipts(body, s);
  assert.strictEqual(r.added, 2);
  assert.strictEqual(s.docs["ops/photoindex"].counts["LIQ-6352"], 2);
  assert.ok(s.photos.every((p) => p.vrf === "LIQ-6352" && p.kind === "link" && /PC2026-2703/.test(p.caption)));
  assert.deepStrictEqual(s.photos.map((p) => p.id), ["vrf-LIQ-6352__1", "vrf-LIQ-6352__2"]);
  const again = await fileReceipts(body, s);
  assert.strictEqual(again.added, 0);
  assert.strictEqual(s.docs["ops/photoindex"].counts["LIQ-6352"], 2);
});

test("a PSRF number is not a motorpool VRF", async () => {
  await assert.rejects(() => fileReceipts({ vrf: "UPShe-0222", voucherNo: "PC1", receipts: [] }, store()), /digits/);
});
