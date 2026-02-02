/* English Quest — admin.js
   Admin UI (requires admin password via EnglishQuestAuth.requireAdmin()):
   - Lessons/exams editor (dynamic)
   - Local student users creation
   - Gradebook (view attempts)
*/
(() => {
  const STORAGE_KEY = "englishQuestLibrary_v2";
  const DEFAULT_URL = "data/library.json";
  const Auth = window.EnglishQuestAuth;

  function uid(prefix="id") {
    return prefix + "_" + Math.random().toString(16).slice(2, 10) + "_" + Date.now().toString(16).slice(2);
  }

  function toast(msg, kind="info"){ Auth.toast(msg, kind); }

  async function loadDefaultLibrary() {
    const res = await fetch(DEFAULT_URL, { cache:"no-store" });
    if (!res.ok) throw new Error("Failed to load library.json");
    return await res.json();
  }

  function loadLocalLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function saveLocalLibrary(lib) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib, null, 2));
  }

  function resetLocalLibrary() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function downloadText(filename, content, mime="application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function ensureLibraryShape(lib) {
    if (!lib || typeof lib !== "object") lib = { appName:"English Quest", version:2, lessons:[] };
    if (!Array.isArray(lib.lessons)) lib.lessons = [];
    lib.appName = lib.appName || "English Quest";
    lib.version = Number.isFinite(lib.version) ? lib.version : 2;

    lib.lessons.forEach(lsn => {
      lsn.id = lsn.id || uid("lesson");
      lsn.title = lsn.title || "Untitled";
      lsn.description = lsn.description || "";
      lsn.kind = (lsn.kind || "quiz").toLowerCase();
      if (!["homework","quiz","exam"].includes(lsn.kind)) lsn.kind = "quiz";

      if (!lsn.takePolicy || typeof lsn.takePolicy !== "object") {
        lsn.takePolicy = { mode: "unlimited", limit: 0 };
      }
      lsn.takePolicy.mode = (lsn.takePolicy.mode || "unlimited");
      if (!["unlimited","one_time","limit"].includes(lsn.takePolicy.mode)) lsn.takePolicy.mode = "unlimited";
      lsn.takePolicy.limit = parseInt(lsn.takePolicy.limit || 0, 10) || 0;

      if (!Array.isArray(lsn.questions)) lsn.questions = [];
      lsn.questions.forEach(q => {
        q.id = q.id || uid("q");
        q.type = q.type || "single";
        q.prompt = q.prompt || "";
      });
    });

    return lib;
  }

  function normalizeOptionLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function buildQuestionEditor(q) {
    const wrap = document.createElement("div");
    wrap.className = "card panel";
    wrap.innerHTML = `
      <h3 style="margin:0 0 8px;">Question Editor</h3>
      <p class="small">Changes save locally (browser).</p>

      <div class="form">
        <div class="field">
          <label>Type</label>
          <select class="select" data-k="type">
            <option value="single">Single choice (A–E)</option>
            <option value="multi">Multi choice (checkbox)</option>
            <option value="exact">Exact phrase</option>
            <option value="contains">Contains keyword(s)</option>
          </select>
        </div>

        <div class="field">
          <label>Prompt</label>
          <textarea class="textarea" data-k="prompt" placeholder="Write the question prompt..."></textarea>
        </div>

        <div class="field" data-block="options">
          <label>Options (one per line)</label>
          <textarea class="textarea mono" data-k="optionsText"></textarea>
          <div class="small">Used for Single/Multi questions.</div>
        </div>

        <div class="field" data-block="answerSingle">
          <label>Correct answer (single)</label>
          <select class="select" data-k="answerSingle"></select>
        </div>

        <div class="field" data-block="answerMulti">
          <label>Correct answers (multi)</label>
          <div class="options" data-k="answerMulti"></div>
          <div class="small">Select all correct options.</div>
        </div>

        <div class="field" data-block="answerExact">
          <label>Correct phrase (exact)</label>
          <input class="textinput" data-k="answerExact" placeholder="I am learning English." />
          <div class="small">Comparison ignores extra spaces/case.</div>
        </div>

        <div class="field" data-block="contains">
          <label>Keywords (comma-separated)</label>
          <input class="textinput" data-k="keywords" placeholder="because, although" />
        </div>
        <div class="field" data-block="contains">
          <label>Minimum words (optional)</label>
          <input class="textinput" data-k="minWords" placeholder="5" />
        </div>

        <div class="row">
          <button class="btn btn-danger" type="button" data-action="delete">Delete Question</button>
          <div class="spacer"></div>
          <span class="tag">id: <span class="mono" data-k="qid"></span></span>
        </div>
      </div>
    `;

    const elType = wrap.querySelector('[data-k="type"]');
    const elPrompt = wrap.querySelector('[data-k="prompt"]');
    const elOptionsText = wrap.querySelector('[data-k="optionsText"]');

    const blockOptions = wrap.querySelector('[data-block="options"]');
    const blockSingle = wrap.querySelector('[data-block="answerSingle"]');
    const blockMulti = wrap.querySelector('[data-block="answerMulti"]');
    const blockExact = wrap.querySelector('[data-block="answerExact"]');
    const blocksContains = [...wrap.querySelectorAll('[data-block="contains"]')];

    const elAnswerSingle = wrap.querySelector('[data-k="answerSingle"]');
    const elAnswerMulti = wrap.querySelector('[data-k="answerMulti"]');
    const elAnswerExact = wrap.querySelector('[data-k="answerExact"]');
    const elKeywords = wrap.querySelector('[data-k="keywords"]');
    const elMinWords = wrap.querySelector('[data-k="minWords"]');
    wrap.querySelector('[data-k="qid"]').textContent = q.id;

    elType.value = q.type || "single";
    elPrompt.value = q.prompt || "";
    const options = Array.isArray(q.options) ? q.options : [];
    elOptionsText.value = options.join("\n");

    function renderAnswerControls() {
      const type = elType.value;
      blockOptions.style.display = (type === "single" || type === "multi") ? "block" : "none";
      blockSingle.style.display = (type === "single") ? "block" : "none";
      blockMulti.style.display = (type === "multi") ? "block" : "none";
      blockExact.style.display = (type === "exact") ? "block" : "none";
      blocksContains.forEach(b => b.style.display = (type === "contains") ? "block" : "none");

      const opts = normalizeOptionLines(elOptionsText.value);

      elAnswerSingle.innerHTML = "";
      opts.forEach(o => {
        const op = document.createElement("option");
        op.value = o;
        op.textContent = o;
        elAnswerSingle.appendChild(op);
      });
      if (type === "single") {
        if (q.answer && opts.includes(q.answer)) elAnswerSingle.value = q.answer;
        else elAnswerSingle.value = opts[0] || "";
      }

      elAnswerMulti.innerHTML = "";
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      opts.forEach((o, i) => {
        const id = uid("chk");
        const row = document.createElement("label");
        row.className = "opt";
        row.setAttribute("for", id);
        row.innerHTML = `<input id="${id}" type="checkbox" /><span class="text">${o}</span>`;
        const chk = row.querySelector("input");
        chk.checked = answerArr.includes(o);
        elAnswerMulti.appendChild(row);
      });

      if (type === "exact") elAnswerExact.value = q.answer || "";
      if (type === "contains") {
        elKeywords.value = (q.keywords || []).join(", ");
        elMinWords.value = (q.minWords ?? "") === 0 ? "0" : (q.minWords ?? "");
      }
    }

    renderAnswerControls();

    elType.addEventListener("change", () => {
      q.type = elType.value;

      if (q.type === "single") {
        q.options = normalizeOptionLines(elOptionsText.value);
        q.answer = q.options[0] || "";
        delete q.keywords; delete q.minWords;
      }
      if (q.type === "multi") {
        q.options = normalizeOptionLines(elOptionsText.value);
        q.answer = Array.isArray(q.answer) ? q.answer : [];
        delete q.keywords; delete q.minWords;
      }
      if (q.type === "exact") {
        delete q.options;
        q.answer = elAnswerExact.value || "";
        delete q.keywords; delete q.minWords;
      }
      if (q.type === "contains") {
        delete q.options; delete q.answer;
        q.keywords = normalizeOptionLines((elKeywords.value||"").replace(/\s*,\s*/g,"\n"));
        q.minWords = parseInt(elMinWords.value||"0",10) || 0;
      }

      renderAnswerControls();
      window.EnglishQuestAdmin?.requestSave?.();
    });

    elPrompt.addEventListener("input", () => {
      q.prompt = elPrompt.value;
      window.EnglishQuestAdmin?.requestSave?.(false);
    });

    elOptionsText.addEventListener("input", () => {
      q.options = normalizeOptionLines(elOptionsText.value);
      if (q.type === "single") {
        const a = elAnswerSingle.value;
        q.answer = q.options.includes(a) ? a : (q.options[0] || "");
      }
      if (q.type === "multi") {
        const prev = new Set(Array.isArray(q.answer) ? q.answer : []);
        q.answer = q.options.filter(o => prev.has(o));
      }
      renderAnswerControls();
      window.EnglishQuestAdmin?.requestSave?.(false);
    });

    elAnswerSingle.addEventListener("change", () => {
      q.answer = elAnswerSingle.value;
      window.EnglishQuestAdmin?.requestSave?.();
    });

    elAnswerMulti.addEventListener("change", () => {
      const chosen = [];
      [...elAnswerMulti.querySelectorAll("input[type=checkbox]")].forEach((chk, idx) => {
        if (chk.checked) chosen.push(q.options[idx]);
      });
      q.answer = chosen.filter(Boolean);
      window.EnglishQuestAdmin?.requestSave?.();
    });

    elAnswerExact.addEventListener("input", () => {
      q.answer = elAnswerExact.value;
      window.EnglishQuestAdmin?.requestSave?.(false);
    });

    function updateContains() {
      q.keywords = normalizeOptionLines((elKeywords.value||"").replace(/\s*,\s*/g,"\n"));
      q.minWords = parseInt(elMinWords.value||"0",10) || 0;
      window.EnglishQuestAdmin?.requestSave?.(false);
    }
    elKeywords.addEventListener("input", updateContains);
    elMinWords.addEventListener("input", updateContains);

    wrap.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm("Delete this question?")) return;
      window.EnglishQuestAdmin?.deleteActiveQuestion?.();
    });

    return wrap;
  }

  const Admin = {
    lib: null,
    selectedLessonId: null,
    selectedQuestionId: null,
    tab: "lessons",
    _saveTimer: null,

    async init() {
      const local = loadLocalLibrary();
      if (local) Admin.lib = ensureLibraryShape(local);
      else Admin.lib = ensureLibraryShape(await loadDefaultLibrary());
      if (!Admin.selectedLessonId && Admin.lib.lessons[0]) Admin.selectedLessonId = Admin.lib.lessons[0].id;
      return Admin.lib;
    },

    requestSave(showToast=true) {
      clearTimeout(Admin._saveTimer);
      Admin._saveTimer = setTimeout(() => {
        saveLocalLibrary(Admin.lib);
        if (showToast) toast("Saved (local)", "good");
      }, 80);
    },

    resetAllLocal() {
      resetLocalLibrary();
      localStorage.removeItem(Auth.USERS_KEY);
      localStorage.removeItem(Auth.ATTEMPTS_KEY);
      Auth.clearAdminSession();
      toast("Local data cleared. Reloading…", "info");
      setTimeout(() => location.reload(), 450);
    },

    render(container) {
      container.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.className = "grid";

      const left = document.createElement("section");
      left.className = "card panel col-4";
      left.innerHTML = `
        <h2>Admin</h2>
        <p class="small">Protected by Admin Password (GitHub Environment secret).</p>

        <div class="row" style="margin-top:8px;">
          <button class="btn ${Admin.tab==="lessons"?"btn-primary":""}" type="button" data-tab="lessons">Lessons</button>
          <button class="btn ${Admin.tab==="users"?"btn-primary":""}" type="button" data-tab="users">Users</button>
          <button class="btn ${Admin.tab==="gradebook"?"btn-primary":""}" type="button" data-tab="gradebook">Gradebook</button>
        </div>

        <div class="hr"></div>

        <div id="leftBody"></div>

        <div class="hr"></div>
        <div class="row">
          <button class="btn" type="button" data-action="export">Export library.json</button>
          <label class="btn" style="position:relative; overflow:hidden;">
            Import
            <input type="file" accept="application/json" data-action="import" style="position:absolute; inset:0; opacity:0; cursor:pointer;" />
          </label>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn btn-danger" type="button" data-action="reset">Reset Local Data</button>
        </div>

        <p class="small" style="margin-top:10px;">
          Publishing updates: Export and replace <span class="mono">data/library.json</span> in your GitHub repo.
        </p>
      `;

      const right = document.createElement("section");
      right.className = "col-8";
      right.innerHTML = `
        <div class="admin-grid">
          <div class="card panel" id="mainEditor"></div>
          <div id="sideEditor"></div>
        </div>
      `;

      wrap.appendChild(left);
      wrap.appendChild(right);
      container.appendChild(wrap);

      left.querySelectorAll("[data-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
          Admin.tab = btn.getAttribute("data-tab");
          Admin.render(container);
        });
      });

      left.querySelector('[data-action="export"]').addEventListener("click", () => {
        const content = JSON.stringify(Admin.lib, null, 2);
        downloadText("library.json", content, "application/json");
        toast("Exported library.json", "good");
      });

      left.querySelector('[data-action="import"]').addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        try{
          const text = await file.text();
          const parsed = ensureLibraryShape(JSON.parse(text));
          Admin.lib = parsed;
          Admin.selectedLessonId = parsed.lessons?.[0]?.id || null;
          Admin.selectedQuestionId = null;
          Admin.requestSave();
          Admin.render(container);
          toast("Imported JSON", "good");
        }catch{
          toast("Import failed (invalid JSON)", "bad");
        }finally{
          ev.target.value = "";
        }
      });

      left.querySelector('[data-action="reset"]').addEventListener("click", () => {
        if (!confirm("Reset ALL local data? (Admin edits, users, scores)")) return;
        Admin.resetAllLocal();
      });

      const leftBody = left.querySelector("#leftBody");
      const mainEditor = right.querySelector("#mainEditor");
      const sideEditor = right.querySelector("#sideEditor");

      if (Admin.tab === "lessons") {
        Admin._renderLessons(leftBody, mainEditor, sideEditor);
      } else if (Admin.tab === "users") {
        Admin.    _renderUsers(leftBody, mainEditor, sideEditor) {
      leftBody.innerHTML = `
        <p class="small">
          Users are shared across devices by publishing <span class="mono">data/users.json</span> in your repo.
          Create users here, then <b>Export users.json</b> and commit it to GitHub.
        </p>
        <div class="hr"></div>

        <div class="row" style="margin-bottom:10px;">
          <button class="btn" type="button" data-action="refreshRepo">Refresh repo users</button>
          <button class="btn btn-primary" type="button" data-action="exportUsers">Export users.json</button>
          <label class="btn" style="position:relative; overflow:hidden;">
            Import users.json (draft)
            <input type="file" accept="application/json" data-action="importUsers" style="position:absolute; inset:0; opacity:0; cursor:pointer;" />
          </label>
        </div>

        <div class="hr"></div>
        <h3 style="margin:0 0 8px;">Repo Users (read-only)</h3>
        <div class="admin-list" id="repoUserList"></div>

        <div class="hr"></div>
        <h3 style="margin:0 0 8px;">Local Draft Users (not published yet)</h3>
        <div class="admin-list" id="localUserList"></div>
      `;

      const repoUserList = leftBody.querySelector("#repoUserList");
      const localUserList = leftBody.querySelector("#localUserList");

      async function renderRepoUsers() {
        repoUserList.innerHTML = `<div class="small">Loading…</div>`;
        const repo = await Auth.getRepoUsers();
        if (!repo.length) {
          const err = Auth.RepoCache?.error;
          repoUserList.innerHTML = `<div class="small">${err ? "Could not load data/users.json yet (is it in the repo?)" : "No repo users yet."}</div>`;
          return;
        }
        repoUserList.innerHTML = "";
        repo.forEach(u => {
          const item = document.createElement("div");
          item.className = "admin-item";
          item.innerHTML = `
            <div class="top">
              <div>
                <div class="name">${u.name}</div>
                <div class="hint">@${u.username}</div>
              </div>
              <div class="row">
                <span class="tag">repo</span>
              </div>
            </div>
          `;
          repoUserList.appendChild(item);
        });
      }

      function renderLocalUsers() {
        const local = Auth.getLocalDraftUsers();
        localUserList.innerHTML = "";
        local.forEach(u => {
          const item = document.createElement("div");
          item.className = "admin-item";
          item.innerHTML = `
            <div class="top">
              <div>
                <div class="name">${u.name}</div>
                <div class="hint">@${u.username}</div>
              </div>
              <div class="row">
                <button class="btn" type="button" data-action="resetPw">Reset PW</button>
                <button class="btn btn-danger" type="button" data-action="del">Delete</button>
              </div>
            </div>
          `;
          item.querySelector('[data-action="resetPw"]').addEventListener("click", async () => {
            const pw = prompt("New password for " + u.username + ":");
            if (pw === null) return;
            const r = await Auth.resetLocalUserPassword(u.id, pw);
            if (!r.ok) toast(r.message || "Failed", "bad");
          });
          item.querySelector('[data-action="del"]').addEventListener("click", () => {
            if (!confirm("Delete this local draft user?")) return;
            Auth.deleteLocalUser(u.id);
            renderLocalUsers();
          });
          localUserList.appendChild(item);
        });

        if (!local.length) localUserList.innerHTML = `<div class="small">No local draft users.</div>`;
      }

      // Buttons
      leftBody.querySelector('[data-action="refreshRepo"]').addEventListener("click", async () => {
        await Auth.loadRepoUsers(true);
        renderRepoUsers();
      });

      leftBody.querySelector('[data-action="exportUsers"]').addEventListener("click", async () => {
        const exported = await Auth.exportMergedUsersJson();
        const content = JSON.stringify(exported, null, 2);
        downloadText("users.json", content, "application/json");
        toast("Exported users.json — commit it to /data/users.json", "good");
      });

      leftBody.querySelector('[data-action="importUsers"]').addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        try{
          const text = await file.text();
          const parsed = JSON.parse(text);
          const users = Array.isArray(parsed.users) ? parsed.users : [];
          // Normalize minimal shape
          const normalized = users.map(u => ({
            id: u.id || u.username,
            name: u.name || u.username,
            username: String(u.username||"").trim().toLowerCase(),
            passHash: String(u.passHash||"").trim().toLowerCase()
          })).filter(u => u.username && u.passHash);
          Auth.importLocalDraftUsers({ users: normalized });
          toast("Imported users.json into local draft users", "good");
          renderLocalUsers();
        } catch {
          toast("Import failed (invalid JSON)", "bad");
        } finally {
          ev.target.value = "";
        }
      });

      // Right side: create user form
      mainEditor.innerHTML = `
        <h2>Create Student User</h2>
        <p class="small">
          This creates a <b>local draft</b> user first. Then click <b>Export users.json</b> and commit it to GitHub
          so students can log in from their own computers.
        </p>
        <div class="form">
          <div class="field">
            <label>Student Name</label>
            <input class="textinput" id="uName" placeholder="Maria Lopez" />
          </div>
          <div class="field">
            <label>Username</label>
            <input class="textinput" id="uUser" placeholder="maria" />
          </div>
          <div class="field">
            <label>Password</label>
            <input class="textinput" id="uPass" placeholder="••••••••" type="password" />
          </div>
          <div class="row">
            <button class="btn btn-primary" type="button" id="btnCreateUser">Create Draft User</button>
          </div>
        </div>
      `;

      sideEditor.innerHTML = `
        <div class="card panel">
          <h3>Publishing step</h3>
          <ol class="small" style="margin:0; padding-left:18px; line-height:1.6;">
            <li>Create users here</li>
            <li>Export <span class="mono">users.json</span></li>
            <li>Replace <span class="mono">data/users.json</span> in your repo</li>
            <li>Push to <span class="mono">main</span> → students can log in anywhere</li>
          </ol>
          <div class="hr"></div>
          <p class="small">
            Security: passwords are stored as SHA-256 hashes, not plaintext.
          </p>
        </div>
      `;

      mainEditor.querySelector("#btnCreateUser").addEventListener("click", async () => {
        const name = mainEditor.querySelector("#uName").value;
        const username = mainEditor.querySelector("#uUser").value;
        const password = mainEditor.querySelector("#uPass").value;
        if (!username.trim() || !password) { toast("Username and password required", "bad"); return; }
        const r = await Auth.createLocalUser({ name, username, password });
        if (!r.ok) { toast(r.message || "Failed", "bad"); return; }
        renderLocalUsers();
      });

      // Initial render
      renderRepoUsers();
      renderLocalUsers();
    },

        _renderGradebook(leftBody, mainEditor, sideEditor) {
      leftBody.innerHTML = `
        <p class="small">View saved scores per student (scores are local to this device).</p>
        <div class="hr"></div>
        <div class="admin-list" id="gbUsers"><div class="small">Loading users…</div></div>
      `;

      mainEditor.innerHTML = `
        <h2>Gradebook</h2>
        <p class="small">Select a student on the left to view attempts.</p>
      `;
      sideEditor.innerHTML = `
        <div class="card panel">
          <h3>Notes</h3>
          <p class="small">
            Attempts are stored locally on this computer/browser only.
          </p>
        </div>
      `;

      const gbUsers = leftBody.querySelector("#gbUsers");

      (async () => {
        const repo = await Auth.getRepoUsers();
        const local = Auth.getLocalDraftUsers();
        const map = new Map();
        [...repo, ...local].forEach(u => map.set(String(u.username).toLowerCase(), u));
        const users = [...map.values()];

        gbUsers.innerHTML = "";
        if (!users.length) {
          gbUsers.innerHTML = `<div class="small">No users found yet.</div>`;
          return;
        }

        users.forEach(u => {
          const attempts = Auth.getAttemptsForUser(u.id || u.username);
          const item = document.createElement("div");
          item.className = "admin-item";
          item.innerHTML = `
            <div class="top">
              <div>
                <div class="name">${u.name}</div>
                <div class="hint">${attempts.length} attempt(s)</div>
              </div>
              <div class="row">
                <button class="btn" type="button" data-action="open">Open</button>
              </div>
            </div>
          `;
          item.querySelector('[data-action="open"]').addEventListener("click", () => {
            Admin.    _renderGradebookDetail(mainEditor, sideEditor, user) {
      const userId = user.id || user.username;
      const attempts = Auth.getAttemptsForUser(userId).slice().reverse();

      const rows = attempts.map(a => `
        <tr>
          <td>${a.takenAt ? new Date(a.takenAt).toLocaleString() : "—"}</td>
          <td>${a.kind || "quiz"}</td>
          <td>${a.lessonTitle || a.lessonId}</td>
          <td>${a.score}/${a.total}</td>
          <td>${a.percent}%</td>
        </tr>
      `).join("");

      mainEditor.innerHTML = `
        <h2>${user.name}</h2>
        <p class="small">@${user.username}</p>
        <div class="hr"></div>
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Exam</th>
              <th>Score</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="small">No attempts yet.</td></tr>`}
          </tbody>
        </table>
      `;

      sideEditor.innerHTML = `
        <div class="card panel">
          <h3>Notes</h3>
          <p class="small">
            Attempts are stored locally on this computer/browser only.
          </p>
        </div>
      `;
    },

    deleteActiveQuestion() {
      const lesson = Admin.lib.lessons.find(l => l.id === Admin.selectedLessonId);
      if (!lesson) return;
      lesson.questions = lesson.questions.filter(q => q.id !== Admin.selectedQuestionId);
      Admin.selectedQuestionId = null;
      Admin.requestSave();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  };

  window.EnglishQuestAdmin = {
    STORAGE_KEY,
    loadDefaultLibrary,
    loadLocalLibrary,
    saveLocalLibrary,
    resetLocalLibrary,
    ensureLibraryShape,
    downloadText,
    Admin
  };

  Admin.init().catch(err => {
    console.error(err);
    toast("Failed to load library", "bad");
  });
})();
