"use strict";

function fail(code, message, statusCode) {
  const err = new Error(message || code);
  err.code = code;
  if (statusCode) err.statusCode = statusCode;
  else if (code === "approver_password" || code === "forbidden") err.statusCode = 403;
  else if (code === "not_found") err.statusCode = 404;
  else if (code === "conflict") err.statusCode = 409;
  else if (code === "unauthorized") err.statusCode = 401;
  else err.statusCode = 400;
  throw err;
}

function errorBody(err) {
  const body = { error: (err && err.message) || "Request failed" };
  if (err && err.code) body.code = err.code;
  return body;
}

module.exports = { errorBody, fail };
