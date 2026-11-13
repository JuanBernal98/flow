/** Observe the actual sticky boundary without rerendering the review during scroll. */
export function observeStickyFileHeaders(container: HTMLElement | null) {
  if (!container) return () => {};
  const positions = new Map<HTMLElement, boolean>();
  let hasScrolled = container.scrollTop > 0;
  /** Only the transition away from the very top needs a scroll callback; geometry comes from IO. */
  const updateTop = () => {
    const next = container.scrollTop > 0;
    if (next === hasScrolled) return;
    hasScrolled = next;
    for (const [header, aboveTop] of positions) header.dataset.stuck = String(next && aboveTop);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const header = entry.target.closest<HTMLElement>(".file-header");
        if (header) {
          const aboveTop = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
          positions.set(header, aboveTop);
          header.dataset.stuck = String(container.scrollTop > 0 && aboveTop);
        }
      }
    },
    { root: container, threshold: [0, 1] },
  );
  for (const sentinel of container.querySelectorAll(".file-sticky-sentinel"))
    observer.observe(sentinel);
  container.addEventListener("scroll", updateTop, { passive: true });
  return () => {
    observer.disconnect();
    container.removeEventListener("scroll", updateTop);
  };
}
