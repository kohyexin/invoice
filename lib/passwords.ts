import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const MIN_PASSWORD = 10;

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** 12 characters, no look-alikes (0/O, 1/l/I), easy to read out or paste. */
export function generatePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function passwordProblem(password: string) {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return null;
}
