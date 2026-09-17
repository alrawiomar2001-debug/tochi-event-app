const express = require("express");
const { hashPassword, verifyPassword } = require("../lib/passwords");
const { collection } = require("../db");
const { sign, requireAuth, requireOwner } = require("../middleware/auth");

const router = express.Router();
const users = collection("users");

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

// POST /api/auth/login  { email, password }
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const user = users.list().find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  const token = sign(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const user = users.get(req.user.id);
  if (!user) return res.status(401).json({ error: "Account no longer exists." });
  res.json({ user: publicUser(user) });
});

// GET /api/auth/team  (owner only) — list team accounts
router.get("/team", requireAuth, requireOwner, (req, res) => {
  res.json({ team: users.list().map(publicUser) });
});

// POST /api/auth/team  (owner only) — add a staff or owner account
router.post("/team", requireAuth, requireOwner, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (!["owner", "staff"].includes(role)) {
    return res.status(400).json({ error: "Role must be 'owner' or 'staff'." });
  }
  if (users.list().some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const passwordHash = hashPassword(password);
  const user = await users.create({ name, email, passwordHash, role });
  res.status(201).json({ user: publicUser(user) });
});

// PUT /api/auth/team/:id  (owner only) — edit a team account's name/email/role/password
router.put("/team/:id", requireAuth, requireOwner, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  if (role && !["owner", "staff"].includes(role)) {
    return res.status(400).json({ error: "Role must be 'owner' or 'staff'." });
  }
  const existing = users.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Account not found." });
  const dupe = users.list().find((u) => u.id !== req.params.id && u.email.toLowerCase() === String(email).toLowerCase());
  if (dupe) return res.status(409).json({ error: "An account with that email already exists." });
  if (req.params.id === req.user.id && role && role !== "owner") {
    return res.status(400).json({ error: "You can't remove your own owner access." });
  }
  const patch = { name, email };
  if (role) patch.role = role;
  if (password) patch.passwordHash = hashPassword(password);
  const updated = await users.update(req.params.id, patch);
  res.json({ user: publicUser(updated) });
});

// DELETE /api/auth/team/:id  (owner only) — remove a team account
router.delete("/team/:id", requireAuth, requireOwner, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't remove your own account." });
  }
  const ok = await users.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Account not found." });
  res.status(204).end();
});

module.exports = router;
