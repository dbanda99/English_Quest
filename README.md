# English Quest (GitHub Pages)

A professional, lightweight web app for **Homeworks, Quizzes, and Exams**, designed for classroom use.

## Features (implemented)
- Admin is password-protected **via GitHub Environment secret** (no backend)
- Admin can add/edit lessons & questions easily (UI editor)
- Local student users (created by Admin)
- Saves scores per student (local gradebook)
- Exam types: **homework / quiz / exam**
- Attempt rules:
  - **Unlimited**
  - **One Time Take Only**
  - **Limit X attempts**
- Results modal shows question numbers + **Review All Questions** button

> Note: Users & scores are stored in **localStorage**. That means they are saved **only on the same computer/browser**.

---

## Deploy to GitHub Pages WITH an Admin password

Because GitHub Pages can’t read secrets at runtime, we inject the secret at deploy time using **GitHub Actions**.

### 1) Create an Environment secret
1. GitHub repo → **Settings → Environments**
2. Create environment: `production`
3. Add secret: `ADMIN_PASS_SHA256`

### 2) Put a SHA-256 hash in the secret (NOT plaintext)
Example (Python):
```bash
python - << 'PY'
import hashlib
pw = "YOUR_ADMIN_PASSWORD"
print(hashlib.sha256(pw.encode()).hexdigest())
PY
```
Copy the output into `ADMIN_PASS_SHA256`.

### 3) Enable GitHub Pages (Source: GitHub Actions)
1. GitHub repo → Settings → Pages
2. **Source**: GitHub Actions

### 4) Deploy
Push to `main`. The workflow will:
- write `assets/admin-secret.js` using the secret
- deploy the site

---

## Local run
Use a local server (fetch() is blocked on file://):
```bash
python -m http.server
```

---

## Admin
- URL: `#/admin`
- Tabs: Lessons, Users, Gradebook

### Publishing updated lessons
Admin edits save locally. To publish:
1. Admin → Export `library.json`
2. Replace `data/library.json` in your GitHub repo with the exported file
3. Push to `main`

---

## Student Login
Admin creates users in **Admin → Users**.
Students log in on the Dashboard page.

---

## Shared student logins across devices (users.json)

Student accounts are loaded from **data/users.json** (in the repo).  
To add or change users:

1. Go to `#/admin` → **Users**
2. Create draft users
3. Click **Export users.json**
4. Replace the repo file: `data/users.json` with the exported one
5. Push to `main` → students can log in from any computer

**Passwords are stored as SHA-256 hashes** (not plaintext).

> Scores/gradebook are still stored locally on each device.  
> If you want centralized scores across devices, tell me and I’ll add a GitHub-based storage option.
