require("./lib/loadEnv")();
const path = require("path");
const express = require("express");

const authRoutes = require("./routes/auth");
const { crudRouter } = require("./routes/crud");
const { requireAuth, requireOwner } = require("./middleware/auth");
const db = require("./db");

const app = express();
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/items", crudRouter("items"));
app.use("/api/appointments", crudRouter("appointments"));
app.use("/api/events", crudRouter("events"));
app.use("/api/expenses", crudRouter("expenses", { ownerOnly: true }));

// GET /api/backup  (owner only) — full data snapshot as a downloadable file.
app.get("/api/backup", requireAuth, requireOwner, (req, res) => {
  const data = db.load();
  delete data.users; // never ship password hashes in a backup file
  const filename = `tochi-event-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(data);
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`tochi.event dashboard running at http://localhost:${PORT}`);
});
