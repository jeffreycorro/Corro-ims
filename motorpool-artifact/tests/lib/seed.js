/**
 * Demo fleet + empty masters. No production ledger pesos.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./worktypes.js"),
      require("./rules.js")
    );
  } else {
    root.MotorpoolSeed = factory(root.MotorpoolWorktypes, root.MotorpoolRules);
  }
})(typeof self !== "undefined" ? self : this, function (worktypes, rules) {
  "use strict";

  var DEMO_UNITS = [
    {
      id: "SV-01",
      code: "SV-01",
      name: "Service pickup",
      type: "service",
      plate: "GAB 1402",
      status: "active",
      meterKind: "km",
      make: "Toyota",
      model: "Hilux",
      year: 2018,
      engine: "",
      chassis: "",
      color: "White",
      acquired: "",
      driveFolder: "Motorpool/Fleet 201/SV-01",
      project: "",
      notes: "Demo unit — not a production 201.",
      papers: { cr: true, or: true, insurance: true },
    },
    {
      id: "DT-12",
      code: "DT-12",
      name: "Dump truck 12",
      type: "dump",
      plate: "CBP 8821",
      status: "active",
      meterKind: "km",
      make: "",
      model: "",
      year: "",
      driveFolder: "Motorpool/Fleet 201/DT-12",
      papers: { cr: true, or: true },
    },
    {
      id: "ST-04",
      code: "ST-04",
      name: "Stake truck 4",
      type: "stake",
      plate: "YBA 5510",
      status: "active",
      meterKind: "km",
      driveFolder: "Motorpool/Fleet 201/ST-04",
      papers: { cr: true, insurance: true },
    },
    {
      id: "TM-03",
      code: "TM-03",
      name: "Transit mixer 3",
      type: "mixer",
      plate: "CBQ 2201",
      status: "active",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/TM-03",
      papers: { orCrCombined: true },
    },
    {
      id: "BT-02",
      code: "BT-02",
      name: "Boom truck 2",
      type: "boom",
      plate: "GAA 9099",
      status: "active",
      meterKind: "km",
      driveFolder: "Motorpool/Fleet 201/BT-02",
      papers: { or: true, insurance: true },
    },
    {
      id: "BH-07",
      code: "BH-07",
      name: "Backhoe 7",
      type: "backhoe",
      plate: "BH-07",
      status: "active",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/BH-07",
      papers: {},
    },
    {
      id: "RR-02",
      code: "RR-02",
      name: "Road roller 2",
      type: "roller",
      plate: "RR-02",
      status: "active",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/RR-02",
      papers: { deed: true },
    },
    {
      id: "MC-05",
      code: "MC-05",
      name: "Motorcycle 5",
      type: "motorcycle",
      plate: "SK 4412",
      status: "active",
      meterKind: "km",
      driveFolder: "Motorpool/Fleet 201/MC-05",
      papers: {},
    },
    {
      id: "MBC-01",
      code: "MBC-01",
      name: "Mobile batching 1",
      type: "mbc",
      plate: "NA",
      status: "active",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/MBC-01",
      papers: {},
    },
    {
      id: "EQ-01",
      code: "EQ-01",
      name: "Plant compressor",
      type: "equipment",
      plate: "",
      status: "active",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/EQ-01",
      papers: { deed: true },
    },
    {
      id: "SV-99",
      code: "SV-99",
      name: "Old service",
      type: "service",
      plate: "OLD 1",
      status: "sold",
      meterKind: "km",
      driveFolder: "Motorpool/Fleet 201/SV-99",
      papers: {},
    },
    {
      id: "AV-01",
      code: "AV-01",
      name: "Awaiting disposal",
      type: "service",
      plate: "AV 0101",
      status: "av",
      meterKind: "km",
      driveFolder: "Motorpool/Fleet 201/AV-01",
      papers: {},
    },
    {
      id: "EQ-N1",
      code: "EQ-N1",
      name: "Equipment 1",
      type: "equipment",
      plate: "TMP 1",
      status: "equipment-n",
      meterKind: "hr",
      driveFolder: "Motorpool/Fleet 201/EQ-N1",
      papers: {},
    },
  ];

  function emptyMasters() {
    return {
      "master/units": { units: DEMO_UNITS.slice() },
      "master/worktypes": {
        families: worktypes.FAMILIES.slice(),
        types: worktypes.TYPES.slice(),
      },
      "master/projects": { projects: [] },
      "master/suppliers": {
        suppliers: [
          {
            id: "MOTORPOOL-INVENTORY",
            name: "MOTORPOOL INVENTORY",
            kind: "issue",
            system: true,
          },
        ],
      },
      "master/staff": { people: [] },
      "master/checklists": { byKind: worktypes.CHECKLISTS },
      "master/papers": { types: worktypes.PAPER_TYPES.slice() },
      "ledger/counter": { year: 0, next: 1 },
      "config/app": rules.defaultConfig(),
    };
  }

  function seedDocs() {
    return emptyMasters();
  }

  return {
    DEMO_UNITS: DEMO_UNITS,
    emptyMasters: emptyMasters,
    seedDocs: seedDocs,
  };
});
