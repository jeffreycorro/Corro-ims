"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const hrAskAttach = require("../public/hr-ask-attach");

describe("hr ask attachments", () => {
  it("builds a vision turn from an image plus the question", () => {
    const content = hrAskAttach.userContent("What does this leave form say?", [
      { kind: "image", name: "lrf.jpg", mediaType: "image/jpeg", data: "abc123" },
    ]);
    assert.equal(Array.isArray(content), true);
    assert.equal(content[0].type, "image");
    assert.equal(content[0].source.media_type, "image/jpeg");
    assert.equal(content[0].source.data, "abc123");
    assert.equal(content[1].type, "text");
    assert.match(content[1].text, /leave form/);
  });

  it("sends PDFs as document blocks and text files as extracted text", () => {
    const pdf = hrAskAttach.userContent("Read this", [
      { kind: "document", name: "form.pdf", mediaType: "application/pdf", data: "pdfbytes" },
    ]);
    assert.equal(pdf[0].type, "document");
    const txt = hrAskAttach.userContent("Summarise", [
      { kind: "text", name: "note.txt", text: "SIL for 16 September" },
    ]);
    assert.match(txt[0].text, /note\.txt/);
    assert.match(txt[0].text, /SIL for 16 September/);
  });

  it("labels attachments in the visible history without dropping the question", () => {
    assert.equal(hrAskAttach.historyText("Why leave?", []), "Why leave?");
    assert.match(hrAskAttach.historyText("Why leave?", [{ name: "scan.jpg" }]), /scan\.jpg/);
    assert.match(hrAskAttach.historyText("Why leave?", [{ name: "scan.jpg" }]), /Why leave/);
  });

  it("accepts common photo and document types", () => {
    assert.equal(hrAskAttach.isImage("image/png", "x.png"), true);
    assert.equal(hrAskAttach.isPdf("application/pdf", "x.pdf"), true);
    assert.equal(hrAskAttach.isText("text/plain", "x.txt"), true);
    assert.equal(hrAskAttach.MAX_FILES, 4);
  });
});
