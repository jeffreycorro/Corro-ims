/**
 * Tiny frozen-document store used only by rule tests.
 * Mirrors the artifact contract: reads come back frozen; thaw before mutate;
 * config/app is a full-field write. Not a second Motorpool UI.
 */
"use strict";

const { freezeRead, thaw } = require("./rules");

function createStore(initial) {
  const docs = Object.assign(Object.create(null), initial || {});

  return {
    get(path) {
      if (!(path in docs) || docs[path] == null) return freezeRead(null);
      return freezeRead(docs[path]);
    },
    getThawed(path) {
      return thaw(this.get(path));
    },
    set(path, value) {
      if (path === "config/app") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("config/app requires a full-field write");
        }
      }
      docs[path] = value;
      return freezeRead(value);
    },
  };
}

module.exports = { createStore };
