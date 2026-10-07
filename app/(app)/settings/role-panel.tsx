"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Segmented, fieldClass } from "@/components/ui/form-controls";
import { SidePanel } from "@/components/ui/side-panel";
import { useI18n } from "@/components/i18n/locale-provider";
import { FEATURES, levelName, normalizePermissions, roleLabel, SYSTEM_ROLE_HELP, type Level, type Permissions, type SystemRoleName } from "@/lib/roles";

export type RoleRow = {
  id: string;
  name: string;
  description: string;
  system: SystemRoleName | null;
  permissions: Permissions;
  users: number;
};

/** Name, description and a level per feature. Owner and Admin open read-only. */
export function RolePanel({
  role,
  onClose,
  onSave,
  onDelete,
}: {
  role: RoleRow | null;
  onClose: () => void;
  onSave: (values: { name: string; description: string; permissions: Permissions }) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}) {
  const { t } = useI18n();
  const readOnly = Boolean(role?.system);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Permissions>(() => normalizePermissions({}));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPermissions(role?.permissions ?? normalizePermissions({}));
    setError(null);
    setConfirmDelete(false);
  }, [role]);

  function save() {
    start(async () => {
      const err = await onSave({ name, description, permissions });
      if (err) setError(err);
      else onClose();
    });
  }

  function remove() {
    if (!onDelete) return;
    if (!confirmDelete) return setConfirmDelete(true);
    start(async () => {
      const err = await onDelete();
      if (err) setError(err);
      else onClose();
    });
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={readOnly ? roleLabel(t, role!) : role ? t("Edit {0}", t("Role").toLowerCase()) : t("New role")}
      footer={
        readOnly ? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("Close")}
          </Button>
        ) : (
          <>
            {onDelete && (
              <Button variant={confirmDelete ? "danger" : "ghost"} size="sm" onClick={remove} disabled={pending} className="mr-auto">
                {confirmDelete ? t("Confirm delete") : t("Delete")}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button size="sm" onClick={save} loading={pending}>
              {t("Save")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>
        )}
        {readOnly ? (
          <p className="rounded-control border border-line bg-overlay/[0.03] px-3 py-2 text-[13px] text-ink-muted">
            {t(SYSTEM_ROLE_HELP[role!.system!])} {t("This role is fixed and can't be changed.")}
          </p>
        ) : (
          <>
            <Field label="Name *">
              <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Finance")} />
            </Field>
            <Field label="Description" hint="Optional. Shown when picking a role for a user.">
              <input className={fieldClass} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </>
        )}

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">{t("Access")}</p>
          <ul className="divide-y divide-line/60 rounded-control border border-line">
            {FEATURES.map((f) => {
              const level = permissions[f.key];
              return (
                <li key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{t(f.label)}</p>
                    <p className="text-[12px] text-ink-soft">{t(f.help)}</p>
                  </div>
                  {readOnly ? (
                    <Badge tone={level === "EDIT" ? "brand" : level === "VIEW" ? "outline" : "neutral"}>{t(levelName(f.key, level))}</Badge>
                  ) : (
                    <Segmented<Level>
                      value={level}
                      options={(f.levels as readonly Level[]).map((l) => ({ value: l, label: levelName(f.key, l) }))}
                      onChange={(v) => setPermissions((p) => ({ ...p, [f.key]: v }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {!readOnly && (
            <p className="mt-2 text-[12px] text-ink-soft">{t("Users and roles are managed by Owners and Admins only, so they aren't listed here.")}</p>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
