require("./lib/loadEnv")();
const path = require("path");
const express = require("express");

const authRoutes = require("./routes/auth");
const { crudRouter } = require("./routes/crud");

const app = express();
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/items", crudRouter("items"));
app.use("/api/appointments", crudRouter("appointments"));
app.use("/api/events", crudRouter("events"));
app.use("/api/expenses", crudRouter("expenses", { ownerOnly: true }));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`tochi.event dashboard running at http://localhost:${PORT}`);
});
