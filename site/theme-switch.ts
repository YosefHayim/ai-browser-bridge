type Theme = "light" | "dark";

const THEME_TOGGLE_SELECTOR = "[data-theme-toggle]";

function readShownTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function pickNextTheme(): Theme {
  return readShownTheme() === "dark" ? "light" : "dark";
}

function showToggleLabels() {
  const nextTheme = pickNextTheme();

  for (const themeToggle of document.querySelectorAll(THEME_TOGGLE_SELECTOR))
    themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch (error) {
    console.error({ error });
  }
}

function flipTheme() {
  const nextTheme = pickNextTheme();
  document.documentElement.dataset.theme = nextTheme;
  saveTheme(nextTheme);
  showToggleLabels();
}

export function connectThemeToggles() {
  for (const themeToggle of document.querySelectorAll(THEME_TOGGLE_SELECTOR))
    themeToggle.addEventListener("click", flipTheme);

  showToggleLabels();
}
