(function () {
  "use strict";

  var NAV = [
    ["dashboard", "Dashboard"],
    ["vouchers", "Disbursement vouchers"],
    ["advances", "Cash advances"],
    ["payables", "Accounts payable"],
    ["suppliers", "Suppliers"],
    ["projects", "Projects"],
    ["approver", "Approver"],
    ["reports", "Reports"],
    ["petty", "Petty cash"],
    ["checks", "Checks"],
    ["gcash", "GCash"],
    ["checklist", "Bills"],
    ["masters", "Masters"],
    ["billings", "Progress billings"],
    ["bank", "Bank recon"],
    ["settings", "Settings"],
  ];
  var DEPTS = ["admin", "technical", "finance", "procurement", "motorpool", "safety", "site", "hr"];
  var EWT = [0, 0.01, 0.02, 0.05, 0.1, 0.15];
  var S = {
    view: "dashboard",
    booted: false,
    approverUnlocked: false,
    projects: [],
    accounts: [],
    employees: [],
    banks: [],
    suppliers: [],
    signatories: [],
    vouchers: [],
    advances: [],
    receipts: [],
    bills: [],
    payments: [],
    balances: [],
    imports: null,
    dashboard: null,
    report: null,
    me: null,
    modal: null,
    error: "",
  };

  function peso(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    var neg = n < 0;
    var parts = Math.abs(n).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-₱" : "₱") + parts.join(".");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pill(status) {
    var kind = /approved|cleared|paid|liquidated/i.test(status) ? "ok" : /cancel|disapprov/i.test(status) ? "bad" : "warn";
    return '<span class="pill ' + kind + '">' + esc(status || "—") + "</span>";
  }

  function api(op, body) {
    return fetch("/.netlify/functions/finance", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(Object.assign({ op: op, build: window.BUILD || "" }, body || {})),
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = {};
        if (text) {
          try { json = JSON.parse(text); } catch (e) { json = { error: text }; }
        }
        if (!res.ok) {
          var err = new Error(json.error || "Request failed");
          err.code = json.code;
          throw err;
        }
        return json;
      });
    });
  }

  function opts(list, value, labeler) {
    return list.map(function (row) {
      var val = labeler ? labeler(row) : row;
      var selected = String(val) === String(value || "") ? " selected" : "";
      return "<option value=\"" + esc(val) + "\"" + selected + ">" + esc(labeler ? val : row) + "</option>";
    }).join("");
  }

  function projectOptions(selected) {
    var names = S.projects.filter(function (row) { return row.active !== false; }).map(function (row) { return row.name; });
    return '<option value="">Choose a project</option>' + opts(names, selected, function (name) { return name; });
  }

  function accountOptions(selected) {
    return '<option value="">Choose an account</option>' + S.accounts.map(function (row) {
      var label = row.code + " " + row.name;
      var selectedAttr = label === selected || row.name === selected || row.code === selected ? " selected" : "";
      return "<option value=\"" + esc(label) + "\" data-code=\"" + esc(row.code) + "\" data-name=\"" + esc(row.name) + "\"" + selectedAttr + ">" + esc(label) + "</option>";
    }).join("");
  }

  function taxFields(row) {
    row = row || {};
    return (
      '<div><label>Amount</label><input name="amount" inputmode="decimal" required value="' + esc(row.amount || "") + '"></div>' +
      '<div><label>VAT</label><select name="vatMode">' +
      ["inclusive", "exclusive", "none"].map(function (mode) {
        return '<option' + ((row.vat_mode || "inclusive") === mode ? " selected" : "") + ">" + mode + "</option>";
      }).join("") +
      "</select></div>" +
      '<div><label>VAT rate</label><input name="vatRate" value="' + esc(row.vat_rate != null ? row.vat_rate : 0.12) + '"></div>' +
      '<div><label>EWT rate</label><select name="ewtRate">' +
      EWT.map(function (rate) {
        return '<option value="' + rate + '"' + (Number(row.ewt_rate || 0) === rate ? " selected" : "") + ">" + (rate * 100) + "%</option>";
      }).join("") +
      "</select></div>"
    );
  }

  function renderNav() {
    var nav = document.getElementById("nav");
    if (!nav) return;
    nav.innerHTML = NAV.map(function (item) {
      var locked = item[0] === "approver" && !S.approverUnlocked ? " locked" : "";
      var on = S.view === item[0] ? " on" : "";
      return '<button type="button" class="nav-i' + on + locked + '" data-nav="' + item[0] + '">' + esc(item[1]) + "</button>";
    }).join("");
  }

  function setTitle(title, crumb) {
    document.getElementById("title").textContent = title;
    document.getElementById("crumb").textContent = crumb || "";
  }

  function table(headers, rows) {
    return (
      "<div class=\"card\"><table><thead><tr>" +
      headers.map(function (h) { return "<th" + (h.num ? " class=\"num\"" : "") + ">" + esc(h.label) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : "<tr><td colspan=\"" + headers.length + "\">Nothing here yet.</td></tr>") +
      "</tbody></table></div>"
    );
  }

  function viewDashboard() {
    var d = S.dashboard || {};
    var ap = d.apDue || {};
    var un = d.unliquidated || {};
    var pending = d.pendingApprovals || {};
    setTitle("Dashboard", "Cash leaving the company, and what is still waiting.");
    return (
      '<div class="grid">' +
      metric(peso(d.cashOutThisMonth), "Cash out this month", d.month || "") +
      metric(String(pending.total || 0), "Pending approvals", (pending.vouchers || 0) + " vouchers · " + (pending.advances || 0) + " advances") +
      metric(peso(un.amount), "Unliquidated cash advances", (un.count || 0) + " still out") +
      metric(peso(ap.dueThisWeekAmount), "AP due this week", (ap.dueThisWeekCount || 0) + " bills · " + peso(ap.openAmount) + " open") +
      (d.sheets && d.sheets.petty ? metric(peso(d.sheets.petty.cashOnHand), "Petty cash on hand", d.sheets.petty.label) : "") +
      (d.sheets && d.sheets.gcash ? metric(peso(d.sheets.gcash.balance), "GCash balance", d.sheets.gcash.label) : "") +
      (d.sheets ? metric(String(d.sheets.pendingChecks || 0), "Checks due soon", (d.sheets.checklistDue || 0) + " bills due within 3 days") : "") +
      "</div>"
    );
  }

  function metric(value, label, note) {
    var dest = "vouchers";
    if (label.indexOf("approval") >= 0) dest = "approver";
    else if (label.indexOf("advance") >= 0) dest = "advances";
    else if (label.indexOf("AP") >= 0) dest = "payables";
    else if (label.indexOf("Petty") >= 0) dest = "petty";
    else if (label.indexOf("GCash") >= 0) dest = "gcash";
    else if (label.indexOf("Check") >= 0) dest = "checks";
    return '<button type="button" class="card" data-nav="' + dest + '"><div class="metric">' + esc(value) + "<small>" + esc(label) + "</small></div><div class=\"sub\">" + esc(note) + "</div></button>";
  }

  function viewVouchers() {
    setTitle("Disbursement vouchers", "One voucher, one number. Draft through cleared.");
    var rows = S.vouchers.map(function (row) {
      return (
        "<tr><td><b>" + esc(row.dv_no) + "</b></td><td>" + esc(row.payee) + "</td><td>" + esc(row.project_name) +
        "</td><td>" + pill(row.status) + "</td><td class=\"num\">" + peso(row.net_amount) +
        "</td><td><button class=\"btn sm\" data-open-voucher=\"" + esc(row.id) + "\">Open</button></td></tr>"
      );
    });
    return (
      '<div class="row"><button class="btn pri" data-new="voucher">New voucher</button></div>' +
      table(
        [{ label: "DV" }, { label: "Payee" }, { label: "Project" }, { label: "Status" }, { label: "Net", num: true }, { label: "" }],
        rows
      )
    );
  }

  function viewAdvances() {
    setTitle("Cash advances", "By department. Release goes out on a disbursement voucher.");
    var mode = S.advanceMode || "register";
    var rows = S.advances.map(function (row) {
      return (
        "<tr><td><b>" + esc(row.ca_no) + "</b></td><td>" + esc(row.employee_name) + "</td><td>" + esc(row.department) +
        "</td><td>" + esc(row.project_name) + "</td><td>" + pill(row.status) + "</td><td class=\"num\">" + peso(row.amount) +
        "</td><td><button class=\"btn sm\" data-open-advance=\"" + esc(row.id) + "\">Open</button></td></tr>"
      );
    });
    var aging = S.advances.filter(function (row) { return row.status === "Released"; }).map(function (row) {
      return "<tr><td>" + esc(row.ca_no) + "</td><td>" + esc(row.employee_name) + "</td><td>" + esc(row.released_on || row.date_needed) +
        "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    var balances = (S.balances || []).map(function (row) {
      return "<tr><td>" + esc(row.employee_name) + "</td><td class=\"num\">" + peso(row.holds) + "</td><td class=\"num\">" + peso(row.owed) +
        "</td><td class=\"num\"><b>" + peso(row.balance) + "</b></td></tr>";
    });
    var body = mode === "aging"
      ? table([{ label: "CA" }, { label: "Employee" }, { label: "Out since" }, { label: "Unliquidated", num: true }], aging)
      : mode === "balances"
        ? table([{ label: "Employee" }, { label: "Holds", num: true }, { label: "Owed", num: true }, { label: "Balance", num: true }], balances)
        : table([{ label: "CA" }, { label: "Employee" }, { label: "Department" }, { label: "Project" }, { label: "Status" }, { label: "Amount", num: true }, { label: "" }], rows);
    return (
      '<div class="row">' +
      '<button class="btn' + (mode === "register" ? " pri" : "") + '" data-camode="register">Register</button>' +
      '<button class="btn' + (mode === "aging" ? " pri" : "") + '" data-camode="aging">Aging</button>' +
      '<button class="btn' + (mode === "balances" ? " pri" : "") + '" data-camode="balances">Balances</button>' +
      '<button class="btn' + (mode === "links" ? " pri" : "") + '" data-camode="links">HR and Motorpool</button>' +
      '<button class="btn pri" data-new="advance">New cash advance</button></div>' +
      (mode === "links" ? linksBlock() : body)
    );
  }

  function linksBlock() {
    var pack = S.imports || { hrAdvances: [], motorpoolReserves: [] };
    var hr = (pack.hrAdvances || []).map(function (row) {
      return "<tr><td>" + esc(row.number) + "</td><td>" + esc(row.employee) + "</td><td>" + esc(row.project) +
        "</td><td>" + esc(row.status) + "</td><td class=\"num\">" + peso(row.balance) + "</td><td>Read only</td></tr>";
    });
    var mp = (pack.motorpoolReserves || []).map(function (row) {
      return "<tr><td>" + esc(row.number) + "</td><td>" + esc(row.supplier) + "</td><td>" + esc(row.project) +
        "</td><td>" + esc(row.status) + "</td><td class=\"num\">" + peso(row.amount) + "</td><td>Read only</td></tr>";
    });
    return (
      "<p class=\"sub\">These rows are read from HR and Motorpool. Finance does not write them back.</p>" +
      "<h2>HR cash advances</h2>" +
      table([{ label: "Number" }, { label: "Employee" }, { label: "Project" }, { label: "Status" }, { label: "Balance", num: true }, { label: "" }], hr) +
      "<h2>Motorpool reserves</h2>" +
      table([{ label: "VRF" }, { label: "Supplier" }, { label: "Project" }, { label: "Status" }, { label: "Amount", num: true }, { label: "" }], mp)
    );
  }

  function viewPayables() {
    setTitle("Accounts payable", "Supplier bills, partial payments, and aging.");
    var today = (S.dashboard && S.dashboard.today) || "";
    var rows = S.bills.map(function (bill) {
      var paid = Number(bill.paid_amount) || 0;
      var left = Math.round((Number(bill.net_amount) - paid) * 100) / 100;
      return "<tr><td><b>" + esc(bill.ap_no) + "</b></td><td>" + esc(bill.supplier_name) + "</td><td>" + esc(bill.invoice_no) +
        "</td><td>" + esc(bill.due_date) + "</td><td>" + pill(bill.status) + "</td><td class=\"num\">" + peso(left) +
        "</td><td><button class=\"btn sm\" data-open-bill=\"" + esc(bill.id) + "\">Open</button></td></tr>";
    });
    var due = S.bills.filter(function (bill) {
      return (bill.status === "Open" || bill.status === "Partial") && bill.due_date && today && bill.due_date >= today && bill.due_date <= addDays(today, 6);
    });
    return (
      '<div class="row"><button class="btn pri" data-new="bill">New supplier bill</button></div>' +
      "<h2>Due this week</h2><p class=\"sub\">" + due.length + " bill" + (due.length === 1 ? "" : "s") + ".</p>" +
      table(
        [{ label: "AP" }, { label: "Supplier" }, { label: "Invoice" }, { label: "Due" }, { label: "Status" }, { label: "Remaining", num: true }, { label: "" }],
        rows
      )
    );
  }

  function addDays(iso, days) {
    var p = String(iso).slice(0, 10).split("-").map(Number);
    var utc = Date.UTC(p[0], p[1] - 1, p[2]) + days * 86400000;
    var dt = new Date(utc);
    return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
  }

  function viewSuppliers() {
    setTitle("Suppliers", "Finance list, with Motorpool names shown once.");
    var rows = (S.suppliers || []).map(function (row) {
      var tag = row.readOnly ? "Motorpool · read only" : row.motorpoolLinked ? "Linked to Motorpool" : "Finance";
      var action = row.readOnly
        ? '<button class="btn sm" data-adopt-supplier="' + esc(row.name) + '">Save into Finance</button>'
        : "";
      return "<tr><td>" + esc(row.name) + (row.branch ? " · " + esc(row.branch) : "") + "</td><td>" + esc(row.tin || "—") + "</td><td>" + esc(row.vat_status || "—") + "</td><td>" + esc(tag) + "</td><td>" + action + "</td></tr>";
    });
    return (
      '<div class="row"><button class="btn pri" data-new="supplier">New supplier</button></div>' +
      table([{ label: "Name" }, { label: "TIN" }, { label: "VAT" }, { label: "Source" }, { label: "" }], rows)
    );
  }

  function viewProjects() {
    setTitle("Projects", "Shared list used by vouchers, advances, and bills.");
    var rows = S.projects.map(function (row) {
      return "<tr><td>" + esc(row.code || "—") + "</td><td>" + esc(row.name) + "</td><td>" + esc(row.client || "—") + "</td><td>" + esc(row.site || "—") + "</td></tr>";
    });
    return (
      '<div class="row"><button class="btn pri" data-new="project">New project</button>' +
      '<button class="btn" data-act="copy-projects">Pull names from HR and Motorpool</button></div>' +
      table([{ label: "Code" }, { label: "Project" }, { label: "Client" }, { label: "Site" }], rows)
    );
  }

  function viewApprover() {
    setTitle("Approver", "Evaluator already checked. Jeffrey approves from here.");
    if (!S.approverUnlocked) {
      return (
        '<div class="card" style="max-width:440px"><h2>Approver</h2>' +
        "<p>Final approval sits behind this password so the rest of Finance stays open. A reload locks it again.</p>" +
        '<form data-form="unlock"><label>Password</label><input name="password" type="password" autocomplete="off">' +
        '<p class="err">' + esc(S.error) + '</p><button class="btn pri" type="submit">Unlock</button></form></div>'
      );
    }
    var vouchers = S.vouchers.filter(function (row) { return row.status === "For Approval"; });
    var advances = S.advances.filter(function (row) { return row.status === "For Approval"; });
    var vrows = vouchers.map(function (row) {
      return "<tr><td>" + esc(row.dv_no) + "</td><td>" + esc(row.payee) + "</td><td class=\"num\">" + peso(row.net_amount) +
        "</td><td><button class=\"btn sm pri\" data-approve=\"voucher\" data-id=\"" + esc(row.id) + "\">Approve</button> " +
        '<button class="btn sm" data-return="voucher" data-id="' + esc(row.id) + '">Return</button></td></tr>';
    });
    var arows = advances.map(function (row) {
      return "<tr><td>" + esc(row.ca_no) + "</td><td>" + esc(row.employee_name) + "</td><td class=\"num\">" + peso(row.amount) +
        "</td><td><button class=\"btn sm pri\" data-approve=\"advance\" data-id=\"" + esc(row.id) + "\">Approve</button> " +
        '<button class="btn sm" data-return="advance" data-id="' + esc(row.id) + '">Return</button></td></tr>';
    });
    return (
      "<p class=\"err\">" + esc(S.error) + "</p>" +
      "<h2>Vouchers</h2>" + table([{ label: "DV" }, { label: "Payee" }, { label: "Net", num: true }, { label: "" }], vrows) +
      "<h2>Cash advances</h2>" + table([{ label: "CA" }, { label: "Employee" }, { label: "Amount", num: true }, { label: "" }], arows)
    );
  }

  function viewReports() {
    setTitle("Monthly reports", "Cash book, aging, and project cost. Print this page.");
    var report = S.report;
    if (!report) return "<p>Loading the month…</p>";
    var book = (report.cashBook || []).map(function (row) {
      return "<tr><td>" + esc(row.dv_no) + "</td><td>" + esc(row.released_on) + "</td><td>" + esc(row.payee) +
        "</td><td>" + esc(row.project_name) + "</td><td class=\"num\">" + peso(row.net_amount) + "</td></tr>";
    });
    var cost = (report.projectCost || []).map(function (row) {
      return "<tr><td>" + esc(row.project_name) + "</td><td class=\"num\">" + row.count + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    return (
      '<div class="row no-print"><button class="btn" onclick="window.print()">Print</button></div>' +
      "<h2>Cash disbursement book · " + esc(report.month) + "</h2>" +
      table([{ label: "DV" }, { label: "Released" }, { label: "Payee" }, { label: "Project" }, { label: "Net", num: true }], book) +
      "<h2>Project cost</h2>" +
      table([{ label: "Project" }, { label: "Vouchers" }, { label: "Net", num: true }], cost) +
      bucketTable("AP aging", report.apAging) +
      bucketTable("Unliquidated cash advances", report.caAging)
    );
  }

  function bucketTable(title, pack) {
    var buckets = (pack && pack.buckets) || {};
    var rows = Object.keys(buckets).map(function (key) {
      return "<tr><td>" + esc(key) + "</td><td class=\"num\">" + buckets[key].count + "</td><td class=\"num\">" + peso(buckets[key].amount) + "</td></tr>";
    });
    return "<h2>" + esc(title) + "</h2>" + table([{ label: "Bucket" }, { label: "Count" }, { label: "Amount", num: true }], rows);
  }

  function comingSoon(title, copy) {
    setTitle(title, "Designed in the finance migration. Not posted from this screen.");
    return '<div class="card"><p class="soon">COMING SOON</p><h2>' + esc(title) + "</h2><p>" + esc(copy) + "</p></div>";
  }

  function viewSettings() {
    setTitle("E-signatures", "Prepared, checked, and approved images stamped on the voucher PDF.");
    var cards = (S.signatories || []).map(function (row) {
      return (
        '<form class="card" data-form="signatory"><input type="hidden" name="slot" value="' + esc(row.slot) + '">' +
        "<h2>" + esc(row.title || row.slot) + "</h2>" +
        "<label>Name</label><input name=\"personName\" value=\"" + esc(row.person_name) + "\">" +
        "<label>PNG or JPEG</label><input name=\"file\" type=\"file\" accept=\"image/png,image/jpeg\">" +
        "<p class=\"sub\">" + (row.has_image ? "Image on file." : "No image yet.") + "</p>" +
        '<button class="btn" type="submit">Save</button></form>'
      );
    }).join("");
    return '<div class="grid">' + cards + "</div>";
  }

  function render() {
    if (window.FinanceSheets) window.FinanceSheets._ctx = { S: S, api: api, refresh: refresh, render: render };
    renderNav();
    var host = document.getElementById("view");
    var html = "";
    if (S.view === "dashboard") html = viewDashboard();
    else if (S.view === "vouchers") html = viewVouchers();
    else if (S.view === "advances") html = viewAdvances();
    else if (S.view === "payables") html = viewPayables();
    else if (S.view === "suppliers") html = viewSuppliers();
    else if (S.view === "projects") html = viewProjects();
    else if (S.view === "approver") html = viewApprover();
    else if (S.view === "reports") html = viewReports();
    else if (S.view === "billings") html = comingSoon("Progress billings", "Contracts, billing percent, retention, and collections are in finance_contracts, finance_billings, and finance_collections.");
    else if (S.view === "bank") html = comingSoon("Bank reconciliation", "Statement lines and matches stay in finance_bank_lines. Check monitoring itself is on the Checks screen.");
    else if (window.FinanceSheets && window.FinanceSheets.owns(S.view)) html = window.FinanceSheets.render(S);
    else if (S.view === "settings") html = viewSettings();
    host.innerHTML = html;
    renderModal();
    var who = document.getElementById("who");
    if (who) who.textContent = S.me && (S.me.name || S.me.email) ? (S.me.name || S.me.email) : "";
    var label = document.getElementById("buildLabel");
    if (label) label.textContent = window.BUILD || "";
  }

  function renderModal() {
    var host = document.getElementById("modalHost");
    if (!S.modal) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = '<div class="modal"><div class="sheet">' + S.modal.html + "</div></div>";
    var pad = host.querySelector("canvas.pad");
    if (pad) bindPad(pad);
  }

  function bindPad(canvas) {
    var ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#102033";
    ctx.lineWidth = 2;
    var drawing = false;
    function point(event) {
      var rect = canvas.getBoundingClientRect();
      var src = event.touches ? event.touches[0] : event;
      return {
        x: (src.clientX - rect.left) * (canvas.width / rect.width),
        y: (src.clientY - rect.top) * (canvas.height / rect.height),
      };
    }
    function down(event) {
      drawing = true;
      var p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      event.preventDefault();
    }
    function move(event) {
      if (!drawing) return;
      var p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      event.preventDefault();
    }
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", function () { drawing = false; });
  }

  function formValues(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = value;
    });
    var account = form.querySelector("[name=account]");
    if (account && account.selectedOptions && account.selectedOptions[0]) {
      data.accountCode = account.selectedOptions[0].getAttribute("data-code") || "";
      data.accountName = account.selectedOptions[0].getAttribute("data-name") || "";
    }
    return data;
  }

  function voucherForm(row) {
    row = row || {};
    var accountLabel = row.account_code ? row.account_code + " " + row.account_name : "";
    return (
      "<h2>" + (row.id ? esc(row.dv_no) : "New disbursement voucher") + "</h2>" +
      '<form data-form="voucher"><input type="hidden" name="id" value="' + esc(row.id || "") + '">' +
      '<div class="fields">' +
      '<div><label>Payee</label><input name="payee" required value="' + esc(row.payee || "") + '"></div>' +
      '<div><label>Project</label><select name="projectName" required>' + projectOptions(row.project_name) + "</select></div>" +
      '<div class="span2"><label>Particulars</label><textarea name="particulars" required>' + esc(row.particulars || "") + "</textarea></div>" +
      '<div class="span2"><label>Account</label><select name="account" required>' + accountOptions(accountLabel) + "</select></div>" +
      taxFields(row) +
      "</div><p class=\"err\"></p><div class=\"row\">" +
      (row.status && row.status !== "Draft" ? "" : '<button class="btn pri" type="submit">Save draft</button>') +
      '<button class="btn" type="button" data-close="1">Close</button></div></form>' +
      voucherActions(row)
    );
  }

  function voucherActions(row) {
    if (!row.id) return "";
    var buttons = "";
    if (row.status === "Draft") buttons += actionBtn(row.id, "submit", "Submit for review");
    if (row.status === "For Review") buttons += actionBtn(row.id, "check", "Mark checked");
    if (row.status === "Approved") buttons += '<button class="btn pri" data-release="' + esc(row.id) + '">Release</button>';
    if (row.status === "Released") buttons += actionBtn(row.id, "clear", "Mark cleared");
    if (["Draft", "For Review", "For Approval", "Approved"].indexOf(row.status) >= 0) buttons += actionBtn(row.id, "cancel", "Cancel");
    buttons += '<button class="btn" data-print="' + esc(row.id) + '">Print PDF</button>';
    buttons += '<label class="btn">Attach<input name="file" type="file" data-upload="voucher" data-id="' + esc(row.id) + '" hidden></label>';
    return '<div class="row">' + buttons + "</div>";
  }

  function actionBtn(id, action, label) {
    return '<button class="btn" data-act-voucher="' + action + '" data-id="' + esc(id) + '">' + esc(label) + "</button>";
  }

  function advanceForm(row) {
    row = row || {};
    var receipts = (S.receipts || []).filter(function (item) { return item.advance_id === row.id; });
    var actual = receipts.reduce(function (sum, item) { return sum + Number(item.amount || 0); }, 0);
    return (
      "<h2>" + (row.id ? esc(row.ca_no) : "New cash advance") + "</h2>" +
      '<form data-form="advance"><input type="hidden" name="id" value="' + esc(row.id || "") + '"><div class="fields">' +
      '<div><label>Employee</label><select name="employeeName" required><option value="">Choose an employee</option>' +
      (S.employees || []).map(function (person) {
        return "<option" + (row.employee_name === person.name ? " selected" : "") + ">" + esc(person.name) + "</option>";
      }).join("") +
      "</select></div>" +
      '<div><label>Department</label><select name="department">' +
      DEPTS.map(function (dept) {
        return "<option" + (row.department === dept ? " selected" : "") + ">" + dept + "</option>";
      }).join("") +
      "</select></div>" +
      '<div class="span2"><label>Purpose</label><input name="purpose" required value="' + esc(row.purpose || "") + '"></div>' +
      '<div><label>Project</label><select name="projectName" required>' + projectOptions(row.project_name) + "</select></div>" +
      '<div><label>Amount</label><input name="amount" required value="' + esc(row.amount || "") + '"></div>' +
      '<div><label>Date needed</label><input name="dateNeeded" type="date" required value="' + esc(row.date_needed || "") + '"></div>' +
      "</div><p class=\"err\"></p><div class=\"row\">" +
      (!row.status || row.status === "Draft" ? '<button class="btn pri" type="submit">Save draft</button>' : "") +
      '<button class="btn" type="button" data-close="1">Close</button></div></form>' +
      (row.id && row.status === "Draft" ? '<button class="btn" data-act-advance="submit" data-id="' + esc(row.id) + '">Submit for review</button>' : "") +
      (row.status === "For Review" ? '<button class="btn" data-act-advance="check" data-id="' + esc(row.id) + '">Mark checked</button>' : "") +
      (row.status === "Approved" ? '<button class="btn pri" data-release-advance="' + esc(row.id) + '">Release via DV</button>' : "") +
      (row.status === "Released"
        ? '<form data-form="receipt"><input type="hidden" name="id" value="' + esc(row.id) + '"><div class="fields"><div><label>Receipt date</label><input type="date" name="date" required></div><div><label>Amount</label><input name="amount" required></div><div class="span2"><label>Particulars</label><input name="particulars" required></div></div><button class="btn" type="submit">Add receipt</button></form>' +
          "<p>Receipts " + peso(actual) + " against " + peso(row.amount) + ".</p>" +
          '<button class="btn pri" data-liquidate="' + esc(row.id) + '">Post liquidation</button>'
        : "") +
      (row.status === "Liquidated"
        ? "<p>Actual " + peso(row.liquidated_amount) + " · refund " + peso(row.refund_amount) + " · reimbursement " + peso(row.reimbursement_amount) + ".</p>" +
          (Number(row.refund_amount) > 0 && !row.refund_received ? '<button class="btn" data-act-advance="receive_refund" data-id="' + esc(row.id) + '">Refund received</button>' : "") +
          (Number(row.reimbursement_amount) > 0 && !row.reimbursement_paid ? '<button class="btn pri" data-reimburse="' + esc(row.id) + '">Reimbursement DV</button>' : "")
        : "")
    );
  }

  function billForm() {
    return (
      "<h2>New supplier bill</h2><form data-form=\"bill\"><div class=\"fields\">" +
      '<div><label>Supplier</label><select name="supplierName" required><option value="">Choose a supplier</option>' +
      (S.suppliers || []).filter(function (row) { return !row.readOnly; }).map(function (row) {
        var label = row.name + (row.branch ? " · " + row.branch : "");
        return '<option value="' + esc(row.name) + '">' + esc(label) + "</option>";
      }).join("") +
      "</select></div>" +
      '<div><label>Invoice no.</label><input name="invoiceNo" required></div>' +
      '<div><label>Invoice date</label><input name="invoiceDate" type="date" required></div>' +
      '<div><label>Terms (days)</label><input name="termsDays" value="30"></div>' +
      '<div><label>Due date</label><input name="dueDate" type="date"></div>' +
      '<div><label>Project</label><select name="projectName" required>' + projectOptions("") + "</select></div>" +
      taxFields({}) +
      "</div><p class=\"err\"></p><button class=\"btn pri\" type=\"submit\">Save bill</button> <button class=\"btn\" type=\"button\" data-close=\"1\">Close</button></form>"
    );
  }

  function releaseForm(id) {
    return (
      "<h2>Release voucher</h2><form data-form=\"release\"><input type=\"hidden\" name=\"id\" value=\"" + esc(id) + "\">" +
      '<div class="fields"><div><label>Method</label><select name="releaseMethod"><option>Cash</option><option>Check</option></select></div>' +
      '<div><label>Receiver</label><input name="receiverName" required></div>' +
      '<div><label>Bank</label><select name="checkBank"><option value="">Cash release</option>' +
      (S.banks || []).map(function (bank) { return "<option>" + esc(bank.nickname) + "</option>"; }).join("") +
      '</select></div><div><label>Check no.</label><input name="checkNo" placeholder="BPI2026-1000274146"></div>' +
      '<div><label>Check date</label><input name="checkDate" type="date"></div>' +
      '<div class="span2"><label>Receiver signature</label><canvas class="pad" width="640" height="160"></canvas></div></div>' +
      '<p class="err"></p><button class="btn pri" type="submit">Release</button> <button class="btn" type="button" data-close="1">Close</button></form>'
    );
  }

  function simpleForm(kind) {
    if (kind === "project") {
      return '<h2>New project</h2><form data-form="project"><label>Name</label><input name="name" required><label>Code</label><input name="code"><label>Client</label><input name="client"><label>Site</label><input name="site"><p class="err"></p><button class="btn pri" type="submit">Save</button> <button class="btn" type="button" data-close="1">Close</button></form>';
    }
    return '<h2>New supplier</h2><form data-form="supplier"><label>Name</label><input name="name" required><label>Branch</label><input name="branch"><label>TIN</label><input name="tin"><label>VAT status</label><select name="vatStatus"><option value=""></option><option>Vat</option><option>Non-Vat</option><option>No Classification</option><option>Vat &amp; No classification</option></select><label>Address</label><input name="address"><p class="err"></p><button class="btn pri" type="submit">Save</button> <button class="btn" type="button" data-close="1">Close</button></form>';
  }

  function openModal(html) {
    S.modal = { html: html };
    renderModal();
  }

  function showFormError(message) {
    var err = document.querySelector("#modalHost .err");
    if (err) err.textContent = message || "";
  }

  function refresh() {
    var jobs = [api("dashboard").then(function (res) { S.dashboard = res.dashboard; })];
    if (S.view === "vouchers" || S.view === "approver") jobs.push(api("listVouchers").then(function (res) { S.vouchers = res.vouchers || []; }));
    if (S.view === "advances" || S.view === "approver") {
      jobs.push(api("listAdvances").then(function (res) { S.advances = res.advances || []; S.receipts = res.receipts || []; }));
      jobs.push(api("balances").then(function (res) { S.balances = res.balances || []; }));
    }
    if (S.view === "advances" && S.advanceMode === "links") jobs.push(api("imports").then(function (res) { S.imports = res.imports; }));
    if (S.view === "payables") jobs.push(api("listBills").then(function (res) { S.bills = res.bills || []; S.payments = res.payments || []; }));
    if (S.view === "suppliers") jobs.push(api("suppliers").then(function (res) { S.suppliers = res.suppliers || []; }));
    if (S.view === "projects") jobs.push(api("projects").then(function (res) { S.projects = res.projects || []; }));
    if (S.view === "reports") jobs.push(api("reports").then(function (res) { S.report = res.report; }));
    if (S.view === "settings") jobs.push(api("signatories").then(function (res) { S.signatories = res.signatories || []; }));
    if (window.FinanceSheets && window.FinanceSheets.owns(S.view)) jobs.push(window.FinanceSheets.load(S, api));
    return Promise.all(jobs).then(render);
  }

  function boot() {
    if (S.booted) return;
    S.booted = true;
    api("boot", { build: window.BUILD })
      .then(function (res) {
        S.me = res.me;
        S.dashboard = res.dashboard;
        S.projects = res.projects || [];
        S.accounts = res.accounts || [];
        S.suppliers = res.suppliers || [];
        S.employees = res.employees || [];
        S.banks = res.banks || [];
        S.signatories = res.signatories || [];
        render();
        return api("registerBuild", { build: window.BUILD, seq: Date.now() });
      })
      .then(function () { return api("latestBuild"); })
      .then(applyBanner)
      .catch(function (err) {
        var view = document.getElementById("view");
        if (view) view.textContent = err.message || "Finance could not load.";
      });
  }

  function applyBanner(res) {
    var banner = document.getElementById("buildBanner");
    var latest = res && res.latest && res.latest.build ? String(res.latest.build).trim() : "";
    var mine = String(window.BUILD || "").trim();
    if (!banner || !mine || !latest || mine === latest) {
      if (banner) banner.hidden = true;
      return;
    }
    document.getElementById("buildMine").textContent = mine;
    document.getElementById("buildLatest").textContent = latest;
    banner.hidden = false;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener("click", function (event) {
    if (window.FinanceSheets && window.FinanceSheets.onClick(event, { S: S, api: api, refresh: refresh, render: render })) return;
    var nav = event.target.closest && event.target.closest("[data-nav]");
    if (nav) {
      S.view = nav.getAttribute("data-nav");
      S.error = "";
      S.modal = null;
      refresh().catch(function (err) { S.error = err.message; render(); });
      return;
    }
    if (event.target.id === "reloadBuild") window.location.reload();
    if (event.target.closest && event.target.closest("[data-close]")) {
      S.modal = null;
      renderModal();
      return;
    }
    var newer = event.target.closest && event.target.closest("[data-new]");
    if (newer) {
      var kind = newer.getAttribute("data-new");
      if (kind === "voucher") openModal(voucherForm(null));
      if (kind === "advance") openModal(advanceForm(null));
      if (kind === "bill") openModal(billForm());
      if (kind === "project" || kind === "supplier") openModal(simpleForm(kind));
      return;
    }
    var openV = event.target.closest && event.target.closest("[data-open-voucher]");
    if (openV) {
      var voucher = S.vouchers.find(function (row) { return row.id === openV.getAttribute("data-open-voucher"); });
      openModal(voucherForm(voucher));
      return;
    }
    var openA = event.target.closest && event.target.closest("[data-open-advance]");
    if (openA) {
      var advance = S.advances.find(function (row) { return row.id === openA.getAttribute("data-open-advance"); });
      openModal(advanceForm(advance));
      return;
    }
    var openB = event.target.closest && event.target.closest("[data-open-bill]");
    if (openB) {
      var bill = S.bills.find(function (row) { return row.id === openB.getAttribute("data-open-bill"); });
      if (!bill) return;
      var left = Math.round((Number(bill.net_amount) - Number(bill.paid_amount || 0)) * 100) / 100;
      openModal(
        "<h2>" + esc(bill.ap_no) + " · " + esc(bill.supplier_name) + "</h2><p>Invoice " + esc(bill.invoice_no) +
        " due " + esc(bill.due_date) + "</p><p>Remaining " + peso(left) + "</p>" +
        (left > 0 ? '<form data-form="pay"><input type="hidden" name="id" value="' + esc(bill.id) + '"><label>Payment amount</label><input name="amount" value="' + left + '"><p class="err"></p><button class="btn pri" type="submit">Pay with DV</button></form>' : "") +
        '<button class="btn" type="button" data-close="1">Close</button>'
      );
      return;
    }
    var act = event.target.closest && event.target.closest("[data-act-voucher]");
    if (act) {
      api("actVoucher", { id: act.getAttribute("data-id"), action: act.getAttribute("data-act-voucher") })
        .then(function () { S.modal = null; return refresh(); })
        .catch(function (err) { showFormError(err.message); });
      return;
    }
    var actA = event.target.closest && event.target.closest("[data-act-advance]");
    if (actA) {
      api("actAdvance", { id: actA.getAttribute("data-id"), action: actA.getAttribute("data-act-advance") })
        .then(function () { S.modal = null; return refresh(); })
        .catch(function (err) { showFormError(err.message); });
      return;
    }
    var release = event.target.closest && event.target.closest("[data-release]");
    if (release && !release.hasAttribute("data-release-advance")) {
      openModal(releaseForm(release.getAttribute("data-release")));
      return;
    }
    var releaseAdv = event.target.closest && event.target.closest("[data-release-advance]");
    if (releaseAdv) {
      api("releaseAdvance", { id: releaseAdv.getAttribute("data-release-advance") })
        .then(function () { S.modal = null; S.view = "vouchers"; return refresh(); })
        .catch(function (err) { showFormError(err.message); });
      return;
    }
    var print = event.target.closest && event.target.closest("[data-print]");
    if (print) {
      window.open("/.netlify/functions/dv-pdf?id=" + encodeURIComponent(print.getAttribute("data-print")), "_blank");
      return;
    }
    var approve = event.target.closest && event.target.closest("[data-approve]");
    if (approve) {
      var opName = approve.getAttribute("data-approve") === "voucher" ? "actVoucher" : "actAdvance";
      api(opName, { id: approve.getAttribute("data-id"), action: "approve", password: S.approverPassword || "" })
        .then(refresh)
        .catch(function (err) {
          S.error = err.message;
          if (err.code === "approver_password") S.approverUnlocked = false;
          render();
        });
      return;
    }
    var ret = event.target.closest && event.target.closest("[data-return]");
    if (ret) {
      var which = ret.getAttribute("data-return") === "voucher" ? "actVoucher" : "actAdvance";
      api(which, { id: ret.getAttribute("data-id"), action: "return" }).then(refresh).catch(function (err) { S.error = err.message; render(); });
      return;
    }
    var liq = event.target.closest && event.target.closest("[data-liquidate]");
    if (liq) {
      api("liquidate", { id: liq.getAttribute("data-liquidate"), receipts: [] })
        .then(function () { S.modal = null; return refresh(); })
        .catch(function (err) { showFormError(err.message); });
      return;
    }
    var reimburse = event.target.closest && event.target.closest("[data-reimburse]");
    if (reimburse) {
      api("reimburse", { id: reimburse.getAttribute("data-reimburse") })
        .then(function () { S.modal = null; S.view = "vouchers"; return refresh(); })
        .catch(function (err) { showFormError(err.message); });
      return;
    }
    var adopt = event.target.closest && event.target.closest("[data-adopt-supplier]");
    if (adopt) {
      api("saveSupplier", { name: adopt.getAttribute("data-adopt-supplier") }).then(refresh).catch(function (err) { window.alert(err.message); });
      return;
    }
    var camode = event.target.closest && event.target.closest("[data-camode]");
    if (camode) {
      S.advanceMode = camode.getAttribute("data-camode");
      refresh().catch(function (err) { S.error = err.message; render(); });
      return;
    }
    if (event.target.closest && event.target.closest("[data-act=\"copy-projects\"]")) {
      api("copyProjects").then(function (res) { S.projects = res.projects || S.projects; render(); }).catch(function (err) { window.alert(err.message); });
    }
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.getAttribute || !form.getAttribute("data-form")) return;
    event.preventDefault();
    var kind = form.getAttribute("data-form");
    var data = formValues(form);
    var job;
    if (kind === "unlock") {
      api("approverCheck", { password: data.password })
        .then(function () {
          S.approverUnlocked = true;
          S.approverPassword = data.password;
          S.error = "";
          render();
        })
        .catch(function (err) {
          S.error = err.message || "That password does not match.";
          render();
        });
      return;
    }
    if (kind === "voucher") job = api(data.id ? "updateVoucher" : "createVoucher", data);
    if (kind === "advance") job = api(data.id ? "updateAdvance" : "createAdvance", data);
    if (kind === "bill") job = api("createBill", data);
    if (kind === "project") job = api("saveProject", data);
    if (kind === "supplier") job = api("saveSupplier", data);
    if (kind === "pay") job = api("payBill", data);
    if (kind === "receipt") job = api("addReceipt", data);
    if (kind === "release") {
      var canvas = form.querySelector("canvas");
      data.receiverSignature = canvas ? canvas.toDataURL("image/png") : "";
      data.action = "release";
      job = api("actVoucher", data);
    }
    if (kind === "signatory") {
      var file = form.querySelector("[name=file]").files[0];
      job = (file ? readFile(file) : Promise.resolve("")).then(function (image) {
        if (image) data.imageData = image;
        return api("saveSignatory", data);
      });
    }
    if (!job) return;
    job
      .then(function (res) {
        if (res.projects) S.projects = res.projects;
        if (res.suppliers) S.suppliers = res.suppliers;
        if (res.signatories) S.signatories = res.signatories;
        S.modal = null;
        return refresh();
      })
      .catch(function (err) { showFormError(err.message); });
  });

  document.addEventListener("change", function (event) {
    var input = event.target;
    if (!input || !input.getAttribute || input.getAttribute("data-upload") !== "voucher") return;
    var file = input.files && input.files[0];
    if (!file) return;
    readFile(file).then(function (url) {
      var comma = url.indexOf(",");
      return api("upload", {
        ownerKind: "voucher",
        ownerId: input.getAttribute("data-id"),
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        dataBase64: comma >= 0 ? url.slice(comma + 1) : url,
      });
    }).then(function (res) {
      if (res.signedUrl) window.open(res.signedUrl, "_blank");
    }).catch(function (err) { showFormError(err.message); });
  });

  window.addEventListener("finance-auth", boot);
  if (window.__financeAuthed) boot();
})();
