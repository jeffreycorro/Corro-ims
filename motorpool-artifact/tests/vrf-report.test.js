"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildMonthlyVrfReport,
  defaultReportMonth,
  formatPeso,
  parseMonth,
} = require("../public/vrf-report");
const {
  createHandler,
  loadMonthlyVrfSources,
  pageBuild,
} = require("../netlify/functions/vrf-report");

const NOW = "2026-10-09T02:00:00.000Z";
const SECRET = "test-approve-vrf-secret-value";

function line(over) {
  return Object.assign(
    {
      month: "2026-09",
      date: "2026-09-10",
      vrf: "1003",
      veh: "DT-02",
      project: "Site B",
      vstatus: "Closed",
      liq: { outcome: "bought" },
    },
    over
  );
}

function septemberSources() {
  return {
    reserves: [
      {
        no: "1",
        vrfNo: "1001",
        date: "2026-09-02",
        status: "Requested",
        veh: "SV-01",
        requestedBy: "Ana",
        work: "PM",
        project: "Site A",
        budget: 5000,
        draftPurpose: "oil filter",
        draftLines: [{ cat: "FILTER — Oil", qty: 1, price: 5000, unit: "pc" }],
      },
      {
        no: "2",
        vrfNo: "1002",
        date: "2026-09-01",
        status: "Approved",
        veh: "SV-01",
        requestedBy: "Ben",
        work: "FUEL",
        project: "Site A",
        approvedBudget: 8000,
        budget: 8000,
        draftOdo: "1000",
        draftPurpose: "diesel",
      },
      {
        no: "3",
        vrfNo: "1003",
        date: "2026-09-10",
        status: "Closed",
        veh: "DT-02",
        requestedBy: "Cara",
        work: "PM",
        project: "Site B",
        approvedBudget: 2000,
        actual: 1900,
        liquidatedAt: "2026-09-12",
        draftPurpose: "service",
      },
      {
        no: "4",
        vrfNo: "1004",
        date: "2026-09-11",
        status: "Cancelled",
        cancelOutcome: "duplicate",
        duplicateOf: "1003",
        veh: "DT-02",
        requestedBy: "Cara",
        approvedBudget: 99999,
        budget: 99999,
        draftPurpose: "duplicate copy",
      },
      {
        no: "5",
        vrfNo: "1005",
        date: "2026-09-12",
        status: "Cancelled",
        cancelOutcome: "cancelled",
        veh: "SV-03",
        requestedBy: "Dan",
        approvedBudget: 300,
      },
      {
        no: "6",
        vrfNo: "1006",
        date: "2026-09-15",
        status: "Closed",
        veh: "SV-02",
        requestedBy: "Eva",
        project: "Site A",
        approvedBudget: 3500,
        draftOdo: "5000",
        liquidatedAt: "2026-09-15",
        draftPurpose: "diesel fill",
      },
      {
        no: "7",
        vrfNo: "1007",
        date: "2026-09-16",
        status: "Closed",
        veh: "SV-03",
        requestedBy: "Finn",
        project: "Site C",
        approvedBudget: 700,
        draftOdo: "5000",
        liquidatedAt: "2026-09-16",
        work: "PM",
      },
      {
        no: "8",
        vrfNo: "1008",
        date: "2026-09-20",
        status: "Flagged",
        veh: "MC-09",
        requestedBy: "Gio",
        project: "Site C",
        approvedBudget: 1000,
        actual: 1500,
        liquidatedAt: "2026-09-21",
        work: "REPAIR",
      },
      {
        no: "9",
        vrfNo: "1009",
        date: "2026-09-18",
        status: "Cancelled",
        cancelOutcome: "not-bought",
        veh: "SV-04",
        requestedBy: "Hua",
        approvedBudget: 400,
        actual: 0,
        liquidatedAt: "2026-09-18",
      },
    ],
    ledger: {
      "2026-08": [
        line({
          month: "2026-08",
          date: "2026-08-20",
          vrf: "0900",
          veh: "SV-01",
          odo: 1500,
          cat: "Fuel — Diesel",
          grp: "Fuel",
          qty: 40,
          unit: "L",
          liters: 40,
          price: 55,
          total: 2200,
          project: "Site A",
        }),
      ],
      "2026-09": [
        line({
          date: "2026-09-01",
          vrf: "1002",
          veh: "SV-01",
          odo: 1000,
          cat: "Fuel — Diesel",
          grp: "Fuel",
          qty: 100,
          unit: "L",
          liters: 100,
          price: 60,
          total: 6000,
          vstatus: "Open",
          liq: null,
          project: "Site A",
        }),
        line({
          vrf: "1003",
          cat: "FILTER — Oil",
          grp: "Maintenance",
          qty: 1,
          price: 1500,
          total: 1500,
          unit: "pc",
        }),
        line({
          vrf: "1003",
          cat: "Labor — General Mechanical",
          grp: "Maintenance",
          qty: 1,
          price: 400,
          total: 400,
          unit: "lot",
        }),
        line({
          date: "2026-09-11",
          vrf: "1004",
          veh: "DT-02",
          cat: "FILTER — Oil",
          qty: 1,
          price: 99999,
          total: 99999,
          vstatus: "Duplicate",
          liq: { outcome: "duplicate" },
          project: "Site B",
        }),
        line({
          date: "2026-09-12",
          vrf: "1005",
          veh: "SV-03",
          cat: "FILTER — Oil",
          total: 300,
          qty: 1,
          price: 300,
          vstatus: "Cancelled",
          liq: { outcome: "cancelled" },
          project: "Site A",
        }),
        line({
          date: "2026-09-15",
          vrf: "1006",
          veh: "SV-02",
          odo: 5000,
          cat: "Fuel — Diesel",
          grp: "Fuel",
          qty: 50,
          unit: "L",
          liters: 50,
          price: 70,
          total: 3500,
          project: "Site A",
        }),
        line({
          date: "2026-09-16",
          vrf: "1007",
          veh: "SV-03",
          odo: 5000,
          cat: "Bolt",
          grp: "Parts",
          qty: 2,
          price: 350,
          total: 700,
          unit: "pc",
          project: "Site C",
        }),
        line({
          date: "2026-09-20",
          vrf: "1008",
          veh: "MC-09",
          cat: "Labor — Welding",
          grp: "Labor",
          qty: 1,
          price: 1500,
          total: 1500,
          project: "Site C",
        }),
      ],
    },
  };
}

function report() {
  const src = septemberSources();
  return buildMonthlyVrfReport({
    month: "2026-09",
    reserves: src.reserves,
    ledger: src.ledger,
    now: NOW,
    build: "2026-10-09 a",
  });
}

describe("monthly VRF report computation", () => {
  it("summarises counts, approved amount, liquidated spend, and variance", () => {
    const out = report();
    assert.equal(out.header.company, "Corro Construction Development and Trade Corporation");
    assert.equal(out.header.title, "Motorpool Monthly VRF Report");
    assert.equal(out.header.month, "2026-09");
    assert.equal(out.header.monthLabel, "September 2026");
    assert.equal(out.header.monthToDate, false);
    assert.equal(out.header.build, "2026-10-09 a");
    assert.equal(out.header.generatedAt, "2026-10-09T10:00:00+08:00");
    assert.match(out.header.generatedAtLabel, /9 Oct 2026, 10:00:00 AM/);

    assert.equal(out.summary.raised, 9);
    assert.equal(out.summary.approved, 6);
    assert.equal(out.summary.closed, 5);
    assert.equal(out.summary.open, 1);
    assert.equal(out.summary.cancelled, 1);
    assert.equal(out.summary.duplicates, 1);
    assert.equal(out.summary.pending, 1);
    assert.equal(out.summary.flagged, 1);
    assert.equal(out.summary.notBought, 1);
    assert.equal(out.summary.approvedAmount, 15600);
    assert.equal(out.summary.actualSpent, 7600);
    assert.equal(out.summary.variance, -8000);
    assert.equal(
      out.summary.pending + out.summary.open + out.summary.closed + out.summary.cancelled + out.summary.duplicates,
      out.summary.raised
    );
  });

  it("leaves duplicates, cancellations, and unliquidated lines out of spend", () => {
    const out = report();
    const spent = out.byCategory.reduce((sum, row) => sum + row.amount, 0);
    assert.equal(spent, out.summary.actualSpent);
    assert.equal(spent, 7600);
    const dup = out.vrfs.find((row) => row.vrf === "1004");
    assert.equal(dup.status, "Duplicate");
    assert.equal(dup.actual, 0);
    assert.equal(out.top.some((row) => row.vrf === "1004"), false);
    assert.equal(out.byVehicle.some((row) => row.amount === 99999), false);
    const cancelled = out.vrfs.find((row) => row.vrf === "1005");
    assert.equal(cancelled.status, "Cancelled");
    assert.equal(cancelled.actual, 0);
    const open = out.vrfs.find((row) => row.vrf === "1002");
    assert.equal(open.status, "Open");
    assert.equal(open.actual, 0);
    assert.equal(out.byCategory.find((row) => row.category === "Fuel").amount, 3500);
  });

  it("groups fuel, parts, and labor, with liters and average price", () => {
    const out = report();
    const fuel = out.byCategory.find((row) => row.category === "Fuel");
    const parts = out.byCategory.find((row) => row.category === "Parts");
    const labor = out.byCategory.find((row) => row.category === "Labor/Service");
    const others = out.byCategory.find((row) => row.category === "Others");
    assert.deepEqual(
      out.byCategory.map((row) => row.category),
      ["Fuel", "Parts", "Labor/Service", "Others"]
    );
    assert.equal(fuel.amount, 3500);
    assert.equal(fuel.liters, 50);
    assert.equal(fuel.avgPricePerLiter, 70);
    assert.equal(parts.amount, 2200);
    assert.equal(parts.liters, null);
    assert.equal(labor.amount, 1900);
    assert.equal(others.amount, 0);
    assert.equal(formatPeso(fuel.amount), "₱ 3,500.00");
    assert.equal(formatPeso(out.summary.variance), "-₱ 8,000.00");
  });

  it("sorts vehicles by amount and rolls projects up", () => {
    const out = report();
    assert.deepEqual(
      out.byVehicle.map((row) => [row.unit, row.count, row.liters, row.amount]),
      [
        ["SV-02", 1, 50, 3500],
        ["DT-02", 1, 0, 1900],
        ["MC-09", 1, 0, 1500],
        ["SV-03", 1, 0, 700],
      ]
    );
    assert.deepEqual(
      out.byProject.map((row) => [row.project, row.amount]),
      [
        ["Site A", 3500],
        ["Site C", 2200],
        ["Site B", 1900],
      ]
    );
    assert.deepEqual(
      out.top.map((row) => row.vrf),
      ["1002", "1001", "1006", "1003", "1008", "1007", "1009"]
    );
    assert.equal(out.top[0].basis, "approved");
    assert.equal(out.top[1].basis, "requested");
    assert.equal(out.top[2].basis, "actual");
    assert.equal(out.top.length <= 10, true);
  });

  it("lists every VRF and flags open, duplicate, and odometer exceptions", () => {
    const out = report();
    assert.deepEqual(
      out.vrfs.map((row) => row.vrf),
      ["1002", "1001", "1003", "1004", "1005", "1006", "1007", "1009", "1008"]
    );
    assert.equal(out.vrfs.find((row) => row.vrf === "1001").status, "Pending");
    assert.equal(out.vrfs.find((row) => row.vrf === "1001").requestedBy, "Ana");
    assert.equal(out.vrfs.find((row) => row.vrf === "1003").jobType, "PM");
    assert.equal(out.vrfs.find((row) => row.vrf === "1003").description, "service");
    assert.equal(out.vrfs.some((row) => row.vrf === "0900"), false);

    assert.deepEqual(
      out.exceptions.openOlderThan7Days.map((row) => row.vrf),
      ["1002"]
    );
    assert.equal(out.exceptions.openOlderThan7Days[0].ageDays, 38);
    assert.deepEqual(
      out.exceptions.duplicatesCancelled.map((row) => row.vrf),
      ["1004"]
    );
    const lower = out.exceptions.odometer.find((row) => row.kind === "lower-than-previous");
    assert.equal(lower.vrf, "1002");
    assert.equal(lower.previousVrf, "0900");
    assert.equal(lower.previousOdo, 1500);
    assert.equal(lower.odo, 1000);
    const same = out.exceptions.odometer.filter((row) => row.kind === "identical-other-unit");
    assert.deepEqual(same.map((row) => row.vrf).sort(), ["1006", "1007"]);
    assert.match(same[0].detail, /same as VRF/);
  });

  it("keeps the current month to date and the seven-day boundary", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-10",
      now: NOW,
      build: "2026-10-09 a",
      reserves: [
        { no: "a", vrfNo: "2001", date: "2026-10-01", status: "Approved", veh: "SV-01", approvedBudget: 100, requestedBy: "Ana" },
        { no: "b", vrfNo: "2002", date: "2026-10-02", status: "Open", veh: "SV-01", approvedBudget: 100, requestedBy: "Ana" },
        { no: "c", vrfNo: "2003", date: "2026-10-15", status: "Requested", veh: "SV-01", budget: 100, requestedBy: "Ana" },
        { no: "d", vrfNo: "2004", date: "2026-09-30", status: "Closed", veh: "SV-01", approvedBudget: 100, requestedBy: "Ana" },
      ],
      ledger: {},
    });
    assert.equal(out.header.monthToDate, true);
    assert.equal(out.header.to, "2026-10-09");
    assert.match(out.header.periodLabel, /month to date/);
    assert.deepEqual(out.vrfs.map((row) => row.vrf), ["2001", "2002"]);
    assert.deepEqual(out.exceptions.openOlderThan7Days.map((row) => row.vrf), ["2001"]);
    assert.equal(out.exceptions.openOlderThan7Days[0].ageDays, 8);
  });

  it("defaults to the previous Manila month", () => {
    assert.equal(defaultReportMonth("2026-10-09T02:00:00.000Z"), "2026-09");
    assert.equal(defaultReportMonth("2026-01-15T02:00:00.000Z"), "2025-12");
    assert.equal(defaultReportMonth("2026-09-30T15:30:00.000Z"), "2026-08");
    assert.equal(defaultReportMonth("2026-09-30T16:30:00.000Z"), "2026-09");
    assert.throws(() => parseMonth("2026-13"), (err) => err.code === "bad_month" && err.statusCode === 400);
    assert.throws(() => parseMonth("09-2026"), (err) => err.code === "bad_month");
  });
});

describe("vrf-report function", () => {
  function call(handler, event) {
    return handler(Object.assign({ httpMethod: "GET", headers: {}, queryStringParameters: {} }, event));
  }

  it("returns the same report as the page module and does not echo the secret", async () => {
    const src = septemberSources();
    let loaded = null;
    const handler = createHandler({
      secret: SECRET,
      now: new Date(NOW),
      build: "2026-10-09 a",
      load: async (month) => {
        loaded = month;
        return src;
      },
    });
    const res = await call(handler, {
      headers: { authorization: "Bearer " + SECRET },
      queryStringParameters: { month: "2026-09" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(loaded, "2026-09");
    const body = JSON.parse(res.body);
    const expected = buildMonthlyVrfReport({
      month: "2026-09",
      reserves: src.reserves,
      ledger: src.ledger,
      now: NOW,
      build: "2026-10-09 a",
    });
    assert.deepEqual(body, expected);
    assert.equal(JSON.stringify(res).includes(SECRET), false);
    assert.equal(JSON.stringify(res).includes("APPROVE_VRF_SECRET"), false);
  });

  it("rejects a missing or wrong secret before reading, and a future or bad month", async () => {
    let reads = 0;
    const handler = createHandler({
      secret: SECRET,
      now: new Date(NOW),
      load: async () => {
        reads += 1;
        return { reserves: [], ledger: {} };
      },
    });
    const unauth = await call(handler, { queryStringParameters: { month: "2026-09" } });
    assert.equal(unauth.statusCode, 401);
    assert.equal(JSON.parse(unauth.body).code, "unauthorized");
    const wrong = await call(handler, {
      headers: { authorization: "Bearer not-the-secret" },
      queryStringParameters: { month: "2026-09" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(reads, 0);

    const future = await call(handler, {
      headers: { authorization: "Bearer " + SECRET },
      queryStringParameters: { month: "2026-11" },
    });
    assert.equal(future.statusCode, 400);
    assert.equal(JSON.parse(future.body).code, "future_month");
    assert.equal(reads, 0);

    const bad = await call(handler, {
      headers: { authorization: "Bearer " + SECRET },
      queryStringParameters: { month: "September" },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(JSON.parse(bad.body).code, "bad_month");
    assert.equal(reads, 0);

    const post = await call(handler, { httpMethod: "POST", headers: { authorization: "Bearer " + SECRET } });
    assert.equal(post.statusCode, 405);
  });

  it("uses the previous month when the query omits one, and stays closed when unconfigured", async () => {
    let loaded = null;
    const handler = createHandler({
      secret: SECRET,
      now: new Date(NOW),
      build: "2026-10-09 a",
      load: async (month) => {
        loaded = month;
        return { reserves: [], ledger: {} };
      },
    });
    const res = await call(handler, {
      headers: { "x-approve-secret": SECRET },
      queryStringParameters: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(loaded, "2026-09");
    assert.equal(JSON.parse(res.body).header.month, "2026-09");

    const closed = createHandler({ secret: "", now: new Date(NOW), load: async () => ({ reserves: [], ledger: {} }) });
    const denied = await call(closed, { headers: { authorization: "Bearer " + SECRET } });
    assert.equal(denied.statusCode, 503);
    assert.equal(JSON.parse(denied.body).code, "not_configured");
    assert.equal(JSON.stringify(denied).includes(SECRET), false);
  });

  it("reads reserve years and ledger months and does not write", async () => {
    const writes = [];
    const docs = {
      "reserves/index": { data: { years: ["2026"] } },
      "reserves/2026": { data: { rows: [{ no: "1", vrfNo: "1001", date: "2026-09-02", status: "Requested", veh: "SV-01" }] } },
      "ledger/index": { data: { months: ["2026-08", "2026-09", "2026-10"] } },
      "ledger/2026-08": { data: { rows: [{ vrf: "0900", date: "2026-08-20", veh: "SV-01", odo: 10 }] } },
      "ledger/2026-09": { data: { rows: [{ vrf: "1006", date: "2026-09-15", veh: "SV-02", total: 10, vstatus: "Closed", liq: { outcome: "bought" }, cat: "Bolt", grp: "Parts" }] } },
      "ledger/2026-10": { data: { rows: [{ vrf: "should-not-load", date: "2026-10-01" }] } },
    };
    const io = {
      async listIds(collection) {
        return Object.keys(docs)
          .filter((key) => key.startsWith(collection + "/"))
          .map((key) => key.slice(collection.length + 1));
      },
      async getDoc(collection, id) {
        return docs[collection + "/" + id] || null;
      },
      async setDoc() {
        writes.push("set");
      },
    };
    const sources = await loadMonthlyVrfSources("2026-09", io);
    assert.deepEqual(writes, []);
    assert.equal(sources.reserves.length, 1);
    assert.deepEqual(Object.keys(sources.ledger).sort(), ["2026-08", "2026-09"]);
    assert.equal(sources.ledger["2026-10"], undefined);
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      reserves: sources.reserves,
      ledger: sources.ledger,
      now: NOW,
      build: "2026-10-09 a",
    });
    assert.equal(out.summary.raised, 2);
    assert.equal(out.vrfs.some((row) => row.vrf === "should-not-load"), false);
  });

  it("hides a read failure without returning the secret or the upstream message", async () => {
    const handler = createHandler({
      secret: SECRET,
      now: new Date(NOW),
      load: async () => {
        const err = new Error("supabase key " + SECRET + " failed");
        err.statusCode = 500;
        throw err;
      },
    });
    const res = await call(handler, {
      headers: { authorization: "Bearer " + SECRET },
      queryStringParameters: { month: "2026-09" },
    });
    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.equal(body.error, "Could not read the VRF records");
    assert.equal(JSON.stringify(res).includes(SECRET), false);
  });
});

describe("monthly VRF report page", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("is an office screen, prints with the shared calculator, and stamps the build", () => {
    const yard = html.slice(html.indexOf("var YARD=["), html.indexOf("var OFFICE"));
    const office = html.slice(html.indexOf("var OFFICE=["), html.indexOf("function buildNav"));
    assert.doesNotMatch(yard, /vrfrpt/);
    assert.match(office, /id:"vrfrpt"/);
    assert.match(office, /Monthly VRF report/);
    assert.match(html, /vrfrpt:vrfReportView/);
    assert.match(html, /function vrfReportView\(/);
    assert.match(html, /api\.buildMonthlyVrfReport/);
    assert.match(html, /Print \/ Save as PDF/);
    assert.match(html, /window\.print\(\)/);
    assert.match(html, /<script src="\/vrf-report\.js"><\/script>/);
    assert.match(html, /var BUILD = "2026-10-09 a"/);
    assert.match(html, /@page mp-vrf-report\{size:A4/);
    assert.match(html, /\.vrfreport thead\{display:table-header-group\}/);
    assert.match(html, /page-break-before:always/);
    assert.match(html, /Corro Construction Development and Trade Corporation|report\.header\.company/);
    assert.equal(pageBuild(), "2026-10-09 a");
    const fn = fs.readFileSync(path.join(__dirname, "../netlify/functions/vrf-report.js"), "utf8");
    assert.doesNotMatch(fn, /setDoc|writeDoc|putReserve|putLedger|saveLedger/);
  });
});
