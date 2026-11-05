"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const stock = require("../public/stock-fifo.js");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

describe("FIFO auto-price across two lots", () => {
  it("blends the oldest litres with the next lot", () => {
    const lots = [
      { date: "2026-01-01", liters: 100, pricePerL: 80, vrf: "1" },
      { date: "2026-02-01", liters: 100, pricePerL: 100, vrf: "2" }
    ];
    const book = stock.fifoConsume(lots, []);
    const quote = stock.quoteFromRemaining(book.lots, 150);
    assert.equal(quote.cost, 13000);
    assert.equal(quote.shortfall, 0);
    assert.ok(Math.abs(quote.rate - 13000 / 150) < 1e-9);
    const priced = stock.blended(quote.cost, 150);
    assert.equal(priced.total, 13000);
    assert.ok(Math.abs(priced.price * 150 - 13000) < 0.02);
  });

  it("prices a fuel-reserve draw from that blend and does not ask for a price", () => {
    const mov = stock.fuelMovements({
      lines: [
        { date: "2026-01-01", vrf: "100", veh: "AV", cat: "Fuel — Diesel", work: "FUEL-BULK", qty: 100, unit: "liters", price: 80, total: 8000, supplier: "Iced Petron", vstatus: "Closed" },
        { date: "2026-02-01", vrf: "101", veh: "AV", cat: "Fuel — Diesel", work: "FUEL-BULK", qty: 100, unit: "liters", price: 100, total: 10000, supplier: "Iced Petron", vstatus: "Closed" }
      ]
    });
    const book = stock.fifoConsume(mov.lots, mov.draws);
    const quote = stock.quoteFromRemaining(book.lots, 150);
    assert.equal(quote.cost, 13000);
    const draw = { cat: "Fuel — Diesel", supplier: "FUEL RESERVE", work: "FUEL-RES", qty: "150", unit: "liters", price: "" };
    assert.equal(stock.priceInputMode(draw), "auto");
    assert.equal(stock.missingPrice(draw), false);
  });
});

describe("station fills do not add drum stock", () => {
  it("leaves a FUEL-STN line, including kind fuel-bulk, out of the lots and the draws", () => {
    const mov = stock.fuelMovements({
      lines: [
        { date: "2026-11-03", vrf: "6285", veh: "BT-01", cat: "Fuel — Diesel", work: "FUEL-STN", qty: 40, unit: "liters", price: 94.1, total: 3764, supplier: "Iced Petron", vstatus: "Open" }
      ],
      reserves: [
        { vrfNo: "6285", date: "2026-11-03", kind: "fuel-bulk", work: "FUEL-STN", status: "Approved", veh: "BT-01", litres: 40, budget: 3764 }
      ]
    });
    assert.equal(mov.lots.length, 0);
    assert.equal(mov.draws.length, 0);
    assert.equal(stock.reserveRole({ kind: "fuel-bulk", work: "FUEL-STN", veh: "BT-01" }), "station");
    assert.equal(stock.priceInputMode({ cat: "Fuel — Diesel", work: "FUEL-STN", supplier: "Iced Petron", qty: "40", unit: "liters" }), "enter");
  });

  it("still blocks the price when the supplier is FUEL RESERVE", () => {
    const line = { cat: "Fuel — Diesel", supplier: "FUEL RESERVE", work: "FUEL-STN", qty: "40", unit: "liters", price: "" };
    assert.equal(stock.lineRole(line), "drum-out");
    assert.equal(stock.priceInputMode(line), "auto");
    assert.equal(stock.missingPrice(line), false);
  });

  it("counts a FUEL-RES draw once when the reserve kind was stored as fuel-bulk", () => {
    const mov = stock.fuelMovements({
      lines: [
        { date: "2026-10-29", vrf: "6268", veh: "BH-06", cat: "Fuel — Diesel", work: "FUEL-RES", qty: 80, unit: "liters", price: 93.4, total: 7472, supplier: "FUEL RESERVE", vstatus: "Closed" }
      ],
      reserves: [
        { vrfNo: "6268", date: "2026-10-29", kind: "fuel-bulk", work: "FUEL-RES", status: "Closed", veh: "BH-06", litres: 80 }
      ]
    });
    assert.equal(mov.lots.length, 0);
    assert.equal(mov.draws.length, 1);
    assert.equal(mov.draws[0].liters, 80);
    assert.equal(stock.reserveRole({ kind: "fuel-bulk", work: "FUEL-RES" }), "drum-out");
  });
});

describe("price input", () => {
  it("does not require a price on a drum draw", () => {
    const line = { cat: "Fuel — Diesel", supplier: "FUEL RESERVE", work: "FUEL-RES", qty: "40", unit: "liters", price: "" };
    assert.equal(stock.priceInputMode(line), "auto");
    assert.equal(stock.missingPrice(line), false);
  });

  it("requires a price on a drum delivery", () => {
    const delivery = { cat: "Fuel — Diesel", work: "FUEL-BULK", veh: "AV", supplier: "Iced Petron", qty: "2080", unit: "liters", price: "" };
    assert.equal(stock.lineRole(delivery), "drum-in");
    assert.equal(stock.priceInputMode(delivery), "required");
    assert.equal(stock.missingPrice(delivery), true);
    assert.equal(stock.missingPrice(Object.assign({}, delivery, { price: "93.4" })), false);
  });
});

describe("delivery lots from the ledger", () => {
  it("keeps the 860 L already on ledger 5798 and does not take a second copy from the purchases list", () => {
    const lines = [
      { date: "2026-09-16", vrf: "5798", veh: "AV", cat: "Fuel — Diesel", work: "FUEL-BULK", qty: 860, unit: "liters", price: 88.5, total: 76110, supplier: "Iced Petron", vstatus: "Closed" },
      { date: "2026-09-16", vrf: "5798", veh: "MBC-01", cat: "Fuel — Diesel", work: "FUEL-RES", qty: 100, unit: "liters", price: 84.5, total: 8450, supplier: "FUEL RESERVE", vstatus: "Closed" }
    ];
    const mov = stock.fuelMovements({
      lines: lines,
      purchases: [{ date: "2026-09-16", vrf: "5798", liters: 860, pricePerL: 88.5, total: 76110 }]
    });
    assert.equal(mov.lots.length, 1);
    assert.equal(mov.lots[0].liters, 860);
    assert.equal(mov.draws.length, 1);
    assert.equal(mov.draws[0].liters, 100);
  });

  it("leaves VRF 5787 at 1,940 L and does not rewrite it to 2,220", () => {
    const line = { date: "2026-09-04", vrf: "5787", veh: "AV", cat: "Fuel — Diesel", qty: 1940, unit: "liters", price: 84.5, total: 163930, supplier: "Iced Petron" };
    const mov = stock.fuelMovements({
      lines: [line],
      purchases: [{ date: "2026-09-04", vrf: "5787", liters: 1940, pricePerL: 84.5, total: 163930 }]
    });
    assert.equal(mov.lots.length, 1);
    assert.equal(mov.lots[0].liters, 1940);
    assert.equal(mov.lots[0].vrf, "5787");
    assert.equal(stock.fuelMovements.toString().indexOf("2220"), -1);
  });

  it("counts a litre-unit drum line such as 5677 from qty", () => {
    const mov = stock.fuelMovements({
      lines: [
        { date: "2026-08-15", vrf: "5677", veh: "AV", cat: "Fuel — Diesel", qty: 2160, unit: "liters", price: 82.7, total: 178632, supplier: "Iced Petron" }
      ]
    });
    assert.equal(mov.lots.length, 1);
    assert.equal(mov.lots[0].liters, 2160);
  });

  it("warns when a fuel quantity looks like pesos and does not treat qty 1 as litres", () => {
    const lump = { cat: "Fuel — Diesel", qty: 1, unit: "pc", price: 163930, total: 163930, veh: "AV" };
    assert.equal(stock.qtyLooksLikePesos(lump).flag, true);
    assert.equal(stock.fuelLineLitres(lump, "drum-in"), 0);
    const station = { cat: "Fuel — Gasoline", work: "FUEL-STN", qty: 1, unit: "pc", price: 400, total: 400 };
    assert.equal(stock.qtyLooksLikePesos(station).flag, true);
    assert.equal(stock.qtyLooksLikePesos({ cat: "Fuel — Diesel", work: "FUEL-BULK", qty: 2080, unit: "liters", price: "" }).flag, false);
    assert.equal(stock.fuelLineLitres({ cat: "Fuel — Diesel", work: "FUEL-RES", supplier: "FUEL RESERVE", qty: 40, unit: "pc", price: 84.5, total: 3380 }, "drum-out"), 40);
  });

  it("does not count the same draw twice when the VRF was stored twice", () => {
    const line = { date: "2026-10-10", vrf: "6156", veh: "DT-05", cat: "Fuel — Diesel", work: "FUEL-RES", qty: 40, unit: "liters", price: 95.1, total: 3804, supplier: "FUEL RESERVE" };
    const mov = stock.fuelMovements({ lines: [Object.assign({ vstatus: "Open" }, line), Object.assign({ vstatus: "Closed" }, line)] });
    assert.equal(mov.draws.length, 1);
    assert.equal(mov.draws[0].liters, 40);
  });
});

describe("parts store FIFO", () => {
  it("prices a draw that spans two receipts and does not ask for a price", () => {
    const lines = [
      { date: "2026-01-01", vrf: "1", veh: "AV", cat: "Oil Filter", item: "C-115", qty: 10, price: 100, total: 1000, vstatus: "Open" },
      { date: "2026-02-01", vrf: "2", veh: "AV", cat: "Oil Filter", item: "C-115", qty: 10, price: 200, total: 2000, vstatus: "Open" }
    ];
    const key = function (row) { return row.cat + "|" + row.item; };
    const quote = stock.quoteStore(lines, key, "Oil Filter|C-115", 15, 0);
    assert.equal(quote.cost, 2000);
    assert.equal(quote.shortfall, 0);
    const issue = { cat: "Oil Filter", item: "C-115", supplier: "MOTORPOOL INVENTORY", veh: "DT-01", qty: "15", price: "" };
    assert.equal(stock.priceInputMode(issue), "auto");
    assert.equal(stock.missingPrice(issue), false);
    const receipt = { cat: "Oil Filter", item: "C-115", veh: "AV", work: "STOCK", qty: "4", price: "" };
    assert.equal(stock.priceInputMode(receipt), "required");
    assert.equal(stock.missingPrice(receipt), true);
  });

  it("does not count fuel or a store issue as a receipt", () => {
    const lines = [
      { date: "2026-08-15", vrf: "5677", veh: "AV", cat: "Fuel — Diesel", item: "Fuel Reserve", qty: 2160, unit: "liters", price: 82.7, total: 178632 },
      { date: "2026-03-01", vrf: "9", veh: "DT-01", supplier: "MOTORPOOL INVENTORY", cat: "Oil Filter", item: "C-115", qty: 2, price: 100, total: 200 }
    ];
    const rows = stock.inventorySummary(lines, function (row) { return row.cat + "|" + row.item; });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].item, "C-115");
    assert.equal(rows[0].inQty, 0);
    assert.equal(rows[0].outQty, 2);
    assert.equal(rows[0].onHand, -2);
  });
});

describe("the page wires the stock rule", () => {
  it("is build 2026-11-05 e, locks fuel to liters, and auto-prices a reserve draw", () => {
    assert.match(html, /<script src="\/stock-fifo\.js"><\/script>/);
    assert.match(html, /var BUILD = "2026-11-05 e"/);
    assert.match(html, /function fifo\(\)/);
    assert.match(html, /function applyDraftStockPrices/);
    assert.match(html, /data-stock-price/);
    assert.match(html, /data-fuel-unit","locked"/);
    assert.match(html, /ui\.readOnly=true/);
    assert.match(html, /if\(isFuel\(l\.cat\)\) normalizeFuelLine\(l\)/);
    assert.match(html, /A delivery into the drums needs a price per litre\./);
    assert.match(html, /A purchase into the store needs a price\./);
    assert.match(html, /data-stock-price","required"/);
    assert.match(html, /priceIn\.readOnly=true/);
    assert.doesNotMatch(html, /weighted average cost/);
    assert.doesNotMatch(html, /correct5787|proposal5787|2220 L/);
  });
});
