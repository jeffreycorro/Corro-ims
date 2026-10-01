"use strict";

const { json, requireSession } = require("../lib/session");
const { attachFunctionEvent, loadServiceAccount } = require("../lib/google-sa");
const { errorBody } = require("../lib/coded-error");

/* Signed-in admin page. Returns the service account identity Jeffrey pastes
   into Workspace Admin → Domain-wide delegation. Never the private key. */
function publicIdentity(account) {
  return {
    client_email: String((account && account.client_email) || ""),
    client_id: String((account && account.client_id) || ""),
  };
}

exports.handler = async (event) => {
  try {
    attachFunctionEvent(event);
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { error: "Method not allowed" });
    }
    requireSession(event);
    const account = await loadServiceAccount();
    if (!account) {
      return json(503, { error: "Google Drive is not configured on this site." });
    }
    return json(200, publicIdentity(account));
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, errorBody(err));
  }
};

exports.publicIdentity = publicIdentity;
