/**
 * 39 work types in 10 families. Master data for VRF line inference.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MotorpoolWorktypes = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FAMILIES = [
    { id: "prev", name: "Preventive" },
    { id: "eng", name: "Engine" },
    { id: "trans", name: "Transmission / driveline" },
    { id: "elec", name: "Electrical" },
    { id: "tire", name: "Tires & wheels" },
    { id: "brake", name: "Brakes" },
    { id: "hyd", name: "Hydraulics" },
    { id: "body", name: "Body & cab" },
    { id: "fuelsys", name: "Fuel system" },
    { id: "fab", name: "Fabrication / other" },
  ];

  var TYPES = [
    { id: "change-oil", familyId: "prev", name: "Change oil" },
    { id: "pms", familyId: "prev", name: "Periodic service (PMS)" },
    { id: "grease", familyId: "prev", name: "Grease / lube" },
    { id: "filter-repl", familyId: "prev", name: "Filter replacement" },
    { id: "coolant", familyId: "prev", name: "Coolant service" },
    { id: "eng-oh", familyId: "eng", name: "Engine overhaul" },
    { id: "eng-repair", familyId: "eng", name: "Engine repair" },
    { id: "injector", familyId: "eng", name: "Injector / pump" },
    { id: "radiator", familyId: "eng", name: "Radiator / cooling" },
    { id: "turbo", familyId: "eng", name: "Turbo / intake" },
    { id: "clutch", familyId: "trans", name: "Clutch" },
    { id: "gearbox", familyId: "trans", name: "Gearbox repair" },
    { id: "diff", familyId: "trans", name: "Differential" },
    { id: "pto", familyId: "trans", name: "Transfer case / PTO" },
    { id: "battery", familyId: "elec", name: "Battery" },
    { id: "alternator", familyId: "elec", name: "Alternator / charging" },
    { id: "starter", familyId: "elec", name: "Starter" },
    { id: "wiring", familyId: "elec", name: "Wiring / lights" },
    { id: "tire-repl", familyId: "tire", name: "Tire replacement" },
    { id: "tire-repair", familyId: "tire", name: "Tire repair" },
    { id: "wheel", familyId: "tire", name: "Wheel alignment / bearings" },
    { id: "brake-shoes", familyId: "brake", name: "Brake shoes / pads" },
    { id: "brake-sys", familyId: "brake", name: "Brake system" },
    { id: "park-brake", familyId: "brake", name: "Parking brake" },
    { id: "hyd-hose", familyId: "hyd", name: "Hydraulic hose" },
    { id: "hyd-pump", familyId: "hyd", name: "Hydraulic pump" },
    { id: "hyd-cyl", familyId: "hyd", name: "Cylinder repair" },
    { id: "hyd-oil", familyId: "hyd", name: "Hydraulic oil" },
    { id: "hyd-valve", familyId: "hyd", name: "Control valve" },
    { id: "body-repair", familyId: "body", name: "Body repair" },
    { id: "glass", familyId: "body", name: "Glass / mirror" },
    { id: "interior", familyId: "body", name: "Seat / interior" },
    { id: "paint", familyId: "body", name: "Paint / rust" },
    { id: "fuel-line", familyId: "fuelsys", name: "Fuel line / tank" },
    { id: "fuel-pump", familyId: "fuelsys", name: "Fuel pump" },
    { id: "injection", familyId: "fuelsys", name: "Carburetor / injection" },
    { id: "weld", familyId: "fab", name: "Welding / fabrication" },
    { id: "undercarriage", familyId: "fab", name: "Undercarriage" },
    { id: "misc", familyId: "fab", name: "Miscellaneous" },
  ];

  var CHECKLISTS = {
    Workshop: [
      { id: "sw-ppe", label: "Safe work: PPE on", group: "safe" },
      { id: "sw-lock", label: "Safe work: Unit chocked / locked out", group: "safe" },
      { id: "sw-cool", label: "Safe work: Cool-down / depressurize", group: "safe" },
      { id: "w-inspect", label: "Inspect and record findings", group: "work" },
      { id: "w-repair", label: "Repair / replace", group: "work" },
      { id: "w-test", label: "Test run", group: "work" },
      { id: "w-clean", label: "Clean and return tools", group: "work" },
      { id: "w-review", label: "Supervisor review", group: "work" },
    ],
    Admin: [
      { id: "a-scope", label: "Scope confirmed", group: "admin" },
      { id: "a-docs", label: "Documents attached", group: "admin" },
      { id: "a-who", label: "Person responsible named", group: "admin" },
      { id: "a-follow", label: "Follow-up date set", group: "admin" },
    ],
  };

  var PAPER_TYPES = [
    { id: "cr", label: "Certificate of Registration (CR)" },
    { id: "or", label: "Official Receipt (OR)" },
    { id: "orCrCombined", label: "Combined OR + CR" },
    { id: "insurance", label: "Insurance" },
    { id: "deed", label: "Deed of sale / deed of assignment" },
  ];

  return {
    CHECKLISTS: CHECKLISTS,
    FAMILIES: FAMILIES,
    PAPER_TYPES: PAPER_TYPES,
    TYPES: TYPES,
  };
});
