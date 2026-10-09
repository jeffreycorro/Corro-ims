"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  alignedNextVrf,
  maxVrfSeq,
  nextFreeVrf,
  releaseVrfClaimState,
  usedVrfNumbers,
  vrfLogVisible,
  vrfSeq,
} = require("./lib/rules");

function usedUpTo(max) {
  const used = {};
  for (let n = 5800; n <= max; n++) used[String(n)] = 1;
  return used;
}

describe("VRF counter stays with the records on file", () => {
  it("does not treat a date-like key as a VRF sequence", () => {
    assert.equal(vrfSeq("5925"), 5925);
    assert.equal(vrfSeq("VRF 5925"), 5925);
    assert.equal(vrfSeq("no-vrf-2026-10-03-DT-01"), 0);
    assert.equal(maxVrfSeq({ "5925": 1, "no-vrf-2026-10-03-DT-01": 1 }), 5925);
  });

  it("pulls a runaway 6055 back to the next number after 5925", () => {
    const used = usedVrfNumbers(
      [{ vrf: "5925" }, { vrf: "5903", status: "Duplicate" }, { vrf: "5902", held: true, status: "Requested" }],
      [{ no: "70", vrfNo: "5902", status: "Requested" }]
    );
    assert.equal(maxVrfSeq(used), 5925);
    assert.equal(alignedNextVrf(6055, used), 5926);
    assert.equal(nextFreeVrf(alignedNextVrf(6055, used), used), 5926);
  });

  it("keeps 6055 when that number is the next free slot after real records", () => {
    const used = usedUpTo(6054);
    assert.equal(alignedNextVrf(6055, used), 6055);
    assert.equal(alignedNextVrf(5800, used), 6055);
  });

  it("follows the highest number on file and leaves holes below it", () => {
    const used = usedUpTo(5925);
    used["5926"] = 1;
    used["5928"] = 1;
    used["6000"] = 1;
    assert.equal(alignedNextVrf(6055, used), 6001);
    delete used["6000"];
    assert.equal(alignedNextVrf(6055, used), 5929);
  });

  it("does not restart at 1 when no VRF records were loaded", () => {
    assert.equal(alignedNextVrf(6055, {}), 6055);
    assert.equal(alignedNextVrf(6055, { "no-vrf-2026-10-03-DT-01": 1 }), 6055);
  });

  it("gives an unsaved claim back and leaves a later claim alone", () => {
    assert.equal(releaseVrfClaimState(5927, 5926, {}), 5926);
    assert.equal(releaseVrfClaimState(5927, 5926, { 5926: 1 }), 5927);
    assert.equal(releaseVrfClaimState(5930, 5926, {}), 5930);
  });
});

describe("a high counter does not hide VRFs that are still on file", () => {
  it("keeps 5902, 5903, 5925 and a new 5926 on the log", () => {
    const list = [
      { vrf: "5903", status: "Duplicate", duplicateOf: "5890", date: "2026-09-28", total: 0 },
      { vrf: "5902", status: "Requested", held: true, date: "2026-09-26", total: 250 },
      { vrf: "5925", status: "Closed", date: "2026-10-02", total: 400 },
      { vrf: "5926", status: "Requested", held: true, date: "2026-10-03", total: 180 },
    ];
    const visible = vrfLogVisible(list);
    ["5903", "5902", "5925", "5926"].forEach((no) => {
      assert.ok(visible.some((v) => v.vrf === no), no + " stays on the log");
    });
    assert.equal(visible.length, list.length);
  });
});

describe("artifact HTML — counter follows the log, create keeps the row", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("aligns the counter, releases a failed claim, and still shows every VRF", () => {
    assert.match(html, /var BUILD = "2026-10-10 b"/);
    assert.match(html, /function alignedNextVrf/);
    assert.match(html, /function reconcileVrfCounter/);
    assert.match(html, /async function releaseVrfClaim/);
    assert.match(html, /function vrfLogVisible/);
    assert.doesNotMatch(html, /kept\.length>=300/);
    assert.doesNotMatch(html, /cur-40/);
    assert.doesNotMatch(html, /done\.slice\(0,\s*60\)/);
    const remintStart = html.indexOf("async function remintHeldVrfCollisions");
    const remintEnd = html.indexOf("function heldVrfShell", remintStart);
    const remint = html.slice(remintStart, remintEnd);
    assert.doesNotMatch(remint, /S\.cfg\.nextVrf=start/);
    assert.match(remint, /does not mint a VRF/);
    const sendStart = html.indexOf("async function sendForApproval");
    const sendEnd = html.indexOf("\nasync function postVrf", sendStart);
    const send = html.slice(sendStart, sendEnd);
    assert.match(send, /issueReserveConfirmed/);
    assert.match(send, /persisted/);
    assert.doesNotMatch(send, /claimVrf\(/);
  });
});
