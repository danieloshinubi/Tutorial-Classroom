# Tutorial Classroom

A React classroom platform backed by Supabase. Students join courses, read
materials, submit assignments and see their grades; tutors create and run their
own courses; administrators manage every user and course.

## Setup

### 1. Create the database

Every table, policy and function lives as a numbered file under
[`supabase/`](supabase) — `001_grants.sql`, `002_backfill_profiles.sql`, and so
on through the current schema. There's no separate bootstrap script to run
first; the numbered migrations are the whole schema, applied in order.

Set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in `.env` (a personal
access token from your Supabase account, and the project's ref from its
Settings page — no database password needed, this runs through the
Management API), then:

```bash
npm run migrate           # apply everything outstanding
npm run migrate:status    # show what has run without changing anything
```

Safe to re-run — each file only ever applies once, tracked in
`schoolivio.migrations`.

### 2. Expose the schema

Go to **Settings → Data API → Exposed schemas** and add `classroom` next to `public`.
Without this every query fails — the app shows a banner telling you so.

### 3. Configure the app

```bash
cp .env.example .env
```

Set `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` from
**Settings → API Keys** (use the publishable key).

> **Only ever use the publishable/anon key.** Create React App inlines these
> values into the browser bundle, so anything in `.env` is public. The secret
> key bypasses row level security entirely and must never appear here.

No key is needed for Google sign-in — see below.

### 4. Run it

```bash
npm install
npm start
```

### 5. Make yourself an administrator

Signup can only ever create a student or a tutor — nobody can register as an
admin. Sign up through the app, then run once in the SQL Editor:

```sql
update classroom.profiles set role = 'admin' where email = 'you@example.com';
```

Sign out and back in. The **Admin** tab appears in the navbar.

## Exams and tests

Tutors set papers; students sit them in the app; multiple choice and true/false
are marked instantly.

**Authoring** — open a course → **Exams** → *Create exam*. Each question is
multiple choice, true/false, or short answer, with its own mark. Set a time
limit and a closing date, then *Save & publish*, or keep it as a draft.
Students never see drafts.

**Sitting** — students open a published exam and press *Start*. A countdown
runs in the header, and every answer saves as it is given, so a closed tab or a
lost connection does not lose the paper. The timer is derived from the server's
`started_at`, so refreshing cannot buy extra time. When it hits zero the paper
submits itself. One attempt per student.

**Marking** — multiple choice and true/false are marked the moment the paper is
submitted. Short answers with an answer key are matched automatically (case and
spacing ignored); the rest wait for the tutor under **Exams → Results**, where
each paper can be opened and marked by hand. Saving marks recalculates the
total.

**The answer key never reaches the browser.** The client reads exam options
without the `is_correct` column, and marking happens inside a `SECURITY
DEFINER` function in Postgres — so a student cannot read the answers out of the
network tab.

## Exam integrity

Two layers, and the distinction matters.

**Browser lockdown — deterrents.** Copy, cut, paste, right-click, text
selection and drag-and-drop are blocked; so are `Ctrl/Cmd + C/V/X/P/S/U/F`,
`F12` and `Ctrl+Shift+I/J/C`. The paper runs fullscreen. Leaving fullscreen,
switching tabs, minimising, or the window losing focus is detected. Questions
and answer options are shuffled per student, so neighbours see different
papers. **A student with devtools can disable all of this** — its job is to
make casual cheating hard and, above all, noisy.

**Database enforcement — the layer that holds.** Every rule that decides a mark
lives in Postgres and cannot be bypassed by tampering with the client:

- Answers are rejected after the deadline, by RLS, not by the timer.
- Attempts are created by `start_exam_attempt()`, so nobody can pre-create one,
  restart to reset the clock, or open an unpublished or closed paper.
- One attempt per student, enforced by a unique constraint.
- Marking happens inside a `SECURITY DEFINER` function; the answer key is never
  sent to the browser.
- Disqualification is decided server-side once the violation count is reached.
- `exam_events` is append-only — there is deliberately no UPDATE or DELETE
  policy for anyone, tutors included, so the log cannot be rewritten.
- Students cannot delete an answer they have already given.

**What the tutor sees.** Each attempt shows its violation count and any
`disqualified`, `auto-submitted` or `late` flag, plus an **Activity** log
listing every event with a timestamp.

**Configurable per exam**, in the builder: block copy/paste, require
fullscreen, shuffle questions, shuffle options, and how many violations trigger
disqualification (0 = warn only, never disqualify).

### Known limits

Be honest with students about what this is. It is not a substitute for
invigilation:

- A second device, a phone or a person in the room is entirely undetectable.
- Screenshots cannot be blocked; `PrintScreen` is logged, nothing more.
- Fullscreen can be declined in some browsers, and cannot be forced.
- A determined student can disable the JavaScript restrictions — but not the
  deadline, the single attempt, or the marking.

## Google sign-in (optional)

The app uses Supabase's OAuth redirect flow, so the Google client secret stays
in Supabase and never reaches the browser. The button appears on the Login and
Signup pages **only once the provider is enabled** — the app asks Supabase which
providers are on, so there is no broken button while it is off.

**1. Google Cloud Console** → *APIs & Services → Credentials* → *Create
credentials → OAuth client ID* → **Web application**.

Add this Authorised redirect URI (the project ref is in your Supabase URL):

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

**2. Supabase** → *Authentication → Sign In / Providers → Google* → enable it and
paste the Client ID and Client Secret from step 1.

**3. Supabase** → *Authentication → URL Configuration* → set **Site URL** and add
your app's origins under **Redirect URLs**:

```
http://localhost:3000
http://localhost:3001
```

Add your production URL there too when you deploy, or the redirect back from
Google will be rejected.

Refresh the app and the button appears. Google accounts always arrive as
students; promote them from the admin portal.

## Roles

| | Student | Tutor | Admin |
| --- | --- | --- | --- |
| Join courses, chat, submit work | ✅ | ✅ | ✅ |
| Create and edit own courses | | ✅ | ✅ |
| Post materials and assignments | | own courses | any course |
| Grade submissions | | own courses | any course |
| See a course's full roster | | own courses | any course |
| Manage all users and roles | | | ✅ |

Roles are enforced in Postgres by row level security, not just hidden in the UI —
forcing your way to `/Admin` still returns nothing you are not entitled to.

## Routes

| Route | Access |
| --- | --- |
| `/Login`, `/Signup`, `/SignupTutor` | public |
| `/Forgot-Password`, `/Reset-Password` | public |
| `/Dashboard` | signed in — your courses |
| `/Levels`, `/Levels/:year/Courses` | signed in |
| `/Levels/:year/Courses/:code` | signed in — stream, materials, assignments, people |
| `/Assignments/:id` | signed in — submit, or grade if you own the course |
| `/Tutors`, `/Profile` | signed in |
| `/Teach`, `/Teach/New`, `/Teach/:id/Edit` | tutor or admin |
| `/Courses/:id/Exams/New` | tutor or admin — author an exam |
| `/Exams/:id` | signed in — sit the exam |
| `/Exams/:id/Results` | tutor or admin — results and marking |
| `/Admin` | admin |

## Scripts

- `npm start` — dev server on port 3000 (`PORT=3001 npm start` to change it)
- `npm test` — test suite
- `npm run build` — production build
