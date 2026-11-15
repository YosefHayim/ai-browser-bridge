import { connectThemeToggles } from "@site/theme-switch.ts";

const COPIED_LABEL_MILLISECONDS = 1600;

const connectCopyButtons = () => {
  for (const copyButton of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const copyStatus = copyButton.querySelector<HTMLElement>("[data-copy-status]");
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copy ?? "");
      } catch (error) {
        console.error({ error });
        return;
      }
      copyButton.dataset.copied = "";
      copyButton.setAttribute("aria-label", "Copied");
      if (copyStatus != null) copyStatus.textContent = "Copied to clipboard";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        delete copyButton.dataset.copied;
        copyButton.setAttribute("aria-label", "Copy");
        if (copyStatus != null) copyStatus.textContent = "";
      }, COPIED_LABEL_MILLISECONDS);
    });
  }
};

const FAQ_ANIMATION_MILLISECONDS = 280;

const animateFaqHeight = (details: HTMLDetailsElement, isOpening: boolean) => {
  const answer = details.querySelector<HTMLElement>("p");
  if (answer == null) return;
  const answerHeight =
    answer.offsetHeight + Number.parseFloat(getComputedStyle(answer).marginBottom);
  const frames = isOpening
    ? [
        { height: "0px", opacity: 0 },
        { height: `${answerHeight}px`, opacity: 1 },
      ]
    : [
        { height: `${answerHeight}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ];
  answer.animate(frames, { duration: FAQ_ANIMATION_MILLISECONDS, easing: "ease" });
};

const connectFaqRows = () => {
  const rows = [...document.querySelectorAll<HTMLDetailsElement>(".qa details")];
  const canAnimateHeight = !CSS.supports("interpolate-size", "allow-keywords");
  const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const row of rows) {
    row.addEventListener("toggle", () => {
      if (row.open) {
        for (const otherRow of rows) if (otherRow !== row) otherRow.open = false;
      }
    });

    const summary = row.querySelector("summary");
    const answer = row.querySelector<HTMLElement>("p");
    const isMissingParts = summary == null || answer == null;
    if (isMissingParts || !canAnimateHeight || isReducedMotion) continue;

    // Browsers without interpolate-size: animate the answer by hand, and keep the row
    // open until the closing animation ends.
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (row.open) {
        animateFaqHeight(row, false);
        setTimeout(() => {
          row.open = false;
        }, FAQ_ANIMATION_MILLISECONDS);
      } else {
        row.open = true;
        animateFaqHeight(row, true);
      }
    });
  }
};

const showPickedItem = (picker: HTMLElement, pickedId: string) => {
  const isHidingOthers = picker.hasAttribute("data-pick-hide");

  for (const pickButton of picker.querySelectorAll<HTMLElement>("[data-pick]"))
    pickButton.setAttribute("aria-pressed", String(pickButton.dataset.pick === pickedId));

  for (const panel of picker.querySelectorAll<HTMLElement>("[data-pick-panel]")) {
    const isPicked = panel.dataset.pickPanel === pickedId;
    if (isHidingOthers) panel.hidden = !isPicked;
    else if (isPicked) panel.dataset.picked = "";
    else delete panel.dataset.picked;
  }
};

const connectPickers = () => {
  for (const picker of document.querySelectorAll<HTMLElement>("[data-picker]")) {
    for (const pickButton of picker.querySelectorAll<HTMLElement>("[data-pick]"))
      pickButton.addEventListener("click", () =>
        showPickedItem(picker, pickButton.dataset.pick ?? ""),
      );
  }
};

const connectMenuToggle = () => {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const menuToggle = document.querySelector<HTMLElement>("[data-menu-toggle]");
  const isMenuMissing = nav == null || menuToggle == null;
  if (isMenuMissing) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = nav.hasAttribute("data-menu-open");
    if (isOpen) nav.removeAttribute("data-menu-open");
    else nav.setAttribute("data-menu-open", "");
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
  });
};

connectThemeToggles();
connectCopyButtons();
connectFaqRows();
connectPickers();
connectMenuToggle();
