let dictionary = {};
let fallback = {};

export async function initI18n(code = "en") {
  fallback = await fetch("/static/languages/en.json").then((r) => r.json());
  dictionary = code === "en" ? fallback : await fetch(`/static/languages/${code}.json`).then((r) => r.json()).catch(() => fallback);
}

export function t(path) {
  const keys = path.split(".");
  let primary = dictionary;
  let backup = fallback;
  for (const key of keys) {
    primary = primary?.[key];
    backup = backup?.[key];
  }
  return primary ?? backup ?? path;
}
