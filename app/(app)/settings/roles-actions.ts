"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { normalizePermissions } from "@/lib/roles";
import { authorizeManager } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

/** Creates or edits a custom role. Owner and Admin are fixed in code. */
export async function saveRole(id: string | null, input: { name?: unknown; description?: unknown; permissions?: unknown }): Promise<Result> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 40) return { ok: false, error: "Keep the name under 40 characters." };
  const permissions = normalizePermissions(input.permissions);

  const clash = await prisma.appRole.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false, error: "Another role already has that name." };

  if (id) {
    const before = await prisma.appRole.findUnique({ where: { id }, select: { system: true, name: true, description: true, permissions: true } });
    if (!before) return { ok: false, error: "That role no longer exists." };
    if (before.system) return { ok: false, error: "Owner and Admin can't be changed." };
    await prisma.appRole.update({ where: { id }, data: { name, description, permissions } });
    const old = normalizePermissions(before.permissions);
    await logActivity(auth.user, {
      action: "update",
      entity: "role",
      entityId: id,
      label: name,
      before: { name: before.name, description: before.description, ...old },
      after: { name, description, ...permissions },
    });
  } else {
    const last = await prisma.appRole.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.appRole.create({ data: { name, description, permissions, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    await logActivity(auth.user, { action: "create", entity: "role", entityId: row.id, label: name, after: { description, ...permissions } });
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Only a role nobody has (including disabled users) can be deleted. */
export async function deleteRole(id: string): Promise<Result> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const role = await prisma.appRole.findUnique({ where: { id }, select: { name: true, description: true, permissions: true, system: true, _count: { select: { users: true } } } });
  if (!role) return { ok: false, error: "That role no longer exists." };
  if (role.system) return { ok: false, error: "Owner and Admin can't be deleted." };
  if (role._count.users > 0) return { ok: false, error: "Move everyone with this role to another role first, including disabled users." };
  await prisma.appRole.delete({ where: { id } });
  await logActivity(auth.user, {
    action: "delete",
    entity: "role",
    entityId: id,
    label: role.name,
    before: { description: role.description, ...normalizePermissions(role.permissions) },
  });
  revalidatePath("/settings");
  return { ok: true };
}
