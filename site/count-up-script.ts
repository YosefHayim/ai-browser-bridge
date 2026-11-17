import NumberFlow from "number-flow";

const COUNT_UP_MILLISECONDS = 1600;

const countUpTiming = { duration: COUNT_UP_MILLISECONDS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

function swapInCounter(target: HTMLElement, finalValue: number): NumberFlow {
  const counter = new NumberFlow();
  counter.locales = "en-US";
  counter.format = { useGrouping: true, maximumFractionDigits: 0 };
  counter.transformTiming = countUpTiming;
  counter.spinTiming = countUpTiming;
  counter.opacityTiming = { duration: 400, easing: "ease-out" };
  counter.update(0);
  target.replaceChildren(counter);
  target.setAttribute("aria-label", target.dataset.countText ?? String(finalValue));
  return counter;
}

/** Every [data-count-to] number starts at 0 and counts up once when it scrolls into view. */
export function connectCountUpNumbers() {
  const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (isReducedMotion) return;

  const counters = new Map<Element, { counter: NumberFlow; finalValue: number }>();
  const viewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pending = counters.get(entry.target);
        viewObserver.unobserve(entry.target);
        if (pending != null) pending.counter.update(pending.finalValue);
      }
    },
    { threshold: 0.4 },
  );

  for (const target of document.querySelectorAll<HTMLElement>("[data-count-to]")) {
    const finalValue = Number(target.dataset.countTo);
    if (!Number.isFinite(finalValue)) continue;
    target.dataset.countText = target.textContent ?? "";
    counters.set(target, { counter: swapInCounter(target, finalValue), finalValue });
    viewObserver.observe(target);
  }
}
