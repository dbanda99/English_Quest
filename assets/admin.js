/* English Quest — admin.js
   Admin UI (requires admin password via EnglishQuestAuth.requireAdmin()):
   - Lessons/exams editor (dynamic)
   - Student users creation (local draft) + export users.json for repo
   - Gradebook (view attempts) — attempts are localStorage (device-only)
*/
(() => {
  const STORAGE_KEY = "englishQuestLibrary_v2";
  const DEFAULT_URL = "data/library.json";
  const Auth = window.EnglishQuestAuth;

  function uid(prefix = "id") {
    return (
      prefix +
      "_" +
      Math.random().toString(16).slice(2, 10) +
      "_" +
      Date.now().toString(16)
    );
  }

  function toast(msg, kind = "info") {
    if (Auth && typeof Auth.toast === "function") Auth.toast(msg, kind);
    else console.log(`[${kind}] ${msg}`);
  }

  async function loadDefaultLibrary() {
    const res = await fetch(DEFAULT_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load library.json");
    return await res.json();
  }

  function loadLocalLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveLocalLibrary(lib) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib, null, 2));
  }

  function resetLocalLibrary() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function downloadText(filename, content, mime = "application/json") {
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
    const out = lib && typeof lib === "object" ? lib : {};
    if (!Array.isArray(out.lessons)) out.lessons = [];
    out.appName = out.appName || "English Quest";
    out.version = Number.isFinite(out.version) ? out.version : 2;

    out.lessons.forEach((lsn, idx) => {
      if (!lsn || typeof lsn !== "object") lsn = out.lessons[idx] = {};
      lsn.id = lsn.id || uid("lesson");
      lsn.title = lsn.title || `Lesson ${idx + 1}`;
      lsn.description = lsn.description || "";
      lsn.kind = String(lsn.kind || "quiz").toLowerCase();
      if (!["homework", "quiz", "exam"].includes(lsn.kind)) lsn.kind = "quiz";

      if (!lsn.takePolicy || typeof lsn.takePolicy !== "object") {
        lsn.takePolicy = { mode: "unlimited", limit: 0 };
      }
      lsn.takePolicy.mode = String(lsn.takePolicy.mode || "unlimited");
      if (!["unlimited", "one_time", "limit"].includes(lsn.takePolicy.mode)) {
        lsn.takePolicy.mode = "unlimited";
      }
      lsn.takePolicy.limit = parseInt(lsn.takePolicy.limit || 0, 10) || 0;

      if (!Array.isArray(lsn.questions)) lsn.questions = [];
      lsn.questions.forEach((q, qi) => {
        if (!q || typeof q !== "object") q = lsn.questions[qi] = {};
        q.id = q.id || uid("q");
        q.type = q.type || "single";
        q.prompt = q.prompt || "";
        if ((q.type === "single" || q.type === "multi") && !Array.isArray(q.options)) {
          q.options = ["A", "B", "C", "D"];
        }
      });
    });

    return out;
  }

  function normalizeOptionLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildQuestionEditor(q, onSave, onDelete) {
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

      blockOptions.style.display = type === "single" || type === "multi" ? "block" : "none";
      blockSingle.style.display = type === "single" ? "block" : "none";
      blockMulti.style.display = type === "multi" ? "block" : "none";
      blockExact.style.display = type === "exact" ? "block" : "none";
      blocksContains.forEach((b) => (b.style.display = type === "contains" ? "block" : "none"));

      const opts = normalizeOptionLines(elOptionsText.value);

      // Single
      elAnswerSingle.innerHTML = "";
      opts.forEach((o) => {
        const op = document.createElement("option");
        op.value = o;
        op.textContent = o;
        elAnswerSingle.appendChild(op);
      });
      if (type === "single") {
        if (q.answer && opts.includes(q.answer)) elAnswerSingle.value = q.answer;
        else elAnswerSingle.value = opts[0] || "";
      }

      // Multi
      elAnswerMulti.innerHTML = "";
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      opts.forEach((o) => {
        const id = uid("chk");
        const row = document.createElement("label");
        row.className = "opt";
        row.setAttribute("for", id);
        row.innerHTML = `<input id="${id}" type="checkbox" /><span class="text">${o}</span>`;
        const chk = row.querySelector("input");
        chk.checked = answerArr.includes(o);
        elAnswerMulti.appendChild(row);
      });

      // Exact / Contains
      if (type === "exact") elAnswerExact.value = q.answer || "";
      if (type === "contains") {
        elKeywords.value = Array.isArray(q.keywords) ? q.keywords.join(", ") : "";
        elMinWords.value = Number.isFinite(q.minWords) ? String(q.minWords) : (q.minWords ? String(q.minWords) : "");
      }
    }

    function commitTypeDefaults(type) {
      q.type = type;

      if (type === "single") {
        q.options = normalizeOptionLines(elOptionsText.value);
        q.answer = q.options[0] || "";
        delete q.keywords;
        delete q.minWords;
      } else if (type === "multi") {
        q.options = normalizeOptionLines(elOptionsText.value);
        q.answer = Array.isArray(q.answer) ? q.answer : [];
        delete q.keywords;
        delete q.minWords;
      } else if (type === "exact") {
        delete q.options;
        q.answer = elAnswerExact.value || "";
        delete q.keywords;
        delete q.minWords;
      } else if (type === "contains") {
        delete q.options;
        delete q.answer;
        q.keywords = normalizeOptionLines((elKeywords.value || "").replace(/\s*,\s*/g, "\n"));
        q.minWords = parseInt(elMinWords.value || "0", 10) || 0;
      }
    }

    renderAnswerControls();

    elType.addEventListener("change", () => {
      commitTypeDefaults(elType.value);
      renderAnswerControls();
      onSave(true);
    });

    elPrompt.addEventListener("input", () => {
      q.prompt = elPrompt.value;
      onSave(false);
    });

    elOptionsText.addEventListener("input", () => {
      q.options = normalizeOptionLines(elOptionsText.value);
      if (q.type === "single") {
        const a = elAnswerSingle.value;
        q.answer = q.options.includes(a) ? a : q.options[0] || "";
      }
      if (q.type === "multi") {
        const prev = new Set(Array.isArray(q.answer) ? q.answer : []);
        q.answer = q.options.filter((o) => prev.has(o));
      }
      renderAnswerControls();
      onSave(false);
    });

    elAnswerSingle.addEventListener("change", () => {
      q.answer = elAnswerSingle.value;
      onSave(true);
    });

    elAnswerMulti.addEventListener("change", () => {
      const chosen = [];
      [...elAnswerMulti.querySelectorAll("input[type=checkbox]")].forEach((chk, idx) => {
        if (chk.checked) chosen.push((q.options || [])[idx]);
      });
      q.answer = chosen.filter(Boolean);
      onSave(true);
    });

    elAnswerExact.addEventListener("input", () => {
      q.answer = elAnswerExact.value;
      onSave(false);
    });

    function updateContains() {
      q.keywords = normalizeOptionLines((elKeywords.value || "").replace(/\s*,\s*/g, "\n"));
      q.minWords = parseInt(elMinWords.value || "0", 10) || 0;
      onSave(false);
    }
    elKeywords.addEventListener("input", updateContains);
    elMinWords.addEventListener("input", updateContains);

    wrap.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm("Delete this question?")) return;
      onDelete();
    });

    return wrap;
  }

  const Admin = {
    lib: null,
    tab: "lessons",
    selectedLessonId: null,
    selectedQuestionId: null,
    _saveTimer: null,
    _initPromise: null,

    async init(force = false) {
      if (Admin._initPromise && !force) return Admin._initPromise;

      Admin._initPromise = (async () => {
        const local = loadLocalLibrary();
        if (local) Admin.lib = ensureLibraryShape(local);
        else Admin.lib = ensureLibraryShape(await loadDefaultLibrary());

        if (!Admin.selectedLessonId && Admin.lib.lessons[0]) {
          Admin.selectedLessonId = Admin.lib.lessons[0].id;
        }
        return Admin.lib;
      })();

      return Admin._initPromise;
    },

    requestSave(showToast = true) {
      clearTimeout(Admin._saveTimer);
      Admin._saveTimer = setTimeout(() => {
        try {
          saveLocalLibrary(Admin.lib);
          if (showToast) toast("Saved (local)", "good");
        } catch (e) {
          console.error(e);
          toast("Save failed (localStorage)", "bad");
        }
      }, 80);
    },

    resetAllLocal() {
      resetLocalLibrary();
      if (Auth) {
        localStorage.removeItem(Auth.USERS_KEY);
        localStorage.removeItem(Auth.ATTEMPTS_KEY);
        Auth.clearAdminSession?.();
      }
      toast("Local data cleared. Reloading…", "info");
      setTimeout(() => location.reload(), 350);
    },

    render(container) {
      // Ensure library is loaded before drawing UI
      if (!Admin.lib) {
        container.innerHTML = `
          <div class="card fade-in">
            <h2 style="margin:0 0 8px;">Loading Admin…</h2>
            <p class="muted" style="margin:0;">Preparing library & users.</p>
          </div>
        `;
        Admin.init()
          .then(() => Admin.render(container))
          .catch((e) => {
            console.error(e);
            container.innerHTML = `
              <div class="card fade-in">
                <h2 style="margin:0 0 8px;">Admin failed to initialize</h2>
                <p class="muted" style="margin:0 0 12px;">${String(e?.message || e)}</p>
                <a class="btn btn-primary" href="#/">Back to Dashboard</a>
              </div>
            `;
          });
        return;
      }

      container.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.className = "grid";

      const left = document.createElement("section");
      left.className = "card panel col-4";
      left.innerHTML = `
        <h2>Admin</h2>
        <p class="small">Protected by Admin Password (GitHub Environment secret).</p>

        <div class="row" style="margin-top:8px;">
          <button class="btn ${Admin.tab === "lessons" ? "btn-primary" : ""}" type="button" data-tab="lessons">Lessons</button>
          <button class="btn ${Admin.tab === "users" ? "btn-primary" : ""}" type="button" data-tab="users">Users</button>
          <button class="btn ${Admin.tab === "gradebook" ? "btn-primary" : ""}" type="button" data-tab="gradebook">Gradebook</button>
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

      // Tabs
      left.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          Admin.tab = btn.getAttribute("data-tab");
          Admin.render(container);
        });
      });

      // Export/import library
      left.querySelector('[data-action="export"]').addEventListener("click", () => {
        const content = JSON.stringify(Admin.lib, null, 2);
        downloadText("library.json", content, "application/json");
        toast("Exported library.json", "good");
      });

      left.querySelector('[data-action="import"]').addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = ensureLibraryShape(JSON.parse(text));
          Admin.lib = parsed;
          Admin.selectedLessonId = parsed.lessons?.[0]?.id || null;
          Admin.selectedQuestionId = null;
          Admin.requestSave(true);
          Admin.render(container);
          toast("Imported JSON", "good");
        } catch {
          toast("Import failed (invalid JSON)", "bad");
        } finally {
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
        Admin._renderLessons(leftBody, mainEditor, sideEditor, container);
      } else if (Admin.tab === "users") {
        Admin._renderUsers(leftBody, mainEditor, sideEditor);
      } else {
        Admin._renderGradebook(leftBody, mainEditor, sideEditor);
      }
    },

    _renderLessons(leftBody, mainEditor, sideEditor, container) {
      // Left: lesson list + add
      leftBody.innerHTML = `
        <div class="row" style="margin-bottom:10px;">
          <button class="btn btn-primary" type="button" data-action="addLesson">+ New Exam</button>
        </div>
        <div style="display:grid; gap:10px;" id="lessonList"></div>
      `;

      const lessonList = leftBody.querySelector("#lessonList");

      function selectedLesson() {
        return Admin.lib.lessons.find((l) => l.id === Admin.selectedLessonId) || null;
      }

      function selectedQuestion(lesson) {
        if (!lesson) return null;
        return (lesson.questions || []).find((q) => q.id === Admin.selectedQuestionId) || null;
      }

      function renderLessonList() {
        lessonList.innerHTML = "";
        if (!Admin.lib.lessons.length) {
          lessonList.innerHTML = `<div class="small">No exams yet. Click “New Exam”.</div>`;
          return;
        }
        Admin.lib.lessons.forEach((l) => {
          const item = document.createElement("div");
          item.className = "admin-item";
          const active = l.id === Admin.selectedLessonId;
          const policyLabel =
            l.takePolicy?.mode === "one_time"
              ? "one time"
              : l.takePolicy?.mode === "limit"
                ? `limit ${l.takePolicy.limit || 0}`
                : "unlimited";

          item.innerHTML = `
            <div class="top">
              <div>
                <div class="name">${l.title}</div>
                <div class="hint">${(l.kind || "quiz")} • ${policyLabel} • ${(l.questions || []).length} q</div>
              </div>
              <div class="row">
                <button class="btn ${active ? "btn-primary" : ""}" type="button" data-action="open">Open</button>
              </div>
            </div>
          `;
          item.querySelector('[data-action="open"]').addEventListener("click", () => {
            Admin.selectedLessonId = l.id;
            Admin.selectedQuestionId = null;
            Admin._renderLessons(leftBody, mainEditor, sideEditor, container);
          });
          lessonList.appendChild(item);
        });
      }

      leftBody.querySelector('[data-action="addLesson"]').addEventListener("click", () => {
        const n = Admin.lib.lessons.length + 1;
        const lesson = {
          id: uid("lesson"),
          title: `Lesson ${n}`,
          description: "",
          kind: "quiz",
          takePolicy: { mode: "unlimited", limit: 0 },
          questions: []
        };
        Admin.lib.lessons.unshift(lesson);
        Admin.selectedLessonId = lesson.id;
        Admin.selectedQuestionId = null;
        Admin.requestSave(true);
        Admin._renderLessons(leftBody, mainEditor, sideEditor, container);
      });

      renderLessonList();

      // Main editor (lesson)
      const lesson = selectedLesson();
      if (!lesson) {
        mainEditor.innerHTML = `
          <h2>Lessons</h2>
          <p class="small">Select an exam on the left, or create a new one.</p>
        `;
        sideEditor.innerHTML = "";
        return;
      }

      mainEditor.innerHTML = `
        <h2>Exam Settings</h2>
        <div class="form">
          <div class="field">
            <label>Title</label>
            <input class="textinput" id="lTitle" />
          </div>
          <div class="field">
            <label>Description</label>
            <textarea class="textarea" id="lDesc" placeholder="Short instructions for students..."></textarea>
          </div>
          <div class="field">
            <label>Type</label>
            <select class="select" id="lKind">
              <option value="homework">homework</option>
              <option value="quiz">quiz</option>
              <option value="exam">exam</option>
            </select>
          </div>

          <div class="field">
            <label>Attempt Policy</label>
            <select class="select" id="lPolicy">
              <option value="unlimited">Unlimited</option>
              <option value="one_time">One Time Take Only</option>
              <option value="limit">Limit attempts (X)</option>
            </select>
          </div>

          <div class="field" id="limitWrap">
            <label>Attempt Limit (X)</label>
            <input class="textinput" id="lLimit" placeholder="2" />
          </div>

          <div class="row">
            <button class="btn btn-primary" type="button" id="btnAddQ">+ Add Question</button>
            <button class="btn btn-danger" type="button" id="btnDelLesson">Delete Exam</button>
            <div class="spacer"></div>
            <span class="tag">${(lesson.questions || []).length} questions</span>
          </div>
        </div>

        <div class="hr"></div>
        <h3 style="margin:0 0 10px;">Questions</h3>
        <div style="display:grid; gap:10px;" id="qList"></div>
      `;

      const lTitle = mainEditor.querySelector("#lTitle");
      const lDesc = mainEditor.querySelector("#lDesc");
      const lKind = mainEditor.querySelector("#lKind");
      const lPolicy = mainEditor.querySelector("#lPolicy");
      const lLimit = mainEditor.querySelector("#lLimit");
      const limitWrap = mainEditor.querySelector("#limitWrap");
      const qList = mainEditor.querySelector("#qList");

      lTitle.value = lesson.title || "";
      lDesc.value = lesson.description || "";
      lKind.value = lesson.kind || "quiz";
      lPolicy.value = lesson.takePolicy?.mode || "unlimited";
      lLimit.value = String(lesson.takePolicy?.limit || "");
      limitWrap.style.display = lPolicy.value === "limit" ? "block" : "none";

      function syncLessonAndSave(showToast = false) {
        lesson.title = lTitle.value || "Untitled";
        lesson.description = lDesc.value || "";
        lesson.kind = String(lKind.value || "quiz").toLowerCase();
        lesson.takePolicy = lesson.takePolicy || { mode: "unlimited", limit: 0 };
        lesson.takePolicy.mode = String(lPolicy.value || "unlimited");
        lesson.takePolicy.limit = parseInt(lLimit.value || "0", 10) || 0;
        limitWrap.style.display = lesson.takePolicy.mode === "limit" ? "block" : "none";
        Admin.requestSave(showToast);
        renderLessonList();
      }

      lTitle.addEventListener("input", () => syncLessonAndSave(false));
      lDesc.addEventListener("input", () => syncLessonAndSave(false));
      lKind.addEventListener("change", () => syncLessonAndSave(true));
      lPolicy.addEventListener("change", () => syncLessonAndSave(true));
      lLimit.addEventListener("input", () => syncLessonAndSave(false));

      function renderQuestionsList() {
        qList.innerHTML = "";
        const qs = lesson.questions || [];
        if (!qs.length) {
          qList.innerHTML = `<div class="small">No questions yet. Click “Add Question”.</div>`;
          return;
        }
        qs.forEach((q, idx) => {
          const item = document.createElement("div");
          item.className = "admin-item";
          const active = q.id === Admin.selectedQuestionId;
          const label = q.prompt ? q.prompt.slice(0, 80) : "(no prompt yet)";
          item.innerHTML = `
            <div class="top">
              <div>
                <div class="name">Q${idx + 1} • ${q.type}</div>
                <div class="hint">${label}</div>
              </div>
              <div class="row">
                <button class="btn ${active ? "btn-primary" : ""}" type="button" data-action="edit">Edit</button>
              </div>
            </div>
          `;
          item.querySelector('[data-action="edit"]').addEventListener("click", () => {
            Admin.selectedQuestionId = q.id;
            renderQuestionsList();
            renderSideEditor();
          });
          qList.appendChild(item);
        });
      }

      function renderSideEditor() {
        sideEditor.innerHTML = "";
        const q = selectedQuestion(lesson);
        if (!q) {
          sideEditor.innerHTML = `
            <div class="card panel">
              <h3>Select a question</h3>
              <p class="small">Pick a question from the list to edit it.</p>
            </div>
          `;
          return;
        }
        const editor = buildQuestionEditor(
          q,
          (showToast) => {
            // keep options/answer consistent
            if ((q.type === "single" || q.type === "multi") && !Array.isArray(q.options)) q.options = [];
            Admin.requestSave(showToast);
            renderQuestionsList();
          },
          () => {
            Admin.deleteActiveQuestion();
            Admin._renderLessons(leftBody, mainEditor, sideEditor, container);
          }
        );
        sideEditor.appendChild(editor);
      }

      mainEditor.querySelector("#btnAddQ").addEventListener("click", () => {
        const q = {
          id: uid("q"),
          type: "single",
          prompt: "",
          options: ["A", "B", "C", "D"],
          answer: "A"
        };
        lesson.questions = lesson.questions || [];
        lesson.questions.push(q);
        Admin.selectedQuestionId = q.id;
        Admin.requestSave(true);
        renderQuestionsList();
        renderSideEditor();
        renderLessonList();
      });

      mainEditor.querySelector("#btnDelLesson").addEventListener("click", () => {
        if (!confirm("Delete this exam?")) return;
        Admin.lib.lessons = Admin.lib.lessons.filter((l) => l.id !== lesson.id);
        Admin.selectedLessonId = Admin.lib.lessons[0]?.id || null;
        Admin.selectedQuestionId = null;
        Admin.requestSave(true);
        Admin._renderLessons(leftBody, mainEditor, sideEditor, container);
      });

      renderQuestionsList();
      renderSideEditor();
    },

    async _renderUsers(leftBody, mainEditor, sideEditor) {
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
        <div style="display:grid; gap:10px;" id="repoUserList"></div>

        <div class="hr"></div>
        <h3 style="margin:0 0 8px;">Local Draft Users (not published yet)</h3>
        <div style="display:grid; gap:10px;" id="localUserList"></div>
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
        repo.forEach((u) => {
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
        local.forEach((u) => {
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
            renderLocalUsers();
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
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const users = Array.isArray(parsed.users) ? parsed.users : [];
          const normalized = users
            .map((u) => ({
              id: u.id || u.username,
              name: u.name || u.username,
              username: String(u.username || "").trim().toLowerCase(),
              passHash: String(u.passHash || "").trim().toLowerCase(),
            }))
            .filter((u) => u.username && u.passHash);

          Auth.importLocalDraftUsers(normalized);
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
        if (!username.trim() || !password) {
          toast("Username and password required", "bad");
          return;
        }
        const r = await Auth.createLocalUser({ name, username, password });
        if (!r.ok) {
          toast(r.message || "Failed", "bad");
          return;
        }
        mainEditor.querySelector("#uPass").value = "";
        renderLocalUsers();
      });

      await Auth.loadRepoUsers(false);
      renderRepoUsers();
      renderLocalUsers();
    },

    async _renderGradebook(leftBody, mainEditor, sideEditor) {
      leftBody.innerHTML = `
        <p class="small">View saved scores per student (scores are local to this device).</p>
        <div class="hr"></div>
        <div style="display:grid; gap:10px;" id="gbUsers"><div class="small">Loading users…</div></div>
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

      const repo = await Auth.getRepoUsers();
      const local = Auth.getLocalDraftUsers();
      const map = new Map();
      [...repo, ...local].forEach((u) => map.set(String(u.username).toLowerCase(), u));
      const users = [...map.values()];

      gbUsers.innerHTML = "";
      if (!users.length) {
        gbUsers.innerHTML = `<div class="small">No users found yet.</div>`;
        return;
      }

      users.forEach((u) => {
        const userId = u.id || u.username;
        const attempts = Auth.getAttemptsForUser(userId);
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
          Admin._renderGradebookDetail(mainEditor, sideEditor, u);
        });
        gbUsers.appendChild(item);
      });
    },

    _renderGradebookDetail(mainEditor, sideEditor, user) {
      const userId = user.id || user.username;
      const attempts = Auth.getAttemptsForUser(userId).slice().reverse();

      const rows = attempts
        .map(
          (a) => `
        <tr>
          <td>${a.takenAt ? new Date(a.takenAt).toLocaleString() : "—"}</td>
          <td>${a.kind || "quiz"}</td>
          <td>${a.lessonTitle || a.lessonId}</td>
          <td>${a.score}/${a.total}</td>
          <td>${a.percent}%</td>
        </tr>
      `
        )
        .join("");

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
      const lesson = Admin.lib.lessons.find((l) => l.id === Admin.selectedLessonId);
      if (!lesson) return;
      lesson.questions = (lesson.questions || []).filter((q) => q.id !== Admin.selectedQuestionId);
      Admin.selectedQuestionId = null;
      Admin.requestSave(true);
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

  // Warm-load (non-blocking)
  Admin.init().catch((err) => {
    console.error(err);
    toast("Failed to initialize Admin library", "bad");
  });
})();
