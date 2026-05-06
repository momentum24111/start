let dictionary = {};
let fallback = {};

export async function initI18n(code = "en") {
  fallback = await fetch("/static/languages/en.json", { cache: "no-store" }).then((r) => r.json());
  if (code === "en") {
    dictionary = fallback;
    return;
  }
  const raw = await fetch(`/static/languages/${code}.json`, { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => fallback);
  dictionary = {
    ...fallback,
    ...raw,
    meta: raw.meta ?? fallback.meta,
    ui: { ...(fallback.ui || {}), ...(raw.ui || {}) }
  };
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
