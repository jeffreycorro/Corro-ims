(function () {
  "use strict";

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

  function pct(value) {
    if (value == null || value === "") return "—";
    var n = Number(value);
    if (n !== n) return "—";
    var text = String(Math.round(n * 10) / 10);
    if (n > 0) text = "+" + text;
    return text + "%";
  }

  function darkOn(S) {
    if (S.billDark != null) return !!S.billDark;
    try { return window.localStorage.getItem("finance-bills-dark") === "1"; } catch (err) { return false; }
  }

  function options(rows, selected, valueKey, labelKey) {
    return (rows || []).map(function (row) {
      var value = valueKey ? row[valueKey] : row;
      var label = labelKey ? row[labelKey] : row;
      return '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
  }

  function chart(points) {
    var w = 720;
    var h = 240;
    var padL = 28;
    var padR = 16;
    var padT = 28;
    var padB = 32;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var max = 1;
    points.forEach(function (row) { max = Math.max(max, row.thisYear || 0, row.lastYear || 0); });
    var n = Math.max(points.length, 1);
    function xy(index, amount) {
      var x = padL + (n === 1 ? innerW / 2 : (index / (n - 1)) * innerW);
      var y = padT + innerH - ((amount || 0) / max) * innerH;
      return [x, y];
    }
    function line(key, color, dash) {
      return '<polyline fill="none" stroke="' + color + '" stroke-width="2.5" ' + (dash ? 'stroke-dasharray="5 4" ' : "") + 'points="' + points.map(function (row, index) {
        var spot = xy(index, row[key]);
        return spot[0] + "," + spot[1];
      }).join(" ") + '"></polyline>';
    }
    var marks = points.map(function (row, index) {
      var spot = xy(index, row.thisYear);
      var label = '<text x="' + spot[0] + '" y="' + (h - 10) + '" text-anchor="middle" font-size="11" fill="currentColor">' + esc(row.label) + "</text>";
      if (!row.inProgress) return label;
      return '<circle cx="' + spot[0] + '" cy="' + spot[1] + '" r="5" fill="#b86a1b"></circle><text x="' + spot[0] + '" y="' + Math.max(14, spot[1] - 10) + '" text-anchor="middle" font-size="11" fill="#b86a1b">in progress</text>' + label;
    }).join("");
    return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Monthly spend, this year and last year"><title>This year and last year</title>' + line("lastYear", "#b86a1b", true) + line("thisYear", "currentColor", false) + marks + "</svg>";
  }

  function bars(rows) {
    if (!rows || !rows.length) return '<p class="sub">Nothing paid in this view.</p>';
    return rows.map(function (row) {
      return '<div class="bill-bar"><div class="row"><span>' + esc(row.label) + "</span><b>" + peso(row.amount) + " · " + pct(row.pct).replace("+", "") + '</b></div><span class="chk-bar-track"><span class="chk-bar-fill" style="width:' + Math.max(0, Math.min(100, Number(row.pct) || 0)) + '%"></span></span></div>';
    }).join("");
  }

  function itemRow(row) {
    var pill = row.pill === "OVERDUE" ? "bad" : row.pill === "DUE NOW" ? "warn" : "ok";
    var note = row.statement ? '<span class="sub">' + esc(row.statement) + "</span>" : "";
    return '<button class="chk-row" type="button" data-bill-open="' + esc(row.id) + '"><span class="pill ' + pill + '">' + esc(row.pill || "DUE") + '</span><span class="who"><b>' + esc(row.biller) + "</b> · " + esc(row.category) + " " + note + '</span><span class="amt">' + peso(row.amount) + "</span></button>";
  }

  function detail(S, pack) {
    if (!S.billOpen) return "";
    var row = (pack.instances || []).find(function (item) { return item.id === S.billOpen; });
    if (!row) return "";
    var bill = (pack.bills || []).find(function (item) { return item.id === row.bill_id; });
    var links = pack.links || {};
    function linkGroup(label, kind, rows) {
      return "<optgroup label=\"" + label + "\">" + (rows || []).map(function (item) {
        return '<option value="' + kind + "|" + esc(item.id) + '">' + esc(item.label) + "</option>";
      }).join("") + "</optgroup>";
    }
    var receipt = row.receipt_href ? '<a href="' + esc(row.receipt_href) + '" target="_blank" rel="noopener">Open receipt</a>' : row.receipt_path ? "<p>Receipt on file.</p>" : "<p class=\"sub\">No receipt yet.</p>";
    return (
      '<section class="card bill-detail" id="bill-detail"><div class="row"><h2>' + esc(bill ? bill.biller : "Bill") + "</h2><span class=\"pill\">" + esc(row.status) + '</span><button class="btn" type="button" data-bill-close>Close</button></div>' +
      "<p>" + esc(bill ? bill.category : "") + " · " + esc(bill ? bill.bill_type : "") + " · " + esc(row.month) + " · " + peso(row.amount) + "</p>" +
      (row.due_date ? "<p class=\"sub\">Due " + esc(row.due_date) + "</p>" : "") +
      '<div class="fields"><label>Date paid<input data-bill-field="paidDate" type="date" value="' + esc(row.paid_date || (pack.monitor && pack.monitor.today) || "") + '"></label>' +
      '<label>Method<select data-bill-field="paymentMethod"><option value="check">Check</option><option value="GCash">GCash</option><option value="bank">Bank</option></select></label>' +
      '<label>Linked payment<select data-bill-field="paymentLink"><option value="">No linked payment</option>' + linkGroup("Check", "check", links.checks) + linkGroup("GCash", "gcash", links.expenses) + linkGroup("Voucher", "dv", links.vouchers) + "</select></label></div>" +
      '<div class="row"><button class="btn pri" type="button" data-bill-act="paid">Mark paid</button><button class="btn" type="button" data-bill-act="na">N/A this month</button><button class="btn" type="button" data-bill-act="unpaid">Mark unpaid</button></div>' +
      "<h3>Receipt</h3>" + receipt + '<label class="btn">Upload receipt<input type="file" accept="image/*,.pdf" data-bill-receipt="' + esc(row.id) + '" hidden></label>' +
      '<form data-sheet-form="saveChecklistInstance"><input type="hidden" name="billId" value="' + esc(row.bill_id) + '"><div class="fields"><label>Month<input name="month" value="' + esc(row.month) + '" required></label><label>Amount<input name="amount" value="' + esc(row.amount) + '" required></label><label>Due<input name="dueDate" type="date" value="' + esc(row.due_date || "") + '"></label></div><p class="err"></p><button class="btn" type="submit">Save amount</button></form></section>'
    );
  }

  function render(S) {
    var pack = S.sheet || {};
    var mon = pack.monitor;
    if (!mon) return '<p class="sub">Bills are still loading.</p>';
    var dark = darkOn(S);
    var category = S.billCategory || "all";
    var item = S.billItem || "all";
    var mode = S.billMode === "cumulative" ? "cumulative" : "monthly";
    var spendYear = S.billSpendYear === "last" ? "last" : "ytd";
    var group = S.billGroup === "type" || S.billGroup === "cards" ? S.billGroup : "location";
    var k = mon.kpis || {};
    var read = (mon.trend && mon.trend.readout) || {};
    var points = (mon.trend && mon.trend[mode]) || [];
    var editing = (pack.bills || []).find(function (row) { return row.id === S.billEdit; }) || null;
    var sites = (mon.categories || pack.sites || []).map(function (name) { return '<option' + (editing && editing.category === name ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("");
    var types = (pack.billTypes || []).map(function (name) { return '<option' + (editing && editing.bill_type === name ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("");
    var cards = (pack.cards || []).map(function (name) { return '<option' + (editing && editing.card_name === name ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("");
    var catOptions = '<option value="all"' + (category === "all" ? " selected" : "") + '>All bills</option><option value="excl"' + (category === "excl" ? " selected" : "") + ">All — excl. credit cards</option>" +
      (mon.categories || []).map(function (name) { return '<option value="' + esc(name) + '"' + (category === name ? " selected" : "") + ">" + esc(name) + "</option>"; }).join("");
    var itemOptions = '<option value="all"' + (item === "all" ? " selected" : "") + ">" + (category === "all" || category === "excl" ? "All items" : "Whole category") + "</option>" + options(mon.items || [], item, "id", "biller");
    var spend = ((mon.spend || {})[spendYear] || {})[group] || [];
    var rentals = (pack.rentals || []).map(function (unit) {
      var received = (pack.rentalReceipts || []).filter(function (row) { return row.unit_id === unit.id; });
      var ytd = received.reduce(function (sum, row) { return sum + (String(row.month || "").indexOf(String(mon.year)) === 0 ? Number(row.amount) || 0 : 0); }, 0);
      return '<article class="card"><b>' + esc(unit.name) + "</b><p>" + peso(unit.monthly_rent) + '/mo</p><p class="sub">Received this year ' + peso(ytd) + "</p></article>";
    }).join("");
    var taxes = (pack.taxes || []).map(function (row) {
      return "<tr><td>" + esc(row.site) + "</td><td>" + esc(row.year) + "</td><td>" + esc(row.status) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    }).join("");
    var tile = function (value, label, extra) {
      return '<div class="card"><div class="metric">' + value + "<small>" + esc(label) + "</small>" + (extra || "") + "</div></div>";
    };
    return (
      '<section class="bills' + (dark ? " dark" : "") + '">' +
      '<div class="row"><h2>Bills</h2><button class="btn" type="button" data-bill-dark>' + (dark ? "Light mode" : "Dark mode") + "</button></div>" +
      '<div class="bill-kpis">' +
      tile(peso(k.lastYearPaid), "Last year total paid") +
      tile(peso(k.thisYearPaid), "This year paid through " + (mon.throughLabel || "no complete month")) +
      tile(pct(k.pctVsLastYear), "YTD vs last year", '<span class="sub">Excl. credit cards ' + pct(k.pctExcludingCards) + "</span>") +
      tile(peso(k.attentionTotal), "Needs attention", '<span class="sub">' + (k.attentionCount || 0) + " not marked paid</span>") +
      "</div>" +
      detail(S, pack) +
      "<h2>Monthly spend</h2>" +
      '<div class="chk-filters"><label>Category<select data-bill-filter="billCategory">' + catOptions + '</select></label><label>Item<select data-bill-filter="billItem">' + itemOptions + "</select></label></div>" +
      '<div class="row"><button class="btn' + (mode === "monthly" ? " pri" : "") + '" type="button" data-bill-mode="monthly">Monthly</button><button class="btn' + (mode === "cumulative" ? " pri" : "") + '" type="button" data-bill-mode="cumulative">Cumulative (YTD)</button></div>' +
      '<div class="chk-chart">' + chart(points) + "</div>" +
      '<p class="bill-read">Through ' + esc(mon.throughLabel || "—") + ": " + peso(read.thisYtd) + " this year vs " + peso(read.lastYtd) + " last year (" + pct(read.pct) + "). Last year full year " + peso(read.lastFull) + ". " + esc(mon.progressLabel || "") + " is in progress (" + peso(read.progressAmount) + ").</p>" +
      "<h2>Where the money goes</h2>" +
      '<div class="row"><button class="btn' + (spendYear === "ytd" ? " pri" : "") + '" type="button" data-bill-spend="ytd">This YTD</button><button class="btn' + (spendYear === "last" ? " pri" : "") + '" type="button" data-bill-spend="last">Last full year</button>' +
      '<button class="btn' + (group === "location" ? " pri" : "") + '" type="button" data-bill-group="location">By location</button><button class="btn' + (group === "type" ? " pri" : "") + '" type="button" data-bill-group="type">By bill type</button><button class="btn' + (group === "cards" ? " pri" : "") + '" type="button" data-bill-group="cards">Credit cards</button></div>' +
      bars(spend) +
      "<h2>Needs attention <span class=\"sub\">" + peso(k.attentionTotal) + "</span></h2>" +
      ((mon.attention || []).map(itemRow).join("") || '<p class="sub">Nothing overdue or due today.</p>') +
      "<h2>Due within 3 days <span class=\"sub\">" + peso(mon.reminderTotal) + "</span></h2>" +
      ((mon.reminders || []).map(function (row) { return itemRow(Object.assign({}, row, { pill: "WITHIN 3 DAYS" })); }).join("") || '<p class="sub">No bills due in the next 3 days.</p>') +
      "<h2>Upcoming scheduled <span class=\"sub\">" + peso(mon.upcomingTotal) + "</span></h2>" +
      ((mon.upcoming || []).map(itemRow).join("") || '<p class="sub">No amounts entered for later months.</p>') +
      "<h2>Rental income</h2><div class=\"bill-kpis\">" + (rentals || "<p class=\"sub\">No units yet.</p>") + "</div>" +
      '<form class="card" data-sheet-form="saveRentalReceipt"><div class="fields"><label>Unit<select name="unitId" required><option value="">Unit</option>' + options(pack.rentals || [], "", "id", "name") + '</select></label><label>Month<input name="month" placeholder="2026-10" required></label><label>Amount<input name="amount" required></label><label>Received<input name="receivedOn" type="date"></label><label>Reference<input name="reference"></label></div><p class="err"></p><button class="btn" type="submit">Record rent received</button></form>' +
      "<h2>Property tax</h2>" +
      '<div class="scroll"><table><thead><tr><th>Site</th><th>Year</th><th>Status</th><th>Amount</th></tr></thead><tbody>' + (taxes || '<tr><td colspan="4">No property tax yet.</td></tr>') + "</tbody></table></div>" +
      '<form class="card" data-sheet-form="savePropertyTax"><div class="fields"><label>Site<input name="site" required></label><label>Year<input name="year" required></label><label>Amount<input name="amount" required></label><label>Paid<input name="paidDate" type="date"></label><label>Status<select name="status"><option>unpaid</option><option>paid</option></select></label></div><p class="err"></p><button class="btn" type="submit">Save property tax</button></form>' +
      '<details class="card chk-issue"' + (editing ? " open" : "") + '><summary>' + (editing ? "Edit bill" : "Add or edit a bill") + "</summary>" +
      '<form data-sheet-form="saveChecklistBill">' + (editing ? '<input type="hidden" name="id" value="' + esc(editing.id) + '">' : "") +
      '<div class="fields"><label>Location<select name="category" required>' + sites + '</select></label><label>Biller<input name="biller" required value="' + esc(editing ? editing.biller : "") + '"></label>' +
      '<label>Bill type<select name="billType" required><option value="">Type</option>' + types + '</select></label><label>Card, if this is a card<select name="cardName"><option value=""></option>' + cards + "</select></label>" +
      '<label>Account name<input name="accountName" value="' + esc(editing ? editing.account_name : "") + '"></label><label>Account no.<input name="accountNo" placeholder="masked on save"></label>' +
      '<label>Usual method<select name="paymentMethod"><option>check</option><option>GCash</option><option>bank</option></select></label>' +
      '<label>Recurring<select name="recurring"><option value="">No</option><option value="true"' + (editing && editing.recurring ? " selected" : "") + '>Yes, fixed amount</option></select></label>' +
      '<label>Fixed amount<input name="recurringAmount" value="' + esc(editing && editing.recurring_amount ? editing.recurring_amount : "") + '"></label><label>Due day<input name="dueDay" value="' + esc(editing && editing.due_day ? editing.due_day : "") + '" placeholder="1-31"></label></div><p class="err"></p><button class="btn pri" type="submit">' + (editing ? "Save bill" : "Add bill") + "</button></form>" +
      '<div class="bill-list">' + (pack.bills || []).map(function (bill) {
        return '<button class="btn" type="button" data-bill-edit="' + esc(bill.id) + '">' + esc(bill.biller) + " · " + esc(bill.bill_type || "type") + "</button>";
      }).join("") + "</div></details></section>"
    );
  }

  function field(root, name) {
    var input = root.querySelector('[data-bill-field="' + name + '"]');
    return input ? input.value : "";
  }

  function onClick(event, host) {
    var node = event.target && event.target.closest && event.target.closest("[data-bill-dark], [data-bill-mode], [data-bill-spend], [data-bill-group], [data-bill-open], [data-bill-close], [data-bill-act], [data-bill-edit]");
    if (!node) return false;
    var S = host.S;
    if (node.hasAttribute("data-bill-dark")) {
      S.billDark = !darkOn(S);
      try { window.localStorage.setItem("finance-bills-dark", S.billDark ? "1" : "0"); } catch (err) {}
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-mode")) {
      S.billMode = node.getAttribute("data-bill-mode");
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-spend")) {
      S.billSpendYear = node.getAttribute("data-bill-spend");
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-group")) {
      S.billGroup = node.getAttribute("data-bill-group");
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-edit")) {
      S.billEdit = node.getAttribute("data-bill-edit");
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-open")) {
      S.billOpen = node.getAttribute("data-bill-open");
      S.error = "";
      host.render();
      return true;
    }
    if (node.hasAttribute("data-bill-close")) {
      S.billOpen = "";
      host.render();
      return true;
    }
    var action = node.getAttribute("data-bill-act");
    if (!action || !S.billOpen) return true;
    var root = node.closest(".bill-detail") || document;
    var payload = { id: S.billOpen, action: action };
    if (action === "paid") {
      payload.paidDate = field(root, "paidDate");
      payload.paymentMethod = field(root, "paymentMethod");
      var linked = field(root, "paymentLink");
      if (linked) {
        var parts = linked.split("|");
        payload.paymentKind = parts[0];
        payload.paymentId = parts.slice(1).join("|");
      }
    }
    host.api("actChecklist", payload).then(function () {
      S.error = "";
      return host.refresh();
    }).catch(function (err) {
      S.error = err.message;
      host.render();
    });
    return true;
  }

  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    var key = el.getAttribute("data-bill-filter");
    var host = window.FinanceSheets && window.FinanceSheets._ctx;
    if (key && host) {
      host.S[key] = el.value;
      if (key === "billCategory") host.S.billItem = "all";
      host.S.error = "";
      host.refresh();
      return;
    }
    var receiptId = el.getAttribute("data-bill-receipt");
    if (!receiptId || !host || !el.files || !el.files[0]) return;
    var file = el.files[0];
    var reader = new FileReader();
    reader.onload = function () {
      var url = String(reader.result || "");
      var comma = url.indexOf(",");
      host.api("upload", {
        ownerKind: "checklist",
        ownerId: receiptId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        dataBase64: comma >= 0 ? url.slice(comma + 1) : url,
      }).then(function (res) {
        return host.api("actChecklist", { id: receiptId, action: "receipt", receiptPath: res.attachment && res.attachment.storage_path });
      }).then(function () {
        host.S.billOpen = receiptId;
        host.S.error = "";
        return host.refresh();
      }).catch(function (err) {
        host.S.error = err.message;
        host.render();
      });
    };
    reader.readAsDataURL(file);
  });

  window.FinanceBills = { onClick: onClick, render: render };
})();
