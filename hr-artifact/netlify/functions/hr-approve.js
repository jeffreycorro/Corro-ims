"use strict";

const { createHandler } = require("../lib/hr-approve-action");

exports.config = {
  includedFiles: [
    "public/index.html",
    "public/hr-payroll-sheet.js",
    "public/hr-project-pay.js",
    "public/hr-ot-forms.js",
    "public/hr-decision-info.js",
    "public/separated-roster.json",
  ],
};

exports.handler = createHandler();
exports.createHandler = createHandler;
