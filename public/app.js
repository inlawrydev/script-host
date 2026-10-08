// ============================================================
// Утилиты
// ============================================================
function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function formatDate(ms) {
    return new Date(ms).toLocaleString("ru-RU");
}

async function copy(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        if (btn) {
            btn.textContent = "✓ Скопировано";
            btn.classList.add("copied");
            setTimeout(() => {
                btn.textContent = "📋 Копировать";
                btn.classList.remove("copied");
            }, 2000);
        }
    } catch {
        alert("Не удалось скопировать");
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));
}

// ============================================================
// Главная
// ============================================================
async function initIndexPage() {
    const list = document.getElementById("scripts-list");
    if (!list) return;

    try {
        const res = await fetch("/api/scripts");
        const scripts = await res.json();

        if (scripts.length === 0) {
            list.innerHTML =
                '<div class="loading">Пока нет скриптов. Добавь через админку!</div>';
            return;
        }

        list.innerHTML = scripts
            .map(
                (s) => `
            <a class="script-card" href="script.html?name=${encodeURIComponent(s.name)}">
                <h3>${escapeHtml(s.name)}</h3>
                <div class="meta">
                    <span>${s.lines} строк</span>
                    <span>${formatSize(s.size)}</span>
                </div>
                <div class="meta">
                    <span>${formatDate(s.updated)}</span>
                </div>
            </a>
        `
            )
            .join("");
    } catch (e) {
        list.innerHTML =
            '<div class="loading">Ошибка загрузки: ' + e.message + "</div>";
    }
}

// ============================================================
// Страница скрипта
// ============================================================
async function initScriptPage() {
    const params = new URLSearchParams(location.search);
    const name = params.get("name");
    if (!name) {
        location.href = "index.html";
        return;
    }

    document.getElementById("script-name").textContent = name;

    try {
        const res = await fetch("/api/scripts");
        const scripts = await res.json();
        const s = scripts.find((x) => x.name === name);
        if (s) {
            document.getElementById("script-size").textContent = formatSize(s.size);
            document.getElementById("script-lines").textContent = s.lines;
            document.getElementById("script-updated").textContent = formatDate(s.updated);
        }
    } catch {}

    const directUrl = `${location.origin}/script/${encodeURIComponent(name)}`;
    document.getElementById("direct-url").textContent = directUrl;

    const loader = buildLoader(name);
    document.getElementById("loader-code").textContent = loader;

    document.getElementById("copy-btn").addEventListener("click", (e) => {
        copy(loader, e.target);
    });
}

function buildLoader(scriptName) {
    return `-- Загрузчик для ${scriptName}
-- Замени значения ниже на свои из config.json

local API_URL = "https://твой-домен.com"  -- URL хоста
local TOKEN   = "41bcde6302bad3d97c..."    -- твой токен
local SECRET  = "12637a5efa78240f..."      -- твой hmac secret
local SCRIPT  = "${scriptName}"

local function detectExecutor()
    if syn and syn.protect_gui then return "Synapse" end
    if fluxus then return "Fluxus" end
    if KRNL_LOADED then return "Krnl" end
    if delta then return "Delta" end
    if wave then return "Wave" end
    if is_sirhurt_closure then return "SirHurt" end
    if secure_load and not syn then return "Solara" end
    if electron then return "Electron" end
    return "Unknown"
end

local function getHWID()
    if syn and syn.get_hwid then return syn.get_hwid() end
    if krnl and krnl.get_hwid then return krnl.get_hwid() end
    if fluxus and fluxus.get_hwid then return fluxus.get_hwid() end
    if get_hwid then return get_hwid() end
    local ok, id = pcall(function()
        return game:GetService("RbxAnalyticsService"):GetClientId()
    end)
    return ok and id or "unknown"
end

local function hmac_hex(key, msg)
    if syn and syn.crypt and syn.crypt.hmac then
        return syn.crypt.hmac(key, msg, "sha256")
    end
    if crypt and crypt.hmac then
        return crypt.hmac(key, msg, "sha256")
    end
    error("Нет HMAC-функции. Используй executor с crypt или добавь Lua-реализацию.")
end

local function http(opts)
    if syn and syn.request then return syn.request(opts) end
    if http_request then return http_request(opts) end
    if request then return request(opts) end
    error("Нет HTTP-функции с headers")
end

local executor = detectExecutor()
local hwid     = getHWID()
local plr      = game:GetService("Players").LocalPlayer
local ts       = tostring(math.floor(os.time() * 1000))
local extra    = hwid .. ":" .. executor .. ":" .. SCRIPT
local sig      = hmac_hex(SECRET, TOKEN .. ":" .. ts .. ":" .. extra)

local authResp = http({
    Url = API_URL .. "/auth",
    Method = "POST",
    Headers = {
        ["Content-Type"] = "application/json",
        ["User-Agent"]   = "Roblox",
    },
    Body = game:GetService("HttpService"):JSONEncode({
        token = TOKEN, hwid = hwid, executor = executor,
        userId = plr.UserId, username = plr.Name,
        timestamp = ts, signature = sig, scriptName = SCRIPT,
    }),
})

if authResp.StatusCode ~= 200 then
    warn("[Auth] " .. tostring(authResp.StatusCode))
    return
end

local session = game:GetService("HttpService"):JSONDecode(authResp.Body).session

local scriptResp = http({
    Url = API_URL .. "/script/" .. SCRIPT,
    Method = "GET",
    Headers = {
        ["X-Session"]  = session,
        ["User-Agent"] = "Roblox",
    },
})

if scriptResp.StatusCode ~= 200 then
    warn("[Script] " .. tostring(scriptResp.StatusCode))
    return
end

loadstring(scriptResp.Body)()
`;
}

// ============================================================
// Админка
// ============================================================
let adminKey = sessionStorage.getItem("adminKey") || "";
let selectedFile = null;

async function initAdminPage() {
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const keyInput = document.getElementById("admin-key");

    if (!loginBtn) return;

    if (adminKey) {
        keyInput.value = adminKey;
        showAdmin();
    }

    loginBtn.addEventListener("click", () => {
        const val = keyInput.value.trim();
        if (!val) return;
        adminKey = val;
        sessionStorage.setItem("adminKey", val);
        showAdmin();
    });

    logoutBtn.addEventListener("click", () => {
        adminKey = "";
        sessionStorage.removeItem("adminKey");
        document.getElementById("admin-panel").classList.add("hidden");
        document.getElementById("auth-box").classList.remove("hidden");
    });

    // Drag & drop для загрузки
    const uploadArea = document.getElementById("upload-area");
    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-btn");

    if (uploadArea && fileInput) {
        uploadArea.addEventListener("click", () => fileInput.click());
        uploadArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadArea.style.background = "var(--bg-hover)";
        });
        uploadArea.addEventListener("dragleave", () => {
            uploadArea.style.background = "";
        });
        uploadArea.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadArea.style.background = "";
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFileSelect(files[0], uploadArea, uploadBtn);
        });

        fileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) handleFileSelect(e.target.files[0], uploadArea, uploadBtn);
        });

        uploadBtn.addEventListener("click", () => {
            if (selectedFile) uploadScript(selectedFile, uploadArea, uploadBtn, fileInput);
        });
    }
}

function handleFileSelect(file, uploadArea, uploadBtn) {
    if (!file.name.endsWith(".lua")) {
        alert("Только .lua файлы!");
        return;
    }
    if (file.size > 1024 * 1024) {
        alert("Максимум 1 MB!");
        return;
    }
    selectedFile = file;
    uploadArea.innerHTML = `✅ ${escapeHtml(file.name)} (${formatSize(file.size)})`;
    uploadBtn.style.display = "inline-block";
}

async function uploadScript(file, uploadArea, uploadBtn, fileInput) {
    if (!adminKey) {
        alert("Сначала авторизуйся!");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            uploadBtn.disabled = true;
            uploadBtn.textContent = "Загрузка...";

            const res = await fetch("/api/scripts/upload", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Admin-Key": adminKey,
                },
                body: JSON.stringify({
                    name: file.name,
                    content: e.target.result,
                }),
            });

            if (res.status === 403) {
                alert("Неверный adminKey");
                uploadBtn.disabled = false;
                uploadBtn.textContent = "Загрузить";
                return;
            }

            if (!res.ok) {
                alert("Ошибка: " + res.status);
                uploadBtn.disabled = false;
                uploadBtn.textContent = "Загрузить";
                return;
            }

            alert("✅ Скрипт загружен!");
            selectedFile = null;
            uploadArea.innerHTML = `📁 Перетащи .lua файл сюда или нажми для выбора`;
            uploadBtn.style.display = "none";
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Загрузить";
            fileInput.value = "";
            await loadAdminScripts();
        } catch (err) {
            alert("Ошибка: " + err.message);
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Загрузить";
        }
    };
    reader.readAsText(file);
}

async function showAdmin() {
    document.getElementById("auth-box").classList.add("hidden");
    document.getElementById("admin-panel").classList.remove("hidden");
    await loadBindings();
    await loadAdminScripts();
}

async function loadBindings() {
    const list = document.getElementById("bindings-list");
    try {
        const res = await fetch("/api/bindings", {
            headers: { "X-Admin-Key": adminKey },
        });
        if (res.status === 403) {
            list.innerHTML =
                '<div class="loading" style="color:var(--danger)">Неверный adminKey</div>';
            return;
        }
        const data = await res.json();

        if (data.length === 0) {
            list.innerHTML = '<div class="loading">Нет активных привязок</div>';
            return;
        }

        list.innerHTML = data
            .map(
                (b) => `
            <div class="binding-row ${b.banned ? "banned" : ""}">
                <div>
                    <div class="col-label">Token</div>
                    <div class="col-value">${escapeHtml(b.token)}</div>
                </div>
                <div>
                    <div class="col-label">HWID</div>
                    <div class="col-value">${escapeHtml(b.hwid)}</div>
                </div>
                <div>
                    <div class="col-label">Executor</div>
                    <div class="col-value">${escapeHtml(b.executor || "—")}</div>
                </div>
                <div>
                    <div class="col-label">Пользователь</div>
                    <div class="col-value">${escapeHtml(b.username || "—")}</div>
                </div>
                <div>
                    <div class="col-label">Статус</div>
                    <span class="badge ${b.banned ? "banned" : "ok"}">
                        ${b.banned ? "Забанен" : "Активен"}
                    </span>
                </div>
                <div>
                    <button class="small ${b.banned ? "" : "danger"}"
                            onclick="toggleBan('${b.fullToken}', ${!b.banned})">
                        ${b.banned ? "Разбанить" : "Забанить"}
                    </button>
                </div>
            </div>
        `
            )
            .join("");
    } catch (e) {
        list.innerHTML = '<div class="loading">Ошибка: ' + e.message + "</div>";
    }
}

async function loadAdminScripts() {
    const grid = document.getElementById("admin-scripts");
    try {
        const res = await fetch("/api/scripts");
        const scripts = await res.json();
        grid.innerHTML =
            scripts
                .map(
                    (s) => `
            <div class="script-card">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <h3 style="flex: 1;">${escapeHtml(s.name)}</h3>
                    <button class="small danger" onclick="deleteScript('${s.name}')" style="margin-left: 8px;">🗑️</button>
                </div>
                <div class="meta"><span>${s.lines} строк</span><span>${formatSize(s.size)}</span></div>
            </div>
        `
                )
                .join("") || '<div class="loading">Нет скриптов</div>';
    } catch {}
}

async function toggleBan(token, ban) {
    try {
        const res = await fetch("/admin/ban", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminKey, token, ban }),
        });
        if (!res.ok) {
            alert("Ошибка: " + res.status);
            return;
        }
        await loadBindings();
    } catch (e) {
        alert("Ошибка: " + e.message);
    }
}

async function deleteScript(name) {
    if (!confirm(`Удалить скрипт "${name}"?`)) return;

    try {
        const res = await fetch("/api/scripts/delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Key": adminKey,
            },
            body: JSON.stringify({ name }),
        });

        if (res.status === 403) {
            alert("Неверный adminKey");
            return;
        }

        if (!res.ok) {
            alert("Ошибка: " + res.status);
            return;
        }

        alert("✅ Скрипт удалён!");
        await loadAdminScripts();
    } catch (e) {
        alert("Ошибка: " + e.message);
    }
}
