# Tutorial Classroom

A React classroom platform backed by Supabase. Students join courses, read
materials, submit assignments and see their grades; tutors create and run their
own courses; administrators manage every user and course.

## Setup

### 1. Create the database

Open the Supabase **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).

It creates a dedicated `classroom` schema — nothing in your `public` schema is
touched — containing:

| Table         | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| `profiles`    | One row per auth user (name, username, role)               |
| `levels`      | 100 / 200 / 300 / 400                                      |
| `courses`     | Catalogue plus tutor-created courses, with an owner        |
| `enrollments` | Which courses a user has joined                            |
| `materials`   | Reading lists and resources per course                     |
| `assignments` | Work set by a tutor                                        |
| `submissions` | One per student per assignment, with grade and feedback    |
| `messages`    | Class chat, streamed over Supabase Realtime                |

Row level security is enabled on every table. The script also seeds the four
levels and the full 68-course catalogue.

> **Warning:** the script starts with `DROP SCHEMA classroom CASCADE`. Re-running
> it is a full reset, not a migration.

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
| `/Admin` | admin |

## Scripts

- `npm start` — dev server on port 3000 (`PORT=3001 npm start` to change it)
- `npm test` — test suite
- `npm run build` — production build
