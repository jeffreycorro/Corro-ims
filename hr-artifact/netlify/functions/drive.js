"use strict";

const { json, requireSession, sessionSecret } = require("../lib/session");
const { capabilities, driveConfigured } = require("../lib/capabilities");
const { attachFunctionEvent } = require("../lib/google-sa");
const { codedError, errorBody } = require("../lib/coded-error");
const { createLimiter } = require("../lib/rate-limit");
const {
  FOLDER_MIME,
  base64DecodedLength,
  createFile,
  createFileChunk,
  createFileInit,
  downloadFile,
  readFileContent,
  searchFiles,
} = require("../lib/google-drive");
const { formatManilaIso } = require("../lib/manila");

const limitDrive = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: "Too many Drive requests. Try again in a moment.",
});

/* AWS Lambda / Netlify Function request bodies sit around 6 MB. Leave/CA
   scans above this oneshot go through create_file_init + chunks in the shim. */
const ONESHOT_MAX = 3.5 * 1024 * 1024;

async function envelope(event, extra) {
  return {
    timezone: "Asia/Manila",
    serverTime: formatManilaIso(),
    capabilities: await capabilities(event),
    ...extra,
  };
}

function toolName(body) {
  return String(body.tool || body.op || body.name || "").trim();
}

function toolArgs(body) {
  if (body.args && typeof body.args === "object") return body.args;
  const copy = { ...body };
  delete copy.tool;
  delete copy.op;
  delete copy.name;
  delete copy.server;
  return copy;
}

exports.handler = async (event) => {
  try {
    attachFunctionEvent(event);
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }

    requireSession(event);

    if (event.httpMethod === "GET") {
      return json(200, await envelope(event, { available: await driveConfigured() }));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    if (!(await driveConfigured())) {
      throw codedError("server_not_connected", "Google Drive is not configured on this site.");
    }

    limitDrive(event);

    const body = JSON.parse(event.body || "{}");
    const server = String(body.server || "Google Drive").trim();
    if (server && server !== "Google Drive") {
      throw codedError("server_not_found", "This portal is not set up to reach that connector.");
    }

    const tool = toolName(body);
    const args = toolArgs(body);

    if (tool === "search_files") {
      return json(200, await envelope(event, await searchFiles(args)));
    }

    if (tool === "read_file_content") {
      return json(200, await envelope(event, await readFileContent(args)));
    }

    if (tool === "download_file") {
      return json(200, await envelope(event, await downloadFile(args)));
    }

    if (tool === "create_file") {
      const mime = args.contentMimeType || "";
      if (mime === FOLDER_MIME) {
        return json(200, await envelope(event, await createFile(args)));
      }
      const bytes = base64DecodedLength(args.base64Content);
      if (bytes > ONESHOT_MAX) {
        throw codedError(
          "bad_request",
          "This file is too large for a single request. The shim should upload it in chunks."
        );
      }
      return json(200, await envelope(event, await createFile(args)));
    }

    if (tool === "create_file_init") {
      return json(200, await envelope(event, await createFileInit(args, sessionSecret())));
    }

    if (tool === "create_file_chunk") {
      return json(200, await envelope(event, await createFileChunk(args, sessionSecret())));
    }

    throw codedError("bad_request", `Unknown Drive tool: ${tool || "(none)"}`);
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    return json(status, errorBody(err));
  }
};
