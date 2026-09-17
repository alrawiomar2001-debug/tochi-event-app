const authToken = require("../lib/authToken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and set a real secret before starting the server.");
  process.exit(1);
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;

function sign(user) {
  return authToken.sign({ sub: user.id, role: user.role, name: user.name }, SECRET, THIRTY_DAYS);
}

// Reads the Bearer token, attaches req.user, rejects if missing/invalid.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  const payload = authToken.verify(token, SECRET);
  if (!payload) return res.status(401).json({ error: "Your session expired — sign in again." });
  req.user = { id: payload.sub, role: payload.role, name: payload.name };
  next();
}

// Use after requireAuth to restrict a route to owner-level accounts
// (expenses, profit, staff management).
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({ error: "Owner access only." });
  }
  next();
}

module.exports = { sign, requireAuth, requireOwner };
