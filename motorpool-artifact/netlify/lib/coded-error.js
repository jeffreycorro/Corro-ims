"use strict";

const STATUS_BY_CODE = {
  not_granted: 403,
  capability_disabled: 403,
  capability_removed: 403,
  cancelled: 499,
  rate_limited: 429,
  prompt_too_large: 413,
  bad_request: 400,
  server_not_connected: 503,
  server_not_found: 404,
  not_in_manifest: 404,
  needs_reauth: 401,
  tool_error: 502,
  upstream_error: 502,
  server_unavailable: 503,
};

function codedError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  err.statusCode = extra.statusCode || STATUS_BY_CODE[code] || 500;
  if (extra.text) err.text = extra.text;
  if (extra.details !== undefined) err.details = extra.details;
  return err;
}

function errorBody(err) {
  const body = {
    error: (err && err.message) || "Request failed",
  };
  if (err && err.code) body.code = err.code;
  if (err && err.text) body.text = err.text;
  return body;
}

module.exports = {
  STATUS_BY_CODE,
  codedError,
  errorBody,
};
