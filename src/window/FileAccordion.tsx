/** @jsxImportSource react */
import type { ReactNode } from "react";

/** Native disclosure keeps mouse and keyboard folding in sync without animating the diff. */
export function FileAccordion({
  id,
  header,
  children,
  path,
  selected,
  onSelectionChange,
  selectionDisabled = false,
  expandable = true,
  emptyLabel = "No text changes",
}: {
  id: string;
  header: ReactNode;
  children: ReactNode;
  path: string;
  selected?: boolean;
  onSelectionChange?: (checked: boolean) => void;
  selectionDisabled?: boolean;
  expandable?: boolean;
  emptyLabel?: string;
}) {
  const controls = (
    <>
      <span className="file-sticky-sentinel" aria-hidden="true" />
      {expandable ? (
        <svg
          className="file-chevron"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m6 4 4 4-4 4" />
        </svg>
      ) : (
        <span className="file-chevron" aria-hidden="true" />
      )}
      {onSelectionChange ? (
        <input
          className="file-select"
          type="checkbox"
          aria-label={`Select ${path}`}
          checked={selected ?? false}
          disabled={selectionDisabled}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectionChange(event.target.checked)}
        />
      ) : null}
      {header}
      {!expandable ? <span className="file-empty-label">{emptyLabel}</span> : null}
    </>
  );
  if (!expandable) {
    return (
      <div className="file" id={id}>
        <div className="file-header file-header-static">{controls}</div>
      </div>
    );
  }
  return (
    <details className="file" id={id} open>
      <summary className="file-header">{controls}</summary>
      {children}
    </details>
  );
}

/** Navigation reveals a folded file before measuring or scrolling to its code. */
export function revealFileAccordion(element: HTMLElement | null) {
  if (element instanceof HTMLDetailsElement) element.open = true;
}

/** Fold the whole stream when any file is open; otherwise reveal every text diff. */
export function toggleFileAccordions(container: HTMLElement | null) {
  const files = [...(container?.querySelectorAll<HTMLDetailsElement>("details.file") ?? [])];
  const open = !files.some((file) => file.open);
  for (const file of files) file.open = open;
}
