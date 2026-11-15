type Theme = "light" | "dark";

const THEME_TOGGLE_SELECTOR = "[data-theme-toggle]";

const readShownTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

const pickNextTheme = (): Theme => (readShownTheme() === "dark" ? "light" : "dark");

const showToggleLabels = () => {
  const nextTheme = pickNextTheme();

  for (const themeToggle of document.querySelectorAll(THEME_TOGGLE_SELECTOR))
    themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
};

const saveTheme = (theme: Theme) => {
  try {
    localStorage.setItem("theme", theme);
  } catch (error) {
    console.error({ error });
  }
};

const flipTheme = () => {
  const nextTheme = pickNextTheme();
  document.documentElement.dataset.theme = nextTheme;
  saveTheme(nextTheme);
  showToggleLabels();
};

export const connectThemeToggles = () => {
  for (const themeToggle of document.querySelectorAll(THEME_TOGGLE_SELECTOR))
    themeToggle.addEventListener("click", flipTheme);

  showToggleLabels();
};
