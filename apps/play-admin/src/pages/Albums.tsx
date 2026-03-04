import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { canAccess } from "../auth/rbac";
import { Dialog } from "../components/ui/dialog";
import { FileDropzone } from "../components/ui/file-dropzone";
import { ImageDropzone } from "../components/ui/image-dropzone";

type Album = {
  id: string;
  title: string;
  year: number;
  artistId: string;
  coverUrl?: string;
  description?: string;
  songs?: { id: string; title: string; audioUrl: string; genreId: string }[];
};

export default function Albums() {
  const qc = useQueryClient();
  const { user, permissions } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Album | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const artistFilterId = searchParams.get("artistId") || "";
  const shouldOpenNew = searchParams.get("new") === "1";

  const schema = z.object({
    title: z.string().min(1),
    year: z.coerce.number().int().positive(),
    artistId: z.string().uuid(),
    genreId: z.string().uuid(),
    coverUrl: z.string().url().optional().or(z.literal("")),
    description: z.string().optional().or(z.literal("")),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      title: "",
      year: new Date().getFullYear(),
      artistId: "",
      genreId: "",
      coverUrl: "",
      description: "",
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["albums"],
    queryFn: async () => (await api.get("/albums")).data as Album[],
  });

  const artistsQuery = useQuery({
    queryKey: ["artists"],
    queryFn: async () =>
      (await api.get("/artists")).data as { id: string; name: string }[],
  });
  const genresQuery = useQuery({
    queryKey: ["genres"],
    queryFn: async () =>
      (await api.get("/genres")).data as { id: string; name: string }[],
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<Album>) => {
      if (editing) {
        return (await api.patch(`/albums/${editing.id}`, payload)).data;
      }
      return (await api.post("/albums", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums"] });
      setShowForm(false);
      setEditing(null);
      form.reset();
      toast.success(editing ? "Album mis à jour" : "Album créé");
    },
    onError: () => toast.error("Échec de sauvegarde de l’album"),
  });

  const deleteSongMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/songs/${id}`)).data,
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["albums"] });
      // Update local editing state to remove the song
      if (editing && editing.songs) {
        setEditing({
          ...editing,
          songs: editing.songs.filter((s) => s.id !== variables),
        });
      }
      if (data.albumDeleted) {
        toast.info(
          `L'album "${data.albumDeleted.title}" a été supprimé car aucun song ne lui est plus associé`,
          { duration: 5000 },
        );
        setShowForm(false);
        setEditing(null);
      } else {
        toast.success("Chanson supprimée de l'album");
      }
    },
    onError: () => toast.error("Échec de suppression de la chanson"),
  });

  const handleRemoveSong = (index: number) => {
    if (!editing || !editing.songs) return;
    const song = editing.songs[index];
    if (!song) return;

    if (
      confirm(`Voulez-vous vraiment supprimer la chanson "${song.title}" ?`)
    ) {
      deleteSongMutation.mutate(song.id);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/albums/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success("Album supprimé");
    },
    onError: () => toast.error("Échec de suppression"),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    setShowForm(true);
  };
  const openEdit = (alb: Album) => {
    setEditing(alb);
    form.reset({
      title: alb.title,
      year: alb.year,
      artistId: alb.artistId,
      coverUrl: alb.coverUrl || "",
      genreId: alb.songs && alb.songs.length ? alb.songs[0].genreId : "",
      description: alb.description || "",
    });
    setShowForm(true);
  };
  const onSubmit = async (values: FormValues) => {
    try {
      const album = await saveMutation.mutateAsync({
        title: values.title,
        year: values.year,
        artistId: values.artistId,
        coverUrl: values.coverUrl || undefined,
        description: values.description || undefined,
      });
      if (!editing && !pendingFiles.length) {
        toast.error("Ajoutez au moins un fichier audio");
        return;
      }
      for (let i = 0; i < pendingFiles.length; i++) {
        const f = pendingFiles[i];
        const d = pendingDurations[i];
        const fd = new FormData();
        fd.append("file", f);
        const up = await api.post("/files/upload-audio", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const audioUrl = up.data?.url || up.data?.filename;
        await api.post("/songs", {
          title: f.name.replace(/\.[^/.]+$/, ""),
          duration: d || 0,
          audioUrl,
          artistIds: [values.artistId],
          isSingle: false,
          albumId: album.id,
          genreId: values.genreId,
        });
      }
      qc.invalidateQueries({ queryKey: ["albums"] });
      qc.invalidateQueries({ queryKey: ["songs"] });
      setShowForm(false);
      setEditing(null);
      form.reset();
      setPendingFiles([]);
      setPendingDurations([]);
      toast.success("Album et chansons créés");
    } catch {
      toast.error("Échec de création");
    }
  };

  const filtered = useMemo(() => {
    const list = data || [];
    return list.filter((a) => {
      if (artistFilterId && a.artistId !== artistFilterId) return false;
      return a.title.toLowerCase().includes(search.toLowerCase());
    });
  }, [data, search, artistFilterId]);
  const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const roleName =
    typeof user?.role === "string" ? user?.role : (user as any)?.role?.name;
  const canCreate = canAccess(roleName, permissions, "create", "album");
  const canUpdate = canAccess(roleName, permissions, "update", "album");
  const canDelete = canAccess(roleName, permissions, "delete", "album");

  const artistOptions = [{ value: "", label: "— Choisir un artiste —" }].concat(
    (artistsQuery.data || []).map((a) => ({ value: a.id, label: a.name })),
  );
  const genreOptions = [{ value: "", label: "— Choisir un genre —" }].concat(
    (genresQuery.data || []).map((g) => ({ value: g.id, label: g.name })),
  );

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingDurations, setPendingDurations] = useState<number[]>([]);

  const artistFilterName =
    artistFilterId && artistsQuery.data
      ? artistsQuery.data.find((a) => a.id === artistFilterId)?.name || ""
      : "";

  useEffect(() => {
    if (!artistFilterId || !shouldOpenNew) return;
    if (!artistsQuery.data || !artistsQuery.data.length) return;
    const exists = artistsQuery.data.some((a) => a.id === artistFilterId);
    if (!exists) return;
    setEditing(null);
    form.reset({
      title: "",
      year: new Date().getFullYear(),
      artistId: artistFilterId,
      genreId: "",
      coverUrl: "",
      description: "",
    });
    setShowForm(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next);
  }, [
    artistFilterId,
    shouldOpenNew,
    artistsQuery.data,
    form,
    searchParams,
    setSearchParams,
  ]);

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Albums</CardTitle>
          <div className="flex flex-col gap-1 items-end">
            <div className="flex gap-2">
              <Input
                placeholder="Rechercher un album…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56"
              />
              {canCreate && <Button onClick={openCreate}>Nouveau</Button>}
            </div>
            {artistFilterName && (
              <div className="text-xs text-muted-foreground">
                Filtré par artiste :{" "}
                <span className="font-medium">{artistFilterName}</span>{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("artistId");
                    next.delete("new");
                    setSearchParams(next);
                  }}
                >
                  Réinitialiser
                </button>
              </div>
            )}
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
                    <th className="p-2">Titre</th>
                    <th className="p-2">Année</th>
                    <th className="p-2">Artist ID</th>
                    <th className="p-2 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems?.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {a.coverUrl ? (
                            <img
                              src={
                                a.coverUrl.startsWith("http")
                                  ? a.coverUrl
                                  : `${(api.defaults.baseURL || "").replace(/\/+$/, "")}${a.coverUrl}`
                              }
                              alt=""
                              className="h-8 w-8 rounded object-cover border"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded border bg-muted/60" />
                          )}
                          <span>{a.title}</span>
                        </div>
                      </td>
                      <td className="p-2">{a.year}</td>
                      <td className="p-2">{a.artistId}</td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          {canUpdate && (
                            <Button
                              variant="outline"
                              onClick={() => openEdit(a)}
                            >
                              Éditer
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(a.id)}
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
            title={editing ? "Mettre à jour un album" : "Nouvel album"}
          >
            <form
              onSubmit={form.handleSubmit(onSubmit as any)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2">
                <Input placeholder="Titre" {...form.register("title")} />
              </div>
              <Input
                placeholder="Année"
                type="number"
                {...form.register("year", { valueAsNumber: true })}
              />
              <Select options={artistOptions} {...form.register("artistId")} />
              <Select options={genreOptions} {...form.register("genreId")} />
              <div className="sm:col-span-2">
                <FileDropzone
                  multiple
                  initialItems={
                    editing?.songs?.map(
                      (s) =>
                        s.title || s.audioUrl.split("/").pop() || s.audioUrl,
                    ) || []
                  }
                  onSelected={(files, metas) => {
                    setPendingFiles(files);
                    setPendingDurations(metas.map((m) => m.duration));
                  }}
                  onRemove={handleRemoveSong}
                />
                {!editing && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Ajoutez au moins un audio
                  </div>
                )}
              </div>
              <div className="sm:col-span-2 space-y-1">
                <ImageDropzone
                  accept="image/jpeg,image/png,image/webp"
                  valueUrl={editing?.coverUrl}
                  previewSize={120}
                  onSelected={async (file) => {
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await api.post("/files/upload-image", fd, {
                        headers: { "Content-Type": "multipart/form-data" },
                      });
                      const url = res.data?.url || res.data?.filename || "";
                      if (!url) {
                        toast.error("Échec d'upload de l'image de couverture");
                        return;
                      }
                      form.setValue("coverUrl", url);
                    } catch {
                      toast.error("Échec d'upload de l'image de couverture");
                    }
                  }}
                />
                <div className="text-xs text-muted-foreground">
                  Formats acceptés : JPG, PNG, WEBP
                </div>
              </div>
              <Input
                placeholder="Description (optionnel)"
                {...form.register("description")}
              />
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
                    form.reset();
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
