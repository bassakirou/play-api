import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { ALL_PERMISSIONS, canAccess } from "../auth/rbac";

type Role = {
  id: string;
  name: string;
  permissions: any;
};

export default function Roles() {
  const qc = useQueryClient();
  const { user, permissions: authPermissions } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/roles")).data as Role[],
  });
  const permQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: async () =>
      (await api.get("/permissions")).data as {
        id: string;
        action: string;
        resource: string;
      }[],
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<Role>) => {
      if (editing) return (await api.patch(`/roles/${editing.id}`, payload)).data;
      return (await api.post("/roles", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setShowForm(false);
      setEditing(null);
      setName("");
      setPermissions("");
      toast.success(editing ? "Rôle mis à jour" : "Rôle créé");
    },
    onError: () => toast.error("Échec de sauvegarde du rôle"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/roles/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Rôle supprimé");
    },
    onError: () => toast.error("Échec de suppression"),
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setPermissions("");
    setShowForm(true);
  };
  const openEdit = (r: Role) => {
    setEditing(r);
    setName(r.name);
    const perms = Array.isArray(r.permissions)
      ? r.permissions.map((p: any) => `${p.action}:${p.resource}`)
      : [];
    setPermissions(perms.join(","));
    setShowForm(true);
  };
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = permissions
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const parsed = entries
      .map((s) => {
        const [action, resource] = s.split(":");
        return action && resource ? { action, resource } : null;
      })
      .filter(Boolean) as { action: string; resource: string }[];
    const allPerms = permQuery.data || ALL_PERMISSIONS;
    const ids =
      "id" in (allPerms?.[0] || {})
        ? (parsed
            .map(
              (p) =>
                (allPerms as any[]).find(
                  (ap) => ap.action === p.action && ap.resource === p.resource,
                )?.id,
            )
            .filter(Boolean) as string[])
        : [];
    try {
      if (editing) {
        await saveMutation.mutateAsync({
          permissions: ids.length ? ids : undefined,
          name,
        });
      } else {
        await saveMutation.mutateAsync({
          name,
          permissions: ids.length ? ids : undefined,
        });
      }
    } catch {
      // handled by saveMutation onError
    }
  };

  const filtered = useMemo(() => {
    const list = data || [];
    return list.filter((r) =>
      r.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const roleName =
    typeof user?.role === "string" ? user?.role : (user as any)?.role?.name;
  const canCreate = canAccess(
    roleName,
    authPermissions as any,
    "create",
    "role",
  );
  const canUpdate = canAccess(
    roleName,
    authPermissions as any,
    "update",
    "role",
  );
  const canDelete = canAccess(
    roleName,
    authPermissions as any,
    "delete",
    "role",
  );

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rôles & Droits</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Rechercher un rôle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            {canCreate && <Button onClick={openCreate}>Nouveau</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left bg-muted">
                  <tr>
                    <th className="p-2">Nom</th>
                    <th className="p-2">Droits</th>
                    <th className="p-2 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems?.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">
                        {(Array.isArray(r.permissions) ? r.permissions : [])
                          .map((p: any) => `${p.action}:${p.resource}`)
                          .join(", ")}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          {canUpdate && (
                            <Button
                              variant="outline"
                              onClick={() => openEdit(r)}
                            >
                              Éditer
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(r.id)}
                            >
                              Suppr.
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-4">
                <div className="text-xs text-muted-foreground">
                  Page {page} / {totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Précédent
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Suivant
                  </Button>
                </div>
              </div>
            </div>
          )}
          {showForm && (
            <form onSubmit={onSubmit} className="mt-6 grid gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Nom du rôle"
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  required
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {["song", "album", "artist", "genre"].map((res) => (
                  <div key={res} className="border rounded-md p-3">
                    <div className="font-medium mb-2 capitalize">{res}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(permQuery.data || ALL_PERMISSIONS)
                        .filter((p) => p.resource === res)
                        .map((p) => {
                          const key = `${p.action}:${p.resource}`;
                          const checked = permissions
                            .split(",")
                            .map((s) => s.trim())
                            .includes(key);
                          return (
                            <label
                              key={key}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const set = new Set(
                                    permissions
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  );
                                  if (e.target.checked) set.add(key);
                                  else set.delete(key);
                                  setPermissions(Array.from(set).join(","));
                                }}
                              />
                              <span>{p.action}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="submit">Enregistrer</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
