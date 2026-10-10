"use strict";

const { nameKey } = require("../../netlify/lib/names");

function aliasKey(value) {
  return nameKey(value);
}

module.exports = { aliasKey };
