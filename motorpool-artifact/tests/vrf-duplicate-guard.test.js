"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  applyLiquidationLine,
  applyVrfAutoApproval,
  earliestVrfNumber,
  findSameOpenRequests,
  heldVrfStatus,
  reuseSubmissionHold,
  VRF_AUTO_APPROVE_UNDER,
  vrfCanLiquidate,
  vrfPrintWatermark,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function oilForm(vrf, status) {
  return {
    vrf: vrf,
    veh: "DT-06",
    date: "2026-09-24",
    odo: "431,811",
    total: 7010,
    jobs: ["PMS"],
    status: status || "Open",
  };
}

describe("same open request", () => {
  const forms = [oilForm("5901"), oilForm("5872"), oilForm("5855")];

  it("treats 5855, 5872 and 5901 as one request and keeps the earliest number", () => {
    const hits = findSameOpenRequests(forms, oilForm("5901"), "5901");
    assert.deepEqual(
      hits.map((v) => v.vrf).sort(),
      ["5855", "5872"]
    );
    assert.equal(earliestVrfNumber(forms).vrf, "5855");
    assert.equal(findSameOpenRequests(forms, Object.assign(oilForm("1"), { total: 150 }), "").length, 0);
    assert.equal(findSameOpenRequests([oilForm("5855", "Duplicate")], oilForm("5901"), "").length, 0);
  });

  it("reuses a submission instead of minting another number", () => {
    const reserves = [
      { no: "9", vrfNo: "5855", submissionId: "sub-dt06", status: "Requested" },
      { no: "10", vrfNo: "9999", submissionId: "sub-other", status: "Requested" },
    ];
    assert.equal(reuseSubmissionHold(reserves, "sub-dt06").vrfNo, "5855");
    assert.equal(reuseSubmissionHold(reserves, "missing"), null);
  });
});

describe("duplicate mark drops the copy out of open spend", () => {
  it("zeroes the lines and is not awaiting liquidation", () => {
    const line = applyLiquidationLine(
      { vrf: "5872", qty: 4, price: 1752.5, total: 7010 },
      { remove: true },
      { at: "2026-09-29", by: "Motorpool", note: "Duplicate of VRF 5855" },
      "duplicate"
    );
    assert.equal(line.total, 0);
    assert.equal(line.qty, 0);
    assert.equal(line.vstatus, "Duplicate");
    assert.equal(vrfCanLiquidate({ vrf: "5872", status: "Duplicate", total: 0 }), false);
    assert.equal(vrfCanLiquidate({ vrf: "5855", status: "Open", total: 7010 }), true);
    assert.equal(
      heldVrfStatus({ status: "Cancelled", cancelOutcome: "duplicate", duplicateOf: "5855" }),
      "Duplicate"
    );
    assert.equal(vrfPrintWatermark({ vrf: "5872", status: "Duplicate" }), "DUPLICATE");
  });
});

describe("artifact HTML — send once, approve the same number", () => {
  it("guards the send button and does not mint on approve", () => {
    assert.match(html, /var BUILD = "2026-10-10 d"/);
    assert.match(html, /S\._sendingVrf/);
    assert.match(html, /submissionId/);
    assert.match(html, /function askSendDespiteMatch/);
    assert.match(html, /Send another anyway/);
    assert.match(html, /function askMarkDuplicate/);
    assert.match(html, /Duplicate of…/);
    assert.match(html, /async function copyMissingPhotos/);
    assert.match(html, /Not creating another number/);
    const prepStart = html.indexOf("async function prepareReservePost");
    const prepEnd = html.indexOf("function queueReservePhotos", prepStart);
    const prep = html.slice(prepStart, prepEnd);
    assert.doesNotMatch(prep, /claimVrf/);
    const sendStart = html.indexOf("async function sendForApproval");
    const sendEnd = html.indexOf("\nasync function postVrf", sendStart);
    const send = html.slice(sendStart, sendEnd);
    assert.match(send, /reserveBySubmission\(d\.submissionId\)/);
    assert.match(send, /findSameOpenRequests/);
    assert.match(send, /S\._sendingVrf=true/);
  });

  it("still auto-approves under 1000 as CEO policy", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const hold = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(hold, 150, "2026-09-29"), true);
    assert.equal(hold.approvedBy, "CEO policy");
    const queued = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(queued, 7010, "2026-09-29"), false);
  });
});
