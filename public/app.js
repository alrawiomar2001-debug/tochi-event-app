(function () {
  "use strict";

  var CATEGORIES = {
    wedding: { label: "Wedding", color: "var(--cat-wedding)" },
    engagement: { label: "Engagement", color: "var(--cat-engagement)" },
    birthday: { label: "Birthday", color: "var(--cat-birthday)" },
    baby_welcoming: { label: "Baby welcoming", color: "var(--cat-baby)" },
  };
  var EXPENSE_CATEGORIES = ["Venue & décor", "Staffing", "Transport", "Item purchase/repair", "Marketing", "Other"];
  // Fixed defaults plus any custom category you've typed before — once used
  // on a saved expense, it sticks around as a suggestion going forward.
  function expenseCategoryOptions() {
    var list = EXPENSE_CATEGORIES.slice(), seen = {};
    list.forEach(function (c) { seen[c] = true; });
    state.expenses.forEach(function (e) { if (e.category && !seen[e.category]) { seen[e.category] = true; list.push(e.category); } });
    return list;
  }
  var CURRENCY = "IQD";

  var token = localStorage.getItem("tochi_token") || null;
  var currentUser = null;
  var state = { items: [], appointments: [], events: [], expenses: [], team: [] };
  var overviewRange = "month";
  var apptFilters = { category: "", status: "" };
  var calState = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selected: null };
  var breakdownRange = "month";
  var itemSearch = "";
  var eventFilters = { search: "", category: "", status: "" };

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
  function isThisYear(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr).getFullYear() === new Date().getFullYear();
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
    document.getElementById("downloadBackupBtn").hidden = !isOwner;

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
    renderOverview(); renderCalendar(); renderItems(); renderAppointments(); renderEvents(); renderExpenses(); renderTeam();
  }

  // ---------------- CALENDAR ----------------
  function pad2(n) { return String(n).padStart(2, "0"); }

  function renderCalendar() {
    if (!calState.selected) calState.selected = todayStr();
    renderCalGrid();
    renderCalDayDetail();
  }

  function renderCalGrid() {
    var year = calState.month.getFullYear(), month = calState.month.getMonth();
    document.getElementById("calMonthLabel").textContent = calState.month.toLocaleString("en-US", { month: "long", year: "numeric" });
    var firstWeekday = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var daysInPrevMonth = new Date(year, month, 0).getDate();
    var cells = [];
    for (var i = 0; i < firstWeekday; i++) cells.push({ day: daysInPrevMonth - firstWeekday + 1 + i, outside: true });
    for (var d = 1; d <= daysInMonth; d++) cells.push({ day: d, outside: false, dateStr: year + "-" + pad2(month + 1) + "-" + pad2(d) });
    var trailing = 1;
    while (cells.length % 7 !== 0) cells.push({ day: trailing++, outside: true });

    var dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var today = todayStr();
    var html = dow.map(function (d) { return '<div class="cal-dow">' + d + "</div>"; }).join("");
    html += cells.map(function (c) {
      if (c.outside) return '<div class="cal-day outside"><div class="cal-daynum">' + c.day + "</div></div>";
      var dayEvents = state.events.filter(function (e) { return e.date === c.dateStr; });
      var dayAppts = state.appointments.filter(function (a) { return a.date === c.dateStr; });
      var dots = dayEvents.map(function (e) { return catColor(e.category); }).concat(dayAppts.map(function (a) { return catColor(a.category); }));
      var shown = dots.slice(0, 4), extra = dots.length - shown.length;
      var classes = "cal-day" + (c.dateStr === today ? " today" : "") + (c.dateStr === calState.selected ? " selected" : "");
      return '<div class="' + classes + '" data-date="' + c.dateStr + '"><div class="cal-daynum">' + c.day + '</div><div class="cal-dots">' +
        shown.map(function (col) { return '<span class="cal-dot" style="background:' + col + '"></span>'; }).join("") +
        (extra > 0 ? '<span class="cal-more">+' + extra + "</span>" : "") + "</div></div>";
    }).join("");
    document.getElementById("calGrid").innerHTML = html;
    document.getElementById("calGrid").querySelectorAll("[data-date]").forEach(function (el) {
      el.addEventListener("click", function () { calState.selected = el.dataset.date; renderCalendar(); });
    });
  }

  function renderCalDayDetail() {
    var dateStr = calState.selected;
    var label = new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("calDayLabel").textContent = label + (dateStr === todayStr() ? " (Today)" : "");
    var dayEvents = state.events.filter(function (e) { return e.date === dateStr; });
    var dayAppts = state.appointments.filter(function (a) { return a.date === dateStr; });
    var el = document.getElementById("calDayDetail");
    if (!dayEvents.length && !dayAppts.length) { el.innerHTML = '<div class="empty"><div class="glyph">🗓️</div><p>Nothing scheduled this day.</p></div>'; return; }
    var rows = [];
    dayEvents.forEach(function (e) {
      rows.push('<div class="day-item" data-open-event="' + e.id + '"><span class="ic">🎉</span><span style="flex:1">' + escapeHtml(e.clientName || "Client") + " · " + catLabel(e.category) + (e.location ? " · " + escapeHtml(e.location) : "") + '</span><span class="meta">' + escapeHtml(e.time || "") + "</span></div>");
    });
    dayAppts.forEach(function (a) {
      rows.push('<div class="day-item" data-open-appt="' + a.id + '"><span class="ic">📅</span><span style="flex:1">' + escapeHtml(a.clientName || "Client") + " · " + catLabel(a.category) + " · " + labelStatus(a.status) + '</span><span class="meta">' + escapeHtml(a.time || "") + "</span></div>");
    });
    el.innerHTML = rows.join("");
    el.querySelectorAll("[data-open-event]").forEach(function (b) { b.addEventListener("click", function () { openEventModal(state.events.find(function (x) { return x.id === b.dataset.openEvent; }), null); }); });
    el.querySelectorAll("[data-open-appt]").forEach(function (b) { b.addEventListener("click", function () { openApptModal(state.appointments.find(function (x) { return x.id === b.dataset.openAppt; })); }); });
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

    document.getElementById("calPrev").addEventListener("click", function () { calState.month = new Date(calState.month.getFullYear(), calState.month.getMonth() - 1, 1); renderCalGrid(); });
    document.getElementById("calNext").addEventListener("click", function () { calState.month = new Date(calState.month.getFullYear(), calState.month.getMonth() + 1, 1); renderCalGrid(); });
    document.getElementById("calToday").addEventListener("click", function () {
      var n = new Date(); calState.month = new Date(n.getFullYear(), n.getMonth(), 1); calState.selected = todayStr(); renderCalendar();
    });

    var catSelect = document.getElementById("apptCategoryFilter");
    Object.keys(CATEGORIES).forEach(function (k) {
      var o = document.createElement("option"); o.value = k; o.textContent = CATEGORIES[k].label;
      catSelect.appendChild(o);
    });
    catSelect.addEventListener("change", function () { apptFilters.category = catSelect.value; renderAppointments(); });
    document.getElementById("apptStatusFilter").addEventListener("change", function (e) { apptFilters.status = e.target.value; renderAppointments(); });

    document.getElementById("itemSearchInput").addEventListener("input", function (e) { itemSearch = e.target.value; renderItems(); });

    var eventCatSelect = document.getElementById("eventCategoryFilter");
    Object.keys(CATEGORIES).forEach(function (k) {
      var o = document.createElement("option"); o.value = k; o.textContent = CATEGORIES[k].label;
      eventCatSelect.appendChild(o);
    });
    document.getElementById("eventSearchInput").addEventListener("input", function (e) { eventFilters.search = e.target.value; renderEvents(); });
    eventCatSelect.addEventListener("change", function () { eventFilters.category = eventCatSelect.value; renderEvents(); });
    document.getElementById("eventStatusFilter").addEventListener("change", function (e) { eventFilters.status = e.target.value; renderEvents(); });

    document.getElementById("addItemBtn").addEventListener("click", function () { openItemModal(null); });
    document.getElementById("addApptBtn").addEventListener("click", function () { openApptModal(null); });
    document.getElementById("addEventBtn").addEventListener("click", function () { openEventModal(null, null); });
    document.getElementById("addExpenseBtn").addEventListener("click", function () { openExpenseModal(null); });
    document.getElementById("addTeamBtn").addEventListener("click", function () { openTeamModal(); });
    document.getElementById("downloadBackupBtn").addEventListener("click", downloadBackup);
  }

  // ---------------- OVERVIEW ----------------
  function eventsInRange(range) { return state.events.filter(function (e) { return range === "all" ? true : isThisMonth(e.date); }); }
  function expensesInRange(range) { return state.expenses.filter(function (e) { return range === "all" ? true : isThisMonth(e.date); }); }

  function renderOverview() {
    var isOwner = currentUser.role === "owner";
    var events = eventsInRange(overviewRange);
    var revenue = events.reduce(function (s, x) { return s + (Number(x.totalAmount) || 0); }, 0);
    var upcoming = state.appointments.filter(function (a) { return a.date >= todayStr() && a.status !== "cancelled" && a.status !== "completed"; }).length;
    var today = todayStr();
    var reservedToday = state.items.reduce(function (s, i) { return s + itemReservedQty(i.id, today, today); }, 0);

    var kpis = [
      { label: "Revenue (" + (overviewRange === "all" ? "all time" : "this month") + ")", value: fmtMoney(revenue), sub: events.length + " event" + (events.length === 1 ? "" : "s") },
      { label: "Upcoming appointments", value: String(upcoming), sub: state.appointments.length + " total on file" },
      { label: "Items reserved today", value: String(reservedToday), sub: state.items.length + " items tracked" },
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
  // Items are the studio's own décor/furniture assets, not sold — "available"
  // is computed per date range (setup through teardown) from what other
  // events have already reserved.
  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
  }
  function itemReservedQty(itemId, rangeStart, rangeEnd, excludeEventId) {
    if (!rangeStart) return 0;
    rangeEnd = rangeEnd || rangeStart;
    return state.events.reduce(function (sum, e) {
      if (excludeEventId && e.id === excludeEventId) return sum;
      var s = e.reserveFrom || e.date, en = e.reserveUntil || e.date;
      if (!s || !rangesOverlap(rangeStart, rangeEnd, s, en)) return sum;
      var found = (e.items || []).find(function (it) { return it.itemId === itemId; });
      return sum + (found ? Number(found.qty) || 0 : 0);
    }, 0);
  }

  // Item categories are the studio's own naming (e.g. "Chairs", "Lighting"),
  // separate from event types — free text, suggested from what's already used.
  function itemCategoryOptions() {
    var seen = {}, list = [];
    state.items.forEach(function (i) { if (i.category && !seen[i.category]) { seen[i.category] = true; list.push(i.category); } });
    return list.sort();
  }

  function itemThumb(i) {
    return i.photo
      ? '<img src="' + i.photo + '" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;display:block">'
      : '<div style="width:36px;height:36px;border-radius:8px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:15px">📦</div>';
  }

  function itemCatPill(c) {
    return c ? '<span class="pill" style="background:var(--surface-2);color:var(--text)">' + escapeHtml(c) + "</span>" : '<span class="section-sub">—</span>';
  }

  function renderItems() {
    var wrap = document.getElementById("itemsTableWrap");
    if (state.items.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">📦</div><h3>No items yet</h3><p>Add décor, furniture or supplies to start tracking your studio\'s assets.</p><button class="btn primary sm" id="emptyAddItem" type="button">+ Add item</button></div>';
      document.getElementById("emptyAddItem").addEventListener("click", function () { openItemModal(null); });
      return;
    }
    var q = itemSearch.trim().toLowerCase();
    var list = state.items.filter(function (i) {
      if (!q) return true;
      return (i.name || "").toLowerCase().indexOf(q) !== -1 || (i.category || "").toLowerCase().indexOf(q) !== -1;
    });
    if (list.length === 0) { wrap.innerHTML = '<div class="empty"><div class="glyph">🔍</div><p>No items match "' + escapeHtml(itemSearch) + '".</p></div>'; return; }
    var today = todayStr();
    var rows = list.slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); }).map(function (i) {
      var reservedToday = itemReservedQty(i.id, today, today);
      return "<tr><td>" + itemThumb(i) + "</td><td>" + escapeHtml(i.name || "—") + "</td><td>" + itemCatPill(i.category) + '</td><td class="num">' + (i.qtyTotal ?? 0) + '</td><td class="num">' + reservedToday + '</td><td><div class="row-actions"><button class="icon-btn" data-view="' + i.id + '" type="button" title="View reservations">👁</button><button class="icon-btn" data-edit="' + i.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + i.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th></th><th>Item</th><th>Category</th><th>Total owned</th><th>Reserved today</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-view]").forEach(function (b) { b.addEventListener("click", function () { openItemReservationsModal(state.items.find(function (x) { return x.id === b.dataset.view; })); }); });
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openItemModal(state.items.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("items", b.dataset.del, "item"); }); });
  }

  function openItemReservationsModal(item) {
    var rows = state.events
      .map(function (e) { var it = (e.items || []).find(function (x) { return x.itemId === item.id; }); return it ? { e: e, qty: it.qty } : null; })
      .filter(Boolean)
      .sort(function (a, b) { return (a.e.reserveFrom || a.e.date || "").localeCompare(b.e.reserveFrom || b.e.date || ""); });
    var body;
    if (!rows.length) {
      body = '<div class="empty"><div class="glyph">📭</div><p>No events have this item reserved yet.</p></div>';
    } else {
      body = '<div class="table-wrap"><table><thead><tr><th>Event</th><th>Dates</th><th>Qty</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var from = r.e.reserveFrom || r.e.date || "—", until = r.e.reserveUntil || r.e.date || "—";
          var dateLabel = from === until ? escapeHtml(from) : escapeHtml(from) + " → " + escapeHtml(until);
          return "<tr><td>" + escapeHtml(r.e.clientName || "Client") + " " + catPill(r.e.category) + '</td><td class="mono">' + dateLabel + '</td><td class="num">' + r.qty + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    openModal("Reservations — " + item.name, body, null, true);
  }

  // Downscales an uploaded photo client-side so item photos don't bloat the database.
  function readAndResizeImage(file, maxDim, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function openItemModal(item) {
    var isEdit = !!item;
    item = item || { name: "", category: "", qtyTotal: 1, notes: "", photo: null };
    var photoDraft = item.photo || null;
    var catOptions = itemCategoryOptions().map(function (c) { return "<option value=\"" + escapeHtml(c) + "\">"; }).join("");
    var body = field("Item name", '<input type="text" id="f_name" autocomplete="off" value="' + escapeHtml(item.name) + '" placeholder="e.g. Gold Chiavari chairs">') +
      field("Category", '<input type="text" id="f_category" autocomplete="off" list="itemCatList" value="' + escapeHtml(item.category || "") + '" placeholder="e.g. Chairs, Tableware, Lighting"><datalist id="itemCatList">' + catOptions + "</datalist>") +
      field("Total owned", '<input type="number" id="f_qtyTotal" min="0" value="' + (item.qtyTotal ?? 0) + '">') +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(item.notes || "") + "</textarea>") +
      '<div class="field"><label>Photo</label><div id="f_photoPreview"></div>' +
      '<div class="toolbar" style="margin-top:8px"><input type="file" id="f_photoFile" accept="image/*"></div></div>';

    openModal(isEdit ? "Edit item" : "Add item", body, async function () {
      var data = { name: val("f_name"), category: val("f_category"), qtyTotal: Number(val("f_qtyTotal")) || 0, notes: val("f_notes"), photo: photoDraft };
      if (!data.name) { toast("Give the item a name"); return false; }
      if (isEdit) await api("PUT", "/api/items/" + item.id, data); else await api("POST", "/api/items", data);
      await loadAll(); renderItems(); renderOverview(); toast("Saved");
    });

    function refreshPhotoUI() {
      var preview = document.getElementById("f_photoPreview");
      preview.innerHTML = photoDraft
        ? '<img src="' + photoDraft + '" alt="" style="width:100%;max-width:180px;border-radius:10px;display:block;margin-bottom:8px"><button class="btn sm" type="button" id="f_photoRemove">Remove photo</button>'
        : '<p class="section-sub" style="margin:0 0 6px">No photo yet.</p>';
      var removeBtn = document.getElementById("f_photoRemove");
      if (removeBtn) removeBtn.addEventListener("click", function () { photoDraft = null; refreshPhotoUI(); });
    }
    refreshPhotoUI();
    document.getElementById("f_photoFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      readAndResizeImage(file, 480, function (dataUrl) { photoDraft = dataUrl; refreshPhotoUI(); });
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
    var body = '<div class="field-grid">' + field("Client name", '<input type="text" id="f_clientName" autocomplete="off" value="' + escapeHtml(appt.clientName) + '" placeholder="e.g. Zainab &amp; Ali">') + field("Phone", '<input type="tel" id="f_phone" autocomplete="off" value="' + escapeHtml(appt.phone || "") + '">') + "</div>" +
      field("Event type", categorySelect("f_category", appt.category)) +
      '<div class="field-grid">' + field("Date", '<input type="date" id="f_date" value="' + escapeHtml(appt.date || "") + '">') + field("Time", '<input type="time" id="f_time" value="' + escapeHtml(appt.time || "") + '">') + "</div>" +
      '<div class="field-grid">' + field("Location", '<input type="text" id="f_location" autocomplete="off" value="' + escapeHtml(appt.location || "") + '">') + field("Guest count", '<input type="number" id="f_guestCount" min="0" value="' + escapeHtml(appt.guestCount || "") + '">') + "</div>" +
      '<div class="field-grid">' + field("Quoted amount", '<input type="number" id="f_quotedAmount" min="0" value="' + (appt.quotedAmount ?? 0) + '">') + field("Status", '<select id="f_status">' + ["pending", "confirmed", "completed", "cancelled"].map(function (s) { return '<option value="' + s + '" ' + (appt.status === s ? "selected" : "") + ">" + labelStatus(s) + "</option>"; }).join("") + "</select>") + "</div>" +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(appt.notes || "") + "</textarea>");

    openModal(isEdit ? "Edit appointment" : "New appointment", body, async function () {
      var data = { clientName: val("f_clientName"), phone: val("f_phone"), category: val("f_category"), date: val("f_date"), time: val("f_time"), location: val("f_location"), guestCount: val("f_guestCount"), quotedAmount: Number(val("f_quotedAmount")) || 0, status: val("f_status"), notes: val("f_notes") };
      if (!data.clientName) { toast("Add a client name"); return false; }
      var prevStatus = appt.status;
      var saved;
      if (isEdit) saved = (await api("PUT", "/api/appointments/" + appt.id, data)).item; else saved = (await api("POST", "/api/appointments", data)).item;
      await loadAll(); renderAppointments(); renderOverview(); renderCalendar(); toast("Saved");
      if (data.status === "completed" && prevStatus !== "completed") {
        setTimeout(function () {
          if (confirm("Mark as completed — log an event for this booking now?")) {
            openEventModal(null, { clientName: data.clientName, phone: data.phone, category: data.category, date: data.date, time: data.time, location: data.location, guestCount: data.guestCount, totalAmount: data.quotedAmount, appointmentId: saved.id });
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

  // Expenses routed straight to this event (not general/overhead costs).
  function eventDirectExpenses(eventId) {
    return state.expenses.filter(function (x) { return x.eventId === eventId; }).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
  }

  function renderEvents() {
    var wrap = document.getElementById("eventsTableWrap");
    var isOwner = currentUser.role === "owner";
    if (state.events.length === 0) {
      wrap.innerHTML = '<div class="empty"><div class="glyph">🎉</div><h3>No events yet</h3><p>Add an event to start tracking revenue, payments and items used.</p><button class="btn primary sm" id="emptyAddEvent" type="button">+ Add event</button></div>';
      document.getElementById("emptyAddEvent").addEventListener("click", function () { openEventModal(null, null); });
      return;
    }
    var q = eventFilters.search.trim().toLowerCase();
    var list = state.events.filter(function (e) {
      if (q && (e.clientName || "").toLowerCase().indexOf(q) === -1) return false;
      if (eventFilters.category && e.category !== eventFilters.category) return false;
      if (eventFilters.status && paymentInfo(e.totalAmount, e.paidAmount).key !== eventFilters.status) return false;
      return true;
    });
    if (list.length === 0) { wrap.innerHTML = '<div class="empty"><div class="glyph">🔍</div><p>No events match these filters.</p></div>'; return; }
    var rows = list.map(function (e) {
      var pay = paymentInfo(e.totalAmount, e.paidAmount);
      var profitCell = "";
      if (isOwner) {
        var direct = eventDirectExpenses(e.id);
        var profit = (Number(e.totalAmount) || 0) - direct;
        profitCell = '<td class="num">' + fmtMoney(direct) + '</td><td class="num" style="color:' + (profit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(profit) + "</td>";
      }
      return "<tr><td class=\"mono\">" + escapeHtml(e.date || "—") + "</td><td>" + escapeHtml(e.clientName || "—") + "</td><td>" + catPill(e.category) + '</td><td class="num">' + fmtMoney(e.totalAmount) + '</td><td class="num">' + fmtMoney(e.paidAmount) + '</td><td class="num">' + fmtMoney(pay.remaining) + '</td><td><span class="pill status-' + pay.key + '">' + pay.label + "</span></td>" + profitCell + '<td><div class="row-actions"><button class="icon-btn" data-print="' + e.id + '" type="button" title="Print quote">🖨</button><button class="icon-btn" data-edit="' + e.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + e.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    var profitHead = isOwner ? "<th>Expenses</th><th>Profit</th>" : "";
    wrap.innerHTML = "<table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Total</th><th>Paid</th><th>Remaining</th><th>Status</th>" + profitHead + "<th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-print]").forEach(function (b) { b.addEventListener("click", function () { printEventQuote(state.events.find(function (x) { return x.id === b.dataset.print; })); }); });
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openEventModal(state.events.find(function (x) { return x.id === b.dataset.edit; }), null); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("events", b.dataset.del, "event"); }); });
  }

  function openEventModal(evt, prefill) {
    var isEdit = !!evt;
    evt = evt || Object.assign({ clientName: "", phone: "", category: "wedding", date: todayStr(), time: "", location: "", guestCount: "", totalAmount: 0, paidAmount: 0, notes: "", appointmentId: null, items: [], reserveFrom: "", reserveUntil: "" }, prefill || {});
    var itemsDraft = (evt.items || []).slice();

    function itemsListHtml() {
      if (itemsDraft.length === 0) return '<p class="section-sub" style="margin:0">No items added yet.</p>';
      return '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead><tbody>' +
        itemsDraft.map(function (it, idx) {
          return "<tr><td>" + escapeHtml(it.name) + '</td><td class="num">' + it.qty + '</td><td><button class="icon-btn" type="button" data-rm-item="' + idx + '" title="Remove">🗑</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }

    function reserveRange() {
      var from = val("f_reserveFrom") || val("f_date") || evt.date || todayStr();
      var until = val("f_reserveUntil") || from;
      if (until < from) until = from;
      return { from: from, until: until };
    }

    function itemAvailability(itemId, from, until) {
      var totalOwned = (state.items.find(function (i) { return i.id === itemId; }) || {}).qtyTotal || 0;
      var reservedByOthers = itemReservedQty(itemId, from, until, isEdit ? evt.id : null);
      var alreadyInThisEvent = itemsDraft.filter(function (it) { return it.itemId === itemId; }).reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0);
      return Math.max(0, totalOwned - reservedByOthers - alreadyInThisEvent);
    }

    function itemAvailabilityLabel(avail, totalOwned) {
      totalOwned = Number(totalOwned) || 0;
      if (avail <= 0) return " — Reserved";
      if (avail < totalOwned) return " — " + avail + " available (" + (totalOwned - avail) + " reserved)";
      return " — " + avail + " available";
    }

    function itemPickerHtml() {
      if (!state.items.length) return '<p class="section-sub" style="margin:6px 0 0">Add items in the Items tab first.</p>';
      var range = reserveRange();
      var options = state.items.map(function (i) {
        var avail = itemAvailability(i.id, range.from, range.until);
        return '<option value="' + i.id + '">' + escapeHtml(i.name) + itemAvailabilityLabel(avail, i.qtyTotal) + "</option>";
      }).join("");
      return '<div class="toolbar" style="margin-top:8px"><select id="f_itemPick">' + options + '</select><input type="number" id="f_itemQty" min="1" value="1" style="width:70px"><button class="btn sm" type="button" id="f_itemAdd">+ Add</button></div>';
    }

    var body =
      '<div class="form-section"><div class="form-section-title">Client &amp; event</div>' +
        '<div class="field-grid">' + field("Client name", '<input type="text" id="f_clientName" autocomplete="off" value="' + escapeHtml(evt.clientName) + '">') + field("Phone", '<input type="tel" id="f_phone" autocomplete="off" value="' + escapeHtml(evt.phone || "") + '">') + "</div>" +
        field("Event type", categorySelect("f_category", evt.category)) +
        '<div class="field-grid">' + field("Date", '<input type="date" id="f_date" value="' + escapeHtml(evt.date || todayStr()) + '">') + field("Time", '<input type="time" id="f_time" value="' + escapeHtml(evt.time || "") + '">') + "</div>" +
        '<div class="field-grid">' + field("Location", '<input type="text" id="f_location" autocomplete="off" value="' + escapeHtml(evt.location || "") + '">') + field("Guest count", '<input type="number" id="f_guestCount" min="0" value="' + escapeHtml(evt.guestCount || "") + '">') + "</div>" +
        field("Notes", '<textarea id="f_notes">' + escapeHtml(evt.notes || "") + "</textarea>") +
      "</div>" +
      '<div class="form-section"><div class="form-section-title">Payment</div>' +
        '<div class="field-grid">' + field("Total amount", '<input type="number" id="f_totalAmount" min="0" value="' + (evt.totalAmount ?? 0) + '">') + field("Paid so far", '<input type="number" id="f_paidAmount" min="0" value="' + (evt.paidAmount ?? 0) + '">') + "</div>" +
        '<p class="section-sub" id="f_remaining" style="margin:0"></p>' +
      "</div>" +
      '<div class="form-section"><div class="form-section-title">Items</div>' +
        '<div class="field"><label>Items needed from / until</label><p class="section-sub" style="margin:0 0 6px">Only widen this if items go out for setup before the event or come back after teardown — otherwise leave it matching the event date.</p><div class="field-grid">' + field("From", '<input type="date" id="f_reserveFrom" value="' + escapeHtml(evt.reserveFrom || evt.date || todayStr()) + '">') + field("Until", '<input type="date" id="f_reserveUntil" value="' + escapeHtml(evt.reserveUntil || evt.reserveFrom || evt.date || todayStr()) + '">') + "</div></div>" +
        '<div class="field"><label>Items reserved</label><div id="eventItemsList">' + itemsListHtml() + '</div><div id="eventItemPicker">' + itemPickerHtml() + "</div></div>" +
      "</div>";

    openModal(isEdit ? "Edit event" : "Add event", body, async function () {
      var range = reserveRange();
      var data = {
        clientName: val("f_clientName"), phone: val("f_phone"), category: val("f_category"), date: val("f_date"),
        time: val("f_time"), location: val("f_location"), guestCount: val("f_guestCount"),
        totalAmount: Number(val("f_totalAmount")) || 0, paidAmount: Number(val("f_paidAmount")) || 0,
        notes: val("f_notes"), appointmentId: evt.appointmentId || null, items: itemsDraft,
        reserveFrom: range.from, reserveUntil: range.until,
      };
      if (!data.clientName) { toast("Add a client name"); return false; }
      if (isEdit) await api("PUT", "/api/events/" + evt.id, data); else await api("POST", "/api/events", data);
      await loadAll(); renderEvents(); renderOverview(); renderExpenses(); renderItems(); renderCalendar(); toast("Saved");
    });

    function updateRemaining() {
      var t = Number(val("f_totalAmount")) || 0, p = Number(val("f_paidAmount")) || 0;
      var remaining = Math.max(0, t - p);
      document.getElementById("f_remaining").textContent = remaining > 0 ? ("Remaining: " + fmtMoney(remaining)) : "Fully paid";
    }
    document.getElementById("f_totalAmount").addEventListener("input", updateRemaining);
    document.getElementById("f_paidAmount").addEventListener("input", updateRemaining);
    updateRemaining();

    function refreshItemPicker() {
      document.getElementById("eventItemPicker").innerHTML = itemPickerHtml();
      wireItemPicker();
    }
    function refreshItemsList() {
      document.getElementById("eventItemsList").innerHTML = itemsListHtml();
      document.getElementById("eventItemsList").querySelectorAll("[data-rm-item]").forEach(function (b) {
        b.addEventListener("click", function () { itemsDraft.splice(Number(b.dataset.rmItem), 1); refreshItemsList(); refreshItemPicker(); });
      });
    }
    function wireItemPicker() {
      var addBtn = document.getElementById("f_itemAdd");
      if (!addBtn) return;
      addBtn.addEventListener("click", function () {
        var itemId = val("f_itemPick"); var qty = Number(val("f_itemQty")) || 1;
        var item = state.items.find(function (i) { return i.id === itemId; });
        if (!item) return;
        var range = reserveRange();
        var avail = itemAvailability(itemId, range.from, range.until);
        if (qty > avail) { toast(avail > 0 ? ("Only " + avail + " available for this date range") : "Reserved for this date range"); return; }
        itemsDraft.push({ itemId: itemId, name: item.name, qty: qty });
        refreshItemsList();
        refreshItemPicker();
      });
    }
    document.getElementById("f_date").addEventListener("change", function () {
      if (!isEdit) { document.getElementById("f_reserveFrom").value = val("f_date"); document.getElementById("f_reserveUntil").value = val("f_date"); }
      refreshItemPicker();
    });
    document.getElementById("f_reserveFrom").addEventListener("change", refreshItemPicker);
    document.getElementById("f_reserveUntil").addEventListener("change", refreshItemPicker);
    wireItemPicker();
  }

  function printEventQuote(e) {
    var pay = paymentInfo(e.totalAmount, e.paidAmount);
    var itemsRows = (e.items || []).map(function (it) {
      return "<tr><td>" + escapeHtml(it.name) + '</td><td class="num">' + it.qty + "</td></tr>";
    }).join("");
    var html =
      '<div class="quote-head"><img src="assets/logo.jpg" alt=""><div><h1>Tochi Event</h1><div class="biz-sub">Studio operations — Event quote</div></div></div>' +
      '<div class="quote-title">' + catLabel(e.category) + " for " + escapeHtml(e.clientName || "Client") + "</div>" +
      '<div class="quote-grid">' +
        "<div><strong>Date</strong>: " + escapeHtml(e.date || "—") + (e.time ? " at " + escapeHtml(e.time) : "") + "</div>" +
        "<div><strong>Phone</strong>: " + escapeHtml(e.phone || "—") + "</div>" +
        "<div><strong>Location</strong>: " + escapeHtml(e.location || "—") + "</div>" +
        "<div><strong>Guests</strong>: " + escapeHtml(String(e.guestCount || "—")) + "</div>" +
      "</div>" +
      (itemsRows ? '<table class="quote-table"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>' + itemsRows + "</tbody></table>" : "") +
      '<div class="quote-summary">' +
        "<div><span>Total</span><span>" + fmtMoney(e.totalAmount) + "</span></div>" +
        "<div><span>Paid</span><span>" + fmtMoney(e.paidAmount) + "</span></div>" +
        '<div class="total"><span>Balance due (' + pay.label + ")</span><span>" + fmtMoney(pay.remaining) + "</span></div>" +
      "</div>" +
      '<div class="quote-footer">Generated ' + todayStr() + " · Tochi Event Studio Operations</div>";
    document.getElementById("printArea").innerHTML = html;
    window.print();
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
      return "<tr><td class=\"mono\">" + escapeHtml(e.date || "—") + "</td><td>" + escapeHtml(e.name || "—") + "</td><td>" + escapeHtml(e.category || "Other") + "</td><td>" + escapeHtml(eventLabel(e.eventId)) + '</td><td class="num">' + fmtMoney(e.amount) + '</td><td><div class="row-actions"><button class="icon-btn" data-edit="' + e.id + '" type="button" title="Edit">✎</button><button class="icon-btn" data-del="' + e.id + '" type="button" title="Delete">🗑</button></div></td></tr>';
    }).join("");
    wrap.innerHTML = "<table><thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Event</th><th>Amount</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
    wrap.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { openExpenseModal(state.expenses.find(function (x) { return x.id === b.dataset.edit; })); }); });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { confirmDelete("expenses", b.dataset.del, "expense"); }); });
  }

  function renderMonthlyBreakdown() {
    var el = document.getElementById("monthlyBreakdown");
    var rangeLabels = { month: "This month", year: "This year", all: "All time" };
    var inRange = breakdownRange === "all" ? function () { return true; } : breakdownRange === "year" ? isThisYear : isThisMonth;
    var rangeEvents = state.events.filter(function (e) { return inRange(e.date); });
    var rangeExpenses = state.expenses.filter(function (x) { return inRange(x.date); });

    var eventRows = rangeEvents.map(function (e) {
      var direct = rangeExpenses.filter(function (x) { return x.eventId === e.id; }).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
      return { e: e, direct: direct, profit: (Number(e.totalAmount) || 0) - direct };
    });
    var overheadTotal = rangeExpenses.filter(function (x) { return !x.eventId; }).reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
    var eventProfitSum = eventRows.reduce(function (s, r) { return s + r.profit; }, 0);
    var netProfit = eventProfitSum - overheadTotal;

    var headHtml = '<div class="section-head" style="padding:16px 16px 0"><h2 style="font-size:15px">' + rangeLabels[breakdownRange] + ': event profit vs. overhead</h2>' +
      '<div class="range-toggle" id="breakdownRangeToggle">' +
        '<button type="button" data-range="month" class="' + (breakdownRange === "month" ? "active" : "") + '">Month</button>' +
        '<button type="button" data-range="year" class="' + (breakdownRange === "year" ? "active" : "") + '">Year</button>' +
        '<button type="button" data-range="all" class="' + (breakdownRange === "all" ? "active" : "") + '">All time</button>' +
      "</div></div>";

    if (rangeEvents.length === 0 && overheadTotal === 0) {
      el.innerHTML = headHtml + '<div class="empty" style="padding:24px"><div class="glyph">🧾</div><p>No events or expenses logged for this range yet.</p></div>';
    } else {
      var rowsHtml = eventRows.map(function (r) {
        return "<tr><td>" + escapeHtml(r.e.clientName || "—") + " " + catPill(r.e.category) + '</td><td class="num">' + fmtMoney(r.e.totalAmount) + '</td><td class="num">' + fmtMoney(r.direct) + '</td><td class="num" style="color:' + (r.profit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(r.profit) + "</td></tr>";
      }).join("");
      el.innerHTML = headHtml +
        '<div class="table-wrap" style="padding:8px 16px 0"><table><thead><tr><th>Event</th><th>Revenue</th><th>Direct expenses</th><th>Event profit</th></tr></thead><tbody>' +
        (rowsHtml || '<tr><td colspan="4" class="section-sub">No events in this range.</td></tr>') + "</tbody></table></div>" +
        '<div style="padding:12px 16px 16px;display:flex;flex-direction:column;gap:4px">' +
          '<div style="display:flex;justify-content:space-between;font-size:13.5px"><span class="section-sub">Sum of event profits</span><span class="mono">' + fmtMoney(eventProfitSum) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:13.5px"><span class="section-sub">− Overhead expenses (rent, marketing, etc.)</span><span class="mono">' + fmtMoney(overheadTotal) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:2px"><span>Net profit — ' + rangeLabels[breakdownRange].toLowerCase() + '</span><span class="mono" style="color:' + (netProfit >= 0 ? "var(--success)" : "var(--danger)") + '">' + fmtMoney(netProfit) + "</span></div>" +
        "</div>";
    }
    document.getElementById("breakdownRangeToggle").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-range]");
      if (!btn) return;
      breakdownRange = btn.dataset.range;
      renderMonthlyBreakdown();
    });
  }

  function openExpenseModal(exp) {
    var isEdit = !!exp;
    exp = exp || { name: "", date: todayStr(), category: "", amount: 0, notes: "", eventId: "" };
    var isGeneral = !exp.eventId;
    var eventOptions = state.events.map(function (e) { return '<option value="' + e.id + '" ' + (exp.eventId === e.id ? "selected" : "") + ">" + escapeHtml(e.clientName || "Event") + " · " + escapeHtml(e.date || "") + "</option>"; }).join("");
    var catList = expenseCategoryOptions();
    var catOptionsHtml = '<option value="" ' + (exp.category ? "" : "selected") + ">Choose a category…</option>" +
      catList.map(function (c) { return '<option value="' + escapeHtml(c) + '" ' + (exp.category === c ? "selected" : "") + ">" + escapeHtml(c) + "</option>"; }).join("") +
      '<option value="__new__">+ Add new category…</option>';
    var body = field("Expense name", '<input type="text" id="f_name" autocomplete="off" value="' + escapeHtml(exp.name || "") + '" placeholder="e.g. Truck rental, Office rent">') +
      '<div class="field"><label>Type</label><div class="range-toggle" id="f_expType"><button type="button" data-type="event" class="' + (isGeneral ? "" : "active") + '">Event expense</button><button type="button" data-type="general" class="' + (isGeneral ? "active" : "") + '">General (overhead)</button></div></div>' +
      '<div class="field" id="f_eventWrap"' + (isGeneral ? " hidden" : "") + ">" + field("Which event", '<select id="f_eventId">' + eventOptions + "</select>") + "</div>" +
      '<div class="field-grid">' + field("Date", '<input type="date" id="f_date" value="' + escapeHtml(exp.date || todayStr()) + '">') + field("Amount", '<input type="number" id="f_amount" min="0" value="' + (exp.amount ?? 0) + '">') + "</div>" +
      '<div class="field"><label>Category</label><select id="f_category">' + catOptionsHtml + '</select><input type="text" id="f_categoryNew" autocomplete="off" placeholder="New category name" hidden style="margin-top:8px"></div>' +
      field("Notes", '<textarea id="f_notes">' + escapeHtml(exp.notes || "") + "</textarea>");
    openModal(isEdit ? "Edit expense" : "Add expense", body, async function () {
      var type = document.getElementById("f_expType").querySelector(".active").dataset.type;
      var eventId = type === "event" ? val("f_eventId") : null;
      if (type === "event" && !eventId) { toast("Pick which event this expense belongs to"); return false; }
      var category = val("f_category");
      if (category === "__new__") category = val("f_categoryNew");
      if (!category) { toast("Pick or add a category"); return false; }
      var data = { name: val("f_name"), date: val("f_date"), category: category, amount: Number(val("f_amount")) || 0, notes: val("f_notes"), eventId: eventId };
      if (!data.name) { toast("Give the expense a name"); return false; }
      if (isEdit) await api("PUT", "/api/expenses/" + exp.id, data); else await api("POST", "/api/expenses", data);
      await loadAll(); renderExpenses(); renderOverview(); renderEvents(); toast("Saved");
    });

    if (!state.events.length) {
      document.getElementById("f_eventWrap").innerHTML = '<p class="section-sub" style="margin:0">No events yet — add one first, or keep this as a general expense.</p>';
    }
    document.getElementById("f_expType").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-type]");
      if (!btn) return;
      document.querySelectorAll("#f_expType button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.getElementById("f_eventWrap").hidden = btn.dataset.type !== "event";
    });
    document.getElementById("f_category").addEventListener("change", function (e) {
      var isNew = e.target.value === "__new__";
      var newInput = document.getElementById("f_categoryNew");
      newInput.hidden = !isNew;
      if (isNew) newInput.focus();
    });
  }

  // ---------------- TEAM ----------------
  async function downloadBackup() {
    try {
      var res = await fetch("/api/backup", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { toast("Couldn't download backup."); return; }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "tochi-event-backup-" + todayStr() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("Couldn't download backup.");
    }
  }

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
        field("Name", '<input type="text" id="f_name" autocomplete="off" value="' + escapeHtml(user.name) + '">') +
        field("Role", '<select id="f_role"><option value="staff"' + (user.role === "staff" ? " selected" : "") + '>Staff (no expenses/profit)</option><option value="owner"' + (user.role === "owner" ? " selected" : "") + ">Owner (full access)</option></select>") +
      "</div>" +
      field("Email", '<input type="email" id="f_email" autocomplete="off" value="' + escapeHtml(user.email) + '">') +
      field(isEdit ? "New password" : "Temporary password", '<input type="text" id="f_password" autocomplete="off" placeholder="' + (isEdit ? "Leave blank to keep current password" : "They should change this after signing in") + '">');
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

  function openModal(title, bodyHtml, onSave, viewOnly) {
    var root = document.getElementById("modalRoot");
    var footer = viewOnly
      ? '<div class="modal-foot"><button class="btn primary" id="modalCancel" type="button">Close</button></div>'
      : '<div class="modal-foot"><button class="btn" id="modalCancel" type="button">Cancel</button><button class="btn primary" id="modalSave" type="button">Save</button></div>';
    root.innerHTML = '<div class="overlay" id="ovl"><div class="modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '"><div class="modal-head"><h3>' + escapeHtml(title) + '</h3><button class="icon-btn" id="modalClose" type="button" aria-label="Close">✕</button></div><div class="form-body">' + bodyHtml + '</div>' + footer + '</div></div>';
    function close() { root.innerHTML = ""; }
    document.getElementById("modalClose").addEventListener("click", close);
    document.getElementById("modalCancel").addEventListener("click", close);
    document.getElementById("ovl").addEventListener("click", function (e) { if (e.target.id === "ovl") close(); });
    if (viewOnly) return;
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
