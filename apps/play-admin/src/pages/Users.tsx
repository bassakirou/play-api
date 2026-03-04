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
import { Label } from "../components/ui/label";
import { Dialog } from "../components/ui/dialog";
import { Select } from "../components/ui/select";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { canAccess } from "../auth/rbac";

type AppUser = {
  id: string;
  email: string;
  name?: string;
  role: any;
};

type UserPayload = {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
  birthDate?: string;
  country?: string;
  gender?: string;
};

export default function Users() {
  const qc = useQueryClient();
  const { user, permissions } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState("");
  const [gender, setGender] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data as AppUser[],
  });
  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () =>
      (await api.get("/roles")).data as { id: string; name: string }[],
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: UserPayload) => {
      if (editing) return (await api.put(`/users/${editing.id}`, payload)).data;
      return (await api.post("/users", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowForm(false);
      setEditing(null);
      setEmail("");
      setName("");
      setRole("user");
      setPassword("");
      toast.success(editing ? "Utilisateur mis à jour" : "Utilisateur créé");
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        "Échec de sauvegarde de l’utilisateur";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Utilisateur supprimé");
    },
    onError: () => toast.error("Échec de suppression"),
  });

  const openCreate = () => {
    setEditing(null);
    setEmail("");
    setName("");
    setRole("user");
    setPassword("");
    setShowForm(true);
  };
  const openEdit = (u: AppUser) => {
    setEditing(u);
    setEmail(u.email);
    setName(u.name || "");
    setRole(u.role?.name ?? u.role);
    setShowForm(true);
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      saveMutation.mutate({ email, name });
    } else {
      saveMutation.mutate({
        email,
        name,
        password,
        role: role.toUpperCase(),
        ...(role.toUpperCase() === "CREATOR"
          ? { birthDate, country, gender }
          : {}),
      });
    }
  };

  const filtered = useMemo(() => {
    const list = data || [];
    return list.filter((u) =>
      `${u.email} ${u.name || ""}`.toLowerCase().includes(search.toLowerCase()),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const roleName =
    typeof user?.role === "string" ? user?.role : (user as any)?.role?.name;
  const canCreate = canAccess(roleName, permissions, "create", "user");
  const canUpdate = canAccess(roleName, permissions, "update", "user");
  const canDelete = canAccess(roleName, permissions, "delete", "user");

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Utilisateurs</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Rechercher un utilisateur…"
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
                    <th className="p-2">Email</th>
                    <th className="p-2">Nom</th>
                    <th className="p-2">Rôle</th>
                    <th className="p-2 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems?.map((u) => (
                    <tr key={u.id} className="border-b">
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">{u.name}</td>
                      <td className="p-2">{u.role?.name ?? u.role}</td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          {canUpdate && (
                            <Button
                              variant="outline"
                              onClick={() => openEdit(u)}
                            >
                              Éditer
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(u.id)}
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
          <Dialog
            open={showForm}
            onOpenChange={setShowForm}
            title={
              editing ? "Mettre à jour un utilisateur" : "Nouvel utilisateur"
            }
          >
            <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-2">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              {!editing && (
                <div className="space-y-2">
                  <Label>Mot de passe</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Rôle</Label>
                <Select
                  options={[
                    { value: "", label: "— Choisir un rôle —" },
                    ...(rolesQuery.data || []).map((r) => ({
                      value: r.name,
                      label: r.name,
                    })),
                  ]}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </div>

              {role.toUpperCase() === "CREATOR" && !editing && (
                <>
                  <div className="space-y-2">
                    <Label>Date de naissance</Label>
                    <Input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Pays</Label>
                    <Input
                      placeholder="Ex: Cameroun"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Genre</Label>
                    <Select
                      options={[
                        { value: "", label: "Non spécifié" },
                        { value: "MALE", label: "Homme" },
                        { value: "FEMALE", label: "Femme" },
                        { value: "OTHER", label: "Autre" },
                      ]}
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {editing ? "Mettre à jour" : "Créer"}
                </Button>
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
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
