// Served at /hub/static/hub.js
let modules = [];
const list = document.getElementById("module-list");
const packetsEl = document.getElementById("packets");
const uptimeEl = document.getElementById("uptime");
const inputEl = document.getElementById("input-label");

async function fetchModules() {
  const res = await fetch("/modules");
  modules = await res.json();
  render();
}

async function fetchHealth() {
  const res = await fetch("/health");
  const h = await res.json();
  packetsEl.textContent = `Packets: ${h.packetsReceived}`;
  uptimeEl.textContent = `Uptime: ${Math.floor(h.uptimeMs / 1000)}s`;
}

function render() {
  list.innerHTML = "";
  for (const m of modules) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = m.enabled;
    cb.addEventListener("change", () => toggle(m.id, cb.checked));

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.displayName;

    const pill = document.createElement("span");
    pill.className = `status-pill ${m.status}`;
    pill.textContent = m.status;

    li.append(cb, name, pill);

    if (m.customStatus) {
      const cs = document.createElement("span");
      cs.className = "custom-status";
      cs.textContent = m.customStatus;
      li.append(cs);
    }
    if (m.lastError) {
      const err = document.createElement("span");
      err.className = "error";
      err.textContent = `! ${m.lastError}`;
      li.append(err);
    }
    list.append(li);
  }
}

async function toggle(id, enable) {
  await fetch(`/modules/${id}/${enable ? "enable" : "disable"}`, { method: "POST" });
  // Admin WS will broadcast the updated state; no need to refetch here
}

function connectAdminWs() {
  const ws = new WebSocket(`ws://${location.host}/admin`);
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "module-state") {
      modules = msg.modules;
      render();
    }
  });
  ws.addEventListener("close", () => setTimeout(connectAdminWs, 1000));
}

fetchModules();
fetchHealth();
setInterval(fetchHealth, 1000);
connectAdminWs();
