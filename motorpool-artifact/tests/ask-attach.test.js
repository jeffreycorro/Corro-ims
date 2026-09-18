"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mpAskAttach = require("../public/motorpool-ask-attach");

describe("motorpool ask attachments", () => {
  it("builds a vision turn from an image plus the question", () => {
    const content = mpAskAttach.userContent("What unit is this?", [
      { kind: "image", name: "plate.jpg", mediaType: "image/jpeg", data: "abc123" },
    ]);
    assert.equal(Array.isArray(content), true);
    assert.equal(content[0].type, "image");
    assert.equal(content[0].source.data, "abc123");
    assert.equal(content[1].text, "What unit is this?");
  });

  it("strips a data-URL prefix before sending", () => {
    const content = mpAskAttach.userContent("see", [
      { kind: "image", name: "x.png", mediaType: "image/png", data: "data:image/png;base64,QQ==" },
    ]);
    assert.equal(content[0].source.data, "QQ==");
  });

  it("keeps a text-only question as a string so typed Ask does not change", () => {
    assert.equal(mpAskAttach.userContent("DT-03 battery?", []), "DT-03 battery?");
  });
});

describe("Ask the log artifact attach wiring", () => {
  it("has attach control, chat history, and looking/answering states", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /data-mp-ask-attach/);
    assert.match(html, /data-mp-ask-file/);
    assert.match(html, /Looking up the records/);
    assert.match(html, /Answering…/);
    assert.match(html, /mpAskAttach/);
    assert.match(html, /name:"leave_for"/);
    assert.match(html, /Hold to talk/);
    assert.match(html, /Stop talking/);
  });
});
