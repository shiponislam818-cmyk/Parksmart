# ParkSmart — Web-Based Smart Parking Management System

CSE 418 (Software Engineering and Design Pattern Lab) project — Metropolitan University, Sylhet.
Built from the ParkSmart SRS: React + Node.js/Express + PostgreSQL + Socket.IO + JWT/bcrypt + qrcode/html5-qrcode + Chart.js.

## What it does

| Area | Features |
|---|---|
| Gate counter (operator) | Plate entry with automatic nearest-slot assignment, slot override, QR ticket (print), exit by camera / USB scanner / typed code, fee calculation, cash or sandbox online payment, lost ticket (find by plate + penalty), offline banner and safe retry |
| Live slot map | Colour **and** text-labelled slots per zone, real-time updates via Socket.IO, Out of Service with reason, slot details |
| Billing | Rate rule per vehicle type (first hour, per started hour, daily cap, grace, lost-ticket penalty, pass price), rate in force at entry is kept, admin-only fee override with reason, receipts (screen, print, PDF) |
| Driver portal | Registration, vehicles, live availability, reservations (hold period, auto-expiry, cancel), monthly passes (sandbox payment, renewal, 3-day reminder on dashboard + email), history and receipts |
| Guest | Public read-only ticket page from the QR code (slot, entry time, elapsed time, current fee) |
| Admin | Dashboard (occupancy per facility/floor, today's revenue, entries, avg stay, passes, peak hours), facilities/zones/slots (bulk create), rates & reservation policy, staff accounts, reports (revenue by day/week/month by vehicle type & method, peak hours, average stay) with CSV/PDF export, append-only audit log with filters |
| Security | bcrypt (cost 10), JWT (8 h), server-side role checks on every endpoint, 15-minute lock after 5 failed logins, 130-bit random ticket codes, parameterised SQL, append-only audit table (DB trigger) |

## Requirements (Windows)

- **Node.js 20 or newer** (tested on Node 26) — https://nodejs.org
- **PostgreSQL 13 or newer** (tested on PostgreSQL 18) — you need the password of the `postgres` user you chose during installation
- VS Code (optional)

## Install and run (development)

Open a terminal (PowerShell) in the project folder:

```powershell
# 1. install dependencies (root helper installs server + client)
npm run install:all

# 2. configure the server
copy server\.env.example server\.env
#    then edit server\.env:
#      DATABASE_URL=postgres://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/parksmart
#      JWT_SECRET=<any long random text>

# 3. create the database, tables and starter data
npm run db:setup

# 4. start API (port 5000) + web client (port 5173) together
npm run dev
```

Open **http://localhost:5173** and sign in with a seeded account:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@parksmart.local | Admin@1234 |
| Gate Operator | operator@parksmart.local | Operator@1234 |
| Registered Driver | driver@parksmart.local | Driver@1234 |

The seed creates two facilities (City Centre Mall, Amberkhana Plaza) with zones and slots, and **sample** rates (car BDT 30 first hour / BDT 20 per hour, grace 10 min — the SRS worked example). Change them under *Rates & policies* (OI-1).

To test on a phone on the same Wi-Fi, open `http://<your-PC-IP>:5173` and set `CLIENT_URL` in `server/.env` to that address so ticket QR codes point to it.

## Run as a single server (production style)

```powershell
npm run build          # builds client/dist
# set CLIENT_URL=http://localhost:5000 in server\.env
npm start              # serves API + built client on http://localhost:5000
```

For deployment (e.g. Render) set the same environment variables; the host provides HTTPS/WSS (CI-01).

## Tests

```powershell
npm test                      # unit tests: fee engine, plate normalisation, ticket codes, validation, formatting
npm run test:coverage         # coverage report (fee engine: 100 % lines)

# API integration tests against a THROW-AWAY database (it is wiped):
createdb -U postgres parksmart_test
$env:TEST_DATABASE_URL="postgres://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/parksmart_test"
npm run test:integration
```

The integration suite covers auth/lockout, the RBAC matrix, entry/exit, concurrent gates (no double assignment), online payment failure, lost ticket, overrides, reservations (hold + expiry), passes, reports/exports, audit immutability and Socket.IO latency.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-restart + Vite dev server |
| `npm run db:setup` | Create DB/tables; seed only if empty (safe to re-run) |
| `npm run db:reset` | **Drops** all ParkSmart tables and reseeds (development only) |
| `npm run build` / `npm start` | Production build / single-server run |

## Project structure

```
ParkSmart/
├─ server/                 Express API + Socket.IO
│  ├─ src/
│  │  ├─ routes/           auth, users, facilities (zones, slots, availability), rates, sessions (entry/exit),
│  │  │                    payments (sandbox gateway, receipts), driver (/me), reports, audit, guest
│  │  ├─ services/         feeEngine (pure), billing, slots (row-locked allocation), scheduler, audit, pdf, email
│  │  ├─ middleware/       JWT auth + role guard
│  │  ├─ db/               schema.sql, setup.js (create/seed), pool.js
│  │  └─ utils/            plate normalisation, ticket codes, validation, formatting
│  └─ tests/               unit/ and integration/
├─ client/                 React (Vite)
│  └─ src/  pages/ (gate, slot map, admin/*, driver/*, guest), components/, lib/, styles/app.css
└─ docs/                   operator quick guide, admin manual, API reference
```

## Notes and assumptions

- **Payments**: online payment uses a built-in **sandbox gateway page** (approve / simulate failure). No real money moves (C-2). A real SSLCommerz sandbox (OI-8) needs store credentials and a public callback URL and was not wired.
- **Email reminders** (FR-RES-07): sent via SMTP if `SMTP_HOST` is set; otherwise printed to the server console. The dashboard reminder always shows.
- **Open issues assumed**: lost-ticket penalty is *added* to the time fee (OI-2); reservations are free and hold the slot 15 min (OI-3, configurable); overstay uses the normal hourly rate (OI-4); a pass waives the fee but does not guarantee a slot (OI-5); vehicles parked overnight keep accruing with the daily cap (OI-6).
- Times are stored in UTC and shown in Asia/Dhaka, dates as DD/MM/YYYY with 12-hour time, amounts as "BDT 1,250".
- Out of scope per SRS: ANPR, barriers/sensors, live bKash/Nagad, native apps.
