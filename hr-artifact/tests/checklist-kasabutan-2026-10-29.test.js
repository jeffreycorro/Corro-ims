"use strict";
/* The R39 checklist print ticks "Decline in Government Mandated Benefits"
   only for a KASABUTAN (govrefuse / legacy kasabutan). benefack is an agreement. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");

function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unclosed " + name);
}

const captured = { body: "" };
const ctx = {
  TODAY: "2026-10-29",
  esc: (s) => String(s == null ? "" : s),
  longDate: (d) => String(d || ""),
  govNoFilled: () => false,
  flipName: (n) => String(n || ""),
  pfHead: () => "",
  pfTitle: (t) => String(t || ""),
  pfControl: () => "",
  pfRows: () => "",
  pfBand: () => "",
  pfBox: (on) => (on ? "[TICK]" : "[OPEN]"),
  pfFoot: () => "",
  pfISO: () => "",
  pfWrap: (inner) => inner,
  draftFoot: () => "",
  wireDraft: () => {},
  $: () => ({ onclick: null }),
  openModal: (o) => {
    captured.body = o.body;
  },
  printDoc: () => {},
  savePDF: () => {},
};
vm.runInNewContext(extractFunction(html, "printChecklist"), ctx);

function declineMark(emp) {
  captured.body = "";
  ctx.printChecklist(emp, "R39-1");
  const m = captured.body.match(/\[(TICK|OPEN)\]Decline in Government Mandated Benefits/);
  assert.ok(m, "checklist row missing");
  return m[1];
}

const agreed = { s: "on", link: "https://drive.example/benefack.pdf" };
const kasabutan = { s: "on", link: "https://drive.example/kasabutan.pdf" };

describe("R39 checklist ticks Decline only for a KASABUTAN", () => {
  it("is build 2026-10-29b", () => {
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(readme, /build 2026-10-29a/);
    assert.match(readme, /Earlier deploy was \*\*build 2026-10-26a\*\*/);
  });

  it("leaves the box open when only a benefack is on file", () => {
    const line = html.split("\n").find((l) => l.includes('["Decline in Government Mandated Benefits"'));
    assert.match(line, /on\("govrefuse"\)\|\|on\("kasabutan"\)/);
    assert.doesNotMatch(line, /benefack/);
    assert.equal(declineMark({ name: "Santos, Ana", docs: { benefack: agreed } }), "OPEN");
    assert.equal(
      declineMark({ name: "Santos, Ana", docs: { benefack: { s: "miss", link: "https://drive.example/benefack.pdf" } } }),
      "OPEN"
    );
    assert.equal(declineMark({ name: "Santos, Ana", docs: {} }), "OPEN");
  });

  it("ticks the box for a KASABUTAN and still ignores a benefack beside it", () => {
    assert.equal(declineMark({ name: "Santos, Ana", docs: { govrefuse: kasabutan } }), "TICK");
    assert.equal(declineMark({ name: "Santos, Ana", docs: { kasabutan: { s: "on" } } }), "TICK");
    assert.equal(
      declineMark({ name: "Santos, Ana", docs: { benefack: agreed, kasabutan: kasabutan } }),
      "TICK"
    );
    assert.equal(
      declineMark({
        name: "Santos, Ana",
        docs: { benefack: agreed, govrefuse: { s: "miss", link: "https://drive.example/kasabutan.pdf" }, vax: { s: "on" } },
      }),
      "TICK"
    );
    assert.match(captured.body, /\[TICK\]Vaccine Card/);
  });
});
