"use strict";

/**
 * Fuel-reserve and parts-store stock.
 *
 * The stock card is driven by VRF ledger lines. fuel/purchases and
 * fuel/withdrawals stopped being written on 4 Sep 2026, so a new VRF never
 * moved those lists. Lots are AV fuel lines and real drum deliveries
 * (FUEL-BULK). Draws are FUEL RESERVE / FUEL-RES lines. A station fill
 * (FUEL-STN) is a cash purchase and is neither a lot nor a draw.
 *
 * Purchases and withdrawals are still read, but only for a VRF that has no
 * ledger line of that kind. A delivery that is already on the ledger is not
 * taken from the purchases list as well. Sheet number 5840 is ledger:5798
 * (AV, 860 L) and is not inserted again. VRF 5787 stays at the litres on
 * the ledger (1,940 L). Nothing here rewrites a stored row.
 *
 * fifoConsume is the existing oldest-litres-first rule. Parts issues use
 * the same rule per item. Nothing in this file writes a record.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StockFifo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var LITRE_UNIT = { l: 1, lt: 1, ltr: 1, liter: 1, litre: 1, liters: 1, litres: 1 };
  var STORE_SUPPLIER = "MOTORPOOL INVENTORY";
  var RESERVE_SUPPLIER = "FUEL RESERVE";

  function num(v) {
    if (v == null || String(v).trim() === "") return null;
    var n = parseFloat(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }
  function upper(v) {
    return String(v == null ? "" : v).trim().toUpperCase();
  }
  function isFuelCat(text) {
    return /^\s*fuel\s*[—–-]/i.test(text == null ? "" : text);
  }
  function isLitreUnit(unit) {
    return !!LITRE_UNIT[String(unit || "").trim().toLowerCase()];
  }
  function digits(vrf) {
    var d = String(vrf == null ? "" : vrf).replace(/\D/g, "");
    return d;
  }
  function dateKey(v) {
    var s = String(v || "");
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + m[2] + m[3];
    var t = Date.parse(s);
    if (isFinite(t)) return new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    return "00000000";
  }
  function closedLine(line) {
    if (!line || line.notBought) return true;
    var s = String(line.vstatus || line.status || "").trim().toLowerCase();
    return s === "cancelled" || s === "canceled" || s === "duplicate" ||
      s === "not bought" || s === "rejected" || s === "archived";
  }
  function liveReserve(reserve) {
    var s = String(reserve && reserve.status || "").trim().toLowerCase();
    return s === "approved" || s === "closed" || s === "flagged";
  }

  function workOf(line, header) {
    return upper((line && line.work) || (header && header.work));
  }
  function vehOf(line, header) {
    return upper((line && line.veh) || (header && header.veh));
  }
  function supplierOf(line) {
    return upper(line && line.supplier);
  }
  function fuelish(line, header) {
    var work = workOf(line, header);
    return isFuelCat(line && line.cat) || work === "FUEL-RES" || work === "FUEL-STN" || work === "FUEL-BULK";
  }

  /* drum-in | drum-out | station | store-in | store-out | other */
  function lineRole(line, header) {
    line = line || {};
    var work = workOf(line, header);
    var sup = supplierOf(line);
    var veh = vehOf(line, header);
    var fuel = fuelish(line, header);
    var reserveDraw = sup === RESERVE_SUPPLIER || work === "FUEL-RES";
    var station = work === "FUEL-STN";
    var bulk = work === "FUEL-BULK";
    if (fuel && bulk) return "drum-in";
    if (fuel && reserveDraw) return "drum-out";
    if (fuel && veh === "AV") return "drum-in";
    if (fuel && station) return "station";
    if (fuel && sup && sup !== RESERVE_SUPPLIER && veh !== "AV") return "station";
    if (!fuel && sup === STORE_SUPPLIER) return "store-out";
    if (!fuel && (veh === "AV" || work === "STOCK") && sup !== STORE_SUPPLIER) return "store-in";
    return "other";
  }

  function reserveRole(reserve) {
    if (!reserve) return "other";
    var work = upper(reserve.work);
    var kind = String(reserve.kind || "");
    var veh = upper(reserve.veh);
    if (work === "FUEL-STN" || kind === "job" && work === "FUEL-STN") return "station";
    if (work === "FUEL-STN") return "station";
    if (work === "FUEL-RES" || kind === "fuel-issue") {
      if (work === "FUEL-BULK") return "drum-in";
      if (work === "FUEL-STN") return "station";
      return "drum-out";
    }
    if (work === "FUEL-BULK") return "drum-in";
    if (kind === "fuel-bulk" && veh === "AV") return "drum-in";
    if (kind === "fuel-bulk") return "station";
    if (veh === "AV" && isFuelCat(reserve.cat)) return "drum-in";
    return "other";
  }

  function priceInputMode(line, header) {
    var role = lineRole(line, header);
    if (role === "drum-out" || role === "store-out") return "auto";
    if (role === "drum-in" || role === "store-in") return "required";
    return "enter";
  }

  function missingPrice(line, header) {
    if (priceInputMode(line, header) !== "required") return false;
    if (!line || !String(line.cat || line.item || "").trim()) return false;
    var price = num(line.price);
    return !(price > 0);
  }

  /**
   * Litres on a fuel line. A litre unit uses qty. A drum line whose unit was
   * left blank or "pc" still counts when qty × a per-litre price matches the
   * total. qty 1 at a peso lump (5787, a ₱400 station line) does not.
   * This does not change the stored unit.
   */
  function fuelLineLitres(line, role) {
    line = line || {};
    if (isLitreUnit(line.unit)) {
      var qUnit = num(line.qty);
      if (qUnit != null && qUnit > 0) return qUnit;
    }
    var named = line.liters != null && line.liters !== "" ? num(line.liters) : null;
    if (named != null && named > 0 && (isLitreUnit(line.unit) || role === "drum-in" || role === "drum-out")) {
      if (isLitreUnit(line.unit) || (line.liters !== "" && line.liters != null && !isReserveHeader(line))) return named;
    }
    if (role !== "drum-in" && role !== "drum-out") return 0;
    var qty = num(line.qty);
    var price = num(line.price);
    if (price == null) price = num(line.pricePerL);
    var total = num(line.total);
    if (qty != null && qty > 1 && price != null && price >= 40 && price <= 200) {
      if (total == null || Math.abs(qty * price - total) <= 1.01) return qty;
    }
    var asked = num(line.litres);
    if ((qty == null || qty <= 0) && asked != null && asked > 0) return asked;
    return 0;
  }
  function isReserveHeader(line) {
    return line.draftLines != null || (line.litres != null && line.qty == null && line.liters == null);
  }

  function qtyLooksLikePesos(line) {
    line = line || {};
    var fuel = fuelish(line);
    if (!fuel) return { flag: false, label: "" };
    var qty = num(line.qty);
    var price = num(line.price);
    if (qty === 1 && price != null && price >= 200) {
      return {
        flag: true,
        label: "Quantity is 1 and the price looks like a peso total. Enter the litres. A delivery also needs the price per litre."
      };
    }
    if (!isLitreUnit(line.unit) && qty != null && qty >= 500) {
      return {
        flag: true,
        label: "This quantity looks like pesos. Fuel lines are in litres."
      };
    }
    if (qty != null && qty >= 3000) {
      return {
        flag: true,
        label: "This quantity looks like pesos. Enter the litres, not the peso amount."
      };
    }
    return { flag: false, label: "" };
  }

  function lotRate(line, litres) {
    var total = num(line.total);
    var price = num(line.price);
    if (price == null) price = num(line.pricePerL);
    if (litres > 0 && total != null && total > 0 && (price == null || price > 500)) return total / litres;
    if (price != null && price > 0 && price <= 500) return price;
    if (litres > 0 && total != null && total > 0) return total / litres;
    return 0;
  }

  function emptyBook() {
    return { lots: [], draws: [] };
  }

  function fuelMovements(src) {
    src = src || {};
    var lots = [];
    var lotMap = {};
    var draws = [];
    var drawMap = {};

    function lotId(vrf, date) {
      return digits(vrf) || ("d-" + dateKey(date));
    }
    function drawId(vrf, date, veh) {
      return digits(vrf) || ("w-" + dateKey(date) + "-" + upper(veh));
    }
    function addLot(id, partial) {
      if (!lotMap[id]) {
        lotMap[id] = {
          id: id, vrf: partial.vrf || "", date: partial.date || "",
          liters: 0, value: 0, rate: 0, total: 0,
          source: partial.source || "", seenLedger: false, supplier: partial.supplier || ""
        };
        lots.push(lotMap[id]);
      }
      var lot = lotMap[id];
      if (partial.seenLedger) lot.seenLedger = true;
      if (partial.reserveNo != null && String(partial.reserveNo) !== "") lot.reserveNo = partial.reserveNo;
      if (partial.ledgerTotal > 0) lot.ledgerTotal = partial.ledgerTotal;
      if (partial.date && (!lot.date || dateKey(partial.date) < dateKey(lot.date))) lot.date = partial.date;
      if (partial.source && !lot.source) lot.source = partial.source;
      if (!(partial.liters > 0)) return lot;
      lot.value += partial.liters * (partial.rate || 0);
      lot.liters += partial.liters;
      lot.total = lot.value;
      lot.rate = lot.liters ? lot.value / lot.liters : 0;
      lot.pricePerL = lot.rate;
      return lot;
    }
    function addDraw(id, partial) {
      if (!drawMap[id]) {
        drawMap[id] = {
          id: id, vrf: partial.vrf || "", date: partial.date || "",
          liters: 0, vehicle: partial.vehicle || "", source: partial.source || "",
          fromLedger: false, reserve: partial.reserve || ""
        };
        draws.push(drawMap[id]);
      }
      var draw = drawMap[id];
      if (partial.fromLedger) draw.fromLedger = true;
      if (partial.date && (!draw.date || dateKey(partial.date) < dateKey(draw.date))) draw.date = partial.date;
      if (!(partial.liters > 0)) return draw;
      /* The same VRF is sometimes stored twice (an open hold and the closed line).
         A second line with a different litre amount is a real extra line. */
      if (partial.fromLedger && draw.fromLedger && Math.abs(draw.liters - partial.liters) < 0.05) return draw;
      draw.liters += partial.liters;
      return draw;
    }

    (src.lines || []).forEach(function (line) {
      if (!line || closedLine(line)) return;
      var role = lineRole(line);
      var id = lotId(line.vrf, line.date);
      if (role === "drum-in") {
        var litres = fuelLineLitres(line, "drum-in");
        addLot(id, {
          vrf: line.vrf, date: line.date, liters: litres, rate: lotRate(line, litres),
          source: "ledger", seenLedger: true, supplier: line.supplier || "",
          ledgerTotal: num(line.total) || 0
        });
      } else if (role === "drum-out") {
        var outL = fuelLineLitres(line, "drum-out");
        addDraw(drawId(line.vrf, line.date, line.veh), {
          vrf: line.vrf, date: line.date, liters: outL, vehicle: line.veh || "",
          source: "ledger", fromLedger: true, reserve: line.reserve || ""
        });
      }
    });

    (src.reserves || []).forEach(function (reserve) {
      if (!reserve || !liveReserve(reserve) || closedLine(reserve)) return;
      var role = reserveRole(reserve);
      var vrf = reserve.vrfNo || reserve.vrf || "";
      if (role === "drum-in") {
        var id = lotId(vrf, reserve.date);
        if (lotMap[id] && lotMap[id].seenLedger) return;
        var litres = fuelLineLitres(reserve, "drum-in");
        if (!(litres > 0) && reserve.draftLines) {
          (reserve.draftLines || []).forEach(function (line) {
            if (line && lineRole(line, reserve) === "drum-in") litres += fuelLineLitres(line, "drum-in");
          });
        }
        addLot(id, {
          vrf: vrf, date: reserve.date, liters: litres, reserveNo: reserve.no,
          rate: lotRate({ price: reserve.pricePerL, total: reserve.budget, pricePerL: reserve.pricePerL }, litres),
          source: "reserve", seenLedger: false
        });
      } else if (role === "drum-out") {
        var did = drawId(vrf, reserve.date, reserve.veh);
        if (drawMap[did] && drawMap[did].fromLedger && drawMap[did].liters > 0) return;
        var outL = fuelLineLitres(reserve, "drum-out");
        addDraw(did, {
          vrf: vrf, date: reserve.date, liters: drawMap[did] && drawMap[did].liters > 0 ? 0 : outL,
          vehicle: reserve.veh || "", source: "reserve", fromLedger: false, reserve: reserve.no || ""
        });
      }
    });

    (src.purchases || []).forEach(function (row) {
      if (!row) return;
      var id = lotId(row.vrf, row.date);
      if (lotMap[id] && lotMap[id].seenLedger) return;
      var litres = num(row.liters);
      if (litres == null) litres = num(row.litres);
      if (!(litres > 0)) return;
      var rate = num(row.pricePerL);
      if (!(rate > 0) && num(row.total) > 0) rate = num(row.total) / litres;
      addLot(id, {
        vrf: row.vrf, date: row.date, liters: litres, rate: rate || 0,
        source: "purchases", seenLedger: false, supplier: row.supplier || ""
      });
    });

    (src.withdrawals || []).forEach(function (row) {
      if (!row) return;
      var id = drawId(row.vrf, row.date, row.vehicle || row.veh);
      if (drawMap[id] && drawMap[id].liters > 0) return;
      var litres = num(row.liters);
      if (litres == null) litres = num(row.litres);
      if (!(litres > 0)) return;
      if (drawMap[id]) {
        drawMap[id].liters += litres;
        if (!drawMap[id].date) drawMap[id].date = row.date || "";
        return;
      }
      addDraw(id, {
        vrf: row.vrf, date: row.date, liters: litres,
        vehicle: row.vehicle || row.veh || "", source: "withdrawals", fromLedger: false
      });
    });

    var outLots = lots.filter(function (lot) { return lot.liters > 0; });
    var outDraws = draws.filter(function (draw) { return draw.liters > 0; });
    return { lots: outLots, draws: outDraws };
  }

  function fifoConsume(lotsIn, drawsIn) {
    var lots = (lotsIn || []).slice().filter(function (p) { return p && p.liters > 0; })
      .sort(function (a, b) { return dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0; })
      .map(function (p) {
        var rate = p.pricePerL || p.rate || ((p.total && p.liters) ? p.total / p.liters : 0) || 0;
        return { date: p.date, left: p.liters, rate: rate, vrf: p.vrf, liters: p.liters, source: p.source || "" };
      });
    var draws = (drawsIn || []).slice().filter(function (w) { return w && w.liters > 0; })
      .sort(function (a, b) { return dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0; });
    var li = 0, costed = [], short = 0;
    draws.forEach(function (w) {
      var need = w.liters, cost = 0;
      while (need > 0.0001 && li < lots.length) {
        if (lots[li].left <= 0.0001) { li += 1; continue; }
        var take = Math.min(need, lots[li].left);
        cost += take * lots[li].rate;
        lots[li].left -= take;
        need -= take;
      }
      if (need > 0.0001) short += need;
      costed.push(Object.assign({}, w, { fifoCost: cost, fifoRate: w.liters ? cost / w.liters : 0 }));
    });
    var onHand = 0, onHandValue = 0, purchasedL = 0, purchasedValue = 0;
    lots.forEach(function (l) {
      onHand += l.left;
      onHandValue += l.left * l.rate;
      purchasedL += l.liters || 0;
      purchasedValue += (l.liters || 0) * (l.rate || 0);
    });
    var consumedL = 0, costOfUse = 0;
    costed.forEach(function (d) { consumedL += d.liters || 0; costOfUse += d.fifoCost || 0; });
    return {
      lots: lots, draws: costed, onHand: onHand, onHandValue: onHandValue, shortfall: short,
      purchasedL: purchasedL, purchasedValue: purchasedValue, consumedL: consumedL, costOfUse: costOfUse
    };
  }

  function consumeQuote(lots, litres) {
    var quote = quoteFromRemaining(lots, litres);
    var need = num(litres) || 0;
    var i = 0;
    while (need > 0.0001 && i < (lots || []).length) {
      var left = lots[i].left != null ? lots[i].left : (num(lots[i].liters) || 0);
      if (left <= 0.0001) { i += 1; continue; }
      var take = Math.min(need, left);
      lots[i].left = left - take;
      need -= take;
    }
    return quote;
  }

  function quoteFromRemaining(lots, litres) {
    var asked = num(litres) || 0;
    var need = asked;
    var cost = 0;
    var i = 0;
    var copy = (lots || []).map(function (lot) {
      var left = lot.left != null ? lot.left : (num(lot.liters) || 0);
      var rate = lot.rate || lot.pricePerL || 0;
      return { left: left, rate: rate };
    });
    while (need > 0.0001 && i < copy.length) {
      if (copy[i].left <= 0.0001) { i += 1; continue; }
      var take = Math.min(need, copy[i].left);
      cost += take * copy[i].rate;
      copy[i].left -= take;
      need -= take;
    }
    var shortfall = need > 0.0001 ? need : 0;
    return { cost: cost, rate: asked > 0 ? cost / asked : 0, shortfall: shortfall, covered: asked - shortfall };
  }

  function blended(cost, litres) {
    var L = num(litres) || 0;
    var total = Math.round((num(cost) || 0) * 100) / 100;
    if (!(L > 0)) return { price: 0, total: 0 };
    var raw = total / L;
    var p4 = Math.round(raw * 10000) / 10000;
    var price = Math.round(p4 * L * 100) === Math.round(total * 100) ? p4 : raw;
    return { price: price, total: Math.round(price * L * 100) / 100 };
  }

  function valueRemaining(receipts, outQty) {
    var lots = (receipts || []).slice().sort(function (a, b) {
      return dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0;
    }).map(function (row) {
      var qty = num(row.qty) || 0;
      var total = num(row.total);
      var price = num(row.price);
      var rate = qty > 0 && total != null ? total / qty : (price || 0);
      return { left: qty, rate: rate };
    });
    var need = num(outQty) || 0;
    var i = 0;
    while (need > 0.0001 && i < lots.length) {
      if (lots[i].left <= 0.0001) { i += 1; continue; }
      var take = Math.min(need, lots[i].left);
      lots[i].left -= take;
      need -= take;
    }
    var leftQty = 0, leftVal = 0, nextRate = null;
    lots.forEach(function (lot) {
      if (lot.left > 0.0001) {
        if (nextRate == null) nextRate = lot.rate;
        leftQty += lot.left;
        leftVal += lot.left * lot.rate;
      }
    });
    return {
      qty: leftQty,
      value: leftVal,
      rate: leftQty > 0 ? leftVal / leftQty : null,
      nextRate: nextRate
    };
  }

  function quoteStore(lines, keyFn, key, qty, alreadyQty) {
    var receipts = [];
    var issued = num(alreadyQty) || 0;
    (lines || []).forEach(function (row) {
      if (!row || closedLine(row)) return;
      if (keyFn(row) !== key) return;
      var role = lineRole(row);
      if (role === "store-in") receipts.push(row);
      else if (role === "store-out") issued += num(row.qty) || 0;
    });
    var remain = valueRemaining(receipts, issued);
    var lots = [];
    var sorted = receipts.slice().sort(function (a, b) {
      return dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0;
    });
    var skip = issued;
    sorted.forEach(function (row) {
      var q = num(row.qty) || 0;
      var total = num(row.total);
      var price = num(row.price);
      var rate = q > 0 && total != null ? total / q : (price || 0);
      var left = q;
      if (skip > 0) {
        var use = Math.min(skip, left);
        left -= use;
        skip -= use;
      }
      if (left > 0.0001) lots.push({ left: left, rate: rate });
    });
    var quote = quoteFromRemaining(lots, qty);
    quote.remaining = remain;
    return quote;
  }

  function inventorySummary(lines, keyFn) {
    var groups = {};
    (lines || []).forEach(function (row) {
      if (!row || closedLine(row)) return;
      var role = lineRole(row);
      if (role !== "store-in" && role !== "store-out") return;
      var key = keyFn(row);
      if (!groups[key]) {
        groups[key] = {
          key: key, cat: row.cat || "", item: row.item || "",
          inQty: 0, outQty: 0, inValue: 0, receipts: []
        };
      }
      var g = groups[key];
      var q = num(row.qty) || 0;
      if (role === "store-in") {
        g.inQty += q;
        g.inValue += num(row.total) || 0;
        g.receipts.push(row);
      } else {
        g.outQty += q;
      }
    });
    return Object.keys(groups).map(function (key) {
      var g = groups[key];
      var fifo = valueRemaining(g.receipts, g.outQty);
      g.onHand = g.inQty - g.outQty;
      g.onHandValue = g.onHand > 0 ? fifo.value : 0;
      g.fifoRate = fifo.rate;
      g.nextRate = fifo.nextRate;
      return g;
    }).sort(function (a, b) { return (b.onHandValue || 0) - (a.onHandValue || 0); });
  }

  return {
    isFuelCat: isFuelCat,
    isLitreUnit: isLitreUnit,
    lineRole: lineRole,
    reserveRole: reserveRole,
    priceInputMode: priceInputMode,
    missingPrice: missingPrice,
    fuelLineLitres: fuelLineLitres,
    qtyLooksLikePesos: qtyLooksLikePesos,
    fuelMovements: fuelMovements,
    fifoConsume: fifoConsume,
    quoteFromRemaining: quoteFromRemaining,
    consumeQuote: consumeQuote,
    blended: blended,
    valueRemaining: valueRemaining,
    quoteStore: quoteStore,
    inventorySummary: inventorySummary
  };
});
