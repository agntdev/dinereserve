## Summary
A Telegram bot that accepts table reservations for a single restaurant, only offers genuinely available slots (no double-booking or overbooking), confirms bookings with a short reference code, sends configurable reminders, and allows guests to reschedule or cancel via inline buttons. Restaurant owner(s) get an admin view in Telegram with live upcoming bookings, capacity-at-a-glance for today, and the ability to flag no-shows and export bookings.

## Audience
- Guests who want to reserve a table via Telegram.
- Restaurant owner(s) and staff who need an at-a-glance view of bookings and control (flag no-shows, configure settings, export data).

## Core entities
- Configuration
  - timezone, opening hours (per weekday), sitting length (minutes), slot granularity (minutes), reminder offset (minutes), allow_table_splitting (bool), booking lookahead (days).
- Table
  - table_id, seats (integer), optional label (e.g., "Window 1").
- Booking
  - booking_id (UUID), ref_code (6-char alphanumeric), guest_name (optional), guest_phone (optional), guest_telegram_id (optional), party_size, start_datetime (restaurant timezone), end_datetime, assigned_tables (list of table_ids), status (confirmed, cancelled, rescheduled, no-show), created_at, updated_at.
- Availability slot / Sitting
  - derived view showing which start times within opening hours are available for a given party size and date.
- AdminUser
  - telegram_user_id, display_name, notification_preferences.

## Integrations & notification targets
- Telegram Bot API (primary UI for guests and owner/admins).
- Persistent database (PostgreSQL recommended) to store configs, tables, bookings, users, and audit logs.
- Background worker / scheduler (e.g., cron + worker, or a job queue like Sidekiq/RQ) to: send reminders, run daily digests, and perform expired-seat housekeeping.
- (Optional) CSV export endpoint delivered to admin via Telegram file when /export is used.

Notifications
- Guests: immediate booking confirmation message with ref code and inline buttons (Reschedule / Cancel). Reminder sent N minutes before booking per config (default 120).
- Owner/admin Telegram chat(s): notify on new bookings, cancellations, reschedules; provide command-driven views (/bookings_today, /bookings YYYY-MM-DD, /capacity_today).

## Interaction flows
- Guest flow
  1. Guest taps Start (or sends /reserve).
  2. Bot asks for date (calendar widget). User picks a date within lookahead window.
  3. Bot asks for party size (quick buttons and numeric input fallback).
  4. Bot calculates real availability for that date and party size (see Allocation rules). It presents only available start-times as inline buttons (paginated if needed). Each button shows time and remaining seat/capacity info.
  5. Guest picks a time. Bot asks for optional name and optional phone number (both optional but recommended). Bot confirms details and asks to confirm.
  6. On confirmation, bot creates booking, assigns tables, sends a confirmation message with ref code and inline actions: Reschedule, Cancel, Details.
  7. Reminder sent per config. Reschedule flow re-runs availability; cancellation frees tables immediately.

- Reschedule / Cancel flow
  - Inline buttons in the guest confirmation message and subsequent reminders allow: Reschedule (repeats step 2–6 limited to lookahead window), Cancel (asks for confirmation then sets status=cancelled). All changes notify owner/admin.

- Admin flow (owner-identified by telegram_user_id set at install)
  - Commands available to admin only:
    - /bookings_today — lists all bookings for today with status and assigned tables; each booking shows inline actions: Mark no-show, Cancel, View details.
    - /bookings YYYY-MM-DD — paginated listing for a given date.
    - /capacity_today — condensed summary showing opening hours, sitting length, total seats, remaining seats per time block.
    - /config — interactive config editor for opening hours, sitting length, table setup, reminder offset, allow_table_splitting.
    - /export YYYY-MM-DD..YYYY-MM-DD — generates CSV and sends it to admin via Telegram file.
  - Admin inline actions make changes in-place (e.g., mark no-show) and log audit entries.

## Availability & table-assignment rules (concrete algorithm)
- Representation: each table is an independent unit with seat capacity.
- Slot generation: for each open day, generate start times from opening_time to closing_time - sitting_length using slot_granularity (default 15 minutes).
- For a requested date, party size, and candidate start time, compute if there exist a combination of currently free tables whose combined seats >= party_size for the full sitting interval. Consider existing bookings that overlap the interval as occupying their assigned tables.
- Table assignment algorithm: greedy first-fit sorted by table size (ascending) trying to minimize over-capacity and number of tables used. If allow_table_splitting=false, require a single table with seats >= party_size; if none, offer next available times or indicate no single-table option.
- When a booking is confirmed, assigned_tables are reserved for the full sitting interval.
- If multiple candidates produce the same fit, choose the assignment that minimizes leftover seats.

## Persistence (concrete DB schema highlights)
- configs (key, value, effective_from)
- tables (id, seats, label)
- bookings (id, ref_code, guest_name, guest_phone, guest_telegram_id, party_size, start_dt, end_dt, status, assigned_tables JSONB, created_at, updated_at)
- admins (telegram_user_id, name)
- audit_logs (action, actor, booking_id, ts)

## Security & privacy
- Guest personal data (name, phone) stored and only visible to admin Telegram users; do not forward guest details to other guests.
- Restrict admin commands to stored admin telegram_user_ids.
- Use TLS for webhooks; database credentials stored securely. Recommend deploying on a host with recommended security practices.

## Reminders & scheduling
- Default reminder offset: 120 minutes before booking start (configurable per restaurant).
- Reminder message repeats once (single reminder). Optionally configurable to send extra reminders (out of scope unless requested).

## Payments
- No payments. Non-goal: collecting payments or deposits via the bot.

## Non-goals
- Integrating with third-party POS or floorplan visualization.
- Handling walk-ins or real-time table turn status from on-premise staff (except via manual admin commands).
- Multi-restaurant or franchise management (single restaurant only by default).

## Errors & partial input handling
- Date/time parsing: use structured pickers where possible. If guest types free-form date/time, parse with NL parser; if ambiguous, ask one clarifying question.
- Party size: accept numeric text; if party exceeds total capacity, explain and offer contact option for special requests.
- When no slots are available on a date, show nearest available dates/times and offer to be notified if a slot opens (optional enhancement).

## Admin install & setup
- First-run should prompt to register one or more admin Telegram user IDs (owner provides these during install). Then guide to configure: timezone, opening hours, sitting length, table definitions (count & seats), slot granularity, reminder offset, allow_table_splitting.

## Assumptions & defaults
- Default timezone set at install (restaurant-local timezone). Rationale: bookings must be interpreted in a single consistent timezone.
- Reminder offset default: 120 minutes before booking. Rationale: "a couple of hours" requested; 2 hours is a common default and can be changed.
- Database: PostgreSQL recommended. Rationale: reliable relational storage and JSONB for assigned_tables is practical.
- Slot granularity: 15 minutes. Rationale: reasonable compromise between flexibility and complexity.
- Booking reference: 6-character alphanumeric code. Rationale: short and human-usable while reasonably unique.
- Lookahead window: 180 days (6 months). Rationale: avoids infinite future bookings while allowing long-range reservations.
- allow_table_splitting default: true. Rationale: allows accommodating larger parties when a single large table isn't available; owner can disable if they never want splits.
- Admin notifications delivered via Telegram to registered admin user(s). Rationale: owner asked for an "owner view" and Telegram is the primary channel requested.
- Language default: English. Rationale: owner used English; UI strings should be internationalized but default to English.

If you want any of the defaults changed (e.g., disallow splitting, different reminder timing, alternate admin notification channels like email or a web dashboard), tell me which single setting to change and I will update the brief accordingly.