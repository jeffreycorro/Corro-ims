"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load201(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-201-file.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hr201File;
}

function emp(id, extra) {
  return Object.assign(
    { id, empNo: id.replace(/\D/g, "") || "1001", name: "Test, " + id, status: "Regular" },
    extra || {}
  );
}

function stores() {
  return {
    ui: { view: "employees", emp: "e1" },
    employees: {
      e1: emp("e1", { name: "Pedrano, Jaica M.", status: "Separated", separatedOn: "2026-03-01" }),
      e2: emp("e2", { name: "Armenio, Toribio D." }),
    },
    nte: {},
    writeups: {},
    memos: {},
    incidents: {},
    leaves: {},
    advances: {},
    reminders: {},
    docreg: {},
    filed: {},
    genfiles: {},
  };
}

function el(tag, attrs) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.assign({}, attrs),
    children: [],
    parentNode: null,
    className: (attrs && attrs.class) || "",
    id: (attrs && attrs.id) || "",
    textContent: "",
    innerHTML: "",
    getAttribute(name) {
      return this.attrs[name] == null ? null : this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === "id") this.id = String(value);
    },
    querySelector(sel) {
      if (this.matches(sel)) return this;
      for (const child of this.children) {
        const hit = child.querySelector(sel);
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      if (this.matches(sel)) out.push(this);
      for (const child of this.children) out.push.apply(out, child.querySelectorAll(sel));
      return out;
    },
    matches(sel) {
      if (sel === ".folder") return String(this.className).split(/\s+/).includes("folder");
      if (sel === ".tabs") return String(this.className).split(/\s+/).includes("tabs");
      if (sel === ".folder-top") return String(this.className).split(/\s+/).includes("folder-top");
      if (sel.startsWith("#")) return this.id === sel.slice(1);
      return false;
    },
    get firstChild() {
      return this.children[0] || null;
    },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i >= 0 ? this.parentNode.children[i + 1] || null : null;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const idx = this.children.indexOf(before);
      if (idx < 0) this.children.push(child);
      else this.children.splice(idx, 0, child);
      return child;
    },
    replaceChild(next, prev) {
      const idx = this.children.indexOf(prev);
      next.parentNode = this;
      if (idx < 0) this.children.push(next);
      else this.children[idx] = next;
      if (prev) prev.parentNode = null;
      return next;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
  };
  if (attrs && attrs.id) node.id = attrs.id;
  return node;
}

function fakeDom() {
  const byId = {};
  const head = el("head");
  const body = el("body");
  const view = el("div", { id: "view" });
  const folder = el("div", { class: "folder" });
  const top = el("div", { class: "folder-top" });
  const tabs = el("div", { class: "tabs" });
  folder.appendChild(top);
  folder.appendChild(tabs);
  view.appendChild(folder);
  body.appendChild(view);
  byId.view = view;

  const document = {
    head,
    body,
    documentElement: el("html"),
    readyState: "complete",
    __created: [],
    getElementById(id) {
      if (byId[id]) return byId[id];
      return this.querySelector("#" + id);
    },
    querySelector(sel) {
      if (sel === ".folder") return folder;
      return view.querySelector(sel) || body.querySelector(sel) || head.querySelector(sel);
    },
    createElement(tag) {
      const node = el(tag);
      const origSet = node.setAttribute.bind(node);
      node.setAttribute = function (name, value) {
        origSet(name, value);
        if (name === "id") byId[value] = node;
      };
      Object.defineProperty(node, "innerHTML", {
        get() {
          return this._html || "";
        },
        set(v) {
          this._html = String(v);
          this.children = [];
          if (/id="hr-201-onfile"/.test(v)) {
            const sec = el("section", { id: "hr-201-onfile", class: "hr-201-onfile" });
            sec.innerHTML = v;
            this.children.push(sec);
            byId["hr-201-onfile"] = sec;
          }
        },
      });
      this.__created.push(node);
      return node;
    },
    addEventListener() {},
  };
  return { document, folder, tabs, view, byId };
}

describe("hr-201-file companion wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-201-file\.js/);
    assert.match(shim, /data-hr-201-file/);
    assert.doesNotMatch(html, /hr-201-file\.js/);
  });
});

describe("hr-201-file recordsFor", () => {
  it("returns nothing when the person has no tagged records", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    assert.equal(hr.recordsFor("e1", stores()).length, 0);
    assert.equal(hr.recordsFor("", stores()).length, 0);
  });

  it("indexes NTEs, write-ups, memos, incidents, leave, advances, and reminders by empId", () => {
    const w = { window: {}, document: undefined, OFFENSES: [{ k: "late", n: "Tardiness" }] };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.nte.n1 = { id: "n1", empId: "e1", no: "NTE2026 - 17", issued: "2026-02-01", cat: "late", status: "issued" };
    S.nte.nOther = { id: "nOther", empId: "e2", no: "NTE2026 - 18", issued: "2026-02-02", status: "draft" };
    S.writeups.w1 = { id: "w1", empId: "e1", no: "WW2026 - 03", date: "2026-02-10", cat: "late", acked: true };
    S.memos.m1 = {
      id: "m1",
      no: "C.M. 2026 - 04",
      subject: "Reporting time",
      audience: "Individual",
      audienceDetail: "e1",
      date: "2026-01-20",
      status: "Issued",
    };
    S.memos.mAll = {
      id: "mAll",
      no: "C.M. 2026 - 01",
      subject: "All staff",
      audience: "All",
      date: "2026-01-05",
      status: "Issued",
    };
    S.incidents.i1 = {
      id: "i1",
      no: "IR2026-0002",
      date: "2026-01-15",
      type: "Near miss",
      persons: ["e2", "e1"],
      stage: "Closed",
    };
    S.leaves.l1 = { id: "l1", empId: "e1", no: "LRF2026-0011", type: "SIL", from: "2026-03-02", to: "2026-03-03", status: "Approved", filedOn: "2026-02-28" };
    S.advances.a1 = { id: "a1", empId: "e1", no: "CAF2026-0008", date: "2026-01-08", particulars: "Tools", status: "Approved" };
    S.reminders.r1 = { id: "r1", empId: "e1", no: "RM2026-02", subject: "Uniform", date: "2026-01-03", status: "Issued" };
    S.reminders.rGroup = { id: "rGroup", audience: "Everyone", subject: "All hands", date: "2026-01-01", status: "Issued" };

    const rows = hr.recordsFor("e1", S);
    const types = rows.map((r) => r.type).slice().sort();
    assert.equal(
      types.join("|"),
      ["Cash advance", "Incident", "Leave", "Memo", "NTE", "Reminder", "Write-up"].sort().join("|")
    );
    assert.ok(!rows.some((r) => r.no === "NTE2026 - 18"));
    assert.ok(!rows.some((r) => r.no === "C.M. 2026 - 01"));
    assert.ok(!rows.some((r) => r.sourceId === "rGroup"));
    const nte = rows.find((r) => r.source === "nte");
    assert.equal(nte.title, "Tardiness");
    assert.match(nte.status, /Issued/);
    assert.equal(rows.find((r) => r.source === "writeups").status, "Signed");
  });

  it("includes a memo tagged by empId even when audience is not Individual", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.memos.m = { id: "m", empId: "e1", audience: "Department", subject: "Site memo", date: "2026-04-01", status: "Draft" };
    const rows = hr.recordsFor("e1", S);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "Memo");
  });

  it("includes reminders that name the person in empIds", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.reminders.r = { id: "r", audience: "Selected people", empIds: ["e2", "e1"], subject: "Two names", date: "2026-05-01" };
    assert.equal(hr.recordsFor("e1", S).length, 1);
    assert.equal(hr.recordsFor("e2", S).length, 1);
  });

  it("does not invent rows for untagged collections or other people", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.leaves.l = { id: "l", empId: "e2", no: "LRF2026-0099", type: "VL", status: "Filed" };
    S.docreg.d = { id: "d", empId: "e2", no: "COE2026 - 01", seriesKey: "COE", title: "COE", status: "Issued" };
    S.filed.f = { id: "f", empId: "", title: "NTE mystery", kind: "nte" };
    assert.equal(hr.recordsFor("e1", S).length, 0);
  });

  it("keeps historical links for a separated employee", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.nte.n1 = { id: "n1", empId: "e1", no: "NTE2025 - 09", issued: "2025-11-02", status: "closed" };
    const rows = hr.recordsFor("e1", S);
    assert.equal(rows.length, 1);
    assert.equal(S.employees.e1.status, "Separated");
  });

  it("surfaces register / filed / general / linked docs without duplicating a live module row", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.leaves.l1 = { id: "l1", empId: "e1", no: "LRF2026-0011", type: "SIL", status: "Approved", filedOn: "2026-02-28" };
    S.docreg.dLeave = {
      id: "dLeave",
      empId: "e1",
      no: "LRF2026-0011",
      seriesKey: "LV",
      module: "leave",
      refId: "l1",
      title: "SIL",
      status: "Issued",
      date: "2026-02-28",
    };
    S.docreg.dCoe = {
      id: "dCoe",
      empId: "e1",
      no: "COE2026 - 02",
      seriesKey: "COE",
      title: "Certificate of Employment",
      status: "Issued",
      date: "2026-06-01",
    };
    S.docreg.dNod = {
      id: "dNod",
      empId: "e1",
      no: "NOD2026-0004",
      seriesKey: "NOD",
      module: "nod",
      refId: "n1",
      title: "Decision",
      status: "Issued",
      date: "2026-02-20",
    };
    S.filed.f1 = {
      id: "f1",
      empId: "e1",
      no: "LRF2026-0011",
      kind: "leave",
      title: "old scan of the same LRF",
      link: "https://drive.example/lrf",
      date: "2026-02-27",
    };
    S.filed.f2 = {
      id: "f2",
      empId: "e1",
      kind: "ncr",
      title: "NCR Pedrano 2025",
      link: "https://drive.example/ncr",
      date: "2025-08-01",
    };
    S.genfiles.g1 = { id: "g1", empId: "e1", title: "Salary increase list", url: "https://drive.example/gen", on: "2026-04-12" };
    S.employees.e1.linkedDocs = [{ title: "Medical note", url: "https://drive.example/med", added: "2026-03-10" }];

    const rows = hr.recordsFor("e1", S);
    const leaves = rows.filter((r) => r.type === "Leave" || r.no === "LRF2026-0011");
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].source, "leaves");
    assert.ok(rows.some((r) => r.source === "docreg" && r.type === "Certificate"));
    assert.ok(rows.some((r) => r.source === "docreg" && r.type === "Notice of Decision"));
    assert.ok(rows.some((r) => r.source === "filed" && /NCR/.test(r.title)));
    assert.ok(!rows.some((r) => r.source === "filed" && r.no === "LRF2026-0011"));
    assert.ok(rows.some((r) => r.source === "genfiles"));
    assert.ok(rows.some((r) => r.source === "linked"));
    assert.equal(rows[0].type, "Certificate");
  });

  it("renders date, type, number, status, and open/print actions", () => {
    const w = { window: {}, document: undefined };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.nte.n1 = { id: "n1", empId: "e1", no: "NTE2026 - 17", issued: "2026-02-01", status: "issued" };
    const html = hr.sectionHtml(S.employees.e1, hr.recordsFor("e1", S));
    assert.match(html, /On file for this person/);
    assert.match(html, /NTE2026 - 17/);
    assert.match(html, /data-hr201-open="nte:n1"/);
    assert.match(html, /data-hr201-print="nte:n1"/);
    assert.match(html, /2026-02-01/);
    const empty = hr.sectionHtml(S.employees.e2, []);
    assert.match(empty, /Nothing tagged/);
  });

  it("opens and prints through the existing editors, not a copied blob", () => {
    const opened = [];
    const printed = [];
    const w = {
      window: {},
      document: undefined,
      nteEditor(id) {
        opened.push(["nte", id]);
      },
      previewNTE(id) {
        printed.push(["nte", id]);
      },
      printIncident(i) {
        printed.push(["ir", i.id]);
      },
      reopenDoc(id) {
        opened.push(["reg", id]);
      },
    };
    w.window = w;
    const hr = load201(w);
    const S = stores();
    S.nte.n1 = { id: "n1", empId: "e1", no: "NTE2026 - 17", issued: "2026-02-01", status: "issued" };
    S.incidents.i1 = { id: "i1", empId: "e1", no: "IR1", date: "2026-01-01", type: "Injury", stage: "Open" };
    S.docreg.d1 = { id: "d1", empId: "e1", no: "COE2026 - 02", seriesKey: "COE", title: "COE", status: "Issued" };
    const nte = hr.recordsFor("e1", S).find((r) => r.source === "nte");
    const ir = hr.recordsFor("e1", S).find((r) => r.source === "incidents");
    const coe = hr.recordsFor("e1", S).find((r) => r.source === "docreg");
    assert.equal(hr.openRecord(nte, S), true);
    assert.equal(hr.printRecord(nte, S), true);
    assert.equal(hr.printRecord(ir, S), true);
    assert.equal(hr.openRecord(coe, S), true);
    assert.deepEqual(opened, [
      ["nte", "n1"],
      ["reg", "d1"],
    ]);
    assert.deepEqual(printed, [
      ["nte", "n1"],
      ["ir", "i1"],
    ]);
  });
});

describe("hr-201-file checklist extras and attach-via-link", () => {
  function loadWithDocs() {
    const w = {
      window: {},
      document: undefined,
      TODAY: "2026-09-15",
      DOCS: [
        { k: "sss", n: "SSS", g: "Statutory" },
        { k: "benefack", n: "Gov Benefit Deduction — acknowledged", g: "Employment" },
        { k: "qcrel", n: "Release &amp; Quitclaim", g: "Quitclaim", opt: 1, code: "CLR" },
        { k: "resign", n: "Resignation Letter", g: "Separation", opt: 1 },
      ],
      GUESS: [
        [/quitclaim|\bqc(?:ls)?\s*-?\s*20\d\d\b|release\s*(and|&)\s*quitclaim/i, "qcrel"],
        [/benefit.*deduction|refusal.*benefit/i, "benefack"],
        [/resignation\s*letter|letter\s*of\s*resignation/i, "resign"],
      ],
      guessDoc(name) {
        const t = String(name || "").replace(/[_\-.]+/g, " ");
        for (const [re, k] of this.GUESS) if (re.test(t)) return k;
        return "";
      },
      docAddLink(v, url, title) {
        url = String(url || "").trim();
        if (!url) return false;
        const links = v.links || [];
        if (v.link === url || links.some((x) => (x.url || x) === url)) return false;
        links.push({ url, title: title || "", on: "2026-09-15" });
        v.links = links;
        if (!v.link) {
          v.link = url;
          v.title = title || "";
        }
        return true;
      },
      docFiles(v) {
        if (!v) return [];
        const out = [];
        const seen = new Set();
        const push = (url, title, on) => {
          url = String(url || "").trim();
          if (!url || seen.has(url)) return;
          seen.add(url);
          out.push({ url, title: title || "", on: on || "" });
        };
        push(v.link, v.title, v.filed);
        (v.links || []).forEach((x) => {
          if (typeof x === "string") push(x, "", "");
          else if (x) push(x.url, x.title, x.on);
        });
        return out;
      },
    };
    w.window = w;
    return { w, hr: load201(w) };
  }

  it("registers refusal, clearance, and the three quitclaim rows without rewriting the artifact", () => {
    const { w, hr } = loadWithDocs();
    const out = hr.registerChecklist(w);
    assert.equal(out.added.slice().sort().join(","), "benref,clrform,qc13th,qclast,qcprorata");
    const byK = Object.fromEntries(w.DOCS.map((d) => [d.k, d]));
    assert.equal(byK.benref.n, "Refusal for GovMan Deduction");
    assert.equal(byK.benref.g, "Statutory");
    assert.equal(byK.clrform.n, "Employee Clearance Form");
    assert.equal(byK.clrform.g, "Separation");
    assert.equal(byK.qclast.n, "Quitclaim — Last Salary");
    assert.equal(byK.qcprorata.n, "Quitclaim — Pro-Rated 13th Month");
    assert.equal(byK.qc13th.n, "Quitclaim — 13th Month Pay");
    assert.equal(byK.benefack.n, "GovMan Deduction — acknowledged");
    assert.equal(byK.benefack.g, "Statutory");
    assert.equal(byK.qcrel.n, "Release & Quitclaim");
    assert.ok(byK.benref.opt);
    assert.ok(byK.clrform.opt);
    hr.registerChecklist(w);
    assert.equal(w.DOCS.filter((d) => d.k === "benref").length, 1);
  });

  it("guesses Drive file names onto the new rows before the general quitclaim rule", () => {
    const { w, hr } = loadWithDocs();
    hr.registerChecklist(w);
    assert.equal(hr.guessDocKey("1286 - Quitclaim - Last Salary.pdf"), "qclast");
    assert.equal(hr.guessDocKey("Quitclaim_Pro-Rated_13th_Month.pdf"), "qcprorata");
    assert.equal(hr.guessDocKey("Quitclaim - 13th Month Pay - Pedrano.pdf"), "qc13th");
    assert.equal(hr.guessDocKey("Employee Clearance Form R50.pdf"), "clrform");
    assert.equal(hr.guessDocKey("Refusal for GovMan Deduction.pdf"), "benref");
    assert.equal(hr.guessDocKey("Decline in Government Mandated Benefits.pdf"), "benref");
    assert.equal(hr.guessDocKey("Gov Benefit Deduction acknowledged.pdf"), "benefack");
    assert.equal(hr.guessDocKey("letter of resignation unsigned.pdf"), "resign");
  });

  it("normalizes Drive share links and file ids", () => {
    const { hr } = loadWithDocs();
    assert.equal(
      hr.normalizeDriveUrl("https://drive.google.com/file/d/1Me4tD2wDWvdWbh84iWFhBvlqOw1QyVlL/view?usp=sharing"),
      "https://drive.google.com/file/d/1Me4tD2wDWvdWbh84iWFhBvlqOw1QyVlL/view"
    );
    assert.equal(
      hr.normalizeDriveUrl("https://drive.google.com/open?id=1Zpy4tS-PvYBbfRjQb34hXIfKeI77QCCI"),
      "https://drive.google.com/file/d/1Zpy4tS-PvYBbfRjQb34hXIfKeI77QCCI/view"
    );
    assert.equal(
      hr.normalizeDriveUrl("1VmxgjUIbXpAhd2uQeyQWm-14SLUF5W0K"),
      "https://drive.google.com/file/d/1VmxgjUIbXpAhd2uQeyQWm-14SLUF5W0K/view"
    );
    assert.equal(hr.normalizeDriveUrl("not a link"), "");
  });

  it("saves a pasted Drive link onto the checklist row", () => {
    const { hr } = loadWithDocs();
    const emp = { id: "e1", name: "Pedrano, Jaica M.", docs: {} };
    const res = hr.applyAttach(
      emp,
      "qclast",
      "https://drive.google.com/file/d/1VmxgjUIbXpAhd2uQeyQWm-14SLUF5W0K/view",
      "Quitclaim — Last Salary",
      "2026-09-15"
    );
    assert.equal(res.ok, true);
    assert.equal(emp.docs.qclast.s, "on");
    assert.equal(emp.docs.qclast.link, "https://drive.google.com/file/d/1VmxgjUIbXpAhd2uQeyQWm-14SLUF5W0K/view");
    assert.equal(emp.docs.qclast.filed, "2026-09-15");
    const again = hr.applyAttach(emp, "qclast", "https://drive.google.com/file/d/1VmxgjUIbXpAhd2uQeyQWm-14SLUF5W0K/view");
    assert.equal(again.ok, false);
    const refuse = hr.applyAttach(emp, "benref", "https://example.com/refusal.pdf", "Refusal");
    assert.equal(refuse.ok, true);
    assert.equal(emp.docs.benref.s, "on");
    const clr = hr.applyAttach(emp, "clrform", "https://drive.google.com/file/d/1Zpy4tS-PvYBbfRjQb34hXIfKeI77QCCI/view");
    assert.equal(clr.ok, true);
  });

  it("lists attached checklist scans on On file for this person", () => {
    const { w, hr } = loadWithDocs();
    hr.registerChecklist(w);
    const S = stores();
    S.employees.e1.docs = {
      qclast: {
        s: "on",
        filed: "2026-08-01",
        link: "https://drive.example/last",
        title: "Quitclaim — Last Salary",
        links: [{ url: "https://drive.example/last", title: "Quitclaim — Last Salary", on: "2026-08-01" }],
      },
      clrform: { s: "on", filed: "2026-08-02", link: "https://drive.example/clr", title: "Clearance" },
    };
    const rows = hr.recordsFor("e1", S);
    assert.ok(rows.some((r) => r.source === "docs" && r.typeKey === "qclast"));
    assert.ok(rows.some((r) => r.source === "docs" && r.typeKey === "clrform"));
    const html = hr.sectionHtml(S.employees.e1, rows);
    assert.match(html, /Quitclaim — Last Salary|Last Salary/);
    assert.match(html, /Employee Clearance Form|Clearance/);
  });

  it("widens the paste-link box and adds Attach link when Drive is offline", () => {
    const { hr } = loadWithDocs();
    const raw =
      '<div class="stack"><button class="btn sm" data-upload="sss" title="Upload into this employee\'s 201 folder in Drive">Upload</button>' +
      '<input type="url" data-addlink="sss" placeholder="paste a Drive link to add" style="width:124px" title="Adds another file to this row — it does not replace what is there"></div>';
    const html = hr.enhanceDocsHtml(raw, { mcpChecked: true, mcpReady: false });
    assert.match(html, /hr-201-attach-note/);
    assert.match(html, /Drive upload and folder match are offline/);
    assert.match(html, /id="hr-201-attach-any"/);
    assert.match(html, /data-hr201-attach="sss"/);
    assert.match(html, /Paste a Drive URL/);
    assert.doesNotMatch(html, /style="width:124px"/);
  });
});

describe("hr-201-file inject", () => {
  it("injects the section on the open 201 folder and follows openEmp", () => {
    const dom = fakeDom();
    const S = stores();
    S.ui.openEmp = "e1";
    S.ui.emp = "e2";
    S.nte.n1 = { id: "n1", empId: "e1", no: "NTE2026 - 17", issued: "2026-02-01", status: "closed" };
    const w = { window: {}, document: dom.document, S };
    w.window = w;
    const hr = load201(w);
    assert.equal(hr.takeOpenEmp(S), true);
    assert.equal(S.ui.emp, "e1");
    const node = hr.inject(dom.document, S);
    assert.ok(node);
    assert.equal(node.id, "hr-201-onfile");
    assert.match(node.innerHTML || "", /On file for this person|hr-201-onfile/);
    const folderKids = dom.folder.children.map((c) => c.id || c.className);
    assert.ok(folderKids.includes("hr-201-onfile"));
    assert.ok(folderKids.indexOf("tabs") < folderKids.indexOf("hr-201-onfile"));
  });

  it("does not inject outside the 201 view", () => {
    const dom = fakeDom();
    const S = stores();
    S.ui.view = "memos";
    const w = { window: {}, document: dom.document, S };
    w.window = w;
    const hr = load201(w);
    assert.equal(hr.inject(dom.document, S), null);
  });
});
