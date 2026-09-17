"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  photoOwnersForVrf,
  photoOwnersForReserve,
  moneyNum,
  lineMoney,
  vrfRequestedBy,
  blankVrfDraft,
  usedVrfNumbers,
  nextFreeVrf,
  heldReserveVrfs,
  vrfLogVisible,
} = require("./lib/rules");

describe("VRF isolation — photos, amount, requested by, log", () => {
  it("loads photos only under the open VRF number", () => {
    assert.deepEqual(photoOwnersForVrf({ vrf: "5795", reserve: "3" }), ["5795"]);
    assert.deepEqual(photoOwnersForVrf("5794"), ["5794"]);
    assert.deepEqual(photoOwnersForVrf(null), []);
    assert.deepEqual(photoOwnersForReserve({ no: "3", vrfNo: "5795", vrfs: ["5795", "5794"] }), [
      "RSV-3",
      "5795",
      "5794",
    ]);
    assert.notDeepEqual(photoOwnersForVrf({ vrf: "5795", reserve: "3" }), photoOwnersForReserve({
      no: "3",
      vrfNo: "5795",
      vrfs: ["5795", "5794"],
    }));
  });

  it("keeps line money numeric so 8450 does not become 84k", () => {
    assert.equal(moneyNum("8,450"), 8450);
    assert.equal(moneyNum("₱ 8,450.00"), 8450);
    assert.equal(lineMoney({ qty: 1, price: 8450 }), 8450);
    assert.equal(lineMoney({ qty: "1", price: "8,450" }), 8450);
    assert.equal(lineMoney({ qty: "", price: "", total: "8450" }), 8450);
    const leaked = [{ qty: 1, price: 8450 }, { qty: 10, price: 7605 }];
    const mixed = leaked.reduce((a, l) => a + lineMoney(l), 0);
    assert.equal(mixed, 8450 + 76050);
    assert.notEqual(lineMoney({ qty: 1, price: 8450 }), 84500);
  });

  it("prints Requested by from the record, then the reserve, then the signed-in user", () => {
    assert.equal(vrfRequestedBy({ requestedBy: "Jun Cruz", notes: "pouring" }, "Ignored"), "Jun Cruz");
    assert.equal(
      vrfRequestedBy({ notes: "purpose only", rows: [{ requestedBy: "Yard Staff" }] }, "Ignored"),
      "Yard Staff"
    );
    assert.equal(
      vrfRequestedBy({ vrf: "5795", notes: "purpose" }, "Signed In", [
        { no: "12", vrfNo: "5795", requestedBy: "Roy Solis" },
      ]),
      "Roy Solis"
    );
    assert.equal(vrfRequestedBy({ notes: "purpose", requestedBy: "MOTORPOOL DEPT." }, "Ada"), "Ada");
    assert.equal(vrfRequestedBy({ notes: "purpose" }, ""), "");
  });

  it("clears draft photos and amounts when opening New VRF", () => {
    const leftover = {
      veh: "DT-03",
      photos: [{ data: "data:image/jpeg;base64,xx" }],
      lines: [{ cat: "Fuel — Diesel", qty: 10, price: 8450 }],
      requestedBy: "Someone else",
    };
    const fresh = blankVrfDraft("2026-09-17", "Yard Staff");
    assert.equal(fresh.veh, "");
    assert.deepEqual(fresh.photos, []);
    assert.equal(fresh.lines.length, 3);
    assert.equal(fresh.requestedBy, "Yard Staff");
    assert.notEqual(fresh.photos.length, leftover.photos.length);
    assert.equal(lineMoney(fresh.lines[0]), 0);
  });

  it("does not reuse a VRF number that is already on the ledger or a held reserve", () => {
    const used = usedVrfNumbers([{ vrf: "5793" }, { vrf: "5794" }], [
      { vrfNo: "5795", vrfs: ["5795"] },
    ]);
    assert.equal(used["5795"], 1);
    assert.equal(nextFreeVrf(5793, used), 5796);
    assert.equal(nextFreeVrf(5796, used), 5796);
  });

  it("keeps an approved held number like 5795 on the log even without ledger rows", () => {
    const existing = [{ vrf: "5601" }, { vrf: "5794" }];
    assert.deepEqual(
      heldReserveVrfs(
        [
          { vrfNo: "5795", status: "Approved", requestedBy: "Jun" },
          { vrfNo: "5794", status: "Approved" },
          { vrfNo: "", status: "Approved" },
        ],
        existing
      ),
      ["5795"]
    );
    const visible = vrfLogVisible(
      [
        { vrf: "1001" },
        { vrf: "5795", held: true },
        ...Array.from({ length: 260 }, (_, i) => ({ vrf: String(4000 + i) })),
      ],
      5796
    );
    assert.ok(visible.some((v) => v.vrf === "5795"));
  });
});

describe("artifact HTML carries the isolation fixes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("clears draft on New VRF and isolates photos by VRF id", () => {
    assert.match(html, /function blankVrfDraft/);
    assert.match(html, /function photoOwnersForVrf/);
    assert.match(html, /function vrfRequestedBy/);
    assert.match(html, /function nextFreeVrf/);
    assert.match(html, /function addHeldReserveVrfs/);
    assert.match(html, /function vrfLogVisible/);
    assert.match(html, /if\(v==="vrf"&&S\.view!=="vrf"\) S\.draft=null/);
    assert.match(html, /\["Requested by",vrfRequestedBy\(entry\)\|\|"—"\]/);
    assert.doesNotMatch(html, /\["Requested by",entry\.notes\?"":"MOTORPOOL DEPT\."\]/);
    assert.match(html, /var BUILD = "2026-09-17 a"/);
  });
});
