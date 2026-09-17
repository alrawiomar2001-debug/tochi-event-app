// Creates the first owner account. Run once: `npm run seed`
// (safe to re-run — it won't duplicate an existing email).

require("../lib/loadEnv")();
const readline = require("readline");
const { hashPassword } = require("../lib/passwords");
const { collection } = require("../db");

const users = collection("users");

function ask(rl, question, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, resolve);
      return;
    }
    // Minimal masked input for the password prompt.
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    const onData = (char) => {
      char = char.toString("utf8");
      if (char === "\n" || char === "\r" || char === "") {
        stdin.removeListener("data", onData);
        stdin.setRawMode && stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (char === "") process.exit(1);
      if (char === "") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("Create the studio owner account (full access, including expenses & profit).\n");
  const name = await ask(rl, "Owner name: ");
  const email = await ask(rl, "Owner email: ");
  const password = await ask(rl, "Owner password: ", true);
  rl.close();

  if (!name || !email || !password) {
    console.error("\nAll three fields are required. Run `npm run seed` again.");
    process.exit(1);
  }

  const existing = users.list().find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.log(`\nAn account with ${email} already exists — nothing to do.`);
    process.exit(0);
  }

  const passwordHash = hashPassword(password);
  await users.create({ name, email, passwordHash, role: "owner" });
  console.log(`\nOwner account created for ${email}. Start the server with \`npm start\` and sign in.`);
}

main();
