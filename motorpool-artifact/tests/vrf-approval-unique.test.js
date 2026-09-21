"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const {
  usedVrfNumbers,
  nextFreeVrf,
  vrfNumberTaken,
  postedVrfNumbers,
  staffMayDirectPostVrf,
  canDirectPostVrf,
  shouldRemintHeldVrf,
  remintHeldVrf,
  repairDuplicateHeldVrfs,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

describe("VRF approval required — no Post VRF bypass", () => {
  it("does not let staff or admin post a VRF without office approval", () => {
    assert.equal(staffMayDirectPostVrf(), false);
    assert.equal(canDirectPostVrf({ role: "admin" }), false);
    assert.equal(canDirectPostVrf({ role: "staff", department: "motorpool" }), false);
  });

  it("keeps the artifact script syntactically valid", () => {
    const match = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(match && match[1], "inline artifact script");
    const tmp = path.join(os.tmpdir(), "motorpool-artifact-check.js");
    fs.writeFileSync(tmp, match[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });

  it("removes the Post VRF control from the create/edit form", () => {
    assert.doesNotMatch(html, /el\("button","btn"\+\(d\.reserve\?" pri":""\),"Post VRF"\)/);
    assert.doesNotMatch(html, /foot\.appendChild\(post\)/);
    assert.match(html, /function staffMayDirectPostVrf/);
    assert.match(html, /Send this VRF for approval\. The office posts it after it is approved\./);
    assert.match(html, /There is no Post VRF on this form/);
    assert.match(html, /async function sendForApproval/);
    assert.match(html, /<b>Send for approval<\/b>/);
  });

  it("postVrf only toasts and does not write the ledger", () => {
    const start = html.indexOf("async function postVrf");
    const end = html.indexOf("\nfunction previewVrf", start);
    assert.ok(start > 0 && end > start);
    const body = html.slice(start, end);
    assert.match(body, /Send this VRF for approval/);
    assert.doesNotMatch(body, /appendLedger/);
    assert.doesNotMatch(body, /await claimVrf/);
  });
});

describe("VRF number uniqueness — posted and pending", () => {
  it("treats a pending hold and a posted row as the same live number", () => {
    const used = usedVrfNumbers([{ vrf: "58528" }], [
      { no: "9", vrfNo: "58528", status: "Requested" },
    ]);
    assert.equal(used["58528"], 1);
    assert.equal(vrfNumberTaken("58528", [{ vrf: "58528" }], []), true);
    assert.equal(
      vrfNumberTaken("58528", [], [{ no: "9", vrfNo: "58528", status: "Requested" }]),
      true
    );
    assert.equal(nextFreeVrf(58528, used), 58529);
    assert.equal(nextFreeVrf(58529, used), 58529);
  });

  it("will not mint a number that is already posted or waiting for approval", () => {
    const used = usedVrfNumbers(
      [{ vrf: "58520" }, { vrf: "58528" }],
      [
        { no: "10", vrfNo: "58521", status: "Requested" },
        { no: "11", vrfNo: "58522", status: "Approved", vrfs: ["58522"] },
        { no: "12", vrfNo: "58500", status: "Rejected" },
      ]
    );
    assert.equal(used["58528"], 1);
    assert.equal(used["58521"], 1);
    assert.equal(used["58522"], 1);
    assert.equal(used["58500"], undefined);
    assert.equal(nextFreeVrf(58520, used), 58523);
    assert.equal(
      vrfNumberTaken("58521", [{ vrf: "58520" }], [{ no: "10", vrfNo: "58521", status: "Requested" }]),
      true
    );
  });

  it("remints the pending 58528 hold and keeps the posted financial row", () => {
    const posted = [{ vrf: "58528", date: "2026-09-20", total: 12500, src: "ledger" }];
    const pending = {
      no: "44",
      vrfNo: "58528",
      status: "Requested",
      vrfs: [],
      requestedBy: "Jun",
    };
    const owner = {
      no: "40",
      vrfNo: "58528",
      status: "Approved",
      vrfs: ["58528"],
    };
    assert.deepEqual(postedVrfNumbers(posted), { 58528: 1 });
    assert.equal(shouldRemintHeldVrf(owner, posted, [owner, pending]), false);
    assert.equal(shouldRemintHeldVrf(pending, posted, [owner, pending]), true);
    const change = remintHeldVrf(pending, posted, [owner, pending], 58529);
    assert.deepEqual(change, { from: "58528", to: "58529", reserve: "44" });
    assert.equal(pending.vrfNo, "58529");
    assert.equal(posted[0].vrf, "58528");
    assert.equal(vrfNumberTaken("58529", posted, [owner, pending]), true);
    assert.equal(vrfNumberTaken("58528", posted, [owner, pending]), true);
  });

  it("repairs a posted + pending 58528 pair without inventing a second posted row", () => {
    const vrfs = [{ vrf: "58528" }];
    const reserves = [
      { no: "1", vrfNo: "58528", status: "Requested", vrfs: [] },
      { no: "2", vrfNo: "58530", status: "Requested", vrfs: [] },
    ];
    const changes = repairDuplicateHeldVrfs(reserves, vrfs, 58529);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].from, "58528");
    assert.equal(changes[0].to, "58529");
    assert.equal(reserves[0].vrfNo, "58529");
    assert.equal(reserves[1].vrfNo, "58530");
    assert.equal(vrfs[0].vrf, "58528");
  });

  it("artifact claims skip posted and pending numbers and remint collisions", () => {
    assert.match(html, /function usedVrfNumbers\(exceptReserve\)/);
    assert.match(html, /function vrfNumberTaken/);
    assert.match(html, /function postedVrfNumbers/);
    assert.match(html, /function shouldRemintHeldVrf/);
    assert.match(html, /async function remintHeldVrfCollisions/);
    assert.match(html, /if\(vrfNumberTaken\(vno\)\) vno=await claimVrf\(\)/);
    assert.match(html, /if\(shouldRemintHeldVrf\(r\)\)/);
    assert.match(html, /if\(postedVrfNumbers\(\)\[String\(no\)\]\)/);
    assert.match(html, /try\{ await remintHeldVrfCollisions\(\); \}catch\(e\)\{\}/);
  });
});
