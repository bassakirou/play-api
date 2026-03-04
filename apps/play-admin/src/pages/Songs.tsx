import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
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
import { MultiSelect } from "../components/ui/multi-select";

type Song = {
  id: string;
  title: string;
  duration: number;
  coverUrl?: string;
  isSingle?: boolean;
  audioUrl: string;
  artists?: { id: string; name: string }[];
  groups?: { id: string; name: string }[];
  albumId?: string;
  genreId?: string;
};

export default function Songs() {
  const qc = useQueryClient();
  const { user, permissions } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editing, setEditing] = useState<Song | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [player] = useState<HTMLAudioElement>(() => new Audio());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const schema = z
    .object({
      title: z.string().min(1),
      duration: z.coerce.number().int().positive(),
      audioUrl: z.string().min(1),
      artistIds: z.array(z.string().uuid()).min(1),
      groupIds: z.array(z.string().uuid()).optional(),
      kind: z.enum(["single", "album"]),
      coverUrl: z.string().url().optional().or(z.literal("")),
      albumId: z.string().uuid().optional().or(z.literal("")),
      genreId: z.string().uuid(),
      releaseDate: z.string().optional(),
    })
    .superRefine((values, ctx) => {
      if (values.kind === "single") {
        if (!values.coverUrl || values.coverUrl.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["coverUrl"],
            message: "La couverture est obligatoire pour un single",
          });
        }
        if (values.albumId && values.albumId !== "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["albumId"],
            message: "Un single ne doit pas être rattaché à un album",
          });
        }
      } else {
        if (!values.albumId || values.albumId === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["albumId"],
            message: "L’album est obligatoire pour un titre d’album",
          });
        }
      }
    });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      title: "",
      duration: 0,
      audioUrl: "",
      artistIds: [],
      groupIds: [],
      kind: "single",
      coverUrl: "",
      albumId: "",
      genreId: "",
      releaseDate: "",
    },
  });
  const [albumSelection, setAlbumSelection] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["songs"],
    queryFn: async () => (await api.get("/songs")).data as Song[],
  });

  const artistsQuery = useQuery({
    queryKey: ["artists-creators"],
    queryFn: async () =>
      (await api.get("/artists/creators")).data as {
        id: string;
        name: string;
      }[],
  });
  const groupsQuery = useQuery({
    queryKey: ["artist-groups"],
    queryFn: async () =>
      (await api.get("/artist-groups")).data as { id: string; name: string }[],
  });
  const albumsQuery = useQuery({
    queryKey: ["albums-all"],
    queryFn: async () =>
      (await api.get("/albums")).data as {
        id: string;
        title: string;
        artistId: string;
      }[],
  });
  const genresQuery = useQuery({
    queryKey: ["genres"],
    queryFn: async () =>
      (await api.get("/genres")).data as { id: string; name: string }[],
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (editing) {
        return (await api.put(`/songs/${editing.id}`, payload)).data;
      }
      return (await api.post("/songs", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["songs"] });
      setShowForm(false);
      setEditing(null);
      form.reset();
      toast.success(editing ? "Chanson mise à jour" : "Chanson créée");
    },
    onError: () => toast.error("Échec de sauvegarde de la chanson"),
  });
  const groupMutation = useMutation({
    mutationFn: async (payload: { name: string; memberIds: string[] }) =>
      (await api.post("/artist-groups", payload)).data,
    onSuccess: () => {
      groupsQuery.refetch();
      setGroupName("");
      setGroupMembers([]);
      setShowGroupForm(false);
      toast.success("Groupe créé");
    },
    onError: () => toast.error("Échec de création du groupe"),
  });

  useEffect(() => {
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentId(null);
    };
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  const resolveAudioUrl = (u: string) => {
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) {
      // Legacy MinIO direct link without query: route via API resolver to get a presigned URL
      if (/localhost:9000/.test(u) && !u.includes("?")) {
        const base = (api.defaults.baseURL || "").replace(/\/+$/, "");
        return `${base}/files/resolved-audio?url=${encodeURIComponent(u)}`;
      }
      return u;
    }
    const base = (api.defaults.baseURL || "").replace(/\/+$/, "");
    return `${base}${u}`;
  };

  const togglePlay = (s: Song) => {
    const src = resolveAudioUrl(s.audioUrl);
    if (!src) return;
    if (currentId === s.id && isPlaying) {
      player.pause();
      return;
    }
    if (player.src !== src) {
      player.src = src;
    }
    setCurrentId(s.id);
    void player.play().catch(() => undefined);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/songs/${id}`)).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["songs"] });
      qc.invalidateQueries({ queryKey: ["albums"] });
      if (data.albumDeleted) {
        toast.info(
          `L'album "${data.albumDeleted.title}" a été supprimé car aucun song ne lui est plus associé`,
          { duration: 5000 },
        );
      } else {
        toast.success("Chanson supprimée");
      }
    },
    onError: () => toast.error("Échec de suppression"),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    setAlbumSelection([]);
    setGroupName("");
    setGroupMembers([]);
    setShowForm(true);
  };
  const openEdit = (song: Song) => {
    setEditing(song);
    const isSingle = song.isSingle ?? !song.albumId;
    form.reset({
      title: song.title,
      duration: song.duration,
      audioUrl: song.audioUrl,
      artistIds: (song.artists || []).map((a) => a.id),
      groupIds: (song.groups || []).map((g) => g.id),
      kind: isSingle ? "single" : "album",
      coverUrl: song.coverUrl || "",
      albumId: song.albumId || "",
      genreId: song.genreId || "",
    });
    setAlbumSelection(song.albumId && !isSingle ? [song.albumId] : []);
    setShowForm(true);
  };
  const onSubmit = (values: FormValues) => {
    const isSingle = values.kind === "single";
    saveMutation.mutate({
      title: values.title,
      duration: values.duration,
      audioUrl: values.audioUrl,
      artistIds: values.artistIds,
      groupIds: values.groupIds,
      isSingle,
      coverUrl: values.coverUrl || undefined,
      albumId: isSingle ? undefined : values.albumId || undefined,
      genreId: values.genreId,
      releaseDate: values.releaseDate,
    });
  };

  const filtered = useMemo(() => {
    const list = data || [];
    return list.filter((s) =>
      s.title.toLowerCase().includes(search.toLowerCase()),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const roleName =
    typeof user?.role === "string" ? user?.role : (user as any)?.role?.name;
  const canCreate = canAccess(roleName, permissions, "create", "song");
  const canUpdate = canAccess(roleName, permissions, "update", "song");
  const canDelete = canAccess(roleName, permissions, "delete", "song");

  const artistOptions = (artistsQuery.data || []).map((a) => ({
    value: a.id,
    label: a.name,
  }));
  const groupOptions = (groupsQuery.data || []).map((g) => ({
    value: g.id,
    label: g.name,
  }));
  const albumOptions = (albumsQuery.data || []).map((a) => ({
    value: a.id,
    label: a.title,
  }));
  const genreOptions = [{ value: "", label: "— Choisir un genre —" }].concat(
    (genresQuery.data || []).map((g) => ({ value: g.id, label: g.name })),
  );
  const kindOptions = [
    { value: "single", label: "Single" },
    { value: "album", label: "Titre d’album" },
  ];

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Songs</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Rechercher un titre…"
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
                    <th className="p-2">Titre</th>
                    <th className="p-2">Durée (s)</th>
                    <th className="p-2">Audio URL</th>
                    <th className="p-2 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems?.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-2">{s.title}</td>
                      <td className="p-2">{s.duration}</td>
                      <td className="p-2 truncate max-w-[240px]">
                        {s.audioUrl}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => togglePlay(s)}
                          >
                            {currentId === s.id && isPlaying ? "Pause" : "Play"}
                          </Button>
                          {canUpdate && (
                            <Button
                              variant="outline"
                              onClick={() => openEdit(s)}
                            >
                              Éditer
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(s.id)}
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
            title={editing ? "Mettre à jour une chanson" : "Nouvelle chanson"}
          >
            <form
              onSubmit={form.handleSubmit(onSubmit as any)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2">
                <Input placeholder="Titre" {...form.register("title")} />
              </div>
              <div className="sm:col-span-2">
                <FileDropzone
                  onSelected={async (file, meta) => {
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await api.post("/files/upload-audio", fd, {
                        headers: { "Content-Type": "multipart/form-data" },
                      });
                      const url = res.data?.url || res.data?.filename || "";
                      if (!url) {
                        toast.error("Échec d'upload");
                        return;
                      }
                      form.setValue("audioUrl", url);
                      form.setValue("duration", meta.duration);
                    } catch {
                      toast.error("Échec d'upload du fichier audio");
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select options={kindOptions} {...form.register("kind")} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Artistes</label>
                <MultiSelect
                  options={artistOptions}
                  value={form.watch("artistIds")}
                  onChange={(vals) => form.setValue("artistIds", vals)}
                  placeholder="Rechercher un artiste..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Groupes d'artistes
                </label>
                <MultiSelect
                  options={groupOptions}
                  value={form.watch("groupIds") || []}
                  onChange={(vals) => form.setValue("groupIds", vals)}
                  placeholder="Rechercher un groupe..."
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowGroupForm(true)}
                >
                  Créer un groupe
                </Button>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Album</label>
                <MultiSelect
                  options={albumOptions}
                  value={albumSelection}
                  multiple={false}
                  onChange={(vals) => {
                    setAlbumSelection(vals);
                    form.setValue("albumId", vals[0] || "");
                  }}
                  placeholder="Rechercher un album..."
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <ImageDropzone
                  accept="image/jpeg,image/png,image/webp"
                  onSelected={async (file: string | Blob) => {
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
              <Select options={genreOptions} {...form.register("genreId")} />
              <Input type="date" {...form.register("releaseDate")} />
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
          <Dialog
            open={showGroupForm}
            onOpenChange={setShowGroupForm}
            title="Nouveau groupe d’artistes"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!groupName.trim()) {
                  toast.error("Nom requis");
                  return;
                }
                groupMutation.mutate({
                  name: groupName.trim(),
                  memberIds: groupMembers,
                });
              }}
              className="grid gap-3"
            >
              <Input
                placeholder="Nom du groupe"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
              />
              <MultiSelect
                options={artistOptions}
                value={groupMembers}
                onChange={setGroupMembers}
                placeholder="Sélectionner des artistes..."
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={groupMutation.isPending}>
                  Créer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowGroupForm(false)}
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
