// Minimal signed, expiring login tokens using HMAC-SHA256 — a small
// hand-rolled equivalent of a JWT, since only this server ever issues or
// checks one. No external dependency needed.

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload, secret, ttlSeconds) {
  const body = base64url(JSON.stringify(Object.assign({}, payload, {
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { sign, verify };
