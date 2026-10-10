# Deployment

## 1. Google Sheets + Apps Script bridge

1. Create a new Google Sheet. Copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
2. Extensions > Apps Script. Delete the placeholder `myFunction` and paste the
   whole contents of `apps-script/Code.gs`.
3. Set `SETTINGS.SPREADSHEET_ID` at the top of `Code.gs`, **or** add a Script
   Property named `SPREADSHEET_ID`.
4. Generate a bridge key and store it as a Script Property:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Project Settings (gear icon) > Script Properties:

   | Property | Value |
   | --- | --- |
   | `SPREADSHEET_ID` | your spreadsheet id (if not set in `Code.gs`) |
   | `API_KEY` | the generated key |

   The bridge **fails closed**: without `API_KEY` every request is rejected.
   `ALLOW_OPEN_BRIDGE=true` exists only for local testing on a private network.
5. Run `setupSheets()` from the editor (Run > Run function, approve the
   permissions). It creates every sheet and header row. Re-run it after any
   future schema change.
6. Deploy > New deployment > Type: **Web app** > Execute as: **Me** > Who has
   access: **Anyone**. Copy the `/exec` URL.
7. Re-run `setupSheets()` once more after the first deployment so the deployed
   version has the current schema.

Optional bootstrap helper, run once from the editor - it refuses to run if an
active administrator already exists:

```js
createInitialAdmin_('you@college.edu', 'Your Name', 'a-strong-password');
```

## 2. Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Required in `.env`:

| Variable | Notes |
| --- | --- |
| `JWT_SECRET` | >= 24 chars. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APPS_SCRIPT_URL` | the `/exec` URL from step 6 |
| `APPS_SCRIPT_API_KEY` | the same key as the `API_KEY` Script Property |
| `CLIENT_URL` | comma-separated allowed origins, e.g. `https://erp.example.com` |

Optional: `PORT` (5000), `JWT_EXPIRES_IN` (8h), `ATTENDANCE_CUTOFF_HOUR` (17),
`ATTENDANCE_TIMEZONE` (Asia/Kolkata), `APPS_SCRIPT_TIMEOUT_MS` (45000),
`DATA_CACHE_TTL_MS` (30000), `BCRYPT_ROUNDS` (10), `NODE_ENV` (development).

```powershell
npm start          # production
npm run dev        # watch mode
npm run check      # syntax check every file
```

The server refuses to start without `JWT_SECRET`, `APPS_SCRIPT_URL` and
`CLIENT_URL`, and rejects a `JWT_SECRET` shorter than 24 characters.

## 3. Frontend

```powershell
cd ..\frontend
Copy-Item .env.example .env.local     # VITE_API_BASE_URL
npm install
npm run build                        # output: frontend/dist
```

`frontend/dist` is a static bundle - serve it from any static host (Netlify,
Vercel, Cloudflare Pages, nginx, Firebase Hosting). Point it at the backend
with `VITE_API_BASE_URL=https://api.example.com/api`.

CORS is handled by the backend from `CLIENT_URL`, so the frontend origin must be
listed there.

## 4. First run

1. `createInitialAdmin_()` in the Apps Script editor (step 1).
2. Sign in at the frontend with that email/password.
3. Immediately change the password in **Security** - the bootstrap hash is
   rewritten as bcrypt on first change.
4. Admin > Departments: add the real departments. Add staff, then students.
   Creating a student/faculty/HOD profile provisions its login automatically, so
   each account can sign in immediately with the password set at creation.
5. Subjects, then **Subject Allocation**: an HOD assigns each subject to one
   faculty member per semester. Until a subject is allocated it stays out of
   faculty view everywhere (material, attendance, assignments, marks, students),
   so this step is what makes the faculty screens useful.
6. Check HOD > Control Center: every subject should show a teacher, and
   **unallocated** should be empty.

## 4b. Upgrading an existing deployment

`setupSheets()` only ever appends, so a spreadsheet created before the
allocation work keeps all of its data:

1. Deploy the new `Code.gs` (Deploy > Manage deployments > Edit > New version).
2. Re-run `setupSheets()` to add the `SubjectAllocations` sheet and the new
   trailing columns (`Materials.visibility`, allocation columns).
3. Confirm the header row still lines up before entering data.
4. Fill in allocations for the current semester; records in other modules keep
   working but faculty-scoped screens only show what is allocated.

The frontend and backend can be deployed before or after this - the backend
reports missing optional modules through `unavailableModules` instead of
failing the whole page, but subject allocation needs step 2 and 3 above.

## 5. Security checklist

- [ ] `API_KEY` Script Property set; `ALLOW_OPEN_BRIDGE` **not** set.
- [ ] `APPS_SCRIPT_API_KEY` matches it in the backend `.env`.
- [ ] `JWT_SECRET` is random, >= 24 chars, and not in version control.
- [ ] Sheets access limited to the deploying account.
- [ ] `.env` files are not committed (they are git-ignored).
- [ ] Live `/exec` URL treated as a secret - it is a credential.

## 6. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Sheet "X" does not exist` | Run `setupSheets()` |
| `Unauthorized request` on every call | `API_KEY` missing or differs from `APPS_SCRIPT_API_KEY` |
| Writes time out | Apps Script cold start; raise `APPS_SCRIPT_TIMEOUT_MS` (default 45000) |
| Login always fails for the first admin | Password changed before `setupSheets()`; re-check the key |
| `Missing required environment variable` | `.env` not copied, or run from the wrong directory |
| 403 on cross-department data | Expected: HOD/faculty are department-scoped by design |
| "You are not allocated to that subject" | Add the subject under Subject Allocation for that HOD / admin |
| 403 on `/dashboard/control-center` | Expected: HOD and admin only |
| A module is missing from the dashboard | Deployment predates the sheet; re-run `setupSheets()` and check `unavailableModules` |