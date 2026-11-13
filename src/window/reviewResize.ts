/** Preserve measured code heights while CSS skips offscreen diff layout during a sidebar drag. */
export function prepareReviewResize(panes: HTMLElement) {
  // Read every box before writing styles so preparation does not repeatedly force layout.
  const blocks = [...panes.querySelectorAll<HTMLElement>(".code-block")].map((element) => {
    const style = getComputedStyle(element);
    return {
      element,
      previousSize: element.style.containIntrinsicBlockSize,
      height:
        element.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth),
    };
  });
  for (const { element, height } of blocks)
    element.style.containIntrinsicBlockSize = `auto ${height}px`;
  return () => {
    for (const { element, previousSize } of blocks)
      element.style.containIntrinsicBlockSize = previousSize;
  };
}
