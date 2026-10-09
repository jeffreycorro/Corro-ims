"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildMonthlyVrfReport,
  defaultReportMonth,
  formatPeso,
  ledgerMonthFromParts,
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
    build: "2026-10-10 c",
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
    assert.equal(out.header.build, "2026-10-10 c");
    assert.equal(out.header.generatedAt, "2026-10-09T10:00:00+08:00");
    assert.match(out.header.generatedAtLabel, /9 Oct 2026, 10:00:00 AM/);

    assert.equal(out.summary.raised, 9);
    assert.equal(out.summary.approved, 6);
    assert.equal(out.summary.closed, 4);
    assert.equal(out.summary.open, 1);
    assert.equal(out.summary.cancelled, 1);
    assert.equal(out.summary.duplicates, 1);
    assert.equal(out.summary.pending, 1);
    assert.equal(out.summary.flagged, 1);
    assert.equal(out.summary.notBought, 1);
    assert.equal(out.summary.approvedAmount, 15600);
    assert.equal(out.summary.actualSpent, 7600);
    assert.equal(out.summary.openNotLiquidated, 8000);
    assert.equal(out.summary.variance, 400);
    assert.equal(out.summary.varianceCount, 4);
    assert.equal(
      out.summary.pending + out.summary.open + out.summary.closed + out.summary.flagged +
        out.summary.cancelled + out.summary.duplicates,
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
      ["Fuel", "Fuel reserve (bulk)", "Parts", "Labor/Service", "Cash advance", "Others"]
    );
    assert.equal(out.byCategory.find((row) => row.category === "Fuel reserve (bulk)").amount, 0);
    assert.equal(out.byCategory.find((row) => row.category === "Cash advance").amount, 0);
    assert.equal(fuel.amount, 3500);
    assert.equal(fuel.liters, 50);
    assert.equal(fuel.avgPricePerLiter, 70);
    assert.equal(parts.amount, 2200);
    assert.equal(parts.liters, null);
    assert.equal(labor.amount, 1900);
    assert.equal(others.amount, 0);
    assert.equal(formatPeso(fuel.amount), "₱ 3,500.00");
    assert.equal(formatPeso(out.summary.variance), "₱ 400.00");
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
    assert.equal(same.length, 1);
    assert.match(same[0].vrf, /1006/);
    assert.match(same[0].vrf, /1007/);
    assert.match(same[0].detail, /Odometer 5000 is the same on/);
    assert.match(same[0].detail, /SV-02 \(VRF 1006\)/);
    assert.match(same[0].detail, /SV-03 \(VRF 1007\)/);
    const flagged = out.vrfs.find((row) => row.vrf === "1008");
    assert.equal(flagged.status, "Flagged");
    assert.match(flagged.statusNote, /Reserve says Flagged; ledger says Closed/);
    assert.deepEqual(
      out.exceptions.statusMismatches.map((row) => row.vrf),
      ["1008"]
    );
    assert.deepEqual(out.exceptions.possibleDuplicates, []);
  });

  it("keeps the current month to date and the seven-day boundary", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-10",
      now: NOW,
      build: "2026-10-10 c",
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

describe("monthly VRF report reconciliation rules", () => {
  it("includes a ledger-only VRF, takes status from vstatus, and has no approved amount", () => {
    const blank = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [],
      ledger: {
        "2026-09": [
          line({
            vrf: "5746",
            veh: "DT-09",
            date: "15 Sep 2026",
            vstatus: "",
            liq: null,
            cat: "Bolt",
            grp: "Parts",
            qty: 1,
            price: 120,
            total: 120,
            unit: "pc",
          }),
        ],
      },
    });
    const row = blank.vrfs.find((item) => item.vrf === "5746");
    assert.equal(row.status, "Closed");
    assert.equal(row.approved, null);
    assert.equal(row.actual, 120);
    assert.equal(blank.summary.raised, 1);
    assert.equal(blank.summary.closed, 1);
    assert.equal(blank.summary.approvedAmount, 0);
    assert.equal(blank.summary.actualSpent, 120);

    const openOnly = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [],
      ledger: {
        "2026-09": [
          line({
            vrf: "5750",
            veh: "SV-08",
            vstatus: "Open",
            liq: null,
            cat: "Bolt",
            grp: "Parts",
            qty: 1,
            price: 90,
            total: 90,
            unit: "pc",
          }),
        ],
      },
    });
    const openRow = openOnly.vrfs[0];
    assert.equal(openRow.status, "Open");
    assert.equal(openRow.approved, null);
    assert.equal(openRow.actual, 0);
    assert.equal(openOnly.summary.open, 1);
    assert.equal(openOnly.summary.actualSpent, 0);
    assert.equal(openOnly.summary.openNotLiquidated, 90);
  });

  it("uses the reserve status when the ledger disagrees and notes the mismatch", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "20",
          vrfNo: "5800",
          date: "2026-09-04",
          status: "Approved",
          veh: "SV-01",
          approvedBudget: 500,
          requestedBy: "Ana",
        },
      ],
      ledger: {
        "2026-09": [
          line({
            vrf: "5800",
            veh: "SV-01",
            date: "2026-09-04",
            vstatus: "Closed",
            liq: { outcome: "bought" },
            cat: "Bolt",
            grp: "Parts",
            qty: 1,
            price: 500,
            total: 500,
            unit: "pc",
          }),
        ],
      },
    });
    const row = out.vrfs[0];
    assert.equal(row.status, "Open");
    assert.match(row.statusNote, /Reserve says Open; ledger says Closed/);
    assert.equal(row.actual, 0);
    assert.equal(out.summary.open, 1);
    assert.equal(out.summary.closed, 0);
    assert.equal(out.summary.actualSpent, 0);
    assert.equal(out.summary.openNotLiquidated, 500);
    assert.equal(out.exceptions.statusMismatches.length, 1);
  });

  it("keeps a bulk fuel-reserve purchase out of the fuel liters", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "21",
          vrfNo: "5798",
          date: "2026-09-08",
          status: "Closed",
          veh: "MBC-01",
          approvedBudget: 76110,
          liquidatedAt: "2026-09-08",
          requestedBy: "Ana",
        },
      ],
      ledger: {
        "2026-09": [
          line({
            vrf: "5798",
            veh: "MBC-01",
            date: "2026-09-08",
            cat: "Fuel — Diesel",
            grp: "Fuel",
            work: "FUEL-RES",
            supplier: "FUEL RESERVE",
            qty: 10,
            unit: "L",
            liters: 10,
            price: 80,
            total: 800,
          }),
          line({
            vrf: "5798",
            veh: "AV",
            date: "2026-09-08",
            cat: "Fuel — Diesel",
            grp: "Fuel",
            work: "FUEL-BULK",
            supplier: "Petron",
            item: "bulk diesel into the reserve",
            qty: 20,
            unit: "L",
            liters: 20,
            price: 100,
            total: 2000,
          }),
        ],
      },
    });
    const fuel = out.byCategory.find((row) => row.category === "Fuel");
    const bulk = out.byCategory.find((row) => row.category === "Fuel reserve (bulk)");
    assert.equal(fuel.amount, 800);
    assert.equal(fuel.liters, 10);
    assert.equal(fuel.avgPricePerLiter, 80);
    assert.equal(bulk.amount, 2000);
    assert.equal(bulk.liters, 20);
    assert.equal(out.summary.raised, 1);
    assert.equal(out.summary.actualSpent, 2800);
    assert.equal(out.byVehicle.find((row) => row.unit === "AV").amount, 2000);
  });

  it("lists possible uncancelled duplicates without removing them from the totals", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "31",
          vrfNo: "5810",
          date: "2026-09-03",
          status: "Closed",
          veh: "DT-02",
          submissionId: "sub-same",
          approvedBudget: 400,
          liquidatedAt: "2026-09-03",
          requestedBy: "Ana",
        },
        {
          no: "32",
          vrfNo: "5811",
          date: "2026-09-03",
          status: "Closed",
          veh: "DT-02",
          submissionId: "sub-same",
          approvedBudget: 400,
          liquidatedAt: "2026-09-03",
          requestedBy: "Ana",
        },
        {
          no: "33",
          vrfNo: "5812",
          date: "2026-09-05",
          status: "Closed",
          veh: "SV-09",
          approvedBudget: 250,
          liquidatedAt: "2026-09-05",
          requestedBy: "Ben",
        },
        {
          no: "34",
          vrfNo: "5813",
          date: "2026-09-05",
          status: "Approved",
          veh: "SV-09",
          approvedBudget: 250,
          requestedBy: "Ben",
        },
        {
          no: "35",
          vrfNo: "5814",
          date: "2026-09-06",
          status: "Cancelled",
          cancelOutcome: "duplicate",
          duplicateOf: "5810",
          veh: "DT-02",
          submissionId: "sub-same",
          approvedBudget: 400,
          requestedBy: "Ana",
        },
      ],
      ledger: {
        "2026-09": [
          line({ vrf: "5810", veh: "DT-02", date: "2026-09-03", cat: "Bolt", grp: "Parts", qty: 1, price: 400, total: 400, unit: "pc" }),
          line({ vrf: "5811", veh: "DT-02", date: "2026-09-03", cat: "Bolt", grp: "Parts", qty: 1, price: 400, total: 400, unit: "pc" }),
          line({ vrf: "5812", veh: "SV-09", date: "2026-09-05", cat: "Bolt", grp: "Parts", qty: 1, price: 250, total: 250, unit: "pc" }),
        ],
      },
    });
    assert.equal(out.summary.raised, 5);
    assert.equal(out.summary.duplicates, 1);
    assert.equal(out.summary.actualSpent, 1050);
    const listed = out.exceptions.possibleDuplicates.map((row) => row.vrf).sort();
    assert.deepEqual(listed, ["5810", "5811", "5812", "5813"]);
    assert.equal(listed.includes("5814"), false);
    const shared = out.exceptions.possibleDuplicates.find((row) => row.vrf === "5810");
    assert.match(shared.reason, /same request or submission number/);
    assert.match(shared.reason, /same unit, date, and amount/);
    assert.match(shared.detail, /Still included in the totals/);
    const pair = out.exceptions.possibleDuplicates.find((row) => row.vrf === "5812");
    assert.match(pair.reason, /same unit, date, and amount/);
  });

  it("merges ledger-only month-document rows and a record stored as one line", () => {
    const doc = ledgerMonthFromParts(
      "2026-09",
      [
        { data: { rows: [{ vrf: "1006", date: "2026-09-15", veh: "SV-02", total: 10, vstatus: "Closed" }] } },
        { data: { vrf: "5747", date: "2026-09-02", veh: "DT-04", total: 80, cat: "Bolt", vstatus: "" } },
      ],
      {
        data: {
          rows: [
            { vrf: "1006", date: "2026-09-15", veh: "SV-02", total: 10, vstatus: "Closed" },
            { vrf: "5748", date: "2026-09-03", veh: "DT-05", total: 40, cat: "Bolt" },
          ],
        },
      }
    );
    assert.deepEqual(
      doc.data.rows.map((row) => row.vrf),
      ["1006", "5747", "5748"]
    );
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [],
      ledger: { "2026-09": doc.data.rows },
    });
    assert.equal(out.summary.raised, 3);
    assert.equal(out.vrfs.find((row) => row.vrf === "5747").status, "Closed");
    assert.equal(out.vrfs.find((row) => row.vrf === "5747").approved, null);
    assert.equal(out.vrfs.find((row) => row.vrf === "5748").status, "Closed");
    assert.equal(out.summary.actualSpent, 130);
  });
});

describe("ledger VRF numbers stay separate from the reserve", () => {
  function closedLine(over) {
    return line(Object.assign({
      vstatus: "Closed",
      liq: { outcome: "bought" },
      qty: 1,
      price: 100,
      total: 100,
      unit: "pc",
      cat: "Bolt",
      grp: "Parts",
    }, over));
  }

  it("keeps a ledger VRF when its reserve field points at a different VRF number", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "3",
          vrfNo: "6099",
          date: "2026-09-02",
          status: "Approved",
          veh: "MBC-01",
          draftOdo: "44000",
          approvedBudget: 9000,
          requestedBy: "Ana",
        },
        {
          no: "35",
          vrfNo: "5964",
          date: "2026-09-04",
          status: "Cancelled",
          cancelOutcome: "duplicate",
          duplicateOf: "5854",
          veh: "DT-02",
          approvedBudget: 5000,
          requestedBy: "Ben",
        },
      ],
      ledger: {
        "2026-09": [
          closedLine({
            vrf: "5795",
            reserve: "3",
            veh: "MBC-01",
            odo: 44000,
            date: "2026-09-02",
            total: 800,
            qty: 1,
            price: 800,
          }),
          closedLine({
            vrf: "5854",
            reserve: "35",
            veh: "DT-02",
            date: "2026-09-04",
            total: 640,
            qty: 1,
            price: 640,
          }),
        ],
      },
    });
    const ledger = out.vrfs.find((row) => row.vrf === "5795");
    const reserveOpen = out.vrfs.find((row) => row.vrf === "6099");
    const kept = out.vrfs.find((row) => row.vrf === "5854");
    const dup = out.vrfs.find((row) => row.vrf === "5964");
    assert.equal(ledger.status, "Closed");
    assert.equal(ledger.actual, 800);
    assert.equal(ledger.approved, null);
    assert.equal(reserveOpen, undefined);
    assert.equal(out.exceptions.liquidatedElsewhere[0].vrf, "6099");
    assert.equal(out.exceptions.liquidatedElsewhere[0].kept, "5795");
    assert.equal(kept.status, "Closed");
    assert.equal(kept.actual, 640);
    assert.equal(dup.status, "Duplicate");
    assert.equal(dup.actual, 0);
    assert.equal(out.summary.open, 0);
    assert.equal(out.summary.duplicates, 1);
    assert.equal(out.summary.actualSpent, 1440);
  });

  it("counts one copy when ledger VRFs share a reserve and the same unit", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "26",
          vrfNo: "6116",
          date: "2026-09-06",
          status: "Cancelled",
          cancelOutcome: "duplicate",
          duplicateOf: "5845",
          veh: "DT-07",
          approvedBudget: 300,
        },
        {
          no: "46",
          vrfNo: "6120",
          date: "2026-09-08",
          status: "Cancelled",
          cancelOutcome: "duplicate",
          duplicateOf: "5864",
          veh: "SV-01",
          approvedBudget: 100,
        },
      ],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5845", reserve: "26", veh: "DT-07", date: "2026-09-06", total: 210, qty: 1, price: 210 }),
          closedLine({ vrf: "5867", reserve: "26", veh: "DT-07", date: "2026-09-07", total: 210, qty: 1, price: 210, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5899", reserve: "26", veh: "DT-07", date: "2026-09-09", total: 210, qty: 1, price: 210, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5864", reserve: "46", veh: "SV-01", date: "2026-09-08", total: 150, qty: 1, price: 150 }),
          closedLine({ vrf: "5881", reserve: "46", veh: "SV-04", date: "2026-09-08", total: 175, qty: 1, price: 175 }),
        ],
      },
    });
    assert.deepEqual(
      out.vrfs.map((row) => row.vrf).sort(),
      ["5845", "5864", "5881", "6116", "6120"]
    );
    assert.equal(out.vrfs.find((row) => row.vrf === "5845").actual, 210);
    assert.equal(out.vrfs.find((row) => row.vrf === "5864").actual, 150);
    assert.equal(out.vrfs.find((row) => row.vrf === "5881").actual, 175);
    assert.deepEqual(
      out.exceptions.uncancelledRepeats.map((row) => row.vrf).sort(),
      ["5867", "5899"]
    );
    assert.equal(out.exceptions.uncancelledRepeats[0].kept, "5845");
    assert.equal(out.summary.raised, 5);
    assert.equal(out.summary.actualSpent, 535);
    assert.equal(out.summary.duplicates, 2);
  });

  it("counts per-liter fuel qty and keeps a peso line out of the average", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        { no: "1", vrfNo: "5701", date: "2026-09-03", status: "Closed", veh: "DT-01", liquidatedAt: "2026-09-03", approvedBudget: 1280 },
      ],
      ledger: {
        "2026-09": [
          line({
            vrf: "5701",
            veh: "DT-01",
            cat: "Fuel — Diesel",
            grp: "Fuel",
            qty: 20,
            price: 88,
            total: 1760,
            liters: null,
            unit: "pc",
          }),
          line({
            vrf: "5701",
            veh: "DT-01",
            cat: "Fuel — Diesel",
            grp: "Fuel",
            qty: 1,
            price: 400,
            total: 400,
            liters: null,
            unit: null,
          }),
        ],
      },
    });
    const fuel = out.byCategory.find((row) => row.category === "Fuel");
    assert.equal(fuel.liters, 20);
    assert.equal(fuel.avgPricePerLiter, 88);
    assert.equal(fuel.amount, 2160);
  });

  it("categorizes a closed request with no ledger rows from its draft lines", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "8",
          vrfNo: "5794",
          date: "2026-09-05",
          status: "Closed",
          veh: "DT-03",
          liquidatedAt: "2026-09-05",
          actual: 1500,
          approvedBudget: 1500,
          draftPurpose: "clutch",
          draftLines: [{ cat: "Clutch", item: "clutch parts", qty: 1, price: 1500 }],
        },
      ],
      ledger: {},
    });
    const parts = out.byCategory.find((row) => row.category === "Parts");
    const others = out.byCategory.find((row) => row.category === "Others");
    assert.equal(out.vrfs[0].vrf, "5794");
    assert.equal(out.vrfs[0].actual, 1500);
    assert.equal(parts.amount, 1500);
    assert.equal(others.amount, 0);
  });

  it("uses the ledger total when the reserve actual is stale, and ignores a stale month document", () => {
    const doc = ledgerMonthFromParts(
      "2026-09",
      [{ data: { rows: [{ vrf: "5904", reserve: "12", date: "2026-09-11", veh: "DT-02", total: 168, qty: 1, price: 500, vstatus: "Closed", liq: { outcome: "bought" }, cat: "Bolt", grp: "Parts" }] } }],
      { data: { rows: [{ vrf: "5904", date: "2026-09-11", veh: "DT-02", total: 999, vstatus: "Closed" }] } }
    );
    assert.equal(doc.data.rows.length, 1);
    assert.equal(doc.data.rows[0].total, 168);
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        { no: "12", vrfNo: "5904", date: "2026-09-11", status: "Closed", veh: "DT-02", actual: 500, liquidatedAt: "2026-09-11", approvedBudget: 500 },
      ],
      ledger: { "2026-09": doc.data.rows },
    });
    assert.equal(out.vrfs[0].actual, 168);
    assert.equal(out.summary.actualSpent, 168);
  });

  it("keeps the liquidated copy when a duplicate cancellation names another VRF", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        { no: "26", vrfNo: "6116", date: "2026-09-06", status: "Cancelled", cancelOutcome: "duplicate", duplicateOf: "5845", veh: "MC-16", approvedBudget: 5000 },
        { no: "27", vrfNo: "6117", date: "2026-09-07", status: "Cancelled", cancelOutcome: "duplicate", duplicateOf: "5846", veh: "SV-06", approvedBudget: 4000 },
        { no: "39", vrfNo: "6118", date: "2026-09-09", status: "Cancelled", cancelOutcome: "duplicate", duplicateOf: "5858", veh: "DT-04", approvedBudget: 5597.88 },
      ],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5845", reserve: "26", veh: "MC-16", date: "2026-09-01", total: 5000, qty: 1, price: 5000, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5867", reserve: "26", veh: "MC-16", date: "2026-09-08", total: 5000, qty: 1, price: 5000, vstatus: "Closed", liq: { outcome: "bought" } }),
          closedLine({ vrf: "5899", reserve: "26", veh: "MC-16", date: "2026-09-10", total: 5000, qty: 1, price: 5000, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5846", reserve: "27", veh: "SV-06", date: "2026-09-02", total: 4000, qty: 1, price: 4000, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5868", reserve: "27", veh: "SV-06", date: "2026-09-08", total: 4000, qty: 1, price: 4000, vstatus: "Closed", liq: { outcome: "bought" } }),
          closedLine({ vrf: "5858", reserve: "39", veh: "DT-04", date: "2026-09-03", total: 5597.88, qty: 1, price: 5597.88, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5875", reserve: "39", veh: "DT-04", date: "2026-09-09", total: 5597.88, qty: 1, price: 5597.88, vstatus: "Closed", liq: { outcome: "bought" } }),
          closedLine({ vrf: "5860", reserve: "40", veh: "SV-08", date: "2026-09-04", total: 50, qty: 1, price: 50, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5883", reserve: "40", veh: "SV-08", date: "2026-09-11", total: 50, qty: 1, price: 50, vstatus: "Flagged", liq: { outcome: "bought" } }),
        ],
      },
    });
    assert.equal(out.vrfs.find((row) => row.vrf === "5867").status, "Closed");
    assert.equal(out.vrfs.find((row) => row.vrf === "5867").actual, 5000);
    assert.equal(out.vrfs.find((row) => row.vrf === "5868").actual, 4000);
    assert.equal(out.vrfs.find((row) => row.vrf === "5875").status, "Closed");
    assert.equal(out.vrfs.find((row) => row.vrf === "5875").actual, 5597.88);
    assert.equal(out.vrfs.find((row) => row.vrf === "5883").status, "Flagged");
    assert.equal(out.vrfs.find((row) => row.vrf === "5860"), undefined);
    assert.equal(out.vrfs.find((row) => row.vrf === "5845"), undefined);
    assert.equal(out.vrfs.find((row) => row.vrf === "5846"), undefined);
    assert.equal(out.vrfs.find((row) => row.vrf === "5858"), undefined);
    const kept = {};
    out.exceptions.uncancelledRepeats.forEach((row) => { kept[row.vrf] = row.kept; });
    assert.equal(kept["5845"], "5867");
    assert.equal(kept["5899"], "5867");
    assert.equal(kept["5846"], "5868");
    assert.equal(kept["5858"], "5875");
    assert.equal(kept["5860"], "5883");
    assert.equal(out.summary.closed, 3);
    assert.equal(out.summary.flagged, 1);
    assert.equal(out.summary.open, 0);
    assert.equal(out.summary.actualSpent, 14647.88);
    assert.equal(out.summary.openNotLiquidated, 0);
    assert.deepEqual(out.exceptions.openOlderThan7Days.map((row) => row.vrf), []);
  });

  it("treats a bought line as the liquidated copy even when vstatus is still Open", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        { no: "26", vrfNo: "6116", date: "2026-09-06", status: "Cancelled", cancelOutcome: "duplicate", duplicateOf: "5845", veh: "MC-16" },
      ],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5845", reserve: "26", veh: "MC-16", date: "2026-09-06", total: 100, qty: 1, price: 100, vstatus: "Open", liq: null }),
          closedLine({ vrf: "5867", reserve: "26", veh: "MC-16", date: "2026-09-08", total: 100, qty: 1, price: 100, vstatus: "Open", liq: { outcome: "bought" } }),
        ],
      },
    });
    assert.equal(out.vrfs.find((row) => row.vrf === "5867").status, "Open");
    assert.equal(out.vrfs.find((row) => row.vrf === "5845"), undefined);
    assert.equal(out.exceptions.uncancelledRepeats[0].vrf, "5845");
    assert.equal(out.exceptions.uncancelledRepeats[0].kept, "5867");
  });

  it("leaves cancelled and duplicate ledger VRFs in the counts when they share a reserve and unit", () => {
    const cancelled = ["5855", "5856", "5870", "5871", "5876", "5880"];
    const duplicates = ["5847", "5866", "5874", "5877", "5878"];
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5867", reserve: "26", veh: "MC-16", date: "2026-09-08", total: 5000, qty: 1, price: 5000 }),
        ].concat(cancelled.map((vrf) => closedLine({
          vrf: vrf,
          reserve: "26",
          veh: "MC-16",
          date: "2026-09-08",
          total: 10,
          qty: 1,
          price: 10,
          vstatus: "Cancelled",
          liq: { outcome: "cancelled" },
        }))).concat(duplicates.map((vrf) => closedLine({
          vrf: vrf,
          reserve: "26",
          veh: "MC-16",
          date: "2026-09-08",
          total: 10,
          qty: 1,
          price: 10,
          vstatus: "Duplicate",
          liq: { outcome: "duplicate" },
        }))),
      },
    });
    assert.equal(out.summary.raised, 12);
    assert.equal(out.summary.closed, 1);
    assert.equal(out.summary.cancelled, 6);
    assert.equal(out.summary.duplicates, 5);
    assert.equal(out.summary.actualSpent, 5000);
    cancelled.forEach((vrf) => {
      assert.equal(out.vrfs.find((row) => row.vrf === vrf).status, "Cancelled");
    });
    duplicates.forEach((vrf) => {
      assert.equal(out.vrfs.find((row) => row.vrf === vrf).status, "Duplicate");
    });
    assert.deepEqual(out.exceptions.uncancelledRepeats, []);
  });

  it("maps fuel work codes, labor names, cash advances, and clutch drafts", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "8",
          vrfNo: "5794",
          date: "2026-09-05",
          status: "Closed",
          veh: "DT-03",
          liquidatedAt: "2026-09-05",
          actual: 800,
          approvedBudget: 800,
          draftLines: [{ cat: "Clutch", item: "clutch parts", qty: 1, price: 800 }],
        },
      ],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5795", veh: "MC-16", date: "2026-09-14", cat: "", item: "", grp: "", work: "FUEL-STN", qty: 144.82, price: 88, total: 12744.16, liters: null, unit: "pc" }),
          closedLine({ vrf: "5809", veh: "SV-01", date: "2026-09-06", cat: "LTO Renewal", item: "", grp: "", qty: 1, price: 1500, total: 1500 }),
          closedLine({ vrf: "5895", veh: "SV-02", date: "2026-09-07", cat: "Emission Test", item: "", grp: "", qty: 1, price: 900, total: 900 }),
          closedLine({ vrf: "5812", veh: "SV-04", date: "2026-09-07", cat: "Body Repair", item: "", grp: "", qty: 1, price: 700, total: 700 }),
          closedLine({ vrf: "5811", veh: "SV-03", date: "2026-09-08", cat: "Labor — Welding", grp: "", qty: 1, price: 400, total: 400 }),
          closedLine({ vrf: "5887", veh: "DT-01", date: "2026-09-09", cat: "Cash Advance (to reconcile)", grp: "", qty: 1, price: 2000, total: 2000 }),
          closedLine({ vrf: "5904", veh: "DT-02", date: "2026-09-11", cat: "Cash Advance (to reconcile)", grp: "", qty: 1, price: 168, total: 168 }),
        ],
      },
    });
    const amount = (name) => out.byCategory.find((row) => row.category === name).amount;
    const fuel = out.byCategory.find((row) => row.category === "Fuel");
    assert.equal(fuel.amount, 12744.16);
    assert.equal(fuel.liters, 144.82);
    assert.equal(amount("Labor/Service"), 3500);
    assert.equal(amount("Cash advance"), 2168);
    assert.equal(amount("Parts"), 800);
    assert.equal(amount("Others"), 0);
    assert.equal(out.vrfs.find((row) => row.vrf === "5794").actual, 800);
  });

  it("uses qty as liters when qty times price equals the total and skips a peso line", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5749", veh: "DT-01", date: "2026-09-04", cat: "Fuel — Diesel", grp: "Fuel", qty: 40, price: 86, total: 3440, liters: 20, unit: "pc" }),
          closedLine({ vrf: "5746", veh: "DT-02", date: "2026-09-04", cat: "Fuel — Diesel", grp: "Fuel", qty: 30, price: 90, total: 2700, liters: 15, unit: null }),
          closedLine({ vrf: "5747", veh: "DT-03", date: "2026-09-04", cat: "Fuel — Diesel", grp: "Fuel", qty: 25, price: 80, total: 2000, liters: 10, unit: "pc" }),
          closedLine({ vrf: "5828", veh: "DT-04", date: "2026-09-05", cat: "Fuel — Diesel", grp: "Fuel", qty: 1, price: 200, total: 200, liters: 1, unit: "pc" }),
        ],
      },
    });
    const fuel = out.byCategory.find((row) => row.category === "Fuel");
    assert.equal(fuel.liters, 95);
    assert.equal(fuel.amount, 8340);
    assert.equal(fuel.avgPricePerLiter, 85.68);
  });

  it("checks odometers on active VRFs only and groups one identical reading", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        {
          no: "70",
          vrfNo: "6115",
          date: "2026-09-24",
          status: "Cancelled",
          cancelOutcome: "duplicate",
          duplicateOf: "5872",
          veh: "SV-09",
          draftOdo: "431811",
          approvedBudget: 10,
        },
      ],
      ledger: {
        "2026-09": [
          closedLine({ vrf: "5795", veh: "MC-16", date: "2026-09-14", odo: 431885, total: 10, qty: 1, price: 10 }),
          closedLine({ vrf: "5872", veh: "MC-16", date: "2026-09-24", odo: 431811, total: 10, qty: 1, price: 10 }),
          closedLine({ vrf: "5896", veh: "MC-16", date: "2026-09-20", odo: 500000, total: 10, qty: 1, price: 10, vstatus: "Cancelled", liq: { outcome: "cancelled" } }),
          closedLine({ vrf: "6100", veh: "SV-02", date: "2026-09-18", odo: 431811, total: 10, qty: 1, price: 10 }),
        ],
      },
    });
    const lower = out.exceptions.odometer.filter((row) => row.kind === "lower-than-previous");
    assert.equal(lower.length, 1);
    assert.equal(lower[0].vrf, "5872");
    assert.equal(lower[0].odo, 431811);
    assert.equal(lower[0].previousVrf, "5795");
    assert.equal(lower[0].previousOdo, 431885);
    assert.equal(lower[0].previousDate, "2026-09-14");
    const identical = out.exceptions.odometer.filter((row) => row.kind === "identical-other-unit");
    assert.equal(identical.length, 1);
    assert.match(identical[0].detail, /MC-16 \(VRF 5872\)/);
    assert.match(identical[0].detail, /SV-02 \(VRF 6100\)/);
    assert.equal(out.exceptions.odometer.some((row) => String(row.vrf).indexOf("5896") >= 0), false);
    assert.equal(out.exceptions.odometer.some((row) => String(row.vrf).indexOf("6115") >= 0), false);
    assert.equal(out.vrfs.find((row) => row.vrf === "5896").status, "Cancelled");
    assert.equal(out.vrfs.find((row) => row.vrf === "6115").status, "Duplicate");
  });

  it("compares variance only where a VRF has both an approved amount and an actual", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: NOW,
      reserves: [
        { no: "1", vrfNo: "5701", date: "2026-09-02", status: "Approved", veh: "SV-01", approvedBudget: 8000 },
        { no: "2", vrfNo: "5702", date: "2026-09-03", status: "Closed", veh: "SV-02", approvedBudget: 1000, liquidatedAt: "2026-09-03" },
      ],
      ledger: {
        "2026-09": [
          line({ vrf: "5702", veh: "SV-02", date: "2026-09-03", total: 400, qty: 1, price: 400, cat: "Bolt", grp: "Parts" }),
          line({ vrf: "5746", veh: "DT-01", date: "2026-09-04", total: 9000, qty: 1, price: 9000, cat: "Bolt", grp: "Parts", vstatus: "Closed" }),
        ],
      },
    });
    assert.equal(out.summary.actualSpent, 9400);
    assert.equal(out.summary.approvedAmount, 9000);
    assert.equal(out.summary.variance, -600);
    assert.equal(out.summary.varianceCount, 1);
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
      build: "2026-10-10 c",
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
      build: "2026-10-10 c",
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
      build: "2026-10-10 c",
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
      build: "2026-10-10 c",
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
    assert.match(html, /Open, not liquidated/);
    assert.match(html, /Possible duplicates/);
    assert.match(html, /Uncancelled repeats/);
    assert.match(html, /Already liquidated on another VRF/);
    assert.match(html, /Reserve and ledger disagree/);
    assert.match(html, /Actual spent \(closed and flagged\)/);
    assert.match(html, /VRFs with both/);
    assert.match(html, /window\.print\(\)/);
    assert.match(html, /<script src="\/vrf-report\.js"><\/script>/);
    assert.match(html, /var BUILD = "2026-10-10 c"/);
    assert.match(html, /@page mp-vrf-report\{size:A4/);
    assert.match(html, /\.vrfreport thead\{display:table-header-group\}/);
    assert.match(html, /page-break-before:always/);
    assert.match(html, /Corro Construction Development and Trade Corporation|report\.header\.company/);
    assert.equal(pageBuild(), "2026-10-10 c");
    const fn = fs.readFileSync(path.join(__dirname, "../netlify/functions/vrf-report.js"), "utf8");
    assert.doesNotMatch(fn, /setDoc|writeDoc|putReserve|putLedger|saveLedger/);
    const db = fs.readFileSync(path.join(__dirname, "../netlify/lib/supabase.js"), "utf8");
    assert.match(db, /ledgerMonthFromParts\(id, recs, blob\)/);
    assert.doesNotMatch(db.slice(db.indexOf("ledgerMonthFromParts(id, recs, blob)") - 400, db.indexOf("ledgerMonthFromParts(id, recs, blob)") + 80), /setDoc|writeRecord/);
  });
});
