const $ = (id) => document.getElementById(id);
const KEY_STORAGE = "qa-studio-key";
const PROJECT_POLL_MS = 3000;
const BUILD_POLL_MS = 15000;

const state = { config: null, project: null, projectTimer: null, buildTimer: null };

function storedKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}

function rememberKey(key) {
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* private mode: ask again next time */ }
}

async function askForKey() {
  const dialog = $("key-dialog");
  $("key-input").value = "";
  dialog.showModal();
  await new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
  rememberKey($("key-input").value.trim());
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  const key = storedKey();
  if (key) headers["x-studio-key"] = key;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    await askForKey();
    return api(path, options);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

function projectIdFromUrl() {
  return new URLSearchParams(location.hash.slice(1)).get("project");
}

function showStart() {
  stopTimers();
  state.project = null;
  history.replaceState(null, "", location.pathname);
  $("start").hidden = false;
  $("workspace").hidden = true;
  $("new-app").hidden = true;
}

function showWorkspace() {
  $("start").hidden = true;
  $("workspace").hidden = false;
  $("new-app").hidden = false;
}

function stopTimers() {
  clearTimeout(state.projectTimer);
  clearTimeout(state.buildTimer);
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message || "";
  el.hidden = !message;
}

function renderChat(project) {
  const list = $("chat");
  list.replaceChildren(
    ...project.chat.map((entry) => {
      const item = document.createElement("li");
      item.className = entry.from;
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = entry.from === "client" ? "You" : "App Studio";
      item.append(who, document.createTextNode(entry.text));
      return item;
    }),
  );
  list.scrollTop = list.scrollHeight;
}

function previewPending(project) {
  return state.config?.previewEnabled && project.status === "ready" && !project.preview && !project.previewError;
}

function renderStatus(project) {
  const status = $("status");
  let text = "";
  if (project.status === "generating") {
    text = project.files.length ? "Updating your app… this takes a couple of minutes." : "Building your app… this takes a few minutes.";
  } else if (previewPending(project)) {
    text = "Preparing the preview…";
  } else if (project.status === "failed") {
    text = "Your app could not be built. Try describing it differently below.";
  } else {
    text = "Your app is ready. Try it, ask for changes, or build it.";
  }
  status.textContent = text;
  status.classList.toggle("busy", project.status === "generating" || previewPending(project));
}

function renderPreview(project) {
  const frame = $("preview-frame");
  const placeholder = $("preview-placeholder");
  const link = $("preview-link");
  if (project.preview) {
    if (frame.dataset.src !== project.preview.embedUrl) {
      frame.src = project.preview.embedUrl;
      frame.dataset.src = project.preview.embedUrl;
    }
    frame.hidden = false;
    placeholder.hidden = true;
    link.href = project.preview.url;
    link.hidden = false;
    $("preview-hint").hidden = false;
    return;
  }
  frame.hidden = true;
  frame.removeAttribute("src");
  delete frame.dataset.src;
  placeholder.hidden = false;
  link.hidden = true;
  $("preview-hint").hidden = true;
  placeholder.textContent =
    project.previewError ||
    (!state.config?.previewEnabled ? "Previews are not switched on for this studio." :
      project.status === "failed" ? "No preview yet." : "Your app will appear here.");
}

const BUILD_LABELS = {
  preparing: "Preparing",
  queued: "Waiting for a build server",
  "in-progress": "Building",
  finished: "Ready",
  errored: "Failed",
  canceled: "Canceled",
};

function renderBuilds(project) {
  const button = $("build-android");
  const running = project.builds.some((b) => !["finished", "errored", "canceled"].includes(b.status));
  button.disabled = !state.config?.buildsEnabled || project.status !== "ready" || running;
  button.title = state.config?.buildsEnabled ? "" : "Builds are not switched on for this studio yet.";

  $("builds").replaceChildren(
    ...project.builds.map((build) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const started = new Date(build.startedAt).toLocaleString();
      label.textContent = `Android · ${BUILD_LABELS[build.status] || build.status} · ${started}`;
      item.append(label);
      if (build.downloadUrl) {
        const link = document.createElement("a");
        link.href = build.downloadUrl;
        link.textContent = "Download APK";
        link.rel = "noopener";
        item.append(link);
      } else if (build.error) {
        const error = document.createElement("span");
        error.className = "form-error";
        error.textContent = build.error;
        item.append(error);
      }
      return item;
    }),
  );
}

function renderCode(project) {
  $("code-card").hidden = project.files.length === 0;
  $("code-files").replaceChildren(
    ...project.files.flatMap((file) => {
      const title = document.createElement("h4");
      title.textContent = file.path;
      const pre = document.createElement("pre");
      pre.textContent = file.contents;
      return [title, pre];
    }),
  );
}

function render(project) {
  state.project = project;
  showWorkspace();
  $("app-name").textContent = project.files.length ? project.appName : "Your new app";
  $("app-swatch").style.background = project.primaryColor;
  renderStatus(project);
  renderChat(project);
  renderPreview(project);
  renderBuilds(project);
  renderCode(project);
  const busy = project.status === "generating";
  $("change-submit").disabled = busy;
  $("change-prompt").disabled = busy;
}

async function refreshProject(id) {
  clearTimeout(state.projectTimer);
  try {
    const project = await api(`/api/projects/${encodeURIComponent(id)}`);
    render(project);
    if (project.status === "generating" || previewPending(project)) {
      state.projectTimer = setTimeout(() => refreshProject(id), PROJECT_POLL_MS);
    }
    scheduleBuildRefresh(project);
  } catch (error) {
    setError("change-error", error.message);
    state.projectTimer = setTimeout(() => refreshProject(id), PROJECT_POLL_MS * 3);
  }
}

function scheduleBuildRefresh(project) {
  clearTimeout(state.buildTimer);
  const running = project.builds.find((b) => !["finished", "errored", "canceled"].includes(b.status));
  if (!running) return;
  state.buildTimer = setTimeout(async () => {
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/builds/${encodeURIComponent(running.id)}`);
    } catch { /* the next project refresh shows the latest state */ }
    refreshProject(project.id);
  }, BUILD_POLL_MS);
}

function openProject(id) {
  history.replaceState(null, "", `#project=${encodeURIComponent(id)}`);
  refreshProject(id);
}

$("start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("start-error", "");
  const button = $("start-submit");
  button.disabled = true;
  try {
    const project = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ prompt: $("start-prompt").value }),
    });
    $("start-prompt").value = "";
    openProject(project.id);
  } catch (error) {
    setError("start-error", error.message);
  } finally {
    button.disabled = false;
  }
});

$("change-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.project) return;
  setError("change-error", "");
  try {
    const project = await api(`/api/projects/${encodeURIComponent(state.project.id)}/changes`, {
      method: "POST",
      body: JSON.stringify({ prompt: $("change-prompt").value }),
    });
    $("change-prompt").value = "";
    render(project);
    refreshProject(project.id);
  } catch (error) {
    setError("change-error", error.message);
  }
});

$("build-android").addEventListener("click", async () => {
  if (!state.project) return;
  setError("build-error", "");
  $("build-android").disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(state.project.id)}/builds`, {
      method: "POST",
      body: JSON.stringify({ platform: "android" }),
    });
  } catch (error) {
    setError("build-error", error.message);
  }
  refreshProject(state.project.id);
});

document.querySelectorAll("[data-example]").forEach((chip) => {
  chip.addEventListener("click", () => {
    $("start-prompt").value = chip.dataset.example;
    $("start-prompt").focus();
  });
});

$("new-app").addEventListener("click", showStart);

async function init() {
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = { previewEnabled: false, buildsEnabled: false };
  }
  const id = projectIdFromUrl();
  if (id) openProject(id);
  else showStart();
}

init();
