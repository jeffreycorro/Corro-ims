"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function loadApp(names) {
  const gStart = html.indexOf("const GUESS = [");
  const gEnd = html.indexOf("/* Underscores, dashes, and accents");
  if (gStart < 0 || gEnd < gStart) throw new Error("GUESS block missing");
  const ctx = {
    TODAY: "2026-10-01",
    EMP_DIRTY: {},
    S: { settings: {}, ready: true, employees: {}, daily: {} },
    SNAP_GEN: 0,
    LIVE_Q: [],
    LIVE_T: null,
    renders: 0,
    puts: 0,
    setTimeout,
    clearTimeout,
    render() {
      ctx.renders += 1;
    },
    put() {
      ctx.puts += 1;
      return Promise.resolve(true);
    },
    lsSaveSoon() {},
    queueDailyShrink() {},
    console,
  };
  const src = html.slice(gStart, gEnd) + "\n" + names.map((n) => extractFunction(html, n)).join("\n");
  vm.runInNewContext(src, ctx);
  return ctx;
}

const MERGE_NAMES = [
  "dateInputValue",
  "statusTextIsSeparated",
  "empStatusIsLive",
  "empStatusIsSeparated",
  "separatedSnapIsStale",
  "employeeLiveBeatsSeparatedSnap",
  "blankStatusIsIntentional",
  "empEnteredFieldNames",
  "employeeFilledBeatsBlankSnap",
  "contribHoldMatches",
  "keepContribHold",
  "keepEmpDateEdits",
  "keepEmpEnteredFields",
  "isEphemeralUrl",
  "isHeavyDataUrl",
  "durableDriveUrl",
  "docFiles",
  "docSetFiles",
  "docAddLink",
  "copyDocMap",
  "docSlotBlank",
  "docSlotStamp",
  "docSlotScore",
  "mergeDocLinks",
  "laterIso",
  "mergeDocSlot",
  "mergeChecklistDocs",
  "docSlotKey",
  "docMapSame",
  "keepChecklistDocs",
  "checklistSnapNeedsRepair",
  "employeeSnapNeedsRepair",
  "mergeIncomingDoc",
  "isHeavyImage",
  "settingsHasImage",
  "employeePersist",
  "shedDocSlotLocal",
  "shedLocalEmployee",
  "foldFileName",
  "fileMentionsEmployee",
  "guessDoc",
  "driveFileDate",
  "linkDriveFile",
  "queueLiveSnapshot",
  "flushLiveSnapshots",
];

describe("2026-10-01b checklist, drive keywords, and a recoverable screen", () => {
  it("is build 2026-10-05a and keeps a checklist file the snapshot left blank", () => {
    assert.match(html, /const BUILD = "2026-10-07a"/);
    assert.match(html, /function keepChecklistDocs\(/);
    assert.match(html, /function checklistSnapNeedsRepair\(/);
    assert.match(html, /function paintCrash\(/);
    assert.match(html, /function flushLiveSnapshots\(/);
    assert.match(html, /function queueLiveSnapshot\(/);
    assert.match(extractFunction(html, "mergeIncomingDoc"), /keepChecklistDocs/);
    assert.match(extractFunction(html, "employeeSnapNeedsRepair"), /checklistSnapNeedsRepair/);
    const ctx = loadApp(MERGE_NAMES);
    const file = "https://drive.google.com/file/d/FILE1/view?usp=sharing";
    const local = {
      id: "e1250",
      empNo: "1250",
      name: "Ababon, Jonathan",
      status: "Regular",
      position: "Heavy Machine Operator",
      docs: {
        jd: {
          s: "on",
          link: file,
          links: [{ url: file, title: "File 1", on: "2026-09-30" }],
          filed: "2026-09-30",
          expiry: "",
        },
        resume: { s: "na", link: "", links: [], filed: "", expiry: "" },
      },
    };
    const incoming = {
      id: "e1250",
      empNo: "1250",
      name: "Ababon, Jonathan",
      status: "Regular",
      position: "Heavy Machine Operator",
      docs: {
        jd: { s: "miss", link: "", links: [], filed: "", expiry: "" },
        resume: { s: "miss", link: "", links: [], filed: "", expiry: "" },
      },
    };
    const next = ctx.mergeIncomingDoc("employees", incoming, local);
    assert.equal(next.docs.jd.s, "on");
    assert.equal(next.docs.jd.filed, "2026-09-30");
    assert.equal(next.docs.jd.link, "https://drive.google.com/file/d/FILE1/view");
    assert.equal(next.docs.jd.links[0].title, "File 1");
    assert.equal(next.docs.resume.s, "na");
    assert.equal(ctx.checklistSnapNeedsRepair(local, incoming), true);
    assert.equal(ctx.employeeSnapNeedsRepair(local, incoming), true);
    assert.equal(next.status, "Regular");
    assert.equal(next.position, "Heavy Machine Operator");
  });

  it("keeps the later checklist status and both files", () => {
    const ctx = loadApp(MERGE_NAMES);
    const older = "https://drive.google.com/file/d/OLD/view";
    const newer = "https://drive.google.com/file/d/NEW/view";
    const slot = ctx.mergeDocSlot(
      { s: "on", link: older, links: [{ url: older, title: "File 1", on: "2026-09-30" }], filed: "2026-09-30", expiry: "" },
      { s: "on", link: newer, links: [{ url: newer, title: "File 2", on: "2026-10-01" }], filed: "2026-10-01", expiry: "" }
    );
    assert.equal(slot.s, "on");
    assert.equal(slot.filed, "2026-10-01");
    const urls = Array.from(slot.links, (x) => String(x.url)).sort();
    assert.deepEqual(urls, [newer, older].sort());
  });

  it("drops a blob url and keeps the Drive link", () => {
    const ctx = loadApp(MERGE_NAMES);
    const drive = "https://drive.google.com/file/d/KEEP/view";
    const slot = ctx.mergeDocSlot(
      {
        s: "on",
        link: "blob:http://localhost/abc",
        links: [
          { url: "blob:http://localhost/abc", title: "temp", on: "" },
          { url: drive, title: "File 1", on: "2026-09-30" },
        ],
        filed: "2026-09-30",
        expiry: "",
      },
      { s: "miss", link: "", links: [], filed: "", expiry: "" }
    );
    assert.equal(slot.s, "on");
    assert.equal(slot.links.length, 1);
    assert.equal(slot.links[0].url, drive);
    assert.equal(ctx.isEphemeralUrl("blob:http://localhost/abc"), true);
  });

  it("matches checklist keywords in real file names", () => {
    const ctx = loadApp(MERGE_NAMES);
    const emp = { empNo: "1250", name: "Ababon, Jonathan" };
    const cases = [
      ["1250_Ababon_Jonathan_-_Resume.pdf", "resume"],
      ["José Résumé.pdf", "resume"],
      ["1250 CV.pdf", "resume"],
      ["Biodata.pdf", "resume"],
      ["TOR.pdf", "tor"],
      ["Transcript of Records.pdf", "tor"],
      ["NBI Clearance.pdf", "nbi"],
      ["PSA Birth Certificate.pdf", "psa"],
      ["Birth Cert.jpg", "psa"],
      ["Phil-Health ID.jpg", "phic"],
      ["PhilHealthID.pdf", "phic"],
      ["Pag_IBIG.pdf", "hdmf"],
      ["SSS E-1.pdf", "sss"],
      ["TIN.jpg", "tin"],
      ["Employment Contract.pdf", "contract"],
      ["Job_Description.pdf", "jd"],
      ["Luzano_Carmel_-_COSH.pdf", "safety"],
      ["Employment Contract Probationary.pdf", "contractprob"],
    ];
    cases.forEach(([name, key]) => {
      assert.equal(ctx.guessDoc(name, emp), key, name);
    });
    assert.equal(ctx.fileMentionsEmployee("1250 Ababon Resume.pdf", emp), true);
    assert.equal(ctx.fileMentionsEmployee("NBI Clearance.pdf", emp), false);
    const linked = { s: "miss", link: "", links: [], filed: "", expiry: "" };
    const added = ctx.linkDriveFile(linked, {
      title: "1250_Job_Description.pdf",
      viewUrl: "https://drive.google.com/file/d/JD1/view",
      modifiedTime: "2026-09-30T02:30:00.000Z",
    });
    assert.equal(added, true);
    assert.equal(linked.s, "on");
    assert.equal(linked.filed, "2026-09-30");
    assert.equal(linked.link, "https://drive.google.com/file/d/JD1/view");
  });

  it("redraws once for a burst of collection snapshots", async () => {
    const ctx = loadApp(MERGE_NAMES);
    const colls = [
      "employees",
      "daily",
      "payruns",
      "leaves",
      "advances",
      "memos",
      "nte",
      "periods",
      "applicants",
      "docreg",
      "tasks",
      "incidents",
      "templates",
      "settings-skip",
    ];
    colls.forEach((c, i) => ctx.queueLiveSnapshot(c, { id: "row-" + i }, []));
    assert.equal(ctx.renders, 0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(ctx.renders, 1);
    assert.equal(ctx.S.employees.id, "row-0");
    assert.equal(ctx.S.daily.id, "row-1");
    assert.equal(ctx.SNAP_GEN, 1);
  });

  it("keeps checklist links when local storage sheds photo bytes", () => {
    const ctx = loadApp(MERGE_NAMES);
    const drive = "https://drive.google.com/file/d/PHOTOFILE/view?usp=drivesdk";
    const employees = {};
    for (let i = 0; i < 240; i += 1) {
      employees["e" + i] = {
        id: "e" + i,
        empNo: String(1200 + i),
        name: "Person " + i,
        photo: "data:image/jpeg;base64," + "A".repeat(16 * 1024),
        docs: {
          jd: {
            s: "on",
            link: "https://drive.google.com/file/d/JD" + i + "/view?usp=sharing",
            links: [
              {
                url: "https://drive.google.com/file/d/JD" + i + "/view?usp=sharing",
                title: "File 1",
                on: "2026-09-30",
              },
            ],
            filed: "2026-09-30",
            expiry: "",
          },
        },
      };
    }
    employees.e0.photoLink = drive;
    const heavyStarted = Date.now();
    const heavy = JSON.stringify(employees);
    const heavyMs = Date.now() - heavyStarted;
    const lightStarted = Date.now();
    const shed = {};
    Object.keys(employees).forEach((id) => {
      shed[id] = ctx.shedLocalEmployee(employees[id]);
    });
    const light = JSON.stringify(shed);
    const lightMs = Date.now() - lightStarted;
    assert.ok(heavy.length > 3_000_000, "heavy " + heavy.length);
    assert.ok(light.length * 10 < heavy.length, "light " + light.length + " heavy " + heavy.length);
    assert.equal(shed.e0.docs.jd.s, "on");
    assert.equal(shed.e0.docs.jd.filed, "2026-09-30");
    assert.equal(shed.e0.docs.jd.link, "https://drive.google.com/file/d/JD0/view");
    assert.equal(shed.e0.photo, undefined);
    const parseHeavy = Date.now();
    JSON.parse(heavy);
    const parseHeavyMs = Date.now() - parseHeavy;
    const parseLight = Date.now();
    JSON.parse(light);
    const parseLightMs = Date.now() - parseLight;
    fs.writeFileSync(
      "/tmp/hr-measure.json",
      JSON.stringify(
        {
          employees: 240,
          heavyBytes: heavy.length,
          lightBytes: light.length,
          stringifyHeavyMs: heavyMs,
          stringifyLightMs: lightMs,
          parseHeavyMs,
          parseLightMs,
          snapshotRenders: 1,
          snapshotCollections: 14,
        },
        null,
        2
      )
    );
  });
});
