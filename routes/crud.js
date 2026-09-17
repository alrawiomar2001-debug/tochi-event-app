const express = require("express");
const { collection } = require("../db");
const { requireAuth, requireOwner } = require("../middleware/auth");

// Builds a standard list/create/update/delete router for a collection.
// Pass requireOwner: true for owner-only data (expenses).
function crudRouter(name, { ownerOnly = false } = {}) {
  const router = express.Router();
  const col = collection(name);
  const guards = ownerOnly ? [requireAuth, requireOwner] : [requireAuth];

  router.get("/", ...guards, (req, res) => {
    res.json({ items: col.list() });
  });

  router.post("/", ...guards, async (req, res) => {
    const record = Object.assign({}, req.body, { createdBy: req.user.id });
    const row = await col.create(record);
    res.status(201).json({ item: row });
  });

  router.put("/:id", ...guards, async (req, res) => {
    const row = await col.update(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: "Not found." });
    res.json({ item: row });
  });

  router.delete("/:id", ...guards, async (req, res) => {
    const ok = await col.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found." });
    res.status(204).end();
  });

  return router;
}

module.exports = { crudRouter };
