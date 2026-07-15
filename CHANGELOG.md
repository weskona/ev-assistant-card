# Changelog

All notable changes to the EV Assistant Card. Format inspired by [Keep a Changelog](https://keepachangelog.com/).

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
