"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const hr = require("../public/hr-leave-numbers");

function emp(id, name) {
  return { id, empNo: id.replace(/\D/g, "") || "1001", name: name || "Test, " + id };
}

function liveStores(extra) {
  const S = {
    employees: {
      eJ: emp("eJ", "Jaranilla, Rosalie R."),
      eC: emp("eC", "Cartuciano, Devin Carl"),
      eL: emp("eL", "Largo, Catherine A."),
    },
    leaves: {
      lvJ: {
        id: "lvJ",
        empId: "eJ",
        no: "LRF2026-0169",
        type: "SIL",
        from: "2026-09-26",
        status: "Filed",
        signedTitle: "LRF2026-0169, Jaranilla signed.pdf",
        notes: "",
      },
      lvC: {
        id: "lvC",
        empId: "eC",
        no: "LRF2026-0169",
        type: "LWOP",
        from: "2026-09-15",
        status: "Filed",
        notes: "",
      },
      lvL: {
        id: "lvL",
        empId: "eL",
        no: "LRF2026-0170",
        type: "LWOP",
        from: "2026-09-16",
        status: "Filed",
      },
    },
    docreg: {
      dC: {
        id: "dC",
        no: "LRF2026-0169",
        seriesKey: "LV",
        year: 2026,
        seq: 169,
        empId: "eC",
        module: "leave",
        refId: "lvC",
        status: "Issued",
      },
      dL: {
        id: "dL",
        no: "LRF2026-0170",
        seriesKey: "LV",
        year: 2026,
        seq: 170,
        empId: "eL",
        module: "leave",
        refId: "lvL",
        status: "Issued",
      },
    },
    filed: {},
    series: { LV: { key: "LV", prefix: "LRF", pad: 4, pattern: "{PREFIX}{YYYY}-{NNNN}" } },
    settings: { hrHead: "Domingo C. Monte Jr." },
  };
  return Object.assign(S, extra || {});
}

function loadOnWindow(windowLike) {
  windowLike.Date = Date;
  windowLike.Promise = Promise;
  windowLike.setTimeout = setTimeout;
  windowLike.JSON = JSON;
  windowLike.Object = Object;
  windowLike.Error = Error;
  windowLike.Intl = Intl;
  windowLike.parseInt = parseInt;
  windowLike.console = console;
  if (!windowLike.window) windowLike.window = windowLike;
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-leave-numbers.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrLeaveNumbers;
}

function fakeHost(S) {
  const puts = [];
  const toasts = [];
  const host = {
    S,
    TODAY: "2026-09-15",
    SESSION: "s-test",
    uid(p) {
      return p + "x1";
    },
    clone: (o) => JSON.parse(JSON.stringify(o)),
    fmtNo(s, seq, year) {
      return (s.prefix || "LRF") + year + "-" + String(seq).padStart(s.pad || 4, "0");
    },
    toast(msg, kind) {
      toasts.push({ msg, kind });
    },
    async put(coll, id, obj) {
      puts.push({ coll, id, no: obj && obj.no });
      S[coll] = S[coll] || {};
      S[coll][id] = obj;
    },
    toasts,
    puts,
  };
  return host;
}

describe("leave number parsing", () => {
  it("treats spaced and padded LRF forms as the same number", () => {
    assert.equal(hr.parseLrf("LRF2026-0169").key, "LRF2026-0169");
    assert.equal(hr.parseLrf("LRF2026 - 0169").seq, 169);
    assert.equal(hr.parseLrf("lrf2026-169").key, "LRF2026-0169");
    assert.ok(hr.sameLeaveNo("LRF2026-0169", "LRF 2026 - 169"));
  });
});

describe("uniqueness across leaves and LV docreg", () => {
  it("refuses a second leave with LRF2026-0169", () => {
    const S = liveStores();
    const clash = hr.conflictForWrite(
      "leaves",
      "lvNew",
      { id: "lvNew", no: "LRF2026-0169", empId: "eL" },
      S
    );
    assert.ok(clash);
    assert.equal(clash.code, hr.DUP_CODE);
    assert.match(clash.message, /LRF2026-0169/);
    assert.match(clash.message, /Jaranilla|Cartuciano/);
  });

  it("allows saving the same leave id again", () => {
    const S = liveStores();
    assert.equal(hr.conflictForWrite("leaves", "lvC", S.leaves.lvC, S), null);
  });

  it("refuses a second LV register row with the same number", () => {
    const S = liveStores();
    const clash = hr.conflictForWrite(
      "docreg",
      "dNew",
      { id: "dNew", no: "LRF2026-0169", seriesKey: "LV", empId: "eJ" },
      S
    );
    assert.ok(clash);
    assert.match(clash.message, /document register/);
  });

  it("does not apply LV uniqueness to a COE register row", () => {
    const S = liveStores();
    assert.equal(
      hr.conflictForWrite(
        "docreg",
        "dCoe",
        { id: "dCoe", no: "COE2026 - 01", seriesKey: "COE" },
        S
      ),
      null
    );
  });

  it("counts a Filed leave with no docreg when picking the next number", () => {
    const S = {
      leaves: { a: { id: "a", no: "LRF2026-0169", status: "Filed" } },
      docreg: {},
      filed: {},
    };
    assert.equal(hr.leavePaperHigh(S, 2026), 169);
    assert.equal(hr.nextFreeLeave(S, 2026).no, "LRF2026-0170");
  });
});

describe("live LRF2026-0169 duplicate", () => {
  it("plans Jaranilla → 0171 and keeps Cartuciano on 0169", () => {
    const S = liveStores();
    const dups = hr.listDuplicateLeaveNos(S);
    assert.equal(dups.length, 1);
    assert.equal(dups[0].no, "LRF2026-0169");
    assert.equal(dups[0].leaves.length, 2);

    const plan = hr.planLiveDuplicate169(S);
    assert.equal(plan.error, undefined);
    assert.equal(plan.leave.id, "lvJ");
    assert.equal(plan.from, "LRF2026-0169");
    assert.equal(plan.to, "LRF2026-0171");
    assert.equal(plan.keep.id, "lvC");
    assert.equal(plan.keepNo, "LRF2026-0169");
  });

  it("renumbers Jaranilla's leave, signed title, and does not steal Cartuciano's register row", async () => {
    const S = liveStores();
    S.employees.eJ.docs = {
      leaveform: {
        s: "on",
        title: "LRF2026-0169 scan",
        links: [{ title: "LRF2026-0169, signed", url: "https://drive.example/j" }],
      },
    };
    const host = fakeHost(S);
    const plan = hr.planLiveDuplicate169(S, host);
    const out = await hr.applyRenumber(host, plan);
    assert.equal(out.to, "LRF2026-0171");
    assert.equal(S.leaves.lvJ.no, "LRF2026-0171");
    assert.equal(S.leaves.lvC.no, "LRF2026-0169");
    assert.equal(S.docreg.dC.no, "LRF2026-0169");
    assert.match(S.leaves.lvJ.signedTitle, /LRF2026-0171/);
    assert.equal(S.employees.eJ.docs.leaveform.links[0].title, "LRF2026-0171, signed");
    assert.ok(S.docreg.dx1);
    assert.equal(S.docreg.dx1.no, "LRF2026-0171");
    assert.equal(S.docreg.dx1.refId, "lvJ");
    assert.equal(hr.nextFreeLeave(S, 2026, host).no, "LRF2026-0172");
    assert.equal(hr.listDuplicateLeaveNos(S).length, 0);
  });

  it("updates a matching Jaranilla docreg instead of minting a second 0169 row", async () => {
    const S = liveStores();
    S.docreg.dJ = {
      id: "dJ",
      no: "LRF2026-0169",
      seriesKey: "LV",
      year: 2026,
      seq: 169,
      empId: "eJ",
      module: "leave",
      refId: "lvJ",
      status: "Issued",
      notes: "",
    };
    const host = fakeHost(S);
    await hr.applyRenumber(host, hr.planLiveDuplicate169(S, host));
    assert.equal(S.docreg.dJ.no, "LRF2026-0171");
    assert.equal(S.docreg.dJ.seq, 171);
    assert.equal(S.docreg.dC.no, "LRF2026-0169");
    assert.equal(hr.nextFreeLeave(S, 2026, host).seq, 172);
  });
});

describe("import and manpower-report paths", () => {
  it("flags a pasted row whose LRF is already on a Filed leave", () => {
    const S = liveStores();
    const rows = hr.parseImportRows(
      "LRF2026-0169\t1241\tSIL\t2026-09-26\t2026-09-26\t1\tBirthday\tFiled\t2026-09-15\tX"
    );
    const clashes = hr.importClashNos(S, rows);
    assert.deepEqual(clashes, ["LRF2026-0169"]);
  });

  it("flags the same number twice in one paste", () => {
    const S = { leaves: {}, docreg: {} };
    const rows = hr.parseImportRows(
      "LRF2026-0180\t1\tVL\t2026-01-01\t2026-01-01\t1\tA\tFiled\t2026-01-01\tX\n" +
        "LRF2026-0180\t2\tSL\t2026-01-02\t2026-01-02\t1\tB\tFiled\t2026-01-02\tY"
    );
    assert.deepEqual(hr.importClashNos(S, rows), ["LRF2026-0180"]);
  });

  it("drops manpower-report jobs whose number is already a leave", () => {
    const S = liveStores();
    const kept = hr.filterCitedJobs(
      [
        { no: "LRF2026-0169", empId: "eJ" },
        { no: "LRF2026-0188", empId: "eL" },
      ],
      S
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].no, "LRF2026-0188");
  });
});

describe("artifact wraps", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
    assert.match(shim, /hr-leave-numbers\.js/);
    assert.match(shim, /data-hr-leave-numbers/);
    assert.ok(shim.indexOf("hr-201-file.js") < shim.indexOf("hr-leave-numbers.js"));
    assert.doesNotMatch(html, /hr-leave-numbers\.js/);
    assert.match(db, /hr-leave-numbers/);
    assert.match(db, /409/);
    assert.match(db, /rejectDuplicateLeaveNumber|conflictForWrite/);
  });

  it("makes nextSeq / peekNo skip numbers that exist only on Filed leaves", () => {
    const S = liveStores();
    delete S.docreg.dC;
    const host = {
      S,
      paperHigh() {
        return 0;
      },
      nextSeq() {
        return 1;
      },
      peekNo() {
        return "LRF2026-0001";
      },
      fmtNo(s, seq, year) {
        return "LRF" + year + "-" + String(seq).padStart(4, "0");
      },
      document: { readyState: "complete", addEventListener() {} },
    };
    host.window = host;
    const api = loadOnWindow(host);
    api.patchGlobals(host);
    assert.equal(host.nextSeq("LV", 2026), 171);
    assert.equal(host.peekNo("LV"), "LRF2026-0171");
    assert.equal(host.nextSeq("CA", 2026), 1);
  });

  it("refuses put('leaves') when the number is already issued", async () => {
    const S = liveStores();
    const toasts = [];
    let wrote = false;
    const host = {
      S,
      toast(msg, kind) {
        toasts.push({ msg, kind });
      },
      async put() {
        wrote = true;
      },
      document: { readyState: "complete", addEventListener() {} },
    };
    const api = loadOnWindow(host);
    api.patchGlobals(host);
    await assert.rejects(
      () => host.put("leaves", "lvX", { id: "lvX", no: "LRF2026-0169", empId: "eL" }),
      /already/
    );
    assert.equal(wrote, false);
    assert.equal(toasts[0].kind, "err");
  });

  it("allocate(LV) does not proceed without the series lock when db is up", async () => {
    const S = liveStores();
    S.series = { LV: { key: "LV", prefix: "LRF", pad: 4, pattern: "{PREFIX}{YYYY}-{NNNN}" } };
    const toasts = [];
    const host = {
      S,
      SESSION: "s1",
      TODAY: "2026-09-15",
      toast(msg, kind) {
        toasts.push({ msg, kind });
      },
      fmtNo(s, seq, year) {
        return "LRF" + year + "-" + String(seq).padStart(4, "0");
      },
      async allocate() {
        throw new Error("artifact allocate should not run for LV");
      },
      document: { readyState: "complete", addEventListener() {} },
    };
    S.db = {
      doc() {
        return {
          async acquire() {
            return { acquired: false };
          },
        };
      },
      collection() {
        return { async get() { return { docs: [] }; } };
      },
    };
    const api = loadOnWindow(host);
    api.patchGlobals(host);
    const entry = await host.allocate("LV", { empId: "eL", module: "leave", refId: "lvNew" });
    assert.equal(entry, null);
    assert.match(toasts[0].msg, /reserve a leave number/);
  });
});
