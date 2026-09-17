// Tiny file-backed JSON store. No external database needed — good enough
// for a small studio (a few users, a few thousand records total).
// Not built for high concurrency; fine for a 2-8 person team.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY_DB = {
  users: [],
  items: [],
  appointments: [],
  events: [],
  expenses: [],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
  }
}

function load() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Object.assign({}, EMPTY_DB, parsed);
  } catch (e) {
    console.error("db.json is corrupt — starting from an empty store. Backup left at db.json.bak");
    fs.copyFileSync(DB_FILE, DB_FILE + ".bak");
    return Object.assign({}, EMPTY_DB);
  }
}

// Simple in-process write queue so overlapping requests don't clobber
// each other's writes to the same file.
let writeChain = Promise.resolve();
function save(data) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeChain;
}

function id() {
  return crypto.randomBytes(9).toString("base64url");
}

// Collection helper: list/get/create/update/remove, always re-reading and
// re-saving the whole file (simple, correct, plenty fast at this scale).
function collection(name) {
  return {
    list() {
      return load()[name];
    },
    get(itemId) {
      return load()[name].find((r) => r.id === itemId) || null;
    },
    async create(record) {
      const data = load();
      const row = Object.assign({ id: id(), createdAt: new Date().toISOString() }, record);
      data[name].push(row);
      await save(data);
      return row;
    },
    async update(itemId, patch) {
      const data = load();
      const idx = data[name].findIndex((r) => r.id === itemId);
      if (idx === -1) return null;
      data[name][idx] = Object.assign({}, data[name][idx], patch, {
        updatedAt: new Date().toISOString(),
      });
      await save(data);
      return data[name][idx];
    },
    async remove(itemId) {
      const data = load();
      const before = data[name].length;
      data[name] = data[name].filter((r) => r.id !== itemId);
      await save(data);
      return data[name].length < before;
    },
  };
}

module.exports = { load, save, id, collection };
