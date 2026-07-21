# Changelog

All notable changes to the EV Assistant Card. Format inspired by [Keep a Changelog](https://keepachangelog.com/).

## [1.5.2] - 2026-07-21

### Changed

- **"Verwerfen" (discard) now asks for confirmation first**, for both a pending Fremdladung and
  a pending Fahrtenbuch trip. Previously it called `discard_pending`/`discard_pending_trip`
  immediately on click, with no way back — a detected-but-unconfirmed estimate was gone the
  instant you misclicked. Now shows an inline "wirklich verwerfen?" prompt (kWh/price or
  start/end-location draft is preserved if you cancel), protected by the same 400ms
  double-click/double-tap guard added for delete confirmations in 1.5.1.

## [1.5.1] - 2026-07-21

### Fixed

- **Accidental delete via double-click/double-tap**: the "really delete?" confirmation button
  renders in the same spot as the delete button it replaces, so a fast double-click/double-tap
  on delete could land its second click on the confirm button and delete the entry without the
  user ever consciously seeing the confirmation. Both the charge-history and Fahrtenbuch delete
  confirmations now ignore a confirm click that arrives within 400ms of the confirmation opening
  — the same click/tap that opened it can no longer also close it. Reported after accidentally
  deleting a Fahrtenbuch entry this way.

## [1.5.0] - 2026-07-21

### Added

- **Fahrtenbuch (trip log) support**, matching EV Assistant v0.14.0/0.14.1. Entity discovery now
  additionally picks up `trip_pending` (binary sensor), `trip_pending_estimate`, `last_trip_km`,
  `trip_count`, and `total_trip_km` — checked ahead of the existing charge-related fallbacks in
  the matching chain, since some of the new entity IDs/`unique_id` suffixes are supersets of the
  charge ones (e.g. `..._trip_count` ends with `_count`, `..._fahrt_schatzung` contains
  `schatzung`) and would otherwise be misclaimed. The detail view gains a separate "Fahrtenbuch"
  section: an inline start/end-location form for each pending trip (calls `log_trip`/
  `discard_pending_trip`), running totals (km, count), and a collapsible history of the last 10
  confirmed trips with edit (`edit_trip`) and delete (`delete_trip`) buttons — the same
  detect-automatically/confirm-manually pattern as external charges, entirely separate state and
  DOM classes so neither feature's event handlers can fire on the other's elements. The compact
  view now also surfaces a pending trip (distance, count) when no charge is pending. The whole
  section stays hidden on installs without the Fahrtenbuch feature configured (no odometer
  entity), just like other optional sensors already do.

## [1.4.1] - 2026-07-15

### Fixed

- **"kWh gesamt"/"Kosten gesamt" showed nothing after updating to EV Assistant v0.10.0**: the new `... Heimladen kWh (gesamt)` / `... Heimladen Kosten (gesamt)` sensors' entity IDs also contain the substrings `kwh_gesamt`/`kosten_gesamt`, which the card's fallback entity-matching used to identify the *external*-charging totals — so on installs without a translation_key match yet, the home-charging sensors (often `unknown` without a configured wallbox meter) silently won the match instead of the correct total sensors. Added explicit `home_kwh`/`home_cost`/`savings` matches ahead of the ambiguous fallback so they're claimed first and never collide.

## [1.4.0] - 2026-07-15

### Added

- **Charging duration** shown wherever a charge's timing is relevant: the pending-charge form gains a "Ladezeit" field alongside SoC/estimate/since, and each history row now shows the session length under the date (e.g. "45 min" or "1h 15min"). Requires EV Assistant v0.9.0+ for the underlying data; older data without a duration simply shows nothing extra.

## [1.3.0] - 2026-07-15

### Added

- **Delete a past charge**: each row in the History list now also has a delete button (🗑) next to the edit button, for removing a falsely detected charge entirely (e.g. it wasn't actually an external charge). Asks for inline confirmation first, then calls the new `ev_assistant.delete_charge` service (requires EV Assistant v0.7.0+). Not reversible.

## [1.2.0] - 2026-07-14

### Added

- **Correct a past charge**: the detail view now has a collapsible "History" list of the last 10 confirmed charges (date, kWh, price, cost), each with an edit button that opens an inline kWh/price form and calls the new `ev_assistant.edit_charge` service (requires EV Assistant v0.6.0+). Requires no separate service call from Developer Tools.

## [1.1.1] - 2026-07-14

### Fixed

- Added a preview screenshot to the README so the repository passes HACS's image-in-readme validation check (previously failed with "does not have images in the Readme file").

## [1.1.0] - 2026-07-14

### Added

- **Multiple simultaneously pending charges**: matches EV Assistant v0.5.0, which fixed a data-loss bug where a second detected external charge silently overwrote the first before it was confirmed. The card now shows one form per open charge (each reads `start_ts` from the shared `offene_ladungen` attribute) and passes the corresponding `start_ts` to `log_charge`/`discard_pending` so the right one is always confirmed or discarded. Compact view and the header chip show a count when more than one is open.

## [1.0.0] - 2026-07-14

### Added

- Initial release. Custom Lovelace card for the [EV Assistant](https://github.com/weskona/ev_assistant) integration.
- Automatic entity discovery via `device_id` — no manual entity list needed. Matches by `unique_id` suffix (primary), `translation_key` (secondary), and an entity-id substring fallback that covers both current and pre-v0.4.1 EV Assistant installations.
- Compact and detail view (click to toggle), responsive layout via CSS container queries.
- Detail view shows an inline form (kWh + price) when a Fremdladung is pending, and calls `ev_assistant.log_charge` / `ev_assistant.discard_pending` **directly** — `config_entry_id` is resolved automatically from the card's device, no helper entities or automations needed (replaces the `packages/ev_assistant_ui.yaml` approach from the integration repo).
- Config editor with a device picker, optional name override, and start mode (compact/detail).
