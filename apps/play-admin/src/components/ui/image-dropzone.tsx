import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import api from "../../lib/api";

type Props = {
  accept?: string;
  onSelected?: (file: File | null) => void;
  onFilesSelected?: (files: File[]) => void;
  onRemoveValueUrl?: (url: string) => void;
  className?: string;
  valueUrl?: string;
  valueUrls?: string[];
  previewSize?: number;
  multiple?: boolean;
};

export function ImageDropzone({
  accept,
  onSelected,
  onFilesSelected,
  onRemoveValueUrl,
  className,
  valueUrl,
  valueUrls,
  previewSize,
  multiple,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFiles = (files: FileList) => {
    const arr = Array.from(files);
    if (!arr.length) return;

    if (multiple) {
      const nextFiles = [...selectedFiles, ...arr];
      setSelectedFiles(nextFiles);
      setNames((prev) => [...prev, ...arr.map((f) => f.name)]);
      const urls = arr.map((f) => URL.createObjectURL(f));
      setPreviews((prev) => [...prev, ...urls]);
      onFilesSelected?.(nextFiles);
    } else {
      setSelectedFiles([arr[0]]);
      setNames([arr[0].name]);
      const url = URL.createObjectURL(arr[0]);
      setPreviews([url]);
      onSelected?.(arr[0]);
    }
  };

  const removeFile = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    // Determine if it's a valueUrl (existing) or a preview (newly uploaded)
    const existingCount = multiple
      ? (valueUrls || []).length
      : valueUrl
        ? 1
        : 0;

    if (index < existingCount) {
      // Removing an existing URL
      if (multiple && valueUrls) {
        onRemoveValueUrl?.(valueUrls[index]);
      } else if (valueUrl) {
        onRemoveValueUrl?.(valueUrl);
      }
      return;
    }

    const previewIndex = index - existingCount;

    if (multiple) {
      const nextFiles = selectedFiles.filter((_, i) => i !== previewIndex);
      const nextNames = names.filter((_, i) => i !== previewIndex);
      const nextPreviews = previews.filter((_, i) => {
        if (i === previewIndex) URL.revokeObjectURL(previews[i]);
        return i !== previewIndex;
      });

      setSelectedFiles(nextFiles);
      setNames(nextNames);
      setPreviews(nextPreviews);
      onFilesSelected?.(nextFiles);
    } else {
      if (previews[0]) URL.revokeObjectURL(previews[0]);
      setSelectedFiles([]);
      setNames([]);
      setPreviews([]);
      onSelected?.(null);
    }
  };

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p));
    };
  }, [previews]);

  const getEffectiveUrl = (url?: string | null, preview?: string | null) => {
    if (preview) return preview;
    if (!url) return null;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("/")) {
      const base = (api.defaults.baseURL || "").replace(/\/+$/, "");
      return `${base}${url}`;
    }
    return url;
  };

  const allUrls = multiple
    ? [...(valueUrls || []), ...previews]
    : ([getEffectiveUrl(valueUrl, previews[0])].filter(Boolean) as string[]);

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-400/80 bg-muted/60 p-4 cursor-pointer",
        dragOver && "bg-muted",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          handleFiles(e.dataTransfer.files);
        }
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept || "image/jpeg,image/png,image/webp"}
        className="hidden"
        multiple={multiple}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <div
        className="relative flex flex-col items-center justify-center text-sm text-muted-foreground"
        style={{ minHeight: Math.max(96, (previewSize || 64) + 32) }}
      >
        <div className="absolute inset-2 rounded-xl border-2 border-dotted border-gray-400/80" />
        {allUrls.length > 0 ? (
          <div className="relative flex flex-wrap items-center justify-center gap-3 p-4">
            {allUrls.map((url, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-1 group relative"
              >
                <img
                  src={url}
                  alt="Preview"
                  className="rounded object-cover border"
                  style={{
                    width: previewSize || 64,
                    height: previewSize || 64,
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => removeFile(i, e)}
                  className="absolute -top-2 -right-2 bg-white text-black rounded-full p-0.5 shadow-md border hover:bg-gray-100 transition-colors z-10"
                >
                  <X className="w-3 h-3" />
                </button>
                {multiple && (
                  <div className="text-[10px] max-w-[4rem] truncate">
                    {names[i] || url.split("/").pop()}
                  </div>
                )}
              </div>
            ))}
            {!multiple && (
              <div className="text-xs max-w-[16rem] truncate">
                {names[0] || (valueUrl ? valueUrl.split("/").pop() : "")}
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex flex-col items-center gap-2">
            <span className="text-2xl">🖼️</span>
            <span>
              {multiple
                ? "Glisser-déposer des images"
                : "Glisser-déposer une image"}
              , ou cliquer
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
