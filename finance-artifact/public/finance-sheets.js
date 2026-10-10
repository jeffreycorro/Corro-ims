(function () {
  "use strict";

  var VIEWS = ["petty", "checks", "gcash", "checklist", "masters"];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function peso(value) {
    var n = Math.round((Number(value) || 0) * 100) / 100;
    var neg = n < 0;
    var parts = Math.abs(n).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-₱" : "₱") + parts.join(".");
  }

  function opts(rows, selected, idKey, labelKey) {
    return (rows || []).map(function (row) {
      var id = row[idKey];
      var label = row[labelKey] || row.name || row.nickname || id;
      return '<option value="' + esc(id) + '"' + (id === selected ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
  }

  function select(name, rows, placeholder) {
    return '<select name="' + name + '" required><option value="">' + esc(placeholder) + "</option>" + opts(rows, "", "id", "name") + "</select>";
  }

  function field(label, html) {
    return "<label>" + esc(label) + html + "</label>";
  }

  function form(action, inner) {
    return '<form class="card" data-sheet-form="' + action + '"><div class="fields">' + inner + '</div><p class="err"></p><div class="row"><button class="btn pri" type="submit">' + esc(action.replace(/^save|^open/, "")) + "</button></div></form>";
  }

  function values(formEl) {
    var data = {};
    new FormData(formEl).forEach(function (value, key) { data[key] = value; });
    return data;
  }

  function table(headers, rows) {
    return '<div class="scroll"><table><thead><tr>' + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : '<tr><td colspan="' + headers.length + '">Nothing on this list yet.</td></tr>') +
      "</tbody></table></div>";
  }

  function renderPetty(S) {
    var pack = S.sheet || {};
    var cycle = pack.cycle;
    var footer = pack.footer || {};
    S.title = "Petty cash";
    var cycles = (pack.cycles || []).map(function (row) {
      return '<option value="' + esc(row.id) + '"' + (cycle && row.id === cycle.id ? " selected" : "") + ">" + esc(row.label) + " · " + esc(row.status) + "</option>";
    }).join("");
    var cash = (pack.cashIns || []).map(function (row) {
      return "<tr><td>" + esc(row.txn_date) + "</td><td>" + esc(row.source_type) + "</td><td>" + esc(row.reference_no) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    var vouchers = (pack.vouchers || []).map(function (row) {
      return "<tr><td><b>" + esc(row.pcv_no) + "</b></td><td>" + esc(row.txn_date) + "</td><td>" + esc(row.employee_name) + "</td><td>" + esc(row.supplier_name) + "</td><td>" + esc(row.project_name) + "</td><td>" + esc(row.vrf_no) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    var releases = (pack.releases || []).map(function (row) {
      return "<tr><td>" + esc(row.txn_date) + "</td><td>" + esc(row.employee_name) + "</td><td>" + esc(row.description) + "</td><td>" + esc(row.status_note) + "</td><td>" + esc(row.status) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    var people = select("employeeId", pack.employees, "Employee");
    var projects = select("projectId", pack.projects, "Project");
    var suppliers = select("supplierId", pack.suppliers, "Supplier");
    var sources = '<select name="sourceType" required><option value="">Source</option>' + (pack.funding || []).map(function (row) {
      return '<option value="' + esc(row.code) + '">' + esc(row.code + " · " + row.name) + "</option>";
    }).join("") + "</select>";
    return (
      '<p class="sub">Cycles are PCB year-number. Cash on hand is computed. Project, employee, and supplier come from the lists.</p>' +
      '<div class="row"><select data-sheet-cycle>' + cycles + '</select>' +
      (cycle && cycle.status === "open" ? '<button class="btn" type="button" data-sheet="close-cycle" data-id="' + esc(cycle.id) + '">Close cycle</button>' : "") +
      "</div>" +
      (footer.totalCash != null ? '<div class="grid"><div class="card"><div class="metric">' + peso(footer.totalCash) + "<small>Total cash</small></div></div><div class=\"card\"><div class=\"metric\">" + peso(footer.cashReleased) + "<small>Cash released</small></div></div><div class=\"card\"><div class=\"metric\">" + peso(footer.totalExpenses) + "<small>Expenses</small></div></div><div class=\"card\"><div class=\"metric\">" + peso(footer.cashOnHand) + "<small>Cash on hand</small></div></div></div>" : "") +
      "<h2>Open a cycle</h2>" + form("openCycle", field("Year", '<input name="year" required value="2026">') + field("Cycle no.", '<input name="cycleNo" required>') + field("From", '<input name="dateFrom" type="date">') + field("Opening, if this is the first", '<input name="openingBalance">')) +
      "<h2>Cash in</h2>" + (cycle ? form("saveCashIn", '<input type="hidden" name="cycleId" value="' + esc(cycle.id) + '">' + field("Date", '<input name="date" type="date" required>') + field("Source", sources) + field("Reference", '<input name="referenceNo" placeholder="J2026-0101">') + field("Amount", '<input name="amount" required>')) : "") +
      "<h2>Voucher</h2>" + (cycle ? form("savePcv", '<input type="hidden" name="cycleId" value="' + esc(cycle.id) + '">' + field("Date", '<input name="date" type="date" required>') + field("C/O", people) + field("Supplier", suppliers) + field("Project", projects) + field("VRF", '<input name="vrfNo">') + field("PO", '<input name="poNo">') + field("Description", '<input name="description" class="span2">') + field("Amount", '<input name="amount" required>')) : "") +
      table(["PCV", "Date", "C/O", "Supplier", "Project", "VRF", "Amount"], vouchers) +
      "<h2>Receipt line</h2>" + (cycle ? form("saveReceipt", field("PCV", '<select name="voucherId" required><option value="">PCV</option>' + (pack.vouchers || []).filter(function (row) { return row.supplier_name !== "Cash"; }).map(function (row) { return '<option value="' + esc(row.id) + '">' + esc(row.pcv_no) + "</option>"; }).join("") + "</select>") + field("SI no.", '<input name="siNo">') + field("SI date", '<input name="siDate" type="date">') + field("Classification", '<select name="classification"><option value=""></option>' + (pack.classifications || []).map(function (item) { return "<option>" + esc(item) + "</option>"; }).join("") + "</select>") + field("Invoice amount", '<input name="invoiceAmount" required>') + field("TIN on the receipt", '<input name="tin">')) : "") +
      "<h2>Release still out</h2>" + (cycle ? form("saveRelease", '<input type="hidden" name="cycleId" value="' + esc(cycle.id) + '">' + field("Date", '<input name="date" type="date" required>') + field("Employee", people) + field("Project", projects) + field("Description", '<input name="description">') + field("Note", '<input name="statusNote" placeholder="lacking attachments">') + field("Amount", '<input name="amount" required>')) : "") +
      table(["Date", "Employee", "Description", "Note", "Status", "Amount"], releases) +
      "<h2>Cash in</h2>" + table(["Date", "Source", "Reference", "Amount"], cash)
    );
  }

  function renderChecks(S) {
    if (window.FinanceChecks) return window.FinanceChecks.render(S);
    return "<p>The checks dashboard is still loading.</p>";
  }

  function renderGcash(S) {
    var pack = S.sheet || {};
    var batch = pack.batch;
    var rows = (pack.expenses || []).map(function (row) {
      return "<tr><td><b>" + esc(row.ref_no) + "</b></td><td>" + esc(row.txn_date) + "</td><td>" + esc(row.employee_name) + "</td><td>" + esc(row.supplier_name) + "</td><td>" + esc(row.project_name) + "</td><td class=\"num\">" + peso(row.amount) + "</td><td class=\"num\">" + peso(row.fee) + "</td></tr>";
    });
    return (
      '<p class="sub">Running balance is computed. A batch usually opens with a ₱30,000 top-up from Jeffrey or Marian.</p>' +
      '<div class="card"><div class="metric">' + peso(pack.balance || 0) + "<small>" + esc(batch ? batch.year + " batch " + batch.batch_no : "No batch yet") + "</small></div></div>" +
      "<h2>Open a batch</h2>" + form("openBatch", field("Year", '<input name="year" value="2026" required>') + field("Batch no.", '<input name="batchNo" required>') + field("Opening, if this is the first", '<input name="openingBalance">')) +
      (batch ? "<h2>Top up</h2>" + form("saveWalletCashIn", '<input type="hidden" name="batchId" value="' + esc(batch.id) + '">' + field("Date", '<input name="date" type="date" required>') + field("Source", '<select name="sourceType"><option>J</option><option>M</option></select>') + field("Amount", '<input name="amount" required>')) : "") +
      (batch ? "<h2>Expense</h2>" + form("saveGcashExpense", '<input type="hidden" name="batchId" value="' + esc(batch.id) + '">' + field("Date", '<input name="date" type="date" required>') + field("C/O", select("employeeId", pack.employees, "Employee")) + field("Supplier", select("supplierId", pack.suppliers, "Supplier")) + field("Project", select("projectId", pack.projects, "Project")) + field("VRF", '<input name="vrfNo">') + field("Description", '<input name="description">') + field("Amount", '<input name="amount" required>') + field("Fee", '<input name="fee" value="0">')) : "") +
      table(["Ref", "Date", "C/O", "Supplier", "Project", "Amount", "Fee"], rows) +
      (batch ? "<h2>Receivable still out</h2>" + form("saveReceivable", '<input type="hidden" name="batchId" value="' + esc(batch.id) + '">' + field("Person", '<input name="personName">') + field("Description", '<input name="description" placeholder="lacking amount 5,200 – person">') + field("Amount", '<input name="amount" required>')) : "") +
      table(["Person", "Description", "Amount"], (pack.receivables || []).map(function (row) {
        return "<tr><td>" + esc(row.person_name) + "</td><td>" + esc(row.description) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
      }))
    );
  }

  function renderChecklist(S) {
    var pack = S.sheet || {};
    var months = [];
    (pack.instances || []).forEach(function (row) { if (months.indexOf(row.month) < 0) months.push(row.month); });
    months.sort();
    var head = ["Site", "Biller", "Account", "Method"].concat(months);
    var body = (pack.bills || []).map(function (bill) {
      var cells = months.map(function (month) {
        var hit = (pack.instances || []).find(function (row) { return row.bill_id === bill.id && row.month === month; });
        if (!hit) return "<td></td>";
        return "<td>" + esc(hit.status) + "<br>" + peso(hit.amount) + "</td>";
      });
      return "<tr><td>" + esc(bill.category) + "</td><td>" + esc(bill.biller) + "</td><td>" + esc(bill.account_no) + "</td><td>" + esc(bill.payment_method) + "</td>" + cells.join("") + "</tr>";
    });
    var due = (pack.due || []).map(function (row) {
      var bill = (pack.bills || []).find(function (item) { return item.id === row.bill_id; });
      return "<tr><td>" + esc(row.bucket) + "</td><td>" + esc(bill ? bill.biller : "") + "</td><td>" + esc(row.due_date) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    });
    var sites = '<select name="category" required>' + (pack.sites || []).map(function (site) { return "<option>" + esc(site) + "</option>"; }).join("") + "</select>";
    return (
      "<h2>Due this week and overdue</h2>" + table(["", "Biller", "Due", "Amount"], due) +
      "<h2>Monthly grid</h2>" + table(head, body) +
      "<h2>Add a biller</h2>" + form("saveChecklistBill", field("Site", sites) + field("Biller", '<input name="biller" required>') + field("Account name", '<input name="accountName">') + field("Account no.", '<input name="accountNo" placeholder="masked on save">') + field("Method", '<select name="paymentMethod"><option>GCash</option><option>check</option><option>bank</option></select>')) +
      "<h2>Month cell</h2>" + form("saveChecklistInstance", field("Bill", '<select name="billId" required><option value="">Bill</option>' + opts(pack.bills, "", "id", "biller") + "</select>") + field("Month", '<input name="month" placeholder="2026-09" required>') + field("Amount", '<input name="amount" required>') + field("Due", '<input name="dueDate" type="date">') + field("Status", '<select name="status"><option>unpaid</option><option>paid</option><option>n-a</option></select>') + field("Paid by", '<select name="paymentKind"><option value=""></option><option>check</option><option>gcash</option><option>dv</option></select>')) +
      "<h2>Rent</h2>" + form("saveRentalUnit", field("Unit", '<input name="name" required>') + field("Site", '<input name="site">')) +
      "<h2>Property tax</h2>" + form("savePropertyTax", field("Site", '<input name="site" required>') + field("Year", '<input name="year" required>') + field("Amount", '<input name="amount" required>'))
    );
  }

  function renderMasters(S) {
    var pack = S.sheet || {};
    var banks = (pack.banks || []).map(function (row) {
      return "<tr><td>" + esc(row.nickname) + "</td><td>" + esc(row.bank_name) + "</td><td>" + esc(row.account_type) + "</td><td>" + esc(row.account_no || "—") + "</td></tr>";
    });
    var people = (pack.employees || []).map(function (row) {
      return "<tr><td>" + esc(row.name) + "</td><td>" + esc(row.department) + "</td></tr>";
    });
    var funding = (pack.funding || []).map(function (row) {
      return "<tr><td>" + esc(row.code) + "</td><td>" + esc(row.name) + "</td></tr>";
    });
    return (
      '<p class="sub">Spellings go through alias lists. A name that is not on the list cannot be typed onto a voucher.</p>' +
      "<h2>Banks</h2>" + table(["Nickname", "Bank", "Type", "Account"], banks) +
      form("saveBank", field("Nickname", '<input name="nickname" required>') + field("Bank", '<input name="bankName">') + field("Type", '<input name="accountType" placeholder="BPI 1842">') + field("Account no.", '<input name="accountNo" placeholder="full number is masked">')) +
      "<h2>Employees</h2>" + table(["Name", "Department"], people) +
      form("saveEmployee", field("Name", '<input name="name" required>') + field("Department", '<input name="department">')) +
      "<h2>Alias</h2>" + form("saveAlias", field("List", '<select name="kind"><option value="employee">Employee</option><option value="project">Project</option><option value="supplier">Supplier</option></select>') + field("Spelling on the sheet", '<input name="alias" required>') + field("Employee", select("targetId", pack.employees, "Employee").replace(" required", "")) + field("Project", select("projectTarget", pack.projects, "Project").replace(" required", "")) + field("Supplier", select("supplierTarget", pack.suppliers, "Supplier").replace(" required", ""))) +
      "<h2>Funding</h2>" + table(["Code", "Name"], funding)
    );
  }

  function render(S) {
    var title = document.getElementById("title");
    var crumb = document.getElementById("crumb");
    var html = "";
    if (S.view === "petty") html = renderPetty(S);
    else if (S.view === "checks") html = renderChecks(S);
    else if (S.view === "gcash") html = renderGcash(S);
    else if (S.view === "checklist") html = renderChecklist(S);
    else if (S.view === "masters") html = renderMasters(S);
    if (title) title.textContent = S.view === "petty" ? "Petty cash" : S.view === "checks" ? "Checks" : S.view === "gcash" ? "GCash" : S.view === "checklist" ? "Bill checklist" : "Masters";
    if (crumb) crumb.textContent = S.view === "checks" ? "Outstanding checks, issued history, and the next 30 days." : "Same registers as the Google Sheets. Pick lists only.";
    if (S.error) html = '<p class="err">' + esc(S.error) + "</p>" + html;
    return html;
  }

  window.FinanceSheets = {
    owns: function (view) { return VIEWS.indexOf(view) >= 0; },
    load: function (S, api) {
      return api("sheetState", {
        view: S.view,
        cycleId: S.cycleId || "",
        batchId: S.batchId || "",
        from: S.checkFrom || "",
        to: S.checkTo || "",
        checkYear: S.checkYear || "",
        checkMonth: S.checkMonth || "",
        checkBank: S.checkBank || "",
      }).then(function (res) {
        S.sheet = res.state || {};
        if (res.serverTime) S.checkUpdated = res.serverTime;
      });
    },
    render: render,
    onClick: function (event, ctx) {
      if (window.FinanceChecks && window.FinanceChecks.onClick(event, ctx)) return true;
      var cycle = event.target.closest && event.target.closest("[data-sheet-cycle]");
      if (cycle && event.type === "change") return false;
      var button = event.target.closest && event.target.closest("[data-sheet]");
      if (button) {
        var action = button.getAttribute("data-sheet");
        if (action === "close-cycle") {
          ctx.api("closeCycle", { id: button.getAttribute("data-id") }).then(ctx.refresh).catch(function (err) { ctx.S.error = err.message; ctx.render(); });
          return true;
        }
      }
      return false;
    },
  };

  document.addEventListener("submit", function (event) {
    var formEl = event.target.closest && event.target.closest("[data-sheet-form]");
    if (!formEl) return;
    event.preventDefault();
    var action = formEl.getAttribute("data-sheet-form");
    var data = values(formEl);
    if (action === "checkWindow") {
      window.FinanceSheets._ctx.S.checkFrom = data.from || "";
      window.FinanceSheets._ctx.S.checkTo = data.to || "";
      window.FinanceSheets._ctx.refresh();
      return;
    }
    if (action === "saveAlias") {
      if (data.kind === "project") data.targetId = data.projectTarget;
      if (data.kind === "supplier") data.targetId = data.supplierTarget;
    }
    window.FinanceSheets._ctx.api(action, data).then(function () {
      return window.FinanceSheets._ctx.refresh();
    }).catch(function (err) {
      var slot = formEl.querySelector(".err");
      if (slot) slot.textContent = err.message || "Could not save.";
    });
  });

  document.addEventListener("change", function (event) {
    var cycle = event.target.closest && event.target.closest("[data-sheet-cycle]");
    if (!cycle || !window.FinanceSheets._ctx) return;
    window.FinanceSheets._ctx.S.cycleId = cycle.value;
    window.FinanceSheets._ctx.refresh();
  });
})();
