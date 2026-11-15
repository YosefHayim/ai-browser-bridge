import { connectThemeToggles } from "@site/theme-switch.ts";

const COPIED_LABEL_MILLISECONDS = 1600;

const connectCopyButtons = () => {
  for (const copyButton of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copy ?? "");
      } catch (error) {
        console.error({ error });
        return;
      }
      copyButton.dataset.copied = "";
      setTimeout(() => delete copyButton.dataset.copied, COPIED_LABEL_MILLISECONDS);
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
connectPickers();
connectMenuToggle();
