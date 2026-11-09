// drop.ts — drop-target hook, ported from the prototype's fbUseDrop. Highlights on
// internal-move (application/x-fb-ids) or OS-file drags, and calls onDrop.
// Returns [over, handlers, fileOver] — fileOver is true only for OS file drags.

import React from "react";

export type DropHandlers = {
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

export const FB_IDS_MIME = "application/x-fb-ids";

export function useDrop(
  onDrop: (e: React.DragEvent) => void,
  canDrop = true,
): [boolean, DropHandlers, boolean] {
  const [over, setOver] = React.useState(false);
  const [fileOver, setFileOver] = React.useState(false);
  const depth = React.useRef(0);
  if (!canDrop) return [false, {}, false];
  const isFiles = (e: React.DragEvent) => {
    const t = e.dataTransfer && e.dataTransfer.types;
    return !!(t && [...t].includes("Files"));
  };
  const has = (e: React.DragEvent) => {
    const t = e.dataTransfer && e.dataTransfer.types;
    return !!(t && ([...t].includes(FB_IDS_MIME) || [...t].includes("Files")));
  };
  return [
    over,
    {
      onDragEnter: (e) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
        setFileOver(isFiles(e));
      },
      onDragOver: (e) => {
        if (!has(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = isFiles(e) ? "copy" : "move";
      },
      onDragLeave: () => {
        depth.current--;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
          setFileOver(false);
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        setFileOver(false);
        onDrop(e);
      },
    },
    fileOver,
  ];
}
