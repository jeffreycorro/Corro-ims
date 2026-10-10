(function () {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

  function compact(value) {
    var n = Number(value) || 0;
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(n);
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "k";
    return sign + String(Math.round(abs));
  }

  function pct(value) {
    if (value == null || value === "") return "—";
    var n = Number(value);
    if (n !== n) return "—";
    var text = String(Math.round(n * 10) / 10);
    if (n > 0) text = "+" + text;
    return text + "%";
  }

  function updatedLabel(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    try {
      return date.toLocaleString("en-US", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (err) {
      return String(iso);
    }
  }

  function ctx() {
    return window.FinanceSheets && window.FinanceSheets._ctx;
  }

  function badge(name, color) {
    return '<span class="bank-badge" style="background:' + esc(color || "#1b3048") + '">' + esc(name || "Bank") + "</span>";
  }

  function chartSvg(mon, mode, guides) {
    var rows = mode === "cumulative" ? mon.cumulative || [] : mode === "stack" ? mon.shown || [] : mon.shown || [];
    var w = 720;
    var h = 248;
    var padL = 16;
    var padR = 36;
    var padT = 28;
    var padB = 32;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var max = 1;
    rows.forEach(function (row) {
      if (mode === "cumulative") {
        max = Math.max(max, row.thisYear || 0, guides ? row.lastYear || 0 : 0);
      } else {
        max = Math.max(max, row.total || 0, guides && mode === "bars" ? row.lastYear || 0 : 0);
      }
    });
    if (guides && mode === "bars") max = Math.max(max, mon.average || 0);
    var n = Math.max(rows.length, 1);
    var gap = n > 8 ? 6 : 10;
    var bw = (innerW - gap * (n - 1)) / n;
    var parts = [];
    if (guides && mode === "bars" && mon.average) {
      var ay = padT + innerH - (mon.average / max) * innerH;
      parts.push('<line x1="' + padL + '" y1="' + ay + '" x2="' + (w - padR) + '" y2="' + ay + '" stroke="#8d2d2d" stroke-dasharray="5 4" stroke-width="1.5"></line>');
      parts.push('<text x="' + (w - 4) + '" y="' + (ay - 4) + '" text-anchor="end" font-size="10" fill="#8d2d2d">avg</text>');
    }
    rows.forEach(function (row, index) {
      var x = padL + index * (bw + gap);
      var monthNum = String(row.month || "").slice(5, 7) || String(index + 1).padStart(2, "0");
      if (mode === "cumulative") {
        return;
      }
      var total = row.total || 0;
      var bh = (total / max) * innerH;
      var y = padT + innerH - bh;
      parts.push('<rect data-check-bar="' + esc(monthNum) + '" x="' + x + '" y="' + padT + '" width="' + bw + '" height="' + innerH + '" fill="transparent"></rect>');
      if (mode === "stack") {
        var cursor = padT + innerH;
        (row.byBank || []).forEach(function (bank) {
          var sh = ((bank.amount || 0) / max) * innerH;
          cursor -= sh;
          parts.push('<rect x="' + x + '" y="' + cursor + '" width="' + bw + '" height="' + Math.max(sh, 0) + '" fill="' + esc(bank.color || "#1b3048") + '" pointer-events="none"></rect>');
        });
      } else {
        var fill = row.current ? "#b86a1b" : "#1b3048";
        parts.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(bh, 0) + '" fill="' + fill + '" rx="3" pointer-events="none"></rect>');
        if (guides && row.lastYear) {
          var ly = padT + innerH - (row.lastYear / max) * innerH;
          parts.push('<line x1="' + (x - 2) + '" y1="' + ly + '" x2="' + (x + bw + 2) + '" y2="' + ly + '" stroke="#5e584f" stroke-dasharray="3 3" stroke-width="2" pointer-events="none"></line>');
        }
        parts.push('<text x="' + (x + bw / 2) + '" y="' + Math.max(12, y - 4) + '" text-anchor="middle" font-size="11" fill="#1c1915" pointer-events="none">' + esc(compact(total)) + "</text>");
      }
      parts.push('<text x="' + (x + bw / 2) + '" y="' + (h - 10) + '" text-anchor="middle" font-size="11" fill="#5e584f" pointer-events="none">' + esc(row.label || "") + "</text>");
    });
    if (mode === "cumulative") {
      function line(key, color, dash) {
        var pts = rows.map(function (row, index) {
          var x = padL + index * (bw + gap) + bw / 2;
          var y = padT + innerH - ((row[key] || 0) / max) * innerH;
          return x + "," + y;
        }).join(" ");
        parts.push('<polyline fill="none" stroke="' + color + '" stroke-width="2.5" ' + (dash ? 'stroke-dasharray="5 4" ' : "") + 'points="' + pts + '"></polyline>');
      }
      line("thisYear", "#1b3048", false);
      if (guides) line("lastYear", "#b86a1b", true);
      rows.forEach(function (row, index) {
        var x = padL + index * (bw + gap) + bw / 2;
        parts.push('<text x="' + x + '" y="' + (h - 10) + '" text-anchor="middle" font-size="11" fill="#5e584f">' + esc(row.label || "") + "</text>");
      });
    }
    var title = mode === "cumulative" ? "Cumulative checks issued, this year and last year" : "Checks issued by month";
    return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + esc(title) + '"><title>' + esc(title) + "</title>" + parts.join("") + "</svg>";
  }

  function legend(mon) {
    var seen = {};
    var bits = [];
    (mon.shown || []).forEach(function (row) {
      (row.byBank || []).forEach(function (bank) {
        if (seen[bank.bank]) return;
        seen[bank.bank] = true;
        bits.push(badge(bank.bank, bank.color));
      });
    });
    return bits.length ? '<div class="row chk-legend">' + bits.join("") + "</div>" : "";
  }

  function detail(S, mon, pack) {
    if (!S.checkOpen) return "";
    var check = (pack.checks || []).find(function (row) { return row.id === S.checkOpen; });
    if (!check) return '<section class="card chk-detail" id="chk-detail"><p>That check is no longer on this list.</p><button class="btn" type="button" data-check-close>Close</button></section>';
    var bank = (pack.banks || []).find(function (row) { return row.id === check.bank_account_id; });
    var color = "#1b3048";
    (mon.banks || []).forEach(function (row) {
      if (row.id === check.bank_account_id) color = row.color;
    });
    var invoices = (pack.invoices || []).filter(function (row) { return row.check_id === check.id; });
    var status = String(check.status || "");
    var actions = "";
    if (status === "issued") actions += '<button class="btn" type="button" data-check-act="for signature">For signature</button>';
    if (status === "for signature") actions += '<button class="btn" type="button" data-check-act="ready">Ready for pickup</button>';
    if (status === "for signature" || status === "ready for pickup") {
      actions += '<label>Received by<input data-check-field="receivedBy" placeholder="Name"></label><label>Release date<input data-check-field="releaseDate" type="date" value="' + esc(mon.today || "") + '"></label><button class="btn pri" type="button" data-check-act="release">Release</button>';
    }
    if (status === "released" || status === "stale") {
      actions += '<label>Cleared on the statement<input data-check-field="clearedDate" type="date" value="' + esc(mon.today || "") + '"></label><button class="btn pri" type="button" data-check-act="clear">Mark cleared</button>';
    }
    if (status !== "cleared" && status !== "cancelled" && status !== "void") {
      actions += '<button class="btn" type="button" data-check-act="cancel">Cancel</button><button class="btn" type="button" data-check-act="void">Void</button>';
    }
    var photo = check.photo_href
      ? '<a href="' + esc(check.photo_href) + '" target="_blank" rel="noopener">Open photo</a><img class="chk-photo" alt="Photo of ' + esc(check.check_no) + '" src="' + esc(check.photo_href) + '">'
      : check.photo_url ? "<p>Photo on file.</p>" : "<p class=\"sub\">No photo yet.</p>";
    var invoiceRows = invoices.map(function (row) {
      return "<tr><td>" + esc(row.si_no) + "</td><td>" + esc(row.si_date) + "</td><td>" + esc(row.po_no) + "</td><td class=\"num\">" + peso(row.amount) + "</td></tr>";
    }).join("");
    return (
      '<section class="card chk-detail" id="chk-detail">' +
      '<div class="row"><h2>' + esc(check.check_no) + "</h2>" + badge(bank ? bank.nickname : "Bank", color) + '<span class="pill">' + esc(status) + '</span><button class="btn" type="button" data-check-close>Close</button></div>' +
      "<p>" + esc(check.payee) + " · " + peso(check.amount) + "</p>" +
      "<p class=\"sub\">Issued " + esc(check.date_issued || "—") + " · Check date " + esc(check.check_date || "—") +
      (check.release_date ? " · Released " + esc(check.release_date) + " to " + esc(check.received_by || "—") : "") +
      (check.cleared_date ? " · Cleared " + esc(check.cleared_date) : "") + "</p>" +
      (status === "stale" ? '<p class="sub">Stale: the check date is 180 days or more before today, and the bank has not cleared it. It can still be cleared or voided.</p>' : "") +
      '<div class="fields">' + actions + "</div>" +
      "<h3>Invoices</h3>" +
      '<div class="scroll"><table><thead><tr><th>SI</th><th>Date</th><th>PO</th><th>Amount</th></tr></thead><tbody>' +
      (invoiceRows || '<tr><td colspan="4">No invoices on this check.</td></tr>') + "</tbody></table></div>" +
      '<form data-sheet-form="saveCheckInvoice"><input type="hidden" name="checkId" value="' + esc(check.id) + '"><div class="fields"><label>SI no.<input name="siNo"></label><label>SI date<input name="siDate" type="date"></label><label>Amount<input name="amount" required></label><label>PO<input name="poNo"></label></div><p class="err"></p><button class="btn" type="submit">Add invoice</button></form>' +
      "<h3>Photo</h3>" + photo +
      '<label class="btn">Upload photo<input type="file" accept="image/*" data-check-photo="' + esc(check.id) + '" hidden></label>' +
      "</section>"
    );
  }

  function render(S) {
    var pack = S.sheet || {};
    var mon = pack.monitor;
    if (!mon) return '<p class="sub">Checks are still loading.</p>';
    var year = S.checkYear || String(mon.filters.year);
    var month = S.checkMonth || "all";
    var bank = S.checkBank || "all";
    var chart = S.checkChart || "bars";
    var guides = S.checkGuides !== false;
    var years = (mon.years || []).map(String);
    if (years.indexOf(String(year)) < 0) years.push(String(year));
    var yearOpts = years.map(function (item) {
      return '<option value="' + esc(item) + '"' + (String(item) === String(year) ? " selected" : "") + ">" + esc(item) + "</option>";
    }).join("");
    var monthOpts = '<option value="all"' + (month === "all" ? " selected" : "") + ">All</option>" + MONTHS.map(function (name, index) {
      var value = String(index + 1).padStart(2, "0");
      return '<option value="' + value + '"' + (month === value ? " selected" : "") + ">" + name.slice(0, 3) + "</option>";
    }).join("");
    var bankOpts = '<option value="all"' + (bank === "all" ? " selected" : "") + ">All</option>" + (mon.banks || []).map(function (row) {
      return '<option value="' + esc(row.id) + '"' + (bank === row.id ? " selected" : "") + ">" + esc(row.nickname) + "</option>";
    }).join("");
    var chips = mon.chips || {};
    var chip = function (value, label) {
      return '<div class="chk-chip"><b>' + value + "</b><span>" + esc(label) + "</span></div>";
    };
    var quarters = (chips.quarters || []).map(function (amount, index) {
      return chip(peso(amount), "Q" + (index + 1));
    }).join("");
    var days = (mon.due30 || []).map(function (day) {
      var rows = (day.checks || []).map(function (row) {
        return '<button class="chk-row" type="button" data-check-open="' + esc(row.id) + '">' + badge(row.bank, row.color) + '<span class="who">' + esc(row.payee) + '</span><span class="amt">' + peso(row.amount) + "</span></button>";
      }).join("");
      return '<article class="card chk-day' + (day.isToday ? " today" : "") + '"><header><b>' + esc(day.label) + "</b> <span>" + esc(day.weekday || "") + '</span><b class="amt">' + peso(day.total) + "</b></header>" +
        (rows || '<p class="sub">No checks</p>') + "</article>";
    }).join("");
    var monthsOpen = S.checkMonths || {};
    var months = (mon.outstandingMonths || []).map(function (row) {
      var open = !!monthsOpen[row.month];
      var banks = (row.banks || []).map(function (item) {
        var lines = (item.checks || []).map(function (check) {
          return '<button class="chk-row" type="button" data-check-open="' + esc(check.id) + '">' + badge(item.bank, item.color) + '<span class="who">' + esc(check.payee) + '</span><span class="amt">' + peso(check.amount) + "</span></button>";
        }).join("");
        return '<div class="chk-bank"><div class="row">' + badge(item.bank, item.color) + "<span>" + item.count + " · " + peso(item.amount) + "</span></div>" + lines + "</div>";
      }).join("");
      return '<button class="chk-month" type="button" data-check-expand="' + esc(row.month) + '"><span>' + esc(row.label) + "</span><span>" + row.count + ' checks</span><b>' + peso(row.amount) + '</b><span class="chk-bar-track"><span class="chk-bar-fill" style="width:' + Number(row.bar || 0) + '%"></span></span></button>' +
        (open ? '<div class="chk-break">' + banks + "</div>" : "");
    }).join("");
    var photos = (mon.photos || []).map(function (row) {
      var href = row.photo_href ? '<a href="' + esc(row.photo_href) + '" target="_blank" rel="noopener">' + esc(row.check_no) + "</a>" : esc(row.check_no);
      return "<li>" + badge(row.bank, row.color) + " " + href + " · " + esc(row.payee) + " · " + peso(row.amount) + "</li>";
    }).join("");
    var audit = "";
    if (S.checkAudit) {
      audit = S.checkAudit.length ? S.checkAudit.map(function (group) {
        var gaps = (group.gaps || []).map(function (gap) {
          var text = gap.numbers && gap.numbers.length ? gap.numbers.join(", ") : gap.from + "–" + gap.to + " (" + gap.count + " missing)";
          return "<li>" + esc(text) + "</li>";
        }).join("");
        return "<li><b>" + esc(group.bank) + "</b> booklet " + esc(group.bookletYear) + " · " + esc(group.from) + "–" + esc(group.to) + "<ul>" + gaps + "</ul></li>";
      }).join("") : "<li>No gaps in the booklet serials.</li>";
      audit = "<ul class=\"chk-audit\">" + audit + "</ul>";
    }
    var suppliers = (pack.suppliers || []).map(function (row) {
      return '<option value="' + esc(row.id) + '">' + esc(row.name) + "</option>";
    }).join("");
    var banks = (pack.banks || []).map(function (row) {
      return '<option value="' + esc(row.id) + '">' + esc(row.nickname) + "</option>";
    }).join("");
    return (
      '<section class="chk">' +
      '<div class="chk-banner"><div class="co">' + esc(mon.company) + '</div><div class="big">' + peso(mon.outstandingOnward) + '</div><div>Outstanding from this month onward</div></div>' +
      '<div class="chk-subbar"><span>Due today — end of ' + esc(mon.monthName) + "</span><b>" + peso(mon.dueThroughMonthEnd) + "</b></div>" +
      detail(S, mon, pack) +
      "<h2>CHECKS ISSUED</h2>" +
      '<div class="chk-filters"><label>Year<select data-check-filter="checkYear">' + yearOpts + '</select></label><label>Month<select data-check-filter="checkMonth">' + monthOpts + '</select></label><label>Bank<select data-check-filter="checkBank">' + bankOpts + "</select></label></div>" +
      '<div class="row">' +
      '<button class="btn' + (chart === "bars" ? " pri" : "") + '" type="button" data-check-chart="bars">Monthly bars</button>' +
      '<button class="btn' + (chart === "stack" ? " pri" : "") + '" type="button" data-check-chart="stack">Stacked by bank</button>' +
      '<button class="btn' + (chart === "cumulative" ? " pri" : "") + '" type="button" data-check-chart="cumulative">Cumulative</button>' +
      '<button class="btn" type="button" data-check-guides>' + (guides ? "Hide" : "Show") + " last-year & average lines</button></div>" +
      '<div class="chk-chart">' + chartSvg(mon, chart, guides) + "</div>" +
      (chart === "stack" ? legend(mon) : "") +
      (chart === "cumulative" ? '<p class="sub">Running total for the full year. Last year is the dashed line.</p>' : "") +
      '<p class="chk-total">Total shown <b>' + peso(mon.totalShown) + "</b></p>" +
      '<div class="chk-chips">' +
      chip(peso(chips.ytd), "YTD total") +
      chip(pct(chips.pctVsLastYear), "% vs last year") +
      chip(peso(chips.lastYearTotal), "Last year total") +
      quarters +
      chip(pct(chips.momPct), "MoM " + (chips.momLabel || "")) +
      "</div>" +
      "<h2>DUE NEXT 30 DAYS</h2>" +
      '<div class="chk-days">' + days + "</div>" +
      "<h2>Outstanding by month</h2>" +
      '<p class="sub">Earliest month through the furthest post-dated month. Open a month for the banks, then a row for the check.</p>' +
      (months || '<p class="sub">No outstanding checks.</p>') +
      '<details class="card chk-issue"><summary>Issue a check</summary>' +
      '<form data-sheet-form="saveCheck"><div class="fields"><label>Bank<select name="bankAccountId" required><option value="">Bank</option>' + banks + '</select></label>' +
      '<label>Check no.<input name="checkNo" placeholder="BPI2026-1000274146" required></label>' +
      '<label>Issued<input name="dateIssued" type="date"></label>' +
      '<label>Check date<input name="checkDate" type="date" required></label>' +
      '<label>Payee<input name="payee" required></label>' +
      '<label>Supplier<select name="supplierId"><option value="">Optional</option>' + suppliers + "</select></label>" +
      '<label>Amount<input name="amount" required></label>' +
      '<label>PO<input name="poRef"></label></div><p class="err"></p><button class="btn pri" type="submit">Issue check</button></form></details>' +
      '<footer class="chk-foot">' +
      '<div class="row"><button class="btn" type="button" data-check-audit>Run audit — find missing checks</button><button class="btn" type="button" data-check-refresh>Refresh</button><span class="sub">Updated ' + esc(updatedLabel(S.checkUpdated)) + "</span></div>" +
      audit +
      '<p class="sub">Excludes canceled checks & inter-bank transfers</p>' +
      '<p><a href="#chk-photos">Check photos</a></p>' +
      '<ul id="chk-photos">' + (photos || "<li>No check photos yet.</li>") + "</ul>" +
      "</footer></section>"
    );
  }

  function onClick(event, host) {
    var node = event.target && event.target.closest && event.target.closest("[data-check-chart], [data-check-guides], [data-check-bar], [data-check-open], [data-check-close], [data-check-expand], [data-check-act], [data-check-audit], [data-check-refresh]");
    if (!node) return false;
    var S = host.S;
    if (node.hasAttribute("data-check-chart")) {
      S.checkChart = node.getAttribute("data-check-chart");
      host.render();
      return true;
    }
    if (node.hasAttribute("data-check-guides")) {
      S.checkGuides = S.checkGuides === false;
      host.render();
      return true;
    }
    if (node.hasAttribute("data-check-bar")) {
      var picked = node.getAttribute("data-check-bar");
      S.checkMonth = S.checkMonth === picked ? "all" : picked;
      S.error = "";
      host.refresh();
      return true;
    }
    if (node.hasAttribute("data-check-open")) {
      S.checkOpen = node.getAttribute("data-check-open");
      S.error = "";
      host.render();
      setTimeout(function () {
        var panel = document.getElementById("chk-detail");
        if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
      }, 0);
      return true;
    }
    if (node.hasAttribute("data-check-close")) {
      S.checkOpen = "";
      host.render();
      return true;
    }
    if (node.hasAttribute("data-check-expand")) {
      var key = node.getAttribute("data-check-expand");
      S.checkMonths = S.checkMonths || {};
      S.checkMonths[key] = !S.checkMonths[key];
      host.render();
      return true;
    }
    if (node.hasAttribute("data-check-refresh")) {
      S.error = "";
      host.refresh();
      return true;
    }
    if (node.hasAttribute("data-check-audit")) {
      host.api("auditChecks", {}).then(function (res) {
        S.checkAudit = res.audit || [];
        S.error = "";
        host.render();
      }).catch(function (err) {
        S.error = err.message;
        host.render();
      });
      return true;
    }
    var action = node.getAttribute("data-check-act");
    if (!action || !S.checkOpen) return true;
    if ((action === "cancel" || action === "void") && !window.confirm("Mark this check " + action + "?")) return true;
    var root = node.closest(".chk-detail") || document;
    var payload = { id: S.checkOpen, action: action };
    var receiver = root.querySelector("[data-check-field=\"receivedBy\"]");
    var released = root.querySelector("[data-check-field=\"releaseDate\"]");
    var cleared = root.querySelector("[data-check-field=\"clearedDate\"]");
    if (receiver) payload.receivedBy = receiver.value;
    if (released) payload.releaseDate = released.value;
    if (cleared) payload.clearedDate = cleared.value;
    host.api("actCheck", payload).then(function () {
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
    var key = el.getAttribute("data-check-filter");
    var host = ctx();
    if (key && host) {
      host.S[key] = el.value;
      host.S.error = "";
      host.refresh();
      return;
    }
    var photoId = el.getAttribute("data-check-photo");
    if (!photoId || !host || !el.files || !el.files[0]) return;
    var file = el.files[0];
    var reader = new FileReader();
    reader.onload = function () {
      var url = String(reader.result || "");
      var comma = url.indexOf(",");
      host.api("upload", {
        ownerKind: "check",
        ownerId: photoId,
        filename: file.name,
        contentType: file.type || "image/jpeg",
        dataBase64: comma >= 0 ? url.slice(comma + 1) : url,
      }).then(function (res) {
        var path = res.attachment && res.attachment.storage_path;
        return host.api("actCheck", { id: photoId, action: "photo", photoUrl: path });
      }).then(function () {
        host.S.error = "";
        host.S.checkOpen = photoId;
        return host.refresh();
      }).catch(function (err) {
        host.S.error = err.message;
        host.render();
      });
    };
    reader.readAsDataURL(file);
  });

  window.FinanceChecks = { onClick: onClick, render: render };
})();
