import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
// Escape `$` so the value can be pasted straight into .env.
console.log(`APP_PASSWORD_HASH="${hash.replace(/\$/g, "\\$")}"`);
