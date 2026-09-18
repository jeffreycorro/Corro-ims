/**
 * Photo / file attach helpers for Ask the records.
 * Loaded by claude-shim.js. Hold-to-talk stays on #ask-q.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrAskAttach = api;
  if (typeof window !== "undefined" && window) window.hrAskAttach = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_FILES = 4;
  var MAX_IMAGE_EDGE = 1400;
  var MAX_IMAGE_BYTES = 400 * 1024;
  var MAX_DOC_BYTES = 4 * 1024 * 1024;
  var MAX_TEXT_BYTES = 200 * 1024;
  var IMAGE_TYPES = {
    "image/jpeg": 1,
    "image/jpg": 1,
    "image/png": 1,
    "image/webp": 1,
    "image/gif": 1,
  };

  function str(value) {
    return value == null ? "" : String(value);
  }

  function mediaType(file) {
    var type = str(file && file.type).toLowerCase();
    if (type === "image/jpg") return "image/jpeg";
    return type;
  }

  function isImage(type, name) {
    if (IMAGE_TYPES[type]) return true;
    return /^image\//.test(type) || /\.(jpe?g|png|webp|gif)$/i.test(name || "");
  }

  function isPdf(type, name) {
    return type === "application/pdf" || /\.pdf$/i.test(name || "");
  }

  function isText(type, name) {
    return /^text\//.test(type) || /\.(txt|csv|md|json|log)$/i.test(name || "");
  }

  function stripDataUrl(value) {
    var s = str(value);
    var idx = s.indexOf(",");
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  function userContent(text, attachments) {
    var blocks = [];
    (attachments || []).forEach(function (a) {
      if (!a) return;
      if (a.kind === "image" && a.data) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: a.mediaType || "image/jpeg",
            data: stripDataUrl(a.data),
          },
        });
      } else if (a.kind === "document" && a.data) {
        blocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: a.mediaType || "application/pdf",
            data: stripDataUrl(a.data),
          },
        });
      } else if (a.kind === "text" && a.text) {
        blocks.push({
          type: "text",
          text: 'Attached file "' + (a.name || "file") + '":\n' + a.text,
        });
      }
    });
    var q = str(text).trim();
    if (q) blocks.push({ type: "text", text: q });
    else if (blocks.length) {
      blocks.push({ type: "text", text: "Please read the attached file(s) and answer from them." });
    }
    if (!blocks.length) return "";
    if (blocks.length === 1 && blocks[0].type === "text") return blocks[0].text;
    return blocks;
  }

  function historyText(text, attachments) {
    var names = (attachments || [])
      .map(function (a) {
        return a && a.name;
      })
      .filter(Boolean);
    var q = str(text).trim();
    if (!names.length) return q;
    var line =
      "[" +
      names.length +
      " attachment" +
      (names.length > 1 ? "s" : "") +
      ": " +
      names.join(", ") +
      "]";
    return q ? q + "\n" + line : line;
  }

  function acceptList() {
    return "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,.pdf,.txt,.csv,.md";
  }

  function readAs(file, method) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error("No file"));
        return;
      }
      if (typeof FileReader === "undefined") {
        reject(new Error("This browser cannot read attachments."));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read " + (file.name || "that file") + "."));
      };
      if (method === "text") reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
  }

  function shrinkImage(file) {
    return readAs(file, "data").then(function (url) {
      return new Promise(function (resolve, reject) {
        if (typeof Image === "undefined" || typeof document === "undefined") {
          resolve({
            kind: "image",
            name: file.name || "photo.jpg",
            mediaType: "image/jpeg",
            data: stripDataUrl(url),
            preview: url,
          });
          return;
        }
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Could not open " + (file.name || "that image") + "."));
        };
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h, 1));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement("canvas");
          cv.width = cw;
          cv.height = ch;
          var cx = cv.getContext("2d");
          cx.fillStyle = "#fff";
          cx.fillRect(0, 0, cw, ch);
          cx.drawImage(img, 0, 0, cw, ch);
          var q = 0.72;
          var out = cv.toDataURL("image/jpeg", q);
          while (out.length > MAX_IMAGE_BYTES * 1.37 && q > 0.32) {
            q -= 0.1;
            out = cv.toDataURL("image/jpeg", q);
          }
          resolve({
            kind: "image",
            name: file.name || "photo.jpg",
            mediaType: "image/jpeg",
            data: stripDataUrl(out),
            preview: out,
          });
        };
        img.src = url;
      });
    });
  }

  function readOne(file) {
    var name = (file && file.name) || "file";
    var type = mediaType(file);
    if (isImage(type, name)) return shrinkImage(file);
    if (isPdf(type, name)) {
      if (file.size > MAX_DOC_BYTES) {
        return Promise.reject(new Error(name + " is too large (max 4 MB)."));
      }
      return readAs(file, "data").then(function (url) {
        return {
          kind: "document",
          name: name,
          mediaType: "application/pdf",
          data: stripDataUrl(url),
        };
      });
    }
    if (isText(type, name)) {
      if (file.size > MAX_TEXT_BYTES) {
        return Promise.reject(new Error(name + " is too large for Ask."));
      }
      return readAs(file, "text").then(function (text) {
        return {
          kind: "text",
          name: name,
          mediaType: type || "text/plain",
          text: String(text || "").slice(0, 20000),
        };
      });
    }
    return Promise.reject(
      new Error("Attach a photo (JPEG, PNG, WebP) or a PDF / text file.")
    );
  }

  function readFiles(fileList, already) {
    var dest = Array.isArray(already) ? already.slice() : [];
    var files = [];
    var i;
    if (fileList && fileList.length != null) {
      for (i = 0; i < fileList.length; i += 1) files.push(fileList[i]);
    }
    var room = Math.max(0, MAX_FILES - dest.length);
    files = files.slice(0, room);
    return files.reduce(function (p, file) {
      return p.then(function (list) {
        return readOne(file).then(function (att) {
          list.push(att);
          return list;
        });
      });
    }, Promise.resolve(dest));
  }

  return {
    MAX_FILES: MAX_FILES,
    acceptList: acceptList,
    historyText: historyText,
    isImage: isImage,
    isPdf: isPdf,
    isText: isText,
    mediaType: mediaType,
    readFiles: readFiles,
    stripDataUrl: stripDataUrl,
    userContent: userContent,
  };
});
