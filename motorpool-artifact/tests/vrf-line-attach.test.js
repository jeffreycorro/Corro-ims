const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extract(name) {
  const start = html.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " missing");
  let i = html.indexOf("{", start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
const reserveShareOfVrf = new Function(extract("reserveShareOfVrf") + "; return reserveShareOfVrf;")();

// Real shape of ledger:5798 (Sep 16, 2026): AV bulk top-up + MBC-01 reserve 6.
const vrf5798 = {
  vrf: "5798", total: 84560,
  rows: [
    { veh: "AV", work: "FUEL-BULK", reserve: "", qty: 860, price: 88.5, total: 76110, vstatus: "Closed" },
    { veh: "MBC-01", work: "FUEL-RES", reserve: "6", qty: 100, price: 84.5, total: 8450, vstatus: "Open" },
  ],
};

describe("reserve actual only counts its own lines on a shared VRF", () => {
  it("MBC-01 reserve 6 gets 8,450, not the 84,560 VRF total", () => {
    assert.equal(reserveShareOfVrf({ no: "6" }, vrf5798), 8450);
  });
  it("another reserve tagged on the same VRF gets only its line", () => {
    const v = { total: 300, rows: [{ reserve: "6", total: 100 }, { reserve: "7", total: 200 }] };
    assert.equal(reserveShareOfVrf({ no: 7 }, v), 200);
  });
  it("falls back to qty x price when a tagged line has no total", () => {
    const v = { total: 0, rows: [{ reserve: "6", qty: 100, price: 84.5 }] };
    assert.equal(reserveShareOfVrf({ no: "6" }, v), 8450);
  });
  it("untagged single-reserve VRFs keep using the whole total", () => {
    assert.equal(reserveShareOfVrf({ no: "9" }, { total: 500, rows: [{ total: 500 }] }), 500);
    assert.equal(reserveShareOfVrf({ no: "9" }, null), 0);
  });
  it("settleReserve and reserveActual use the per-reserve share", () => {
    assert.match(extract("settleReserve"), /reserveShareOfVrf\(r,v\)/);
    assert.match(extract("reserveActual"), /reserveShareOfVrf\(r,v\)/);
    assert.doesNotMatch(extract("settleReserve"), /a\+\(v\.total\|\|0\)/);
  });
});
