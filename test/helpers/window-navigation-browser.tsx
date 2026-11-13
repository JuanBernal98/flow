/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileAccordion } from "../../src/window/FileAccordion";
import { fileAnchor } from "../../src/window/review";
import { navigateReview, type ReviewNavigation } from "../../src/window/reviewNavigation";

/** Exercise first, repeated, folded and superseded file navigation through the real scroll coordinator. */
export function TestReviewNavigation() {
  const review = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState<ReviewNavigation | null>(null);
  useLayoutEffect(() => navigateReview(review.current, request, []), [request]);
  useEffect(() => {
    const file = () => document.getElementById(fileAnchor("nav-b.ts")) as HTMLDetailsElement;
    const atAnchor = () =>
      Math.abs(file().getBoundingClientRect().top - review.current!.getBoundingClientRect().top) <
      2;
    const click = (name: string) =>
      document.querySelector<HTMLButtonElement>(`#navigation-test [data-open="${name}"]`)!.click();
    let first = false;
    let repeated = false;
    let folded = false;
    const timers = [
      setTimeout(() => click("b"), 400),
      setTimeout(() => {
        first = atAnchor();
        review.current!.scrollTop += 150;
        click("b");
      }, 700),
      setTimeout(() => {
        repeated = atAnchor();
        file().open = false;
        click("b");
      }, 1000),
      setTimeout(() => {
        folded = file().open && atAnchor();
        click("a");
        click("b");
      }, 1300),
      setTimeout(() => {
        const result = document.createElement("pre");
        result.id = "navigation-result";
        result.textContent = JSON.stringify({ first, repeated, folded, latest: atAnchor() });
        document.body.append(result);
      }, 1800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div id="navigation-test">
      <button
        type="button"
        data-open="a"
        onClick={() => setRequest({ kind: "file", path: "nav-a.ts" })}
      >
        File A
      </button>
      <button
        type="button"
        data-open="b"
        onClick={() => setRequest({ kind: "file", path: "nav-b.ts" })}
      >
        File B
      </button>
      <div className="diff" ref={review} style={{ width: 700, height: 240 }}>
        {["a", "b", "c"].map((name) => (
          <FileAccordion
            key={name}
            id={fileAnchor(`nav-${name}.ts`)}
            path={`nav-${name}.ts`}
            header={<span>File {name}</span>}
          >
            <div style={{ height: 600 }} />
          </FileAccordion>
        ))}
      </div>
    </div>
  );
}
