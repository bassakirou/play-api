import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Textarea } from "../components/ui/textarea";
import { Dialog } from "../components/ui/dialog";
import { MultiSelect } from "../components/ui/multi-select";
import { ImageDropzone } from "../components/ui/image-dropzone";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { canAccess } from "../auth/rbac";

type Artist = {
  id: string;
  name: string;
  bio?: string | null;
  imageUrl?: string | null;
  bannerUrl?: string | null;
  gallery?: string | null;
  certified?: boolean;
  birthDate?: string | null;
  country?: string | null;
  gender?: string | null;
  albums?: { id: string; title: string }[];
  songs?: { id: string; title: string }[];
};

type ArtistGroup = {
  id: string;
  name: string;
  members?: { id: string; name: string }[];
};

export default function Artists() {
  const qc = useQueryClient();
  const { user, permissions } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ArtistGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [songsDetailArtist, setSongsDetailArtist] = useState<Artist | null>(
    null,
  );

  const [showArtistForm, setShowArtistForm] = useState(false);
  const [editingArtist, setEditingArtist] = useState<Artist | null>(null);
  const [artistName, setArtistName] = useState("");
  const [artistBio, setArtistBio] = useState("");
  const [artistCertified, setArtistCertified] = useState(false);
  const [artistImageUrl, setArtistImageUrl] = useState<File | null>(null);
  const [artistBannerUrl, setArtistBannerUrl] = useState<File | null>(null);
  const [artistGallery, setArtistGallery] = useState<File[]>([]);

  const removeFileFromGallery = (url: string) => {
    if (!editingArtist || !editingArtist.gallery) return;
    const gallery = JSON.parse(editingArtist.gallery);
    const nextGallery = gallery.filter((u: string) => u !== url);
    setEditingArtist({
      ...editingArtist,
      gallery: JSON.stringify(nextGallery),
    });
  };

  const artistsQuery = useQuery({
    queryKey: ["artists"],
    queryFn: async () => (await api.get("/artists")).data as Artist[],
  });

  const groupsQuery = useQuery({
    queryKey: ["artist-groups"],
    queryFn: async () =>
      (await api.get("/artist-groups")).data as ArtistGroup[],
  });

  const groupMutation = useMutation({
    mutationFn: async (payload: { name: string; memberIds: string[] }) =>
      (await api.post("/artist-groups", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist-groups"] });
      setGroupName("");
      setGroupMembers([]);
      setEditingGroup(null);
      setShowGroupForm(false);
      toast.success("Groupe créé");
    },
    onError: () => toast.error("Échec de création du groupe"),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      name: string;
      memberIds: string[];
    }) =>
      (
        await api.patch(`/artist-groups/${payload.id}`, {
          name: payload.name,
          memberIds: payload.memberIds,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist-groups"] });
      setGroupName("");
      setGroupMembers([]);
      setEditingGroup(null);
      setShowGroupForm(false);
      toast.success("Groupe mis à jour");
    },
    onError: () => toast.error("Échec de mise à jour du groupe"),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/artist-groups/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist-groups"] });
      toast.success("Groupe supprimé");
    },
    onError: () => toast.error("Échec de suppression du groupe"),
  });

  const saveArtistMutation = useMutation({
    mutationFn: async (payload: any) => {
      const uploadImage = async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post("/files/upload-image", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return res.data.url;
      };

      const updateData: any = {
        name: payload.name,
        bio: payload.bio,
        certified: payload.certified,
      };

      if (payload.image) {
        updateData.imageUrl = await uploadImage(payload.image);
      }
      if (payload.banner) {
        updateData.bannerUrl = await uploadImage(payload.banner);
      }
      if (payload.galleryFiles?.length) {
        const newUrls = await Promise.all(
          payload.galleryFiles.map((f: File) => uploadImage(f)),
        );
        const existingGallery = editingArtist?.gallery
          ? JSON.parse(editingArtist.gallery)
          : [];
        updateData.gallery = JSON.stringify([...existingGallery, ...newUrls]);
      }

      if (editingArtist) {
        return (await api.patch(`/artists/${editingArtist.id}`, updateData))
          .data;
      }
      return (await api.post("/artists", updateData)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      setShowArtistForm(false);
      setEditingArtist(null);
      toast.success(editingArtist ? "Artiste mis à jour" : "Artiste créé");
    },
    onError: (error: any) => {
      console.error(
        "Save artist error:",
        error.response?.data || error.message,
      );
      toast.error("Échec de sauvegarde de l'artiste");
    },
  });

  const deleteArtistMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/artists/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      toast.success("Artiste supprimé");
    },
    onError: () => toast.error("Échec de suppression"),
  });

  const filtered = useMemo(() => {
    const list = artistsQuery.data || [];
    return list.filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [artistsQuery.data, search]);

  const groupsByArtistId = useMemo(() => {
    const map: Record<string, ArtistGroup[]> = {};
    (groupsQuery.data || []).forEach((g) => {
      (g.members || []).forEach((m) => {
        if (!map[m.id]) map[m.id] = [];
        map[m.id].push(g);
      });
    });
    return map;
  }, [groupsQuery.data]);

  const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const roleName =
    typeof user?.role === "string" ? user?.role : (user as any)?.role?.name;
  const canManageArtists = canAccess(roleName, permissions, "update", "artist");
  const canCreateAlbum = canAccess(roleName, permissions, "create", "album");

  const artistOptions = (artistsQuery.data || []).map((a) => ({
    value: a.id,
    label: a.name,
  }));

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Artistes</CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Rechercher un artiste…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            {canManageArtists && (
              <>
                <Button
                  onClick={() => {
                    setEditingArtist(null);
                    setArtistName("");
                    setArtistBio("");
                    setArtistCertified(false);
                    setArtistImageUrl(null);
                    setArtistBannerUrl(null);
                    setArtistGallery([]);
                    setShowArtistForm(true);
                  }}
                >
                  Nouvel Artiste
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupName("");
                    setGroupMembers([]);
                    setShowGroupForm(true);
                  }}
                >
                  Regrouper en groupe
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {artistsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="space-y-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left bg-muted">
                    <tr>
                      <th className="p-2">Nom</th>
                      <th className="p-2">Albums</th>
                      <th className="p-2">Groupes</th>
                      <th className="p-2 text-center">Chansons</th>
                      <th className="p-2 w-40">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems?.map((a) => (
                      <tr key={a.id} className="border-b">
                        <td className="p-2">{a.name}</td>
                        <td className="p-2">
                          {a.albums && a.albums.length ? (
                            <div className="flex flex-wrap gap-1">
                              {a.albums.map((alb) => (
                                <Button
                                  key={alb.id}
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  onClick={() =>
                                    navigate(`/albums?artistId=${a.id}`)
                                  }
                                >
                                  {alb.title}
                                </Button>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2">
                          {(groupsByArtistId[a.id] || []).length
                            ? (groupsByArtistId[a.id] || [])
                                .map((g) => g.name)
                                .join(", ")
                            : "—"}
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span>{a.songs?.length ?? 0}</span>
                            {(a.songs?.length || 0) > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSongsDetailArtist(a)}
                              >
                                Détail
                              </Button>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="flex gap-2">
                            {canManageArtists && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingArtist(a);
                                    setArtistName(a.name);
                                    setArtistBio(a.bio || "");
                                    setArtistCertified(!!a.certified);
                                    setShowArtistForm(true);
                                  }}
                                >
                                  Éditer
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm("Supprimer cet artiste ?"))
                                      deleteArtistMutation.mutate(a.id);
                                  }}
                                >
                                  Suppr.
                                </Button>
                              </>
                            )}
                            {canCreateAlbum && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  navigate(`/albums?artistId=${a.id}&new=1`)
                                }
                              >
                                Ajouter un album
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
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page === totalPages}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold mb-2">
                  Groupes d&apos;artistes
                </h2>
                {groupsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">
                    Chargement des groupes…
                  </p>
                ) : (groupsQuery.data || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aucun groupe pour le moment.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(groupsQuery.data || []).map((g) => (
                      <div
                        key={g.id}
                        className="border rounded-md px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{g.name}</div>
                          {canManageArtists && (
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingGroup(g);
                                  setGroupName(g.name);
                                  setGroupMembers(
                                    (g.members || []).map((m) => m.id),
                                  );
                                  setShowGroupForm(true);
                                }}
                              >
                                Éditer
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteGroupMutation.mutate(g.id)}
                              >
                                Suppr.
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {(g.members || []).map((m) => m.name).join(", ") ||
                            "Aucun membre"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <Dialog
            open={showArtistForm}
            onOpenChange={(open) => {
              setShowArtistForm(open);
              if (!open) {
                setEditingArtist(null);
                setArtistName("");
                setArtistBio("");
                setArtistCertified(false);
                setArtistImageUrl(null);
                setArtistBannerUrl(null);
                setArtistGallery([]);
              }
            }}
            title={editingArtist ? "Modifier l'artiste" : "Nouvel artiste"}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveArtistMutation.mutate({
                  name: artistName,
                  bio: artistBio,
                  certified: artistCertified,
                  image: artistImageUrl,
                  banner: artistBannerUrl,
                  galleryFiles: artistGallery,
                });
              }}
              className="grid gap-4 max-h-[80vh] overflow-y-auto p-1"
            >
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Biographie</Label>
                <Textarea
                  value={artistBio}
                  onChange={(e) => setArtistBio(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="certified"
                  checked={artistCertified}
                  onCheckedChange={(checked) => setArtistCertified(!!checked)}
                />
                <Label htmlFor="certified">Artiste certifié</Label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Image de profil</Label>
                  <ImageDropzone
                    onSelected={setArtistImageUrl}
                    valueUrl={editingArtist?.imageUrl || ""}
                    onRemoveValueUrl={() => {
                      if (editingArtist)
                        setEditingArtist({ ...editingArtist, imageUrl: null });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bannière</Label>
                  <ImageDropzone
                    onSelected={setArtistBannerUrl}
                    valueUrl={editingArtist?.bannerUrl || ""}
                    onRemoveValueUrl={() => {
                      if (editingArtist)
                        setEditingArtist({ ...editingArtist, bannerUrl: null });
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Galerie photos</Label>
                <ImageDropzone
                  multiple
                  onFilesSelected={setArtistGallery}
                  valueUrls={
                    editingArtist?.gallery
                      ? JSON.parse(editingArtist.gallery)
                      : []
                  }
                  onRemoveValueUrl={removeFileFromGallery}
                />
              </div>

              <div className="flex gap-2 pt-4 sticky bottom-0 bg-background pb-2">
                <Button type="submit" disabled={saveArtistMutation.isPending}>
                  {editingArtist ? "Mettre à jour" : "Créer"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowArtistForm(false)}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </Dialog>

          <Dialog
            open={showGroupForm}
            onOpenChange={(open) => {
              setShowGroupForm(open);
              if (!open) {
                setEditingGroup(null);
                setGroupName("");
                setGroupMembers([]);
              }
            }}
            title={
              editingGroup
                ? "Modifier un groupe d’artistes"
                : "Nouveau groupe d’artistes"
            }
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!groupName.trim()) {
                  toast.error("Nom requis");
                  return;
                }
                if (!groupMembers.length) {
                  toast.error("Sélectionner au moins un artiste");
                  return;
                }
                if (editingGroup) {
                  updateGroupMutation.mutate({
                    id: editingGroup.id,
                    name: groupName.trim(),
                    memberIds: groupMembers,
                  });
                } else {
                  groupMutation.mutate({
                    name: groupName.trim(),
                    memberIds: groupMembers,
                  });
                }
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
                <Button
                  type="submit"
                  disabled={
                    groupMutation.isPending || updateGroupMutation.isPending
                  }
                >
                  {editingGroup ? "Mettre à jour" : "Créer"}
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
          <Dialog
            open={!!songsDetailArtist}
            onOpenChange={(open) => {
              if (!open) {
                setSongsDetailArtist(null);
              }
            }}
            title={
              songsDetailArtist ? `Chansons de ${songsDetailArtist.name}` : ""
            }
          >
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {songsDetailArtist?.songs && songsDetailArtist.songs.length ? (
                songsDetailArtist.songs.map((s) => (
                  <div key={s.id} className="text-sm">
                    {s.title}
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Aucune chanson.</p>
              )}
            </div>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
