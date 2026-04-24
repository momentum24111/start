export function applyTheme(theme) {
  const link = document.getElementById("theme-link");
  link.setAttribute("href", `/static/themes/${theme}/theme.css`);
}
