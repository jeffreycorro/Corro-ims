"use strict";

/**
 * Copy a Builds-only GOOGLE_SERVICE_ACCOUNT_JSON into the functions bundle
 * so Lambda does not need the ~3KB value in its environment.
 *
 * On Netlify, NETLIFY=true. Locally we leave the empty stub so a real key
 * is never written into git by accident.
 */
const fs = require("fs");
const path = require("path");

const dest =
  process.env.GOOGLE_SA_GENERATED_PATH ||
  path.join(__dirname, "../netlify/lib/google-sa.generated.js");
const rawEnv = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
const onNetlify = process.env.NETLIFY === "true";
const force = process.env.FORCE_GOOGLE_SA_BUNDLE === "1";

function asJsonText(raw) {
  let text = raw;
  if (!text.startsWith("{")) {
    text = Buffer.from(text, "base64").toString("utf8").trim();
  }
  const json = JSON.parse(text);
  if (!json.client_email || !json.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key");
  }
  return text;
}

let raw = "";
if (rawEnv && (onNetlify || force)) {
  raw = asJsonText(rawEnv);
  console.log("prepare-google-sa: bundling service account from Builds-only env");
} else if (rawEnv) {
  console.log(
    "prepare-google-sa: GOOGLE_SERVICE_ACCOUNT_JSON is set locally; leaving stub (runtime env, file, or Blobs will be used)"
  );
} else {
  console.log("prepare-google-sa: no Builds env; Drive will use Netlify Blobs or runtime env");
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(
  dest,
  `"use strict";\n// Generated at build. Do not commit a real key.\nmodule.exports = { raw: ${JSON.stringify(raw)} };\n`
);
