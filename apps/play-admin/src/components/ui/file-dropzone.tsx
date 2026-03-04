import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/utils";

type SingleCb = (file: File, meta: { duration: number }) => void;
type MultiCb = (files: File[], metas: { duration: number }[]) => void;

type Props =
  | {
      multiple?: false;
      accept?: string;
      onSelected: SingleCb;
      onRemove?: (index: number) => void;
      className?: string;
      initialItems?: string[];
    }
  | {
      multiple: true;
      accept?: string;
      onSelected: MultiCb;
      onRemove?: (index: number) => void;
      className?: string;
      initialItems?: string[];
    };

export function FileDropzone(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [filesState, setFilesState] = useState<
    { file: File; meta: { duration: number } }[]
  >([]);

  const extractDuration = (file: File) =>
    new Promise<number>((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener("loadedmetadata", () => {
        const d = Math.round(audio.duration || 0);
        URL.revokeObjectURL(url);
        resolve(isFinite(d) ? d : 0);
      });
      audio.load();
    });

  const handleFiles = useCallback(
    async (files: FileList) => {
      const arr = Array.from(files);
      const durations = await Promise.all(arr.map(extractDuration));
      const metas = durations.map((d) => ({ duration: d }));
      if (props.multiple) {
        const merged = filesState.concat(
          arr.map((f, i) => ({ file: f, meta: metas[i] })),
        );
        setFilesState(merged);
        setNames(merged.map((i) => i.file.name));
        (props as any).onSelected(
          merged.map((i) => i.file),
          merged.map((i) => i.meta),
        );
      } else if (arr[0]) {
        setFilesState([{ file: arr[0], meta: metas[0] }]);
        setNames([arr[0].name]);
        (props as any).onSelected(arr[0], metas[0]);
      }
    },
    [props, filesState],
  );

  const removeAt = (index: number) => {
    if (!props.multiple) return;
    const initialLen = (props as any).initialItems?.length || 0;

    // If index is within initial items range, call onRemove prop
    if (index < initialLen) {
      if (props.onRemove) {
        props.onRemove(index);
      }
      return;
    }

    // Otherwise remove from local state (newly added files)
    const localIndex = index - initialLen;
    const next = filesState.filter((_, i) => i !== localIndex);
    setFilesState(next);
    setNames(next.map((i) => i.file.name));
    (props as any).onSelected(
      next.map((i) => i.file),
      next.map((i) => i.meta),
    );
  };

  const mergedNames =
    (props as any).initialItems && (props as any).initialItems.length
      ? ([...(props as any).initialItems, ...names] as string[])
      : names;

  return (
    <div
      className={cn("cursor-pointer", props.className)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          void handleFiles(e.dataTransfer.files);
        }
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={props.accept || "audio/*"}
        className="hidden"
        multiple={!!(props as any).multiple}
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />
      <div
        className={cn(
          "relative min-h-[6rem] flex flex-col items-center justify-center rounded-xl border-2 border-dotted border-gray-400/80 p-4 text-sm text-muted-foreground transition-colors",
          dragOver ? "bg-muted border-primary" : "bg-muted/30",
        )}
      >
        <div className="w-full">
          {props.multiple ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {mergedNames.length ? (
                mergedNames.map((n, idx) => (
                  <div
                    key={`${n}-${idx}`}
                    className="flex items-center justify-between rounded-xl border border-dotted border-gray-400/80 bg-background px-3 py-2 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                      <span className="text-base flex-shrink-0">♪</span>
                      <span className="truncate" title={n || ""}>
                        {n ||
                          "Glisser-déposer une musique, ou cliquer pour choisir"}
                      </span>
                    </div>
                    {props.multiple && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAt(idx);
                        }}
                        className="ml-2 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-gray-400/80 text-[10px] hover:bg-destructive hover:text-destructive-foreground transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="col-span-full flex items-center justify-center py-8 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-2xl">♪</span>
                    <span>
                      Glisser-déposer des musiques, ou cliquer pour choisir
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center gap-2 overflow-hidden max-w-full px-4">
                <span className="text-base flex-shrink-0">♪</span>
                <span className="truncate">
                  {names[0] ||
                    "Glisser-déposer une musique, ou cliquer pour choisir"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
