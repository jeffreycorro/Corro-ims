/**
 * 201 File search. Records are stored surname-first ("Dela Cruz, Maria S.")
 * but queries are often typed given-name-first ("Maria Dela Cruz").
 * Tokens must all match; commas and periods are ignored on both sides.
 */

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearch(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

export function givenNameFirst(surnameFirst: string): string {
  const comma = surnameFirst.indexOf(",");
  if (comma === -1) return surnameFirst.trim();
  const surname = surnameFirst.slice(0, comma).trim();
  const rest = surnameFirst.slice(comma + 1).trim();
  if (!rest) return surname;
  return `${rest} ${surname}`;
}

export type EmployeeSearchFields = {
  name: string;
  emp_no: string;
  position: string | null;
};

export function employeeSearchHaystack(employee: EmployeeSearchFields): string {
  return normalizeSearchText(
    [employee.name, givenNameFirst(employee.name), employee.emp_no, employee.position ?? ""].join(" "),
  );
}

export function employeeMatchesQuery(employee: EmployeeSearchFields, query: string): boolean {
  const tokens = tokenizeSearch(query);
  if (tokens.length === 0) return true;
  const haystack = employeeSearchHaystack(employee);
  return tokens.every((token) => haystack.includes(token));
}

export function filterEmployees<T extends EmployeeSearchFields>(employees: T[], query: string): T[] {
  return employees.filter((employee) => employeeMatchesQuery(employee, query));
}
