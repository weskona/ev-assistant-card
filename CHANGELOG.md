# Changelog

All notable changes to the EV Assistant Card. Format inspired by [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-07-14

### Added

- Initial release. Custom Lovelace card for the [EV Assistant](https://github.com/weskona/ev_assistant) integration.
- Automatic entity discovery via `device_id` — no manual entity list needed. Matches by `unique_id` suffix (primary), `translation_key` (secondary), and an entity-id substring fallback that covers both current and pre-v0.4.1 EV Assistant installations.
- Compact and detail view (click to toggle), responsive layout via CSS container queries.
- Detail view shows an inline form (kWh + price) when a Fremdladung is pending, and calls `ev_assistant.log_charge` / `ev_assistant.discard_pending` **directly** — `config_entry_id` is resolved automatically from the card's device, no helper entities or automations needed (replaces the `packages/ev_assistant_ui.yaml` approach from the integration repo).
- Config editor with a device picker, optional name override, and start mode (compact/detail).
