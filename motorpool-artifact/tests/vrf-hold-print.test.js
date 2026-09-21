"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("os");
const {
  photoOwnersForVrf,
  photoOwnersForReserve,
  photoOwnersForOpenVrf,
  heldReserveVrfs,
  vrfLogVisible,
  remintHeldVrf,
  postedVrfNumbers,
  shouldRemintHeldVrf,
  staffMayDirectPostVrf,
  canDirectPostVrf,
  vrfPrintWatermark,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

describe("9/21 15:28 — held FOR APPROVAL VRF stays printable with photos", () => {
  it("surfaces a Requested hold on the VRF log even when the ledger is already indexed", () => {
    const existing = [{ vrf: "5601" }, { vrf: "5827" }];
    assert.deepEqual(
      heldReserveVrfs(
        [
          {
            no: "88",
            vrfNo: "5901",
            status: "Requested",
            requestedBy: "Sophie Hardcorro",
            draftLines: [{ cat: "Fuel — Diesel", qty: 1, price: 1000 }],
          },
          { no: "89", vrfNo: "5827", status: "Requested" },
        ],
        existing
      ),
      ["5901"]
    );
    const visible = vrfLogVisible(
      [
        { vrf: "1001" },
        { vrf: "5901", held: true, status: "Requested" },
        ...Array.from({ length: 260 }, (_, i) => ({ vrf: String(4000 + i) })),
      ],
      5902
    );
    assert.ok(visible.some((v) => v.vrf === "5901"));
  });

  it("keeps posted-VRF photo isolation, but a Requested hold also sees its reserve copy", () => {
    assert.deepEqual(photoOwnersForVrf({ vrf: "5901", reserve: "88" }), ["5901"]);
    const hold = { vrf: "5901", reserve: "88", held: true, status: "Requested" };
    const reserve = { no: "88", vrfNo: "5901", vrfs: [] };
    assert.deepEqual(photoOwnersForOpenVrf(hold, reserve), ["5901", "RSV-88"]);
    assert.deepEqual(photoOwnersForOpenVrf(hold, reserve, { 5901: 1 }), ["5901"]);
    assert.deepEqual(photoOwnersForReserve(reserve), ["RSV-88", "5901"]);
    assert.deepEqual(photoOwnersForOpenVrf({ vrf: "5795", reserve: "3" }, {
      no: "3",
      vrfNo: "5795",
      vrfs: ["5795", "5794"],
    }), ["5795"]);
  });

  it("remints a colliding hold and leaves the posted financial row on its number", () => {
    const posted = [{ vrf: "5828", date: "2026-09-20", total: 12500, src: "ledger" }];
    const pending = { no: "44", vrfNo: "5828", status: "Requested", vrfs: [] };
    const owner = { no: "40", vrfNo: "5828", status: "Approved", vrfs: ["5828"] };
    assert.deepEqual(postedVrfNumbers(posted), { 5828: 1 });
    assert.equal(shouldRemintHeldVrf(pending, posted, [owner, pending]), true);
    const change = remintHeldVrf(pending, posted, [owner, pending], 5829);
    assert.deepEqual(change, { from: "5828", to: "5829", reserve: "44" });
    assert.equal(pending.vrfNo, "5829");
    assert.equal(posted[0].vrf, "5828");
  });

  it("watermarks a hold FOR APPROVAL and a posted VRF APPROVED", () => {
    assert.equal(vrfPrintWatermark({ vrf: "5901", held: true, status: "Requested" }), "FOR APPROVAL");
    assert.equal(vrfPrintWatermark({ vrf: "5901", src: "reserve-hold", status: "Requested" }), "FOR APPROVAL");
    assert.equal(vrfPrintWatermark({ vrf: "5901", status: "Requested" }), "FOR APPROVAL");
    assert.equal(vrfPrintWatermark({ vrf: "5828", status: "Open" }), "APPROVED");
    assert.equal(vrfPrintWatermark({ vrf: "5795", status: "Closed" }), "APPROVED");
    assert.equal(vrfPrintWatermark({ vrf: "1001", status: "Legacy" }), "APPROVED");
    assert.equal(vrfPrintWatermark(null), "FOR APPROVAL");
  });

  it("does not restore a Post VRF bypass", () => {
    assert.equal(staffMayDirectPostVrf(), false);
    assert.equal(canDirectPostVrf({ role: "admin" }), false);
    assert.doesNotMatch(html, /el\("button","btn"\+\(d\.reserve\?" pri":""\),"Post VRF"\)/);
    assert.doesNotMatch(html, /foot\.appendChild\(post\)/);
  });
});

describe("artifact HTML — hold print / photos / log after Send for approval", () => {
  it("keeps the artifact script syntactically valid", () => {
    const match = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(match && match[1], "inline artifact script");
    const tmp = path.join(os.tmpdir(), "motorpool-hold-print-check.js");
    fs.writeFileSync(tmp, match[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });

  it("invalidates the VRF index when a hold is saved so VRF Logs sees Requested", () => {
    const start = html.indexOf("async function saveReserves");
    const end = html.indexOf("\nasync function claimReserveNo", start);
    assert.ok(start > 0 && end > start);
    const body = html.slice(start, end);
    assert.match(body, /_vrfs=null/);
  });

  it("copies photos when a colliding hold is reminted", () => {
    const start = html.indexOf("async function remintHeldVrfCollisions");
    const end = html.indexOf("\nfunction addHeldReserveVrfs", start);
    assert.ok(start > 0 && end > start);
    const body = html.slice(start, end);
    assert.match(body, /await copyPhotos\(changes\[ci\]\.from, changes\[ci\]\.to\)/);
  });

  it("saves send-for-approval photos on the VRF number and the reserve, then opens VRF Logs", () => {
    const start = html.indexOf("async function sendForApproval");
    const end = html.indexOf("\nasync function postVrf", start);
    assert.ok(start > 0 && end > start);
    const body = html.slice(start, end);
    assert.match(body, /addPhotoToOwners\(\[String\(vno\), rsvOwner\(no\)\]/);
    assert.match(body, /S\.view="vrflog"/);
    assert.match(body, /openVrf\(held,"photos"\)/);
    assert.doesNotMatch(body, /appendLedger/);
    assert.doesNotMatch(body, /S\.view="rsv"/);
  });

  it("lets staff print and reopen a Requested hold from the reserve sheet and VRF sheet", () => {
    assert.match(html, /function heldVrfEntry/);
    assert.match(html, /function photoOwnersForOpenVrf/);
    assert.match(html, /prHold\.addEventListener\("click",function\(\)\{/);
    assert.match(html, /Attachments on this request/);
    assert.match(html, /Requested — FOR APPROVAL/);
    assert.match(html, /Sent for approval — VRF /);
    assert.match(html, /Photos and print work now/);
    assert.match(html, /if\(!waiting\) tabDefs\.push\(\["liq"/);
    assert.match(html, /listPhotosMany\(photoOwnersForOpenVrf\(entry\)\)/);
    assert.match(html, /var BUILD = "2026-09-21 d"/);
    assert.match(html, /function vrfPrintWatermark/);
    assert.match(html, /function vrfMarkNode/);
    assert.match(html, /d\.appendChild\(vrfMarkNode\(mark\)\)/);
    assert.match(html, /ph\.appendChild\(vrfMarkNode\(mark\)\)/);
    assert.match(html, /print-color-adjust:exact/);
    assert.match(html, /@media print\{\.vrfdoc>\.vmark\{position:fixed;inset:12mm\}\}/);
  });
});
