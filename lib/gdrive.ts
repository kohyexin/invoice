import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/* Google Drive as the PDF archive, via the REST API (no SDK). Uses the
 * `drive.file` scope: the app only sees files and folders it created itself. */

const SETTING_KEY = "gdrive";
const ROOT_FOLDER_NAME = "STAR SAAS Invoices";
const AGREEMENTS_FOLDER_NAME = "STAR SAAS Agreements";
const SIGNED_AGREEMENTS_FOLDER_NAME = "STAR SAAS Signed agreements";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type StoredConnection = {
  refreshToken: string;
  email: string;
  rootFolderId: string;
  /** Missing on connections made before agreements; created on first use. */
  agreementsFolderId?: string;
  signedAgreementsFolderId?: string;
  connectedAt: string;
};
export type DriveConnection = Omit<StoredConnection, "refreshToken"> & {
  folderUrl: string;
  agreementsFolderUrl: string | null;
  signedAgreementsFolderUrl: string | null;
};

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export function googleRedirectUri(req: Request) {
  return `${process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin}/api/google/callback`;
}

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/* ---------------------------- token at rest ---------------------------- */

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(`gdrive:${secret}`).digest();
}

function seal(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function open(sealed: string) {
  const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function readConnection(): Promise<StoredConnection | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return null;
  const v = row.value as Omit<StoredConnection, "refreshToken"> & { refreshToken: string };
  try {
    return { ...v, refreshToken: open(v.refreshToken) };
  } catch {
    return null;
  }
}

export async function getDriveConnection(): Promise<DriveConnection | null> {
  const c = await readConnection();
  if (!c) return null;
  const { refreshToken: _omit, ...rest } = c;
  void _omit;
  return {
    ...rest,
    folderUrl: folderUrl(c.rootFolderId),
    agreementsFolderUrl: c.agreementsFolderId ? folderUrl(c.agreementsFolderId) : null,
    signedAgreementsFolderUrl: c.signedAgreementsFolderId ? folderUrl(c.signedAgreementsFolderId) : null,
  };
}

/* ------------------------------ OAuth flow ----------------------------- */

export function driveAuthUrl(redirectUri: string, state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Finishes the OAuth flow: stores the refresh token and creates the archive folder. */
export async function connectDrive(code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error_description?: string };
  if (!res.ok || !tok.access_token) throw new Error(tok.error_description || "Google did not accept the sign-in.");
  if (!tok.refresh_token) throw new Error("Google did not return a long-lived token. Remove the app's access in your Google Account and connect again.");
  if (!tok.scope?.includes(DRIVE_SCOPE)) throw new Error("Drive access was not granted. Tick the Google Drive permission when connecting.");

  const email = tok.id_token ? (JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? "" : "";
  cachedToken = { token: tok.access_token, expires: Date.now() + 50 * 60_000 };
  folderCache.clear();
  const rootFolderId = await findOrCreateFolder(ROOT_FOLDER_NAME, "root");
  const agreementsFolderId = await findOrCreateFolder(AGREEMENTS_FOLDER_NAME, "root");
  const signedAgreementsFolderId = await findOrCreateFolder(SIGNED_AGREEMENTS_FOLDER_NAME, "root");

  const value = {
    refreshToken: seal(tok.refresh_token),
    email,
    rootFolderId,
    agreementsFolderId,
    signedAgreementsFolderId,
    connectedAt: new Date().toISOString(),
  };
  await prisma.appSetting.upsert({ where: { key: SETTING_KEY }, update: { value }, create: { key: SETTING_KEY, value } });
}

export async function disconnectDrive() {
  const c = await readConnection();
  await prisma.appSetting.deleteMany({ where: { key: SETTING_KEY } });
  cachedToken = null;
  folderCache.clear();
  if (c) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refreshToken)}`, { method: "POST" }).catch(() => undefined);
}

/* ----------------------------- API helpers ----------------------------- */

let cachedToken: { token: string; expires: number } | null = null;

async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  const c = await readConnection();
  if (!c) throw new Error("Google Drive is not connected.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    if (tok.error === "invalid_grant") throw new Error("Google Drive access expired or was removed. Reconnect it in Settings.");
    throw new Error("Couldn't sign in to Google Drive.");
  }
  cachedToken = { token: tok.access_token, expires: Date.now() + ((tok.expires_in ?? 3600) - 120) * 1000 };
  return cachedToken.token;
}

async function drive(path: string, init: RequestInit = {}, base = "https://www.googleapis.com/drive/v3") {
  const send = async () => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) } });
  let res = await send();
  // Google can revoke an access token before its stated expiry; get a fresh one and try once more.
  if (res.status === 401) {
    cachedToken = null;
    res = await send();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const err = new Error(body.error?.message || `Google Drive error ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

const folderCache = new Map<string, string>();
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findOrCreateFolder(name: string, parentId: string) {
  const cacheKey = `${parentId}/${name}`;
  const hit = folderCache.get(cacheKey);
  if (hit) return hit;
  const q = `mimeType='${FOLDER_MIME}' and name='${quote(name)}' and '${parentId}' in parents and trashed=false`;
  const found = (await (await drive(`/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)).json()) as { files: { id: string }[] };
  const id =
    found.files[0]?.id ??
    ((await (
      await drive("/files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      })
    ).json()) as { id: string }).id;
  folderCache.set(cacheKey, id);
  return id;
}

async function datedFolder(rootId: string, date: Date) {
  const y = String(date.getUTCFullYear());
  const m = `${y}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return findOrCreateFolder(m, await findOrCreateFolder(y, rootId));
}

/** Year / year-month folder under the invoice archive root, e.g. 2026 / 2026-09. */
export async function monthFolder(date: Date) {
  const c = await readConnection();
  if (!c) throw new Error("Google Drive is not connected.");
  return datedFolder(c.rootFolderId, date);
}

/** The agreement roots, created and saved on first use for older connections. */
export async function agreementFolders() {
  const c = await readConnection();
  if (!c) throw new Error("Google Drive is not connected.");
  if (c.agreementsFolderId && c.signedAgreementsFolderId) return { unsigned: c.agreementsFolderId, signed: c.signedAgreementsFolderId };
  const agreementsFolderId = c.agreementsFolderId ?? (await findOrCreateFolder(AGREEMENTS_FOLDER_NAME, "root"));
  const signedAgreementsFolderId = c.signedAgreementsFolderId ?? (await findOrCreateFolder(SIGNED_AGREEMENTS_FOLDER_NAME, "root"));
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: SETTING_KEY } });
  await prisma.appSetting.update({
    where: { key: SETTING_KEY },
    data: { value: { ...(row.value as object), agreementsFolderId, signedAgreementsFolderId } },
  });
  return { unsigned: agreementsFolderId, signed: signedAgreementsFolderId };
}

/** Year folder for an agreement PDF, under the unsigned or signed root, e.g. 2026. */
export async function agreementYearFolder(date: Date, signed: boolean) {
  const roots = await agreementFolders();
  return findOrCreateFolder(String(date.getUTCFullYear()), signed ? roots.signed : roots.unsigned);
}

function multipart(meta: object, data: Uint8Array, contentType: string) {
  const boundary = `inv${randomBytes(8).toString("hex")}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), Buffer.from(data), Buffer.from(`\r\n--${boundary}--`)]);
  return { body, type: `multipart/related; boundary=${boundary}` };
}

type DriveFile = { id: string; md5Checksum?: string };

export async function uploadFile(name: string, folderId: string, data: Uint8Array, contentType = "application/pdf"): Promise<DriveFile> {
  const { body, type } = multipart({ name, parents: [folderId] }, data, contentType);
  const res = await drive("/files?uploadType=multipart&fields=id,md5Checksum", { method: "POST", headers: { "Content-Type": type }, body }, "https://www.googleapis.com/upload/drive/v3");
  return (await res.json()) as DriveFile;
}

/** Replaces the content (Drive keeps the previous version) and/or renames and moves the file. */
export async function updateFile(
  fileId: string,
  opts: { name?: string; fromFolderId?: string | null; toFolderId?: string; data?: Uint8Array; contentType?: string }
): Promise<DriveFile> {
  const q = new URLSearchParams({ fields: "id,md5Checksum" });
  if (opts.toFolderId && opts.fromFolderId && opts.toFolderId !== opts.fromFolderId) {
    q.set("addParents", opts.toFolderId);
    q.set("removeParents", opts.fromFolderId);
  }
  const meta = opts.name ? { name: opts.name } : {};
  if (opts.data) {
    q.set("uploadType", "multipart");
    const { body, type } = multipart(meta, opts.data, opts.contentType ?? "application/pdf");
    const res = await drive(`/files/${fileId}?${q}`, { method: "PATCH", headers: { "Content-Type": type }, body }, "https://www.googleapis.com/upload/drive/v3");
    return (await res.json()) as DriveFile;
  }
  const res = await drive(`/files/${fileId}?${q}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
  return (await res.json()) as DriveFile;
}

export async function downloadFile(fileId: string) {
  const res = await drive(`/files/${fileId}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Moves a file to Drive's trash (recoverable for 30 days). Missing files count as done. */
export async function trashFile(fileId: string) {
  try {
    await drive(`/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  } catch (e) {
    if ((e as { status?: number }).status === 404) return;
    throw e;
  }
}
