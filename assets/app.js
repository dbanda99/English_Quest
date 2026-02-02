/* English Quest — app.js
   Router + Student dashboard + Login + Test + Results modal with "Review all".
*/
(() => {
  const AdminLib = window.EnglishQuestAdmin || null;
  const Engine = window.EnglishQuestEngine;
  const Auth = window.EnglishQuestAuth;

  const appEl = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const btnLogout = document.getElementById("btn-logout");

  const State = {
    lib: null,
    activeLesson: null,
    idx: 0,
    answers: {},
    startedAt: null,
    user: null
  };

  function qs(sel, root=document){ return root.querySelector(sel); }
  function qsa(sel, root=document){ return [...root.querySelectorAll(sel)]; }

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function openModal(title, bodyHtml, actions=[]) {
    modalRoot.innerHTML = "";
    modalRoot.classList.add("show");
    modalRoot.setAttribute("aria-hidden","false");

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", closeModal);

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role","dialog");
    modal.setAttribute("aria-modal","true");

    const header = document.createElement("div");
    header.className = "modal-header";
    header.innerHTML = `
      <div><h3 class="modal-title">${escapeHtml(title)}</h3></div>
      <button class="modal-close" type="button" aria-label="Close">✕</button>
    `;
    header.querySelector(".modal-close").addEventListener("click", closeModal);

    const body = document.createElement("div");
    body.className = "modal-body";
    body.innerHTML = bodyHtml;

    const footer = document.createElement("div");
    footer.className = "modal-actions";
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = a.className || "btn";
      btn.type = "button";
      btn.textContent = a.label;
      btn.addEventListener("click", () => a.onClick?.());
      footer.appendChild(btn);
    });

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);

    modalRoot.appendChild(overlay);
    modalRoot.appendChild(modal);

    const onKey = (ev) => { if (ev.key === "Escape") closeModal(); };
    window.addEventListener("keydown", onKey, { once:true });
  }

  function closeModal(){
    modalRoot.classList.remove("show");
    modalRoot.setAttribute("aria-hidden","true");
    modalRoot.innerHTML = "";
  }

  function fmtTime(ms){
    const s = Math.max(0, Math.floor(ms/1000));
    const m = Math.floor(s/60);
    const r = s % 60;
    if (m <= 0) return `${r}s`;
    return `${m}m ${r}s`;
  }

  const LIB_STORAGE_KEY = "englishQuestLibrary_v2";
  function loadLocalLibraryFallback() {
    try {
      const raw = localStorage.getItem(LIB_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function ensureLibraryShapeFallback(lib) {
    const out = lib && typeof lib === "object" ? lib : {};
    if (!Array.isArray(out.lessons)) out.lessons = [];
    if (!out.appName) out.appName = "English Quest";
    if (!out.version) out.version = 1;
    out.lessons = out.lessons.map((l, i) => {
      const x = l && typeof l === "object" ? l : {};
      if (!x.id) x.id = `lesson_${String(i+1).padStart(2,"0")}`;
      if (!x.title) x.title = `Lesson ${i+1}`;
      if (!x.description) x.description = "";
      if (!x.kind) x.kind = "quiz";
      if (!x.takePolicy || typeof x.takePolicy !== "object") x.takePolicy = { mode:"unlimited", limit:0 };
      if (!Array.isArray(x.questions)) x.questions = [];
      return x;
    });
    return out;
  }
  async function loadDefaultLibraryFallback() {
    const res = await fetch("data/library.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/library.json (${res.status})`);
    return await res.json();
  }

  async function loadLibrary() {
    // Prefer AdminLib helpers if available (for consistency),
    // but DO NOT require them (so login never goes blank).
    try {
      if (AdminLib && typeof AdminLib.loadLocalLibrary === "function") {
        const local = AdminLib.loadLocalLibrary();
        if (local) return AdminLib.ensureLibraryShape(local);
        const def = await AdminLib.loadDefaultLibrary();
        return AdminLib.ensureLibraryShape(def);
      }
    } catch (e) {
      console.warn("AdminLib library helpers failed, using fallback.", e);
    }

    const local = loadLocalLibraryFallback();
    if (local) return ensureLibraryShapeFallback(local);
    const def = await loadDefaultLibraryFallback();
    return ensureLibraryShapeFallback(def);
  }


  function getLessonById(id) {
    return State.lib.lessons.find(l => l.id === id);
  }

  function updateTopbar() {
    State.user = Auth.getCurrentUser();
    btnLogout.style.display = State.user ? "inline-flex" : "none";
  }

  function route() {
    updateTopbar();
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\/?/, "").split("/");
    const root = parts[0] || "";

    if (root === "admin") {
      Auth.requireAdmin().then(ok => {
        if (!ok) { location.hash = "#/"; return; }
        const AdminNow = window.EnglishQuestAdmin;
        if (!AdminNow || !AdminNow.Admin) {
          appEl.innerHTML = `
            <div class="card fade-in">
              <h2 style="margin:0 0 8px;">Admin failed to load</h2>
              <p class="muted" style="margin:0 0 12px;">
                Your <span class="mono">assets/admin.js</span> did not load correctly (syntax error or missing file).
                Re-upload the latest project files and hard refresh.
              </p>
              <div class="row">
                <a class="btn btn-primary" href="#/">Back to Dashboard</a>
              </div>
            </div>
          `;
          return;
        }
        AdminNow.Admin.render(appEl);
      });
      return;
    }

    if (!State.user) {
      renderLogin();
      return;
    }

    if (root === "" ) { renderDashboard(); return; }
    if (root === "lesson") {
      const id = decodeURIComponent(parts[1] || "");
      const lesson = getLessonById(id);
      if (!lesson) { renderNotFound("Lesson not found."); return; }
      renderLessonIntro(lesson);
      return;
    }
    if (root === "test") {
      const id = decodeURIComponent(parts[1] || "");
      const lesson = getLessonById(id);
      if (!lesson) { renderNotFound("Test not found."); return; }
      startOrResumeTest(lesson);
      return;
    }

    renderNotFound("Page not found.");
  }

  function renderNotFound(msg){
    appEl.innerHTML = `
      <div class="card panel">
        <h2>Not found</h2>
        <p>${escapeHtml(msg)}</p>
        <div class="row"><a class="btn btn-primary" href="#/">Dashboard</a></div>
      </div>
    `;
  }

  function renderLogin() {
    appEl.innerHTML = `
      <section class="card panel">
        <h1>Student Login</h1>
        <p>Sign in with the account your teacher created.</p>
        <div class="form" style="max-width:520px;">
          <div class="field">
            <label>Username</label>
            <input class="textinput" id="loginUser" placeholder="maria" />
          </div>
          <div class="field">
            <label>Password</label>
            <input class="textinput" id="loginPass" type="password" placeholder="••••••••" />
          </div>
          <div class="row">
            <button class="btn btn-primary" id="btnLogin" type="button">Login</button>
            <span class="small" id="loginHint"></span>
          </div>
          <div class="hr"></div>
          <p class="small">
            Admin? Go to <span class="mono">#/admin</span>.
          </p>
        </div>
      </section>
    `;

    qs("#btnLogin", appEl).addEventListener("click", async () => {
      const u = qs("#loginUser", appEl).value;
      const p = qs("#loginPass", appEl).value;
      const hint = qs("#loginHint", appEl);
      hint.textContent = "…";
      const res = await Auth.loginUser(u, p);
      if (!res.ok) {
        hint.textContent = res.message || "Login failed";
        hint.className = "small bad";
        return;
      }
      hint.textContent = "";
      hint.className = "small";
      updateTopbar();
      location.hash = "#/";
    });
  }

  function examBadge(kind){
    const k = (kind || "quiz").toLowerCase();
    if (k === "homework") return `<span class="tag">Homework</span>`;
    if (k === "exam") return `<span class="tag">Exam</span>`;
    return `<span class="tag">Quiz</span>`;
  }

  function attemptsInfo(lesson){
    const take = lesson.takePolicy?.mode || "unlimited";
    const limit = parseInt(lesson.takePolicy?.limit || 0, 10) || 0;
    const used = Auth.countAttemptsForLesson(State.user.id, lesson.id);

    if (take === "unlimited") return { text: `Attempts: ${used} (unlimited)`, canTake: true };
    if (take === "one_time") return { text: used >= 1 ? "Attempts: 1/1 (locked)" : "Attempts: 0/1", canTake: used < 1 };
    if (take === "limit") {
      const max = Math.max(1, limit || 1);
      return { text: used >= max ? `Attempts: ${max}/${max} (locked)` : `Attempts: ${used}/${max}`, canTake: used < max };
    }
    return { text: `Attempts: ${used}`, canTake: true };
  }

  function renderDashboard() {
    const totalLessons = State.lib.lessons.length;
    const attempts = Auth.getAttemptsForUser(State.user.id).slice().reverse().slice(0, 6);

    appEl.innerHTML = `
      <section class="card dashboard-head">
        <div>
          <h1 class="dashboard-title">Dashboard</h1>
          <p class="dashboard-sub">Welcome, <b>${escapeHtml(State.user.name)}</b>. Choose an assignment below.</p>
        </div>
        <div class="row">
          <span class="pill">Lessons <strong>${totalLessons}</strong></span>
        </div>
      </section>

      <div class="grid" style="margin-top:14px;">
        <section class="card panel col-8">
          <h2>Assignments</h2>
          <p class="small">Homework, quizzes, and exams. Attempt rules are enforced automatically.</p>
          <div class="lesson-list" id="lessonList"></div>
        </section>

        <section class="card panel col-4">
          <h2>Recent Scores</h2>
          <p class="small">Saved locally on this computer/browser.</p>
          <div class="hr"></div>
          <div id="recentScores"></div>
        </section>
      </div>
    `;

    const list = qs("#lessonList", appEl);
    list.innerHTML = "";

    State.lib.lessons.forEach((lesson) => {
      const info = attemptsInfo(lesson);
      const row = document.createElement("div");
      row.className = "lesson-row";
      row.innerHTML = `
        <div class="meta">
          <div class="title">${escapeHtml(lesson.title)}</div>
          <div class="desc">${escapeHtml(lesson.description || "")}</div>
          <div class="small" style="margin-top:6px;">${escapeHtml(info.text)}</div>
        </div>
        <div class="row">
          ${examBadge(lesson.kind)}
          <a class="btn" href="#/lesson/${encodeURIComponent(lesson.id)}">Details</a>
          <a class="btn btn-primary" ${info.canTake ? "" : "aria-disabled='true'"} href="${info.canTake ? `#/test/${encodeURIComponent(lesson.id)}` : "#/"}" ${info.canTake ? "" : "style='pointer-events:none; opacity:.6'"}>Start</a>
        </div>
      `;
      list.appendChild(row);
    });

    if (State.lib.lessons.length === 0) list.innerHTML = `<div class="small">No assignments yet.</div>`;

    const recent = qs("#recentScores", appEl);
    if (attempts.length === 0) {
      recent.innerHTML = `<div class="small">No attempts yet.</div>`;
    } else {
      recent.innerHTML = attempts.map(a => `
        <div class="admin-item" style="padding:10px;">
          <div class="top">
            <div>
              <div class="name">${escapeHtml(a.lessonTitle || a.lessonId)}</div>
              <div class="hint">${escapeHtml((a.kind||"quiz").toUpperCase())} • ${a.score}/${a.total} • ${a.percent}%</div>
            </div>
          </div>
          <div class="small" style="margin-top:6px;">${a.takenAt ? new Date(a.takenAt).toLocaleString() : ""}</div>
        </div>
      `).join("");
    }
  }

  function renderLessonIntro(lesson) {
    const info = attemptsInfo(lesson);
    appEl.innerHTML = `
      <section class="card panel">
        <h2>${escapeHtml(lesson.title || "Lesson")}</h2>
        <p>${escapeHtml(lesson.description || "")}</p>

        <div class="row">
          ${examBadge(lesson.kind)}
          <span class="pill">${escapeHtml(info.text)}</span>
          <div class="spacer"></div>
          <a class="btn" href="#/">Back</a>
          <a class="btn btn-primary" href="${info.canTake ? `#/test/${encodeURIComponent(lesson.id)}` : "#/"}" ${info.canTake ? "" : "style='pointer-events:none; opacity:.6'"}>${info.canTake ? "Start" : "Locked"}</a>
        </div>

        <div class="hr"></div>
        <p class="small">
          Tip: “Exact” ignores extra spaces and capitalization. “Contains” requires keyword(s).
        </p>
      </section>
    `;
  }

  function startOrResumeTest(lesson) {
    const info = attemptsInfo(lesson);
    if (!info.canTake) {
      Auth.toast("No attempts left for this assignment.", "bad");
      location.hash = `#/lesson/${encodeURIComponent(lesson.id)}`;
      return;
    }

    State.activeLesson = lesson;
    State.idx = 0;
    State.answers = {};
    State.startedAt = Date.now();
    renderTest();
  }

  function currentQuestion() { return State.activeLesson.questions[State.idx]; }

  function collectAnswerFromUI(q, root) {
    if (!q) return null;
    if (q.type === "single") {
      const checked = qs('input[type="radio"]:checked', root);
      return checked ? checked.value : "";
    }
    if (q.type === "multi") {
      return qsa('input[type="checkbox"]:checked', root).map(x => x.value);
    }
    if (q.type === "exact" || q.type === "contains") {
      const ta = qs('[data-role="textAnswer"]', root);
      return ta ? ta.value : "";
    }
    return null;
  }

  function validateAnswer(q, answer) {
    if (!q) return { ok:false, message:"No question" };
    if (q.type === "single") return answer ? { ok:true } : { ok:false, message:"Please select an option." };
    if (q.type === "multi") return (Array.isArray(answer) && answer.length) ? { ok:true } : { ok:false, message:"Please select at least one option." };
    if (q.type === "exact" || q.type === "contains") return String(answer||"").trim() ? { ok:true } : { ok:false, message:"Please type your answer." };
    return { ok:true };
  }

  function renderTest() {
    const lesson = State.activeLesson;
    const total = lesson.questions.length;

    if (!total) {
      appEl.innerHTML = `
        <section class="card panel">
          <h2>${escapeHtml(lesson.title)}</h2>
          <p>This assignment has no questions yet.</p>
          <div class="row">
            <a class="btn" href="#/">Dashboard</a>
          </div>
        </section>
      `;
      return;
    }

    const q = currentQuestion();
    appEl.innerHTML = `
      <section class="card test-shell">
        <div class="test-header">
          <div>
            <h2 class="test-title">${escapeHtml(lesson.title || "Test")}</h2>
            <p class="test-sub">Question ${State.idx + 1} / ${total}</p>
          </div>
          <div class="row">
            ${examBadge(lesson.kind)}
            <a class="btn btn-ghost" href="#/lesson/${encodeURIComponent(lesson.id)}">Exit</a>
          </div>
        </div>

        <div class="progress"><div></div></div>

        <div class="qwrap enter" id="qwrap"></div>

        <div class="test-actions">
          <button class="btn" type="button" id="btnBack" ${State.idx === 0 ? "disabled" : ""}>Back</button>
          <div class="spacer"></div>
          <span class="small" id="hint"></span>
          <button class="btn btn-primary" type="button" id="btnNext">${State.idx === total-1 ? "Finish" : "Next"}</button>
        </div>
      </section>
    `;

    const qwrap = qs("#qwrap", appEl);
    qwrap.innerHTML = renderQuestionHTML(q, State.idx);

    const pct = Math.round(((State.idx) / total) * 100);
    qs(".progress > div", appEl).style.width = `${pct}%`;

    qs("#btnBack", appEl).addEventListener("click", () => { if (State.idx>0) changeQuestion(State.idx-1); });

    qs("#btnNext", appEl).addEventListener("click", () => {
      const ans = collectAnswerFromUI(q, qwrap);
      const v = validateAnswer(q, ans);
      const hint = qs("#hint", appEl);
      if (!v.ok) {
        hint.textContent = v.message;
        hint.className = "small warn";
        pulse(qwrap);
        return;
      }
      hint.textContent = "";
      hint.className = "small";
      State.answers[q.id] = ans;

      if (State.idx === total - 1) finishTest();
      else changeQuestion(State.idx + 1);
    });
  }

  function pulse(el){
    el.animate([
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(0)" },
    ], { duration: 260, easing: "ease-out" });
  }

  function changeQuestion(newIdx) {
    const qwrap = qs("#qwrap", appEl);
    qwrap.classList.remove("enter");
    qwrap.classList.add("exit");
    setTimeout(() => { State.idx = newIdx; renderTest(); }, 160);
  }

  function renderQuestionHTML(q, idx) {
    const type = q.type;
    const prompt = escapeHtml(q.prompt || "");

    let help = "";
    if (type === "single") help = "Choose one option.";
    if (type === "multi") help = "Select all that apply.";
    if (type === "exact") help = "Type the exact phrase.";
    if (type === "contains") help = `Must contain: ${(q.keywords||[]).join(", ") || "(any)"}${q.minWords ? ` • min ${q.minWords} words` : ""}`;

    let body = "";

    if (type === "single") {
      const opts = q.options || [];
      body = `
        <div class="options">
          ${opts.map((o, i) => {
            const letter = String.fromCharCode(65 + i);
            const id = `opt_${q.id}_${i}`;
            return `
              <label class="opt" for="${id}">
                <input id="${id}" type="radio" name="single_${q.id}" value="${escapeHtml(o)}"/>
                <span class="label">${letter}</span>
                <span class="text">${escapeHtml(o)}</span>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }

    if (type === "multi") {
      const opts = q.options || [];
      body = `
        <div class="options">
          ${opts.map((o, i) => {
            const letter = String.fromCharCode(65 + i);
            const id = `chk_${q.id}_${i}`;
            return `
              <label class="opt" for="${id}">
                <input id="${id}" type="checkbox" name="multi_${q.id}" value="${escapeHtml(o)}"/>
                <span class="label">${letter}</span>
                <span class="text">${escapeHtml(o)}</span>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }

    if (type === "exact" || type === "contains") {
      body = `
        <textarea class="textarea" data-role="textAnswer" placeholder="Type your answer here..."></textarea>
        <div class="small" style="margin-top:8px;">
          ${type === "exact" ? "Tip: extra spaces & capitalization are ignored." : "Tip: include the required keyword(s)."}
        </div>
      `;
    }

    return `
      <p class="qprompt">Q${idx+1}. ${prompt}</p>
      <p class="qhelp">${escapeHtml(help)}</p>
      ${body}
    `;
  }

  function finishTest() {
    const lesson = State.activeLesson;
    const total = lesson.questions.length;
    const results = [];
    let correct = 0;

    lesson.questions.forEach((q, i) => {
      const user = State.answers[q.id];
      const r = Engine.gradeQuestion(q, user);
      results.push({ index: i+1, q, ...r });
      if (r.correct) correct += 1;
    });

    const pct = Engine.percent(correct, total);
    const duration = fmtTime(Date.now() - (State.startedAt || Date.now()));

    const attempt = {
      attemptId: "a_" + Math.random().toString(16).slice(2,10) + "_" + Date.now().toString(16),
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      kind: lesson.kind || "quiz",
      score: correct,
      total,
      percent: pct,
      takenAt: new Date().toISOString()
    };
    Auth.recordAttempt(State.user.id, attempt);

    const wrong = results.filter(r => !r.correct);

    function rowHtml(r){
      const expected = Engine.prettyAnswer(r.q.answer ?? (r.q.keywords||[]));
      const user = Engine.prettyAnswer(r.user);
      const status = r.correct ? `<span class="good">Correct</span>` : `<span class="bad">Wrong</span>`;
      return `
        <tr>
          <td style="width:60px;">Q${r.index}</td>
          <td>${escapeHtml(r.q.prompt || "")}</td>
          <td>${status}</td>
          <td class="${r.correct ? "good" : "bad"}">${escapeHtml(user) || "—"}</td>
          <td class="good">${escapeHtml(expected) || "—"}</td>
        </tr>
      `;
    }

    const allTable = `
      <table class="table" id="tbl-all">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Status</th>
            <th>Your answer</th>
            <th>Correct</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(rowHtml).join("")}
        </tbody>
      </table>
    `;

    const wrongTable = `
      <table class="table" id="tbl-wrong">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Status</th>
            <th>Your answer</th>
            <th>Correct</th>
          </tr>
        </thead>
        <tbody>
          ${wrong.length ? wrong.map(rowHtml).join("") : `<tr><td colspan="5" class="good">Perfect! 🎉</td></tr>`}
        </tbody>
      </table>
    `;

    const body = `
      <div class="row" style="margin-bottom:10px;">
        <span class="pill">Score <strong>${correct}/${total}</strong></span>
        <span class="pill">Percent <strong>${pct}%</strong></span>
        <span class="pill">Time <strong>${duration}</strong></span>
      </div>

      <div class="row" style="margin-bottom:10px;">
        <button class="btn" type="button" id="btn-show-wrong">Show Incorrect</button>
        <button class="btn btn-primary" type="button" id="btn-show-all">Review All Questions</button>
        <span class="small" id="reviewHint">${wrong.length ? `${wrong.length} incorrect` : "All correct"}</span>
      </div>

      <div id="review-wrong">${wrongTable}</div>
      <div id="review-all" style="display:none;">${allTable}</div>

      <div class="small" style="margin-top:10px;">
        Saved to this device for gradebook.
      </div>
    `;

    openModal(
      `Results — ${lesson.title || "Test"}`,
      body,
      [
        { label: "Retry", className: "btn", onClick: () => { closeModal(); location.hash = `#/test/${encodeURIComponent(lesson.id)}`; } },
        { label: "Dashboard", className: "btn btn-primary", onClick: () => { closeModal(); location.hash = "#/"; } }
      ]
    );

    const btnWrong = qs("#btn-show-wrong", modalRoot);
    const btnAll = qs("#btn-show-all", modalRoot);
    const viewWrong = qs("#review-wrong", modalRoot);
    const viewAll = qs("#review-all", modalRoot);

    btnWrong?.addEventListener("click", () => {
      viewWrong.style.display = "block";
      viewAll.style.display = "none";
    });
    btnAll?.addEventListener("click", () => {
      viewWrong.style.display = "none";
      viewAll.style.display = "block";
    });
  }

  async function boot() {
    try {
      State.lib = await loadLibrary();
    } catch (e) {
      console.error("Library load failed", e);
      State.lib = { appName: "English Quest", version: 1, lessons: [] };
      Auth.toast?.("Library failed to load. Check that data/library.json exists in your repo.", "bad");
    }
    updateTopbar();

    btnLogout.addEventListener("click", () => {
      Auth.logoutUser();
      updateTopbar();
      location.hash = "#/";
      route();
    });

    window.addEventListener("hashchange", route);
    route();
  }

  boot();
})();
