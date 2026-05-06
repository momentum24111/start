const headers = { "Content-Type": "application/json" };

async function request(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  getConfig: () => request("/api/config"),
  saveConfig: (config) => request("/api/config", { method: "PUT", headers, body: JSON.stringify(config) }),
  getSettings: () => request("/api/settings"),
  saveSettings: (settings) => request("/api/settings", { method: "PUT", headers, body: JSON.stringify(settings) }),
  getThemes: () => request("/api/themes"),
  getLanguages: () => request("/api/languages"),
  cacheFavicon: (url) => request("/api/favicon", { method: "POST", headers, body: JSON.stringify({ url }) }),
  restartApp: () => request("/api/restart", { method: "POST", headers, body: "{}" })
};
