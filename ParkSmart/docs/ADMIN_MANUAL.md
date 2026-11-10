# ParkSmart — Administrator Manual

Administrators can do everything an operator can, plus set-up, rates, staff, reports and the audit log.

## 1. Facilities, zones and slots (Facilities & slots)
- **New facility**: name, address, opening hours. Use the switch to deactivate/activate a facility (not possible while vehicles are parked or reservations are pending). The pencil edits it.
- Select a facility on the left, then **Add zone / floor**. The **order** decides which zone is "nearest": entry assigns the free slot in the lowest-order zone, then the lowest sequence number.
- **Add slots**:
  - *Bulk range*: prefix `A-`, from `1`, to `40`, digits `2` creates A-01 … A-40.
  - *Single slot*: one code.
  - Every slot has exactly one vehicle type. Codes must be unique inside a facility.
- Edit a slot (code, type, sequence) with the pencil; delete with the bin. Slots or zones with a parked vehicle or an active reservation cannot be deleted.

## 2. Rates and policies (Rates & policies)
For each vehicle type set: first-hour charge, per-started-hour charge, daily cap (per 24 h block, 0 = no cap), grace minutes, lost-ticket penalty and monthly pass price. **Save new rate** starts a new rule from now; vehicles already parked keep the old rule. **Rate history** shows all rules.

Fee rule: 0 if the stay ≤ grace minutes; otherwise first hour + per-hour charge for every started hour after the first, each 24-hour block capped at the daily cap; lost tickets add the penalty.

**Reservation policy**: hold period after the start time (default 15 min), maximum window length, how many days ahead drivers may book.

## 3. Staff & users
- **New staff account** creates a Gate Operator or Administrator (email + initial password).
- The pencil edits name, email, phone, role, or sets a new password (leave blank to keep).
- The switch deactivates/reactivates an account — a deactivated user is signed out at their next action and cannot log in.
- Accounts lock for 15 minutes after 5 wrong passwords; setting a new password unlocks them.

## 4. Fee override
At the gate, after finding a ticket, **Override fee** lets you charge a different amount. A reason is mandatory and is recorded in the audit log and on the receipt.

## 5. Dashboard and reports
- **Dashboard**: occupancy now (per facility and floor), today's revenue with cash/online split, entries today and average stay, active passes and those expiring this week, entries per hour today, revenue by vehicle type this month (Export CSV/PDF).
- **Reports**: choose a date range (or Today / 7 days / 30 days) and group revenue by day, week or month. Revenue is split by vehicle type and payment method; switch Chart/Table. Peak hours and average stay by vehicle type are shown below. Each report exports to **CSV** and **PDF**.

## 6. Audit log
Every login, entry, exit, payment, fee override, rate change and slot status change is recorded with user, action, target and time. Filter by user, action and date range; **Show** reveals before/after details. Entries cannot be edited or deleted (the database refuses it).

## 7. Backups (NFR-REL-04)
Back up daily, e.g. with Windows Task Scheduler:
```
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc parksmart > D:\backup\parksmart_%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.dump
```
Restore into a new database with `pg_restore -U postgres -d parksmart_restore file.dump`.
