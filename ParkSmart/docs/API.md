# ParkSmart REST API (v1)

Base URL: `/api/v1`. JSON in and out. Authenticated endpoints need `Authorization: Bearer <JWT>` (8 h lifetime).
Errors: `{ "error": "<what went wrong and what to do>" }` with standard status codes (400 validation, 401 not logged in, 403 role not allowed, 404 not found, 409 conflict).
Roles: **A** Administrator, **O** Gate Operator, **D** Registered Driver, **P** public.

## Auth
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| POST | /auth/register | P | `{name, phone, email, password}` → `{token, user}` (driver) |
| POST | /auth/login | P | `{identifier (email or phone), password}` → `{token, user}`; 5 failures lock 15 min |
| GET | /auth/me | A O D | current user |
| POST | /auth/logout | A O D | audit entry; client discards the token |
| POST | /auth/change-password | A O D | `{current_password, new_password}` |

## Users (staff management)
| GET | /users?role=&q= | A | list |
| POST | /users | A | `{name, email, phone?, role: admin\|operator, password}` |
| PUT | /users/:id | A | `{name, email, phone?, role, password?}` |
| PATCH | /users/:id/active | A | `{is_active}` |

## Facilities, zones, slots
| GET | /facilities?all=1 | A O D | `all=1` (admin) includes inactive |
| POST / PUT | /facilities, /facilities/:id | A | `{name, address, opening_hours}` |
| PATCH | /facilities/:id/active | A | `{is_active}` |
| GET / POST | /facilities/:id/zones | A O D / A | `{label, sort_order}` |
| PUT / DELETE | /zones/:id | A | delete refused with parked vehicles/reservations |
| GET | /facilities/:id/slots?status=&vehicle_type= | A O D | slot map (staff also get plate + session) |
| POST | /zones/:id/slots | A | single `{code, vehicle_type}` or bulk `{mode:"bulk", prefix, from, to, pad, vehicle_type}` |
| PUT / DELETE | /slots/:id | A | `{code, vehicle_type, sequence_no}` |
| GET | /slots/:id | A O | details, current session, reservations |
| PATCH | /slots/:id/service | A O | `{out_of_service: true, reason}` (only from Free) or `{out_of_service: false}` |
| GET | /availability | A O D | free/occupied/reserved/out counts per facility and vehicle type |

## Rates & settings
| GET | /rates | A O D | active rule per vehicle type |
| GET | /rates/history | A | all rules |
| PUT | /rates/:vehicleType | A | `{first_hour, per_hour, daily_cap, grace_minutes, lost_ticket_penalty, monthly_pass_price}` — closes the old rule |
| GET / PUT | /settings | A O D / A | `{reservation_hold_minutes, reservation_max_hours, reservation_advance_days}` |

## Parking sessions (gate)
| GET | /sessions/suggest?facility_id=&vehicle_type= | A O | nearest free slot preview |
| POST | /sessions | A O | entry `{facility_id, plate, vehicle_type, slot_id?, client_request_id?}` → 201 ticket `{ticket_code, qr (PNG data URL), guest_url, slot, …}`; same `client_request_id` replays (200) |
| GET | /sessions?status=&facility_id=&q= | A O | list |
| GET | /sessions/lookup?code= \| ?plate= | A O | exit quote; `code` accepts code or scanned URL; `plate` = lost ticket (penalty added) |
| POST | /sessions/:id/exit | A O | `{method: cash\|online, lost_ticket?, override_amount?, override_reason?}` (override: admin only). Cash closes at once; online returns `{pending: true, payment}` |
| GET | /sessions/:id/ticket | A O | ticket reprint |

## Payments
| GET | /payments/:id | staff, or owner | summary (sandbox page) |
| POST | /payments/:id/sandbox | staff (parking) / pass holder | `{outcome: success\|failure}` — test mode only |
| GET | /payments/:id/receipt | staff, or owner | receipt JSON |
| GET | /payments/:id/receipt.pdf | staff, or owner | receipt PDF |

## Driver (/me)
| GET / POST | /me/vehicles | D | `{plate, type}` |
| DELETE | /me/vehicles/:id | D | unlink |
| GET / POST | /me/reservations | D | `{vehicle_id, facility_id, start_time, end_time}` (ISO) |
| POST | /me/reservations/:id/cancel | D | |
| GET / POST | /me/passes | D | `{vehicle_id, facility_id}` → `{pass, payment, gateway_url}` |
| POST | /me/passes/:id/renew | D | new pass starting after the current one |
| GET | /me/history | D | sessions + pass payments with receipt ids |

## Reports & audit (admin)
| GET | /reports/dashboard | A | tiles, occupancy per facility/zone, hourly entries, revenue by type (month) |
| GET | /reports/revenue?from=&to=&group=day\|week\|month | A | rows by period × vehicle type × method × source |
| GET | /reports/traffic?from=&to= | A | entries per hour, peak hour, average stay |
| GET | /reports/export?report=revenue\|traffic&format=csv\|pdf&from=&to=&group= | A | file download |
| GET | /audit?user_id=&action=&from=&to=&page= | A | 50 per page |
| GET | /audit/actions | A | distinct actions |

## Public
| GET | /guest/tickets/:code | P | slot, entry time, elapsed, current fee (no plate / personal data) |
| GET | /health | P | liveness |

## Socket.IO (same origin, JWT in `auth.token`)
- `slot:updated` `{id, facility_id, zone_id, code, vehicle_type, status, out_of_service_reason, at}`
- `layout:changed` `{facility_id}` — slots/zones added or removed; clients re-fetch. Clients also re-fetch after reconnecting.
