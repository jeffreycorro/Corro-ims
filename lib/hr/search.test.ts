import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { employeeMatchesQuery, givenNameFirst } from "./search.ts";

const maria = {
  name: "Dela Cruz, Maria S.",
  emp_no: "1353",
  position: "HR Officer",
};

describe("201 File search", () => {
  it("matches given-name-first against surname-first storage", () => {
    assert.equal(givenNameFirst(maria.name), "Maria S. Dela Cruz");
    assert.equal(employeeMatchesQuery(maria, "Maria Dela Cruz"), true);
    assert.equal(employeeMatchesQuery(maria, "maria dela cruz"), true);
  });

  it("matches filed surname-first order, emp no, and position", () => {
    assert.equal(employeeMatchesQuery(maria, "Dela Cruz, Maria S."), true);
    assert.equal(employeeMatchesQuery(maria, "1353"), true);
    assert.equal(employeeMatchesQuery(maria, "HR Officer"), true);
  });

  it("tokenizes and ignores commas and periods", () => {
    assert.equal(employeeMatchesQuery(maria, "Maria S Dela Cruz"), true);
    assert.equal(employeeMatchesQuery(maria, "Cruz, Maria"), true);
    assert.equal(employeeMatchesQuery(maria, "Officer 1353"), true);
  });

  it("requires every token", () => {
    assert.equal(employeeMatchesQuery(maria, "Maria Santos"), false);
  });
});
