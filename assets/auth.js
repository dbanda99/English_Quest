/* English Quest — auth.js
   - Admin password check (sha256) using injected env secret.
   - Users:
       A) Repo users: data/users.json (read-only, shared across devices)
       B) Local users: localStorage (draft edits / offline)
   - Attempts (scores): still localStorage (gradebook is local to device).
*/
(() => {
  const USERS_KEY = "englishQuestUsers_v1";     // local draft users
  const ATTEMPTS_KEY = "englishQuestAttempts_v1";
  const REPO_USERS_URL = "data/users.json";

  const RepoCache = {
    loaded: false,
    users: [],
    error: null
  };

  function toast(msg, kind="info") {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    const icon = kind === "good" ? "✅" : kind === "bad" ? "❌" : "ℹ️";
    t.textContent = `${icon} ${msg}`;
    t.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder();
    const data = enc.encode(String(text));
    const buf = await crypto.subtle.digest("SHA-256", data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function loadRepoUsers(force=false) {
    if (RepoCache.loaded && !force) return RepoCache.users;
    try {
      const res = await fetch(REPO_USERS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch ${REPO_USERS_URL}`);
      const json = await res.json();
      const users = Array.isArray(json.users) ? json.users : [];
      RepoCache.users = users.map(u => ({
        id: u.id || u.username,
        name: u.name || u.username,
        username: String(u.username || "").trim().toLowerCase(),
        passHash: String(u.passHash || "").trim().toLowerCase()
      })).filter(u => u.username && u.passHash);
      RepoCache.loaded = true;
      RepoCache.error = null;
      return RepoCache.users;
    } catch (e) {
      RepoCache.loaded = true;
      RepoCache.error = e;
      RepoCache.users = [];
      return [];
    }
  }

  function loadLocalUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) return { users: [] };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.users)) parsed.users = [];
      return parsed;
    } catch {
      return { users: [] };
    }
  }

  function saveLocalUsers(store) {
    localStorage.setItem(USERS_KEY, JSON.stringify(store, null, 2));
  }

  function loadAttempts() {
    try {
      const raw = localStorage.getItem(ATTEMPTS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveAttempts(obj) {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(obj, null, 2));
  }

  function getCurrentUser() {
    try {
      const raw = sessionStorage.getItem("englishQuestSessionUser");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setCurrentUser(userSafe) {
    sessionStorage.setItem("englishQuestSessionUser", JSON.stringify(userSafe));
  }

  function logoutUser() {
    sessionStorage.removeItem("englishQuestSessionUser");
  }

  function normalizeUsername(u){ return String(u||"").trim().toLowerCase(); }

  function mergeUsers(repoUsers, localUsers) {
    const map = new Map();
    (repoUsers || []).forEach(u => map.set(normalizeUsername(u.username), u));
    (localUsers || []).forEach(u => map.set(normalizeUsername(u.username), u)); // local overrides
    return [...map.values()].filter(u => u.username && u.passHash);
  }

  async function loginUser(username, password) {
    const u = normalizeUsername(username);
    const p = String(password || "");

    const repoUsers = await loadRepoUsers(false);
    const localStore = loadLocalUsers();
    const merged = mergeUsers(repoUsers, localStore.users);

    const user = merged.find(x => normalizeUsername(x.username) === u);
    if (!user) return { ok:false, message:"User not found." };

    const hash = await sha256Hex(p);
    if (hash !== String(user.passHash||"").toLowerCase()) return { ok:false, message:"Incorrect password." };

    const safe = { id: user.id || user.username, username: user.username, name: user.name || user.username };
    setCurrentUser(safe);
    return { ok:true, user: safe };
  }

  async function requireAdmin() {
    const adminHash = (window.ENGLISH_QUEST_ADMIN_SHA256 || "").trim().toLowerCase();
    if (!adminHash) {
      alert("Admin secret is not configured.\n\nSet ADMIN_PASS_SHA256 in GitHub Environment secrets and deploy via GitHub Actions (see README).");
      return false;
    }

    const cached = sessionStorage.getItem("englishQuestAdminAuthed");
    if (cached === "1") return true;

    const pw = prompt("Admin Password:");
    if (pw === null) return false;

    const hash = await sha256Hex(pw);
    if (hash === adminHash) {
      sessionStorage.setItem("englishQuestAdminAuthed", "1");
      toast("Admin unlocked", "good");
      return true;
    }
    toast("Wrong admin password", "bad");
    return false;
  }

  function clearAdminSession() {
    sessionStorage.removeItem("englishQuestAdminAuthed");
  }

  async function createLocalUser({ name, username, password }) {
    const store = loadLocalUsers();
    const u = normalizeUsername(username);
    if (!u) return { ok:false, message:"Username required." };
    if (store.users.some(x => normalizeUsername(x.username) === u)) {
      return { ok:false, message:"Username already exists in local draft users." };
    }
    const id = "u_" + Math.random().toString(16).slice(2, 10) + "_" + Date.now().toString(16);
    const passHash = await sha256Hex(String(password||""));
    store.users.push({
      id,
      name: String(name||"").trim() || u,
      username: u,
      passHash
    });
    saveLocalUsers(store);
    toast("User created (local draft)", "good");
    return { ok:true };
  }

  async function resetLocalUserPassword(userId, newPassword) {
    const store = loadLocalUsers();
    const user = store.users.find(u => u.id === userId);
    if (!user) return { ok:false, message:"User not found in local draft users." };
    user.passHash = await sha256Hex(String(newPassword||""));
    saveLocalUsers(store);
    toast("Password updated (local draft)", "good");
    return { ok:true };
  }

  function deleteLocalUser(userId) {
    const store = loadLocalUsers();
    store.users = store.users.filter(u => u.id !== userId);
    saveLocalUsers(store);
    toast("Local draft user deleted", "good");
  }

  function recordAttempt(userId, attempt) {
    const attempts = loadAttempts();
    if (!Array.isArray(attempts[userId])) attempts[userId] = [];
    attempts[userId].push(attempt);
    saveAttempts(attempts);
  }

  function getAttemptsForUser(userId) {
    const attempts = loadAttempts();
    return Array.isArray(attempts[userId]) ? attempts[userId] : [];
  }

  function countAttemptsForLesson(userId, lessonId) {
    return getAttemptsForUser(userId).filter(a => a.lessonId === lessonId).length;
  }

  async function getRepoUsers() {
    return await loadRepoUsers(false);
  }

  function getLocalDraftUsers() {
    const store = loadLocalUsers();
    return store.users || [];
  }

  async function exportMergedUsersJson() {
    const repo = await loadRepoUsers(false);
    const local = loadLocalUsers().users || [];
    const merged = mergeUsers(repo, local);
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      users: merged.map(u => ({
        id: u.id || u.username,
        name: u.name || u.username,
        username: normalizeUsername(u.username),
        passHash: String(u.passHash||"").toLowerCase()
      }))
    };
  }

  function importLocalDraftUsers(usersArray) {
    const store = loadLocalUsers();
    store.users = Array.isArray(usersArray) ? usersArray : [];
    saveLocalUsers(store);
  }

  window.EnglishQuestAuth = {
    USERS_KEY,
    ATTEMPTS_KEY,
    REPO_USERS_URL,
    RepoCache,
    toast,
    sha256Hex,
    requireAdmin,
    clearAdminSession,

    loadRepoUsers,
    getRepoUsers,

    loadLocalUsers,
    saveLocalUsers,
    getLocalDraftUsers,
    importLocalDraftUsers,

    getCurrentUser,
    loginUser,
    logoutUser,

    createLocalUser,
    resetLocalUserPassword,
    deleteLocalUser,

    exportMergedUsersJson,

    recordAttempt,
    getAttemptsForUser,
    countAttemptsForLesson
  };
})();
