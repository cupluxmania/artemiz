# Hospital Expo — Booth Booking Management System

A full-stack booth booking system built from your "DB OSI Ver 3.0 2026" spreadsheet
(Booking Stand tab). Includes a real SQLite database, JWT login with roles, a premium
light-themed dashboard UI, Excel import, and Excel/PDF export.

## ✨ Features

- **Login system** with JWT auth and 3 roles:
  - `admin` — full access (manage users, events, bookings)
  - `staff` — can create/edit/delete bookings & events
  - `viewer` — read-only dashboard & booking list
- **Premium Dashboard**: live stats (total/confirmed/pending/cancelled bookings,
  STD/EXH/SS/RS counts), bar charts by country & city, a donut chart for booking
  status, events overview, and a recently-updated bookings feed.
- **Booth Bookings module** mirroring your spreadsheet columns:
  Keterangan, Nomor Booth, Country, Company Name (NPWP), No. VA, Quantity (Size/STD/EXH),
  Confirm (Size/STD/EXH), Type (SS/RS), Shipping Address, NPWP info, Contact Person,
  Status, Notes — with search, status filter, pagination, a detail view drawer, and:
  - **Import from Excel/CSV** — drag & drop a `.xlsx`/`.xls`/`.csv` file, columns are
    auto-detected/mapped (Keterangan, Nomor Booth, Company Name, No. VA, Quantity,
    Confirm, Type, Contact, etc.), preview before confirming, bulk-inserted into any
    selected event.
  - **Export to Excel (.xlsx)** — full data export matching your original sheet layout,
    plus a dedicated "Payment Termin (T1-T6)" sheet showing paid/unpaid status and
    paid dates per installment.
  - **Export to PDF report** — a formatted, paginated PDF booking report (landscape,
    styled headers, alternating row colors, includes SPK date/number, contract value,
    and termin progress) via the server (`pdfkit`).
- **Payment / Termin tracking (up to 6 installments)** — each booking can have an SPK
  (Surat Perintah Kerja / work order) date & number, a total contract value in **IDR or
  USD**, and a configurable number of payment termin (T1 through T6, max 6). A dedicated
  "💳 Payments" modal lets you check off each termin as paid, auto-stamp or manually set
  the paid date, track due dates, payment method, and reference number — with the
  booking list showing an at-a-glance progress bar (e.g. "2/3 termin paid") and the
  dashboard surfacing total collected, outstanding balance (broken down per currency),
  and any overdue termins.

- **Master Booth Inventory ("Halls & Booths")** — supports large venues (~1000+ physical
  booth slots). The set of halls a venue uses ("the plot") is **derived automatically from
  the event's title**:
  - If the title contains **"Int'l" or "International"** (case-insensitive), the event
    uses the full multi-hall convention layout: **Hall 5, Hall 6, Hall 7, Hall 8, Hall 9,
    Hall 10, Ambulance**.
  - Any other event title uses the domestic/local layout: **Convention, Foyer,
    Exhibition, Ambulance**.
  - This applies everywhere a hall needs to be picked or shown — the booking form's Hall
    dropdown, the multi-booth picker, "Generate Booth Slots", and the Edit Booth Slot
    modal all automatically switch to the correct hall set the moment you change the
    selected Event, and cross-plot hall assignments are rejected server-side.
  - The "Halls & Booths" sidebar view shows a row of **colorful, clickable hall cards**
    (styled like the Dashboard's stat cards) — click one to instantly filter the table to
    that hall, plus pill-style status filters (🟢 Available / 🟠 Booked / 🔴 Blocked) and a
    badge indicating which plot ("🌐 International" / "🏠 Domestic") is active.
  - Booth numbers are clickable and open an **Edit Booth Slot modal** to change Hall,
    Booth Number, Size, and Status directly (Hall/Booth Number lock automatically while a
    slot is booked, to protect the booking link).
  - Admins/staff can generate additional slots for any hall in the current event's plot
    on demand.
- **Multi-booth bookings** — a single company booking can now claim **multiple physical
  booth numbers at once** (e.g. 3 booths in Hall 7 for a large exhibitor) via a visual
  booth picker (grid of clickable slots, filterable by hall, live availability status).
  Selected booths appear as removable tags in the booking form. Double-booking the same
  physical slot is prevented automatically, and deleting/editing a booking correctly
  releases any booths no longer assigned.
- **Booth Type multi-select** — each booking can be tagged with one or more booth types
  (**Standard**, **Space Only**) via checkboxes, useful when a booking's booths are a mix
  of types.

- **Events module** to manage multiple expo events (Medan 2026, Bali 2026, Booking Stand
  2027, etc.) — each booking belongs to an event, switchable via the top bar dropdown.
- **User Management** (admin only) — create/edit/disable/delete users & roles.
- **Activity Log** — audit trail of logins, creates, edits, deletes, imports.
- **Premium light-theme UI** — glassmorphism login screen, gradient stat cards, donut
  & bar charts, sidebar navigation with active-state accents, modals, toasts, badges,
  fully responsive for mobile/tablet.

## 🗄️ Database

Real **SQLite** database at `server/db/expo.db` (auto-created on first run) with tables:
`users`, `events`, `booths`, `activity_log`. Schema lives in `server/db/schema.sql`.

## 🚀 Getting Started

```bash
cd hospital-expo-system
npm install        # installs Express, better-sqlite3, bcryptjs, jsonwebtoken, xlsx, pdfkit, multer, etc.
npm run seed        # creates default users + a sample event/bookings
npm start           # starts the server at http://localhost:4000
```

Open **http://localhost:4000** in your browser.

### Demo accounts (created by `npm run seed`)

| Username | Password   | Role   |
|----------|-----------|--------|
| admin    | admin123  | Admin  |
| staff    | staff123  | Staff  |
| viewer   | viewer123 | Viewer |

> ⚠️ Change these passwords (via User Management, as admin) before using this for
> real data, and set a custom `JWT_SECRET` in a `.env` file for production use.

## 🖱️ Try It Instantly — Interactive Mockup (no install needed)

There's also a **fully self-contained demo** at `hospital-expo-mockup/index.html` that
runs 100% in the browser (no server, no npm install). It uses `localStorage` as its
"database", ships with realistic seed data across 3 events, and supports the exact
same features: login with roles, dashboard, booth CRUD, Excel import/export, and PDF
export — all client-side (SheetJS + jsPDF bundled inline). Just open the file in any
browser. Use the "↺ Reset Demo Data" button in the sidebar to restore the original
seed data at any time.

## 📁 Project Structure

```
hospital-expo-system/
├── server/
│   ├── index.js          # Express app entry point
│   ├── db/
│   │   ├── schema.sql    # SQLite schema
│   │   ├── index.js      # DB connection/init
│   │   └── seed.js       # Seed default users/events/sample data
│   ├── middleware/auth.js
│   └── routes/
│       ├── auth.js       # login/me
│       ├── events.js     # CRUD events
│       ├── booths.js     # CRUD booth bookings + bulk import + import-preview (xlsx parsing)
│       ├── users.js      # CRUD users (admin only)
│       ├── dashboard.js  # stats + activity log
│       └── export.js     # Excel (.xlsx) and PDF export
├── public/
│   ├── index.html
│   ├── css/style.css     # premium light theme styling
│   ├── js/app.js         # frontend SPA logic (incl. import/export UI)
│   └── vendor/           # bundled SheetJS/jsPDF for client-side parsing
└── package.json

hospital-expo-mockup/
└── index.html             # fully self-contained interactive demo (open directly, no server)
```

## 🔌 API Overview (all under `/api`, JWT bearer token required except `/auth/login`)

- `POST /auth/login` — returns `{ token, user }`
- `GET /auth/me`
- `GET/POST/PUT/DELETE /events`
- `GET/POST/PUT/DELETE /booths`
- `POST /booths/bulk-import` — insert an array of parsed rows into an event
- `POST /booths/import-preview` — upload a raw `.xlsx/.xls/.csv` file (multipart), returns normalized/mapped rows for preview
- `GET/POST/PUT/DELETE /users` (admin only)
- `GET /dashboard/stats?event_id=`, `GET /dashboard/activity`
- `GET /export/booths.xlsx?event_id=` — Excel export (incl. Payment Termin sheet)
- `GET /export/booths.pdf?event_id=` — PDF report export (incl. SPK/termin columns)
- `GET /payments/booth/:boothId` — get the T1-T6 payment schedule + totals for a booth
- `PUT /payments/booth/:boothId/termin/:terminNumber` — update/mark paid a specific termin (1-6)
- `GET /payments/summary?event_id=` — org-wide payment totals (broken down per currency) + overdue termin list
- `GET /inventory/halls?event_id=` — returns the hall plot for that event (`{ halls, isInternational, eventName }`); International titles get Hall 5-10 + Ambulance, otherwise Convention/Foyer/Exhibition/Ambulance
- `GET /inventory?event_id=&hall=&status=&search=` — browse/filter the booth inventory (up to 1000+ slots)
- `GET /inventory/summary?event_id=` — per-hall available/booked/blocked counts
- `POST /inventory/generate` — bulk-generate new booth slots for a hall (`{ event_id, hall, count, size, prefix }`)
- `PUT /inventory/:id` — update a slot's status (block/unblock) or size
- `DELETE /inventory/:id` — remove an unbooked slot from inventory
- Booth create/update (`POST/PUT /booths`) now also accept `inventory_ids: [..]` (array of booth_inventory IDs to assign — supports multi-booth bookings) and `booth_types: ["Standard","Space Only"]`

## 🛠️ Notes / Next Steps

- The system currently models a single unified "Booth Booking" table across events —
  exactly like the "Booking Stand 2027" tab in your sheet. Other tabs (Virtual Account,
  Loyalti, TES, etc.) can be added as additional modules if needed.
- Header aliases recognized during import include: KETERANGAN, NOMOR BOOTH, COUNTRY,
  COMPANY NAME (NPWP), NO. VA, SIZE/STD/EXH (quantity & confirm), SS/RS (type), FOYER,
  SHIPPING ADDRESS, NO. NPWP, NPWP ADDRESS, NAME/PHONE/EMAIL (contact), STATUS, NOTES —
  case-insensitive and spacing-tolerant.
