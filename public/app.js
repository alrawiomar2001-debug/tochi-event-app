(function () {
  "use strict";

  var CATEGORIES = {
    wedding: { label: "Wedding", color: "var(--cat-wedding)" },
    engagement: { label: "Engagement", color: "var(--cat-engagement)" },
    birthday: { label: "Birthday", color: "var(--cat-birthday)" },
    baby_welcoming: { label: "Baby welcoming", color: "var(--cat-baby)" },
  };
  var EXPENSE_CATEGORIES = ["Venue & décor", "Staffing", "Transport", "Item purchase/repair", "Marketing", "Other"];
  var CURRENCY = "IQD";

  var token = localStorage.getItem("tochi_token") || null;
  var currentUser = null;
  var state = { items: [], appointments: [], events: [], expenses: [], team: [] };
  var overviewRange = "month";
  var apptFilters = { category: "", status: "" };

  // ---------------- utils ----------------
  function fmtMoney(n) {
    n = Math.round(Number(n) || 0);
    return CURRENCY + " " + n.toLocaleString("en-US");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function catLabel(c) { return (CATEGORIES[c] && CATEGORIES[c].label) || c || "—"; }
  function catColor(c) { return (CATEGORIES[c] && CATEGORIES[c].color) || "var(--text-muted)"; }
  function catPill(c) { return '<span class="pill cat" style="background:' + catColor(c) + '">' + escapeHtml(catLabel(c)) + "</span>"; }
  function toast(msg) {
    var wrap = document.getElementById("toastWrap");
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function monthKey(d) { var dt = new Date(d); return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0"); }
  function isThisMonth(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr), now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  // ---------------- theme ----------------
  function currentTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyThemeIcon() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    var dark = currentTheme() === "dark";
    btn.textContent = dark ? "☀️" : "🌙";
    btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tochi_theme", next); } catch (e) {}
    applyThemeIcon();
  }

  // ---------------- API ----------------
  async function api(method, url, body) {
    var headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    var res = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401) doLogout();
      var err = new Error((data && data.error) || "Something went wrong.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------- auth ----------------
  function doLogout() {
    token = null; currentUser = null;
    localStorage.removeItem("tochi_token");
    document.getElementById("app").hidden = true;
    document.getElementById("loginScreen").hidden = false;
  }

  async function boot() {
    document.getElementById("loginForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = document.getElementById("loginEmail").value.trim();
      var password = document.getElementById("loginPassword").value;
      var errBox = document.getElementById("loginError");
      errBox.hidden = true;
      try {
        var res = await api("POST", "/api/auth/login", { email: email, password: password });
        token = res.token;
        localStorage.setItem("tochi_token", token);
        await startApp();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });

    document.getElementById("logoutBtn").addEventListener("click", doLogout);
    document.getElementById("themeToggle").addEventListener("click", toggleTheme);
    applyThemeIcon();

    if (token) {
      try { await startApp(); } catch (e) { doLogout(); }
    }
  }

  async function startApp() {
    var res = await api("GET", "/api/auth/me");
    currentUser = res.user;
    document.getElementById("loginScreen").hidden = true;
    document.getElementById("app").hidden = false;

    var isOwner = currentUser.role === "owner";
    document.getElementById("viewerName").textContent = currentUser.name || "You";
    var pill = document.getElementById("rolePill");
    pill.textContent = isOwner ? "Owner" : "Staff";
    pill.className = "role-pill " + (isOwner ? "owner" : "staff");
    document.getElementById("expensesLock").hidden = isOwner;
    document.getElementById("teamLock").hidden = isOwner;
    document.getElementById("addExpenseBtn").hidden = !isOwner;
    document.getElementById("addTeamBtn").hidden = !isOwner;

    wireStaticUI();
    await loadAll();
    renderAll();
  }

  async function loadAll() {
    var isOwner = currentUser.role === "owner";
    var calls = [
      api("GET", "/api/items").then(function (r) { state.items = r.items; }),
      api("GET", "/api/appointments").then(function (r) {
        state.appointments = r.items.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
      }),
      api("GET", "/api/events").then(function (r) {
        state.events = r.items.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      }),
    ];
    if (isOwner) {
      calls.push(api("GET", "/api/expenses").then(function (r) {
        state.expenses = r.items.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      }));
      calls.push(api("GET", "/api/auth/team").then(function (r) { state.team = r.team; }));
    }
    await Promise.all(calls);
  }

  function renderAll() {
    renderOverview(); renderItems(); renderAppointments(); renderEvents(); renderExpenses(); renderTeam();
  }

  // ---------------- tabs & static UI ----------------
  function wireStaticUI() {
    document.getElementById("tabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      var name = btn.dataset.tab;
      document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    });

    document.getElementById("rangeToggle").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-range]");
      if (!btn) return;
      overviewRange = btn.dataset.range;
      document.querySelectorAll("#rangeToggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      renderOverview();
    });

    var catSelect = document.getElementById("apptCategoryFilter");
    Object.keys(CATEGORIES).forEach(function (k) {
      var o = document.createElement("option"); o.value = k; o.textContent = CATEGORIES[k].label;
      catSelect.appendChild(o);
    });
    catSelect.addEventListener("change", function () { apptFilters.category = catSelect.value; renderAppointments(); });
    document.getElementById("apptStatusFilter").addEventListener("change", function (e) { apptFilters.status = e.target.value; renderAppointments(); });

    document.getElementById("addItemBtn").addEventListener("click", function () { openItemModal(null); });
    document.getElementById("addApptBtn").addEventListener("click", function () { openApptModal(null); });
    document.getElementById("addEventBtn").addEventListener("click", function () { openEventModal(null, null); });
    document.getElementById("addExpenseBtn").addEventListener("click", function () { openExpenseModal(null); });
    document.getElementById("addTeamBtn").addEventListener("click", function () { openTeamModal(); });
  }

  // ---------------- OVERVIEW ----------------
  function eventsInRange(range) { return state.events.filter(function (e) { return range === "all" ? true : isThisMonth(e.date); }); }
  function expensesInRange(range) { return state.expenses.filter(function (e) { return range === "all" ? true : isThisMonth(e.date); }); }

  function renderOverview() {
    var isOwner = currentUser.role === "owner";
    var events = eventsInRange(overviewRange);
    var revenue = events.reduce(function (s, x) { return s + (Number(x.totalAmount) || 0); }, 0);
    var upcoming = state.appointments.filter(function (a) { return a.date >= todayStr() && a.status !== "cancelled" && a.status !== "completed"; }).length;
    var lowStock = state.items.filter(function (i) { var q = Number(i.qtyAvailable) || 0, r = Number(i.reorderLevel) || 2; return q <= r; }).length;

    var kpis = [
      { label: "Revenue (" + (overviewRange === "all" ? "all time" : "this month") + ")", value: fmtMoney(revenue), sub: events.length + " event" + (events.length === 1 ? "" : "s") },
      { label: "Upcoming appointments", value: String(upcoming), sub: state.appointments.length + " total on file" },
      { label: "Items to reorder", value: String(lowStock), sub: state.items.length + " items tracked" },
    ];
    var html = kpis.map(function (k) {
      return '<div class="card kpi"><div class="label">' + escapeHtml(k.label) + '</div><div class="value">' + k.value + '</div><div class="sub">' + escapeHtml(k.sub) + "</div></div>";
    }).join("");

    if (isOwner) {
      var expenses = expensesInRange(overviewRange).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
      var profit = revenue - expenses;
      var margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
      html += '<div class="card kpi"><div class="label">Expenses</div><div class="value">' + fmtMoney(expenses) + '</div><div class="sub">' + (overviewRange === "all" ? "all time" : "this month") + "</div></div>";
      html += '<div class="card kpi"><div class="label">Profit</div><div class="value" style="color:' + (profit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(profit) + '</div><div class="sub">' + margin + "% margin</div></div>";
    } else {
      html += '<div class="card kpi locked"><div class="glyph">🔒</div><div><div class="label" style="margin-bottom:2px">Profit &amp; expenses</div><div class="sub">Owner access only</div></div></div>';
    }
    document.getElementById("kpiGrid").innerHTML = html;

    renderCatChart(events);
    renderTrendChart();
    renderActivity();
  }

  function renderCatChart(events) {
    var totals = {};
    Object.keys(CATEGORIES).forEach(function (k) { totals[k] = 0; });
    events.forEach(function (e) { if (totals[e.category] != null) totals[e.category] += Number(e.totalAmount) || 0; });
    var max = Math.max.apply(null, Object.values(totals).concat([1]));
    var el = document.getElementById("catChart");
    if (events.length === 0) {
      el.innerHTML = '<div class="empty" style="padding:16px 4px"><div class="glyph">📊</div><p>No events logged for this range yet.</p></div>';
      return;
    }
    el.innerHTML = Object.keys(CATEGORIES).map(function (k) {
      var v = totals[k], pct = Math.max(2, Math.round((v / max) * 100));
      return '<div class="bar-row"><div class="cat-label"><span class="dot" style="background:' + catColor(k) + '"></span>' + escapeHtml(CATEGORIES[k].label) + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + "%;background:" + catColor(k) + '"></div></div>' +
        '<div class="bar-val mono">' + fmtMoney(v) + "</div></div>";
    }).join("");
  }

  function renderTrendChart() {
    var months = [], now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleString("en-US", { month: "short" }) });
    }
    var totals = months.map(function (m) {
      return state.events.filter(function (e) { return monthKey(e.date || "1970-01-01") === m.key; }).reduce(function (s, x) { return s + (Number(x.totalAmount) || 0); }, 0);
    });
    var max = Math.max.apply(null, totals.concat([1]));
    var w = 320, h = 100, pad = 8;
    var stepX = (w - pad * 2) / (months.length - 1);
    var pts = totals.map(function (v, i) { return [pad + i * stepX, h - pad - (v / max) * (h - pad * 2)]; });
    var path = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    var area = path + " L" + pts[pts.length - 1][0].toFixed(1) + "," + (h - pad) + " L" + pts[0][0].toFixed(1) + "," + (h - pad) + " Z";
    var svg = '<svg viewBox="0 0 ' + w + " " + (h + 20) + '" width="100%" style="max-width:360px;display:block" role="img" aria-label="Revenue trend, last 6 months">' +
      '<path d="' + area + '" fill="var(--primary)" opacity="0.14"></path>' +
      '<path d="' + path + '" fill="none" stroke="var(--primary)" stroke-width="2"></path>' +
      pts.map(function (p, i) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === pts.length - 1 ? 3.5 : 2.2) + '" fill="var(--primary)"></circle>'; }).join("") +
      months.map(function (m, i) { return '<text x="' + pts[i][0].toFixed(1) + '" y="' + (h + 14) + '" font-size="9" fill="var(--text-muted)" text-anchor="middle" font-family="Manrope">' + m.label + "</text>"; }).join("") +
      "</svg>";
    document.getElementById("trendChart").innerHTML = svg;
  }

  function renderActivity() {
    var items = [];
    state.events.slice(0, 6).forEach(function (e) { items.push({ date: e.date, icon: "🎉", text: (e.clientName || "Client") + " · " + fmtMoney(e.totalAmount) + " · " + catLabel(e.category) }); });
    state.appointments.slice(-6).forEach(function (a) { items.push({ date: a.date, icon: "📅", text: (a.clientName || "Client") + " · " + catLabel(a.category) + " · " + (a.status || "pending") }); });
    items.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    items = items.slice(0, 6);
    var el = document.getElementById("activityList");
    if (items.length === 0) { el.innerHTML = '<div class="empty"><div class="glyph">✨</div><h3>Nothing logged yet</h3><p>Add an item, appointment or event to see activity here.</p></div>'; return; }
    el.innerHTML = items.map(function (i) { return '<div class="activity-item"><span class="ic">' + i.icon + '</span><span style="flex:1">' + escapeHtml(i.text) + '</span><span class="meta">' + escapeHtml(i.date || "") + "</span></div>"; }).join("");
  }

  // ---------------- ITEMS ----------------
  function itemStatus(i) {
    var q = Number(i.qtyAvailable) || 0, r = Number(i.reorderLevel) || 2;
    if (q <= 0) return { key: "out", label: "Out of stock" };
    if (q <= r) return { key: "low", label: "Low stock" };
    return { key: "instock", label: "In stock" };
  }

  function renderItems() {
    var wrap = document.getElementById("itemsTableWrap");
    if (state.items.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">📦</div><h3>No items yet</h3><p>Add décor, furniture or supplies to start tracking stock.</p><button class="btn primary sm" id="emptyAddItem" type="button">+ Add item</button></div>';
      document.getElementById("emptyAddItem").addEventListener("click", function () { openItemModal(null); });
      return;
    }
    var rows = state.items.slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); }).map(function (i) {
      var st = itemStatus(i);
      return "<tr><td>" + escapeHtml(i.name || "—") + "</td><td>" + catPill(i.category) + '</td><td class="num">' + (i.qtyAvailable ?? 0) + " / " + (i.qtyTotal ?? 0) + '</td><td class="num">' + fmtMoney(i.unitPrice) + '</td><td><span class="pill status-' + st.key + '">' + st.label + '</span></td><td><div class="row-actions"><button class="icon-btn" data-edit="' + i.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + i.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>Item</th><th>Category</th><th>Available / total</th><th>Unit price</th><th>Status</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openItemModal(state.items.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("items", b.dataset.del, "item"); }); });
  }

  function openItemModal(item) {
    var isEdit = !!item;
    item = item || { name: "", category: "wedding", qtyAvailable: 1, qtyTotal: 1, reorderLevel: 2, unitCost: 0, unitPrice: 0 };
    var body = field("Item name", '<input type="text" id="f_name" value="' + escapeHtml(item.name) + '" placeholder="e.g. Gold Chiavari chairs">') +
      field("Event type", categorySelect("f_category", item.category)) +
      '<div class="field-grid">' + field("Available qty", '<input type="number" id="f_qtyAvailable" min="0" value="' + (item.qtyAvailable ?? 0) + '">') + field("Total owned", '<input type="number" id="f_qtyTotal" min="0" value="' + (item.qtyTotal ?? 0) + '">') + "</div>" +
      '<div class="field-grid">' + field("Reorder at", '<input type="number" id="f_reorderLevel" min="0" value="' + (item.reorderLevel ?? 2) + '">') + field("Unit price (rental/sale)", '<input type="number" id="f_unitPrice" min="0" value="' + (item.unitPrice ?? 0) + '">') + "</div>";
    openModal(isEdit ? "Edit item" : "Add item", body, async function () {
      var data = { name: val("f_name"), category: val("f_category"), qtyAvailable: Number(val("f_qtyAvailable")) || 0, qtyTotal: Number(val("f_qtyTotal")) || 0, reorderLevel: Number(val("f_reorderLevel")) || 0, unitPrice: Number(val("f_unitPrice")) || 0, unitCost: item.unitCost || 0 };
      if (!data.name) { toast("Give the item a name"); return false; }
      if (isEdit) await api("PUT", "/api/items/" + item.id, data); else await api("POST", "/api/items", data);
      await loadAll(); renderItems(); renderOverview(); toast("Saved");
    });
  }

  // ---------------- APPOINTMENTS ----------------
  function labelStatus(s) { return { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[s] || "Pending"; }

  function renderAppointments() {
    var wrap = document.getElementById("apptsTableWrap");
    var list = state.appointments.filter(function (a) {
      if (apptFilters.category && a.category !== apptFilters.category) return false;
      if (apptFilters.status && a.status !== apptFilters.status) return false;
      return true;
    });
    if (state.appointments.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">📅</div><h3>No appointments yet</h3><p>Log your first booking or consultation.</p><button class="btn primary sm" id="emptyAddAppt" type="button">+ New appointment</button></div>';
      document.getElementById("emptyAddAppt").addEventListener("click", function () { openApptModal(null); });
      return;
    }
    if (list.length === 0) { wrap.innerHTML = '<div class="empty"><div class="glyph">🔍</div><p>No appointments match these filters.</p></div>'; return; }
    var rows = list.map(function (a) {
      return "<tr><td class=\"mono\">" + escapeHtml(a.date || "—") + (a.time ? " · " + escapeHtml(a.time) : "") + "</td><td>" + escapeHtml(a.clientName || "—") + "</td><td>" + catPill(a.category) + "</td><td>" + escapeHtml(a.location || "—") + '</td><td class="num">' + fmtMoney(a.quotedAmount) + '</td><td><span class="pill status-' + (a.status || "pending") + '">' + escapeHtml(labelStatus(a.status)) + '</span></td><td><div class="row-actions"><button class="icon-btn" data-edit="' + a.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + a.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>When</th><th>Client</th><th>Type</th><th>Location</th><th>Quoted</th><th>Status</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openApptModal(state.appointments.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("appointments", b.dataset.del, "appointment"); }); });
  }

  function openApptModal(appt) {
    var isEdit = !!appt;
    appt = appt || { clientName: "", phone: "", category: "wedding", date: todayStr(), time: "", location: "", guestCount: "", status: "pending", quotedAmount: 0, notes: "" };
    var body = '<div class="field-grid">' + field("Client name", '<input type="text" id="f_clientName" value="' + escapeHtml(appt.clientName) + '" placeholder="e.g. Zainab &amp; Ali">') + field("Phone", '<input type="tel" id="f_phone" value="' + escapeHtml(appt.phone || "") + '">') + "</div>" +
      field("Event type", categorySelect("f_category", appt.category)) +
      '<div class="field-grid">' + field("Date", '<input type="date" id="f_date" value="' + escapeHtml(appt.date || "") + '">') + field("Time", '<input type="time" id="f_time" value="' + escapeHtml(appt.time || "") + '">') + "</div>" +
      '<div class="field-grid">' + field("Location", '<input type="text" id="f_location" value="' + escapeHtml(appt.location || "") + '">') + field("Guest count", '<input type="number" id="f_guestCount" min="0" value="' + escapeHtml(appt.guestCount || "") + '">') + "</div>" +
      '<div class="field-grid">' + field("Quoted amount", '<input type="number" id="f_quotedAmount" min="0" value="' + (appt.quotedAmount ?? 0) + '">') + field("Status", '<select id="f_status">' + ["pending", "confirmed", "completed", "cancelled"].map(function (s) { return '<option value="' + s + '" ' + (appt.status === s ? "selected" : "") + ">" + labelStatus(s) + "</option>"; }).join("") + "</select>") + "</div>" +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(appt.notes || "") + "</textarea>");

    openModal(isEdit ? "Edit appointment" : "New appointment", body, async function () {
      var data = { clientName: val("f_clientName"), phone: val("f_phone"), category: val("f_category"), date: val("f_date"), time: val("f_time"), location: val("f_location"), guestCount: val("f_guestCount"), quotedAmount: Number(val("f_quotedAmount")) || 0, status: val("f_status"), notes: val("f_notes") };
      if (!data.clientName) { toast("Add a client name"); return false; }
      var prevStatus = appt.status;
      var saved;
      if (isEdit) saved = (await api("PUT", "/api/appointments/" + appt.id, data)).item; else saved = (await api("POST", "/api/appointments", data)).item;
      await loadAll(); renderAppointments(); renderOverview(); toast("Saved");
      if (data.status === "completed" && prevStatus !== "completed") {
        setTimeout(function () {
          if (confirm("Mark as completed — log an event for this booking now?")) {
            openEventModal(null, { clientName: data.clientName, category: data.category, totalAmount: data.quotedAmount, appointmentId: saved.id });
          }
        }, 250);
      }
    });
  }

  // ---------------- EVENTS ----------------
  function paymentInfo(total, paid) {
    total = Number(total) || 0; paid = Number(paid) || 0;
    var remaining = Math.max(0, total - paid);
    var key = paid <= 0 ? "unpaid" : (paid >= total && total > 0 ? "paid" : "partial");
    var label = key === "paid" ? "Paid" : key === "partial" ? "Partial" : "Unpaid";
    return { remaining: remaining, key: key, label: label };
  }

  function renderEvents() {
    var wrap = document.getElementById("eventsTableWrap");
    if (state.events.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">🎉</div><h3>No events yet</h3><p>Add an event to start tracking revenue, payments and items used.</p><button class="btn primary sm" id="emptyAddEvent" type="button">+ Add event</button></div>';
      document.getElementById("emptyAddEvent").addEventListener("click", function () { openEventModal(null, null); });
      return;
    }
    var rows = state.events.map(function (e) {
      var pay = paymentInfo(e.totalAmount, e.paidAmount);
      return "<tr><td class=\"mono\">" + escapeHtml(e.date || "—") + "</td><td>" + escapeHtml(e.clientName || "—") + "</td><td>" + catPill(e.category) + '</td><td class="num">' + fmtMoney(e.totalAmount) + '</td><td class="num">' + fmtMoney(e.paidAmount) + '</td><td class="num">' + fmtMoney(pay.remaining) + '</td><td><span class="pill status-' + pay.key + '">' + pay.label + '</span></td><td><div class="row-actions"><button class="icon-btn" data-edit="' + e.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + e.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Total</th><th>Paid</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openEventModal(state.events.find(function (x) { return x.id === b.dataset.edit; }), null); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("events", b.dataset.del, "event"); }); });
  }

  function openEventModal(evt, prefill) {
    var isEdit = !!evt;
    evt = evt || Object.assign({ clientName: "", phone: "", category: "wedding", date: todayStr(), totalAmount: 0, paidAmount: 0, notes: "", appointmentId: null, items: [] }, prefill || {});
    var itemsDraft = (evt.items || []).slice();

    function itemsListHtml() {
      if (itemsDraft.length === 0) return '<p class="section-sub" style="margin:0">No items added yet.</p>';
      return '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead><tbody>' +
        itemsDraft.map(function (it, idx) {
          return "<tr><td>" + escapeHtml(it.name) + '</td><td class="num">' + it.qty + '</td><td><button class="icon-btn" type="button" data-rm-item="' + idx + '" title="Remove">🗑</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }

    var itemOptions = state.items.map(function (i) { return '<option value="' + i.id + '">' + escapeHtml(i.name) + "</option>"; }).join("");

    var body = '<div class="field-grid">' + field("Client name", '<input type="text" id="f_clientName" value="' + escapeHtml(evt.clientName) + '">') + field("Phone", '<input type="tel" id="f_phone" value="' + escapeHtml(evt.phone || "") + '">') + "</div>" +
      field("Event type", categorySelect("f_category", evt.category)) +
      field("Date", '<input type="date" id="f_date" value="' + escapeHtml(evt.date || todayStr()) + '">') +
      '<div class="field-grid">' + field("Total amount", '<input type="number" id="f_totalAmount" min="0" value="' + (evt.totalAmount ?? 0) + '">') + field("Paid so far", '<input type="number" id="f_paidAmount" min="0" value="' + (evt.paidAmount ?? 0) + '">') + "</div>" +
      '<p class="section-sub" id="f_remaining" style="margin:0"></p>' +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(evt.notes || "") + "</textarea>") +
      '<div class="field"><label>Items used</label><div id="eventItemsList">' + itemsListHtml() + "</div>" +
      (state.items.length ? '<div class="toolbar" style="margin-top:8px"><select id="f_itemPick">' + itemOptions + '</select><input type="number" id="f_itemQty" min="1" value="1" style="width:70px"><button class="btn sm" type="button" id="f_itemAdd">+ Add</button></div>' : '<p class="section-sub" style="margin:6px 0 0">Add items in the Items tab first.</p>') +
      "</div>";

    openModal(isEdit ? "Edit event" : "Add event", body, async function () {
      var data = {
        clientName: val("f_clientName"), phone: val("f_phone"), category: val("f_category"), date: val("f_date"),
        totalAmount: Number(val("f_totalAmount")) || 0, paidAmount: Number(val("f_paidAmount")) || 0,
        notes: val("f_notes"), appointmentId: evt.appointmentId || null, items: itemsDraft,
      };
      if (!data.clientName) { toast("Add a client name"); return false; }
      if (isEdit) await api("PUT", "/api/events/" + evt.id, data); else await api("POST", "/api/events", data);
      await loadAll(); renderEvents(); renderOverview(); renderExpenses(); toast("Saved");
    });

    function updateRemaining() {
      var t = Number(val("f_totalAmount")) || 0, p = Number(val("f_paidAmount")) || 0;
      var remaining = Math.max(0, t - p);
      document.getElementById("f_remaining").textContent = remaining > 0 ? ("Remaining: " + fmtMoney(remaining)) : "Fully paid";
    }
    document.getElementById("f_totalAmount").addEventListener("input", updateRemaining);
    document.getElementById("f_paidAmount").addEventListener("input", updateRemaining);
    updateRemaining();

    function refreshItemsList() {
      document.getElementById("eventItemsList").innerHTML = itemsListHtml();
      document.getElementById("eventItemsList").querySelectorAll("[data-rm-item]").forEach(function (b) {
        b.addEventListener("click", function () { itemsDraft.splice(Number(b.dataset.rmItem), 1); refreshItemsList(); });
      });
    }
    var addBtn = document.getElementById("f_itemAdd");
    if (addBtn) addBtn.addEventListener("click", function () {
      var itemId = val("f_itemPick"); var qty = Number(val("f_itemQty")) || 1;
      var item = state.items.find(function (i) { return i.id === itemId; });
      if (!item) return;
      itemsDraft.push({ itemId: itemId, name: item.name, qty: qty });
      refreshItemsList();
    });
  }

  // ---------------- EXPENSES ----------------
  function eventLabel(id) {
    if (!id) return "General";
    var e = state.events.find(function (x) { return x.id === id; });
    return e ? (e.clientName || "Event") + " · " + (e.date || "") : "—";
  }

  function renderExpenses() {
    var isOwner = currentUser.role === "owner";
    document.getElementById("expensesLockedBanner").hidden = isOwner;
    document.getElementById("expensesContent").hidden = !isOwner;
    if (!isOwner) return;

    var revenue = state.events.reduce(function (s, x) { return s + (Number(x.totalAmount) || 0); }, 0);
    var expTotal = state.expenses.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
    var profit = revenue - expTotal;
    var margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
    document.getElementById("profitKpiGrid").innerHTML =
      '<div class="card kpi"><div class="label">All-time revenue</div><div class="value">' + fmtMoney(revenue) + "</div><div class=\"sub\">" + state.events.length + ' events</div></div>' +
      '<div class="card kpi"><div class="label">All-time expenses</div><div class="value">' + fmtMoney(expTotal) + "</div><div class=\"sub\">" + state.expenses.length + ' entries</div></div>' +
      '<div class="card kpi"><div class="label">All-time profit</div><div class="value" style="color:' + (profit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(profit) + '</div><div class="sub">' + margin + "% margin</div></div>";

    renderMonthlyBreakdown();

    var wrap = document.getElementById("expensesTableWrap");
    if (state.expenses.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">🧾</div><h3>No expenses logged yet</h3><p>Track venue, staffing, transport and other costs here.</p><button class="btn primary sm" id="emptyAddExpense" type="button">+ Add expense</button></div>';
      document.getElementById("emptyAddExpense").addEventListener("click", function () { openExpenseModal(null); });
      return;
    }
    var rows = state.expenses.map(function (e) {
      return "<tr><td class=\"mono\">" + escapeHtml(e.date || "—") + "</td><td>" + escapeHtml(e.category || "Other") + "</td><td>" + escapeHtml(eventLabel(e.eventId)) + '</td><td class="num">' + fmtMoney(e.amount) + "</td><td>" + escapeHtml(e.notes || "—") + '</td><td><div class="row-actions"><button class="icon-btn" data-edit="' + e.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + e.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>Date</th><th>Category</th><th>Event</th><th>Amount</th><th>Notes</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openExpenseModal(state.expenses.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("expenses", b.dataset.del, "expense"); }); });
  }

  function renderMonthlyBreakdown() {
    var el = document.getElementById("monthlyBreakdown");
    var monthEvents = state.events.filter(function (e) { return isThisMonth(e.date); });
    var monthExpenses = state.expenses.filter(function (x) { return isThisMonth(x.date); });

    var eventRows = monthEvents.map(function (e) {
      var direct = monthExpenses.filter(function (x) { return x.eventId === e.id; }).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
      return { e: e, direct: direct, profit: (Number(e.totalAmount) || 0) - direct };
    });
    var overheadTotal = monthExpenses.filter(function (x) { return !x.eventId; }).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
    var eventProfitSum = eventRows.reduce(function (s, r) { return s + r.profit; }, 0);
    var netProfit = eventProfitSum - overheadTotal;

    if (monthEvents.length === 0 && overheadTotal === 0) {
      el.innerHTML = '<div class="section-head" style="padding:16px 16px 0"><h2 style="font-size:15px">This month: event profit vs. overhead</h2></div>' +
        '<div class="empty" style="padding:24px"><div class="glyph">🧾</div><p>No events or expenses logged this month yet.</p></div>';
      return;
    }
    var rowsHtml = eventRows.map(function (r) {
      return "<tr><td>" + escapeHtml(r.e.clientName || "—") + " " + catPill(r.e.category) + '</td><td class="num">' + fmtMoney(r.e.totalAmount) + '</td><td class="num">' + fmtMoney(r.direct) + '</td><td class="num" style="color:' + (r.profit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(r.profit) + "</td></tr>";
    }).join("");
    el.innerHTML =
      '<div class="section-head" style="padding:16px 16px 0"><h2 style="font-size:15px">This month: event profit vs. overhead</h2></div>' +
      '<div class="table-wrap" style="padding:8px 16px 0"><table><thead><tr><th>Event</th><th>Revenue</th><th>Direct expenses</th><th>Event profit</th></tr></thead><tbody>' +
      (rowsHtml || '<tr><td colspan="4" class="section-sub">No events this month.</td></tr>') + "</tbody></table></div>" +
      '<div style="padding:12px 16px 16px;display:flex;flex-direction:column;gap:4px">' +
        '<div style="display:flex;justify-content:space-between;font-size:13.5px"><span class="section-sub">Sum of event profits</span><span class="mono">' + fmtMoney(eventProfitSum) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:13.5px"><span class="section-sub">− Overhead expenses (rent, marketing, etc.)</span><span class="mono">' + fmtMoney(overheadTotal) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:2px"><span>Net profit this month</span><span class="mono" style="color:' + (netProfit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(netProfit) + "</span></div>" +
      "</div>";
  }

  function openExpenseModal(exp) {
    var isEdit = !!exp;
    exp = exp || { date: todayStr(), category: EXPENSE_CATEGORIES[0], amount: 0, notes: "", eventId: "" };
    var eventOptions = '<option value="">General (monthly overhead)</option>' + state.events.map(function (e) { return '<option value="' + e.id + '" ' + (exp.eventId === e.id ? "selected" : "") + ">" + escapeHtml(e.clientName || "Event") + " · " + escapeHtml(e.date || "") + "</option>"; }).join("");
    var body = '<div class="field-grid">' + field("Date", '<input type="date" id="f_date" value="' + escapeHtml(exp.date || todayStr()) + '">') + field("Amount", '<input type="number" id="f_amount" min="0" value="' + (exp.amount ?? 0) + '">') + "</div>" +
      field("Category", '<select id="f_category">' + EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + escapeHtml(c) + '" ' + (exp.category === c ? "selected" : "") + ">" + escapeHtml(c) + "</option>"; }).join("") + "</select>") +
      field("Route to event", '<select id="f_eventId">' + eventOptions + "</select>") +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(exp.notes || "") + "</textarea>");
    openModal(isEdit ? "Edit expense" : "Add expense", body, async function () {
      var data = { date: val("f_date"), category: val("f_category"), amount: Number(val("f_amount")) || 0, notes: val("f_notes"), eventId: val("f_eventId") || null };
      if (isEdit) await api("PUT", "/api/expenses/" + exp.id, data); else await api("POST", "/api/expenses", data);
      await loadAll(); renderExpenses(); renderOverview(); toast("Saved");
    });
  }

  // ---------------- TEAM ----------------
  function renderTeam() {
    var isOwner = currentUser.role === "owner";
    document.getElementById("teamLockedBanner").hidden = isOwner;
    document.getElementById("teamContent").hidden = !isOwner;
    if (!isOwner) return;
    var wrap = document.getElementById("teamTableWrap");
    var rows = state.team.map(function (u) {
      var mine = u.id === currentUser.id;
      return "<tr><td>" + escapeHtml(u.name) + (mine ? ' <span class="section-sub">(you)</span>' : "") + "</td><td>" + escapeHtml(u.email) + '</td><td><span class="pill status-' + u.role + '">' + (u.role === "owner" ? "Owner" : "Staff") + '</span></td><td><div class="row-actions"><button class="icon-btn" data-edit="' + u.id + '" type="button" title="Edit">✎</button>' + (mine ? "" : '<button class="icon-btn" data-del="' + u.id + '" type="button" title="Remove">🗑</button>') + "</div></td></tr>";
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openTeamModal(state.team.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!confirm("Remove this team member's access?")) return;
      await api("DELETE", "/api/auth/team/" + b.dataset.del);
      await loadAll(); renderTeam(); toast("Removed");
    }); });
  }

  function openTeamModal(user) {
    var isEdit = !!user;
    user = user || { name: "", email: "", role: "staff" };
    var body = '<div class="field-grid">' +
        field("Name", '<input type="text" id="f_name" value="' + escapeHtml(user.name) + '">') +
        field("Role", '<select id="f_role"><option value="staff"' + (user.role === "staff" ? " selected" : "") + '>Staff (no expenses/profit)</option><option value="owner"' + (user.role === "owner" ? " selected" : "") + ">Owner (full access)</option></select>") +
      "</div>" +
      field("Email", '<input type="email" id="f_email" value="' + escapeHtml(user.email) + '">') +
      field(isEdit ? "New password" : "Temporary password", '<input type="text" id="f_password" placeholder="' + (isEdit ? "Leave blank to keep current password" : "They should change this after signing in") + '">');
    openModal(isEdit ? "Edit team member" : "Add team member", body, async function () {
      var data = { name: val("f_name"), email: val("f_email"), password: val("f_password"), role: val("f_role") };
      if (!data.name || !data.email) { toast("Fill in name and email"); return false; }
      if (isEdit) {
        if (!data.password) delete data.password;
        await api("PUT", "/api/auth/team/" + user.id, data);
      } else {
        if (!data.password) { toast("Set a temporary password"); return false; }
        await api("POST", "/api/auth/team", data);
      }
      await loadAll(); renderTeam(); toast(isEdit ? "Team member updated" : "Team member added");
    });
  }

  // ---------------- shared form + modal helpers ----------------
  function field(label, inputHtml) { return '<div class="field"><label>' + label + "</label>" + inputHtml + "</div>"; }
  function categorySelect(id, selected) {
    return '<select id="' + id + '">' + Object.keys(CATEGORIES).map(function (k) { return '<option value="' + k + '" ' + (selected === k ? "selected" : "") + ">" + CATEGORIES[k].label + "</option>"; }).join("") + "</select>";
  }
  function val(id) { var el = document.getElementById(id); return el ? (el.value.trim ? el.value.trim() : el.value) : ""; }

  function openModal(title, bodyHtml, onSave) {
    var root = document.getElementById("modalRoot");
    root.innerHTML = '<div class="overlay" id="ovl"><div class="modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '"><div class="modal-head"><h3>' + escapeHtml(title) + '</h3><button class="icon-btn" id="modalClose" type="button" aria-label="Close">✕</button></div><div class="form-body">' + bodyHtml + '</div><div class="modal-foot"><button class="btn" id="modalCancel" type="button">Cancel</button><button class="btn primary" id="modalSave" type="button">Save</button></div></div></div>';
    function close() { root.innerHTML = ""; }
    document.getElementById("modalClose").addEventListener("click", close);
    document.getElementById("modalCancel").addEventListener("click", close);
    document.getElementById("ovl").addEventListener("click", function (e) { if (e.target.id === "ovl") close(); });
    document.getElementById("modalSave").addEventListener("click", async function () {
      var saveBtn = document.getElementById("modalSave");
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        var result = await onSave();
        if (result === false) { saveBtn.disabled = false; saveBtn.textContent = "Save"; return; }
        close();
      } catch (err) {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
        toast(err.message || "Couldn't save — try again.");
      }
    });
  }

  async function confirmDelete(collectionName, id, label) {
    if (!confirm("Delete this " + label + "?")) return;
    try {
      await api("DELETE", "/api/" + collectionName + "/" + id);
      await loadAll(); renderAll(); toast("Deleted");
    } catch (err) {
      toast(err.message || "Couldn't delete.");
    }
  }

  boot();
})();
