class EvAssistantCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Formularzustand pro offener Ladung, keyed by start_ts (es koennen
    // mehrere Fremdladungen gleichzeitig offen sein, z.B. zwei Ladestopps
    // auf einem Roadtrip vor dem ersten Bestaetigen).
    this._formState = {};
    // Bearbeitungszustand pro Historie-Eintrag, keyed by erfasst_ts (zum
    // nachtraeglichen Korrigieren eines Tippfehlers bei kWh/Preis).
    this._editState = {};
    // Loesch-Bestaetigung pro Historie-Eintrag, keyed by erfasst_ts (true
    // waehrend die "wirklich loeschen?"-Nachfrage angezeigt wird).
    this._deleteConfirm = {};
    this._historyOpen = false;
    this._lastSignature = null;
  }

  static getStubConfig() {
    return { device_id: '', mode: 'compact' };
  }

  static getConfigElement() {
    return document.createElement('ev-assistant-card-editor');
  }

  setConfig(config) {
    if (!config.device_id && !config.entity) {
      throw new Error('device_id oder entity erforderlich');
    }
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeRender();
  }

  // ----- Geraet / Config-Entry-Aufloesung -------------------------------
  _deviceId() {
    const cfg = this._config;
    if (cfg.device_id) return cfg.device_id;
    if (cfg.entity && this._hass.entities) {
      const e = this._hass.entities[cfg.entity];
      if (e) return e.device_id;
    }
    return null;
  }

  _device() {
    const id = this._deviceId();
    return id && this._hass.devices ? this._hass.devices[id] : null;
  }

  _configEntryId() {
    const device = this._device();
    return device && device.config_entries && device.config_entries.length
      ? device.config_entries[0]
      : null;
  }

  _getDeviceName() {
    if (this._config.name) return this._config.name;
    const device = this._device();
    return device ? device.name : 'EV Assistant';
  }

  // ----- Entity-Auto-Discovery -------------------------------------------
  // Bevorzugt unique_id (stabil, aendert sich nie), dann translation_key,
  // dann Entity-ID-Substring als Fallback (deckt sowohl neu angelegte
  // Entitaeten als auch aeltere Installationen ab, die vor Einfuehrung des
  // translation_key-Systems eingerichtet wurden und daher noch die alte,
  // ASCII-transliterierte Benennung "schaetzung" statt "schatzung" tragen).
  _getEntities() {
    const hass = this._hass;
    if (this._config.entities) return this._config.entities;
    const deviceId = this._deviceId();
    const result = {};

    Object.values(hass.entities || {}).forEach((e) => {
      if (e.device_id !== deviceId) return;
      const id = e.entity_id;
      const state = hass.states[id];
      if (!state) return;
      const domain = id.split('.')[0];
      const uid = e.unique_id || '';
      const tk = e.translation_key || '';
      const has = (key) => uid.endsWith('_' + key) || tk === key;

      if (domain === 'binary_sensor') {
        result.pending_binary = id;
        return;
      }
      // Substring-Fallback deckt beide Wortreihenfolgen ab: die urspruengliche
      // Benennung vor dem "Fremdladung"-Praefix-Umbau (z.B. "letzte_kosten")
      // UND die daraus per translation_key neu vergebene Reihenfolge bei
      // frisch angelegten Entitaeten (z.B. "fremdladung_kosten_letzte").
      if (has('pending_estimate') || id.includes('schatzung') || id.includes('schaetzung')) {
        result.pending_estimate = id;
      } else if (has('last_cost') || id.includes('letzte_kosten') || id.includes('kosten_letzte')) {
        result.last_cost = id;
      } else if (has('last_kwh') || id.includes('letzte_kwh') || id.includes('kwh_letzte')) {
        result.last_kwh = id;
      } else if (has('total_kwh') || id.includes('kwh_gesamt')) {
        result.total_kwh = id;
      } else if (has('total_cost') || id.includes('kosten_gesamt')) {
        result.total_cost = id;
      } else if (has('count') || id.includes('anzahl')) {
        result.count = id;
      } else if (has('last_price') || id.includes('letzter_preis') || id.includes('preis_letzter')) {
        result.last_price = id;
      } else if (has('measured_efficiency') || id.includes('ladewirkungsgrad')) {
        result.measured_efficiency = id;
      }
    });
    return result;
  }

  _state(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId] || null;
  }

  _val(entityId) {
    const s = this._state(entityId);
    return s ? s.state : null;
  }

  _attr(entityId, attr) {
    const s = this._state(entityId);
    return s ? s.attributes[attr] : null;
  }

  _ok(val) {
    return val !== null && val !== undefined && val !== 'unknown' && val !== 'unavailable';
  }

  _fmt(val, decimals = 2) {
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  _fmtDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  // ----- Re-Render-Signatur ----------------------------------------------
  // Ohne diese Sperre wuerde JEDE hass-Aktualisierung (also praktisch
  // dauernd, ausgeloest von irgendeiner beliebigen Entitaet im System) das
  // komplette Shadow-DOM per innerHTML neu aufbauen und damit laufende
  // Benutzereingaben in den kWh-/Preis-Feldern verwerfen. Es wird nur neu
  // gerendert, wenn sich die fuer diese Karte relevanten Werte tatsaechlich
  // geaendert haben.
  _signature(ents) {
    const keys = Object.values(ents).filter((v) => typeof v === 'string');
    const parts = keys.map((id) => {
      const s = this._state(id);
      return s ? `${id}:${s.state}:${JSON.stringify(s.attributes)}` : id;
    });
    return `${this._mode}|${this._config.name || ''}|${parts.join('|')}`;
  }

  _maybeRender() {
    if (!this._hass || !this._config) return;
    if (this._mode === undefined) this._mode = this._config.mode || 'compact';
    const ents = this._getEntities();
    const sig = this._signature(ents);
    if (sig === this._lastSignature && this.shadowRoot.firstChild) return;
    this._lastSignature = sig;
    this._render(ents);
  }

  _toggleMode() {
    this._mode = this._mode === 'detail' ? 'compact' : 'detail';
    this._lastSignature = null;
    this._maybeRender();
  }

  // ----- Aktionen (Services direkt aufrufen, kein input_number-Umweg) ----
  // `startTs` waehlt bei mehreren gleichzeitig offenen Ladungen die
  // gemeinte aus; ohne Angabe (undefined) bestaetigt/verwirft der Service
  // die aelteste (FIFO) — hier aber immer explizit mitgegeben, da die
  // Karte pro offener Ladung ein eigenes Formular mit bekanntem start_ts
  // zeigt.
  async _save(ev, startTs) {
    ev.stopPropagation();
    const entryId = this._configEntryId();
    if (!entryId) return;
    const state = this._formState[startTs] || {};
    const kwh = parseFloat(state.kwh);
    const price = parseFloat(state.price);
    if (isNaN(kwh) || isNaN(price)) return;
    await this._hass.callService('ev_assistant', 'log_charge', {
      config_entry_id: entryId,
      start_ts: startTs,
      kwh,
      price_kwh: price,
    });
    delete this._formState[startTs];
    this._lastSignature = null;
  }

  async _discard(ev, startTs) {
    ev.stopPropagation();
    const entryId = this._configEntryId();
    if (!entryId) return;
    await this._hass.callService('ev_assistant', 'discard_pending', {
      config_entry_id: entryId,
      start_ts: startTs,
    });
    delete this._formState[startTs];
    this._lastSignature = null;
  }

  _onInput(startTs, key, e) {
    const state = this._formState[startTs] || (this._formState[startTs] = {});
    state[key] = e.target.value;
  }

  // ----- Historie nachtraeglich korrigieren -------------------------------
  // Eigener, von den offenen-Ladungen-Formularen getrennter Zustand: hier
  // wird ein bereits bestaetigter Eintrag editiert (ev_assistant.edit_charge),
  // keine neue Ladung angelegt. Keyed by erfasst_ts, der stabilen ID eines
  // Historie-Eintrags.
  _toggleHistory(ev) {
    ev.stopPropagation();
    this._historyOpen = !this._historyOpen;
    this._lastSignature = null;
    this._maybeRender();
  }

  _startEditHistory(ev, rec) {
    ev.stopPropagation();
    this._editState[rec.erfasst_ts] = {
      kwh: this._fmt(rec.kwh, 2).replace(',', '.'),
      price: this._fmt(rec.preis_kwh, 3).replace(',', '.'),
    };
    this._lastSignature = null;
    this._maybeRender();
  }

  _cancelEditHistory(ev, erfasstTs) {
    ev.stopPropagation();
    delete this._editState[erfasstTs];
    this._lastSignature = null;
    this._maybeRender();
  }

  _onHistoryInput(erfasstTs, key, e) {
    const state = this._editState[erfasstTs] || (this._editState[erfasstTs] = {});
    state[key] = e.target.value;
  }

  async _saveHistoryEdit(ev, erfasstTs) {
    ev.stopPropagation();
    const entryId = this._configEntryId();
    if (!entryId) return;
    const state = this._editState[erfasstTs] || {};
    const kwh = parseFloat(state.kwh);
    const price = parseFloat(state.price);
    if (isNaN(kwh) || isNaN(price)) return;
    await this._hass.callService('ev_assistant', 'edit_charge', {
      config_entry_id: entryId,
      erfasst_ts: erfasstTs,
      kwh,
      price_kwh: price,
    });
    delete this._editState[erfasstTs];
    this._lastSignature = null;
  }

  // ----- Historie-Eintrag loeschen -----------------------------------------
  // Getrennt vom Bearbeiten: hier wird ein Eintrag komplett entfernt (z.B.
  // eine faelschlich erkannte Fremdladung, die gar keine war). Da nicht
  // rueckgaengig zu machen, erst eine Inline-Bestaetigung ("wirklich
  // loeschen?") statt sofort zu loeschen.
  _askDeleteHistory(ev, erfasstTs) {
    ev.stopPropagation();
    this._deleteConfirm[erfasstTs] = true;
    this._lastSignature = null;
    this._maybeRender();
  }

  _cancelDeleteHistory(ev, erfasstTs) {
    ev.stopPropagation();
    delete this._deleteConfirm[erfasstTs];
    this._lastSignature = null;
    this._maybeRender();
  }

  async _confirmDeleteHistory(ev, erfasstTs) {
    ev.stopPropagation();
    const entryId = this._configEntryId();
    if (!entryId) return;
    await this._hass.callService('ev_assistant', 'delete_charge', {
      config_entry_id: entryId,
      erfasst_ts: erfasstTs,
    });
    delete this._deleteConfirm[erfasstTs];
    this._lastSignature = null;
  }

  // ----- Rendering ---------------------------------------------------------
  _pendingList(ents) {
    return this._attr(ents.pending_binary, 'offene_ladungen') || [];
  }

  _historyList(ents) {
    return this._attr(ents.last_cost, 'historie') || [];
  }

  _renderCompact(ents, name, pendingList) {
    const count = this._val(ents.count);
    const totalKwh = this._val(ents.total_kwh);
    const n = pendingList.length;
    const color = n ? 'var(--warning-color,#f59e0b)' : 'var(--success-color,#10b981)';
    const icon = n ? '⚡' : '🔌';
    const sub = n
      ? n === 1
        ? `Fremdladung erkannt, ~${this._fmt(pendingList[0].energy_kwh, 1)} kWh`
        : `${n} offene Fremdladungen`
      : this._ok(count)
        ? `${parseInt(count, 10)} Ladungen · ${this._fmt(totalKwh, 0)} kWh gesamt`
        : 'Keine Fremdladungen erfasst';
    return `
      <div class="card compact">
        <div class="ci" style="background:${color}22;color:${color}">${icon}</div>
        <div class="ci-info">
          <div class="name">${name}</div>
          <div class="sub">${sub}</div>
        </div>
        ${n ? '<div class="chip warn">⚠ Offen</div>' : '<div class="chip ok">OK</div>'}
      </div>`;
  }

  _renderPendingForm(p, lastPrice) {
    const startTs = p.start_ts;
    const state = this._formState[startTs] || (this._formState[startTs] = {});
    if (state.kwh === undefined) state.kwh = p.energy_kwh ? this._fmt(p.energy_kwh, 1).replace(',', '.') : '';
    if (state.price === undefined) state.price = this._ok(lastPrice) ? this._fmt(lastPrice, 3).replace(',', '.') : '';
    const safeTs = String(startTs).replace(/[^0-9.]/g, '');
    return `
      <div class="pending-box" data-start-ts="${startTs}">
        <div class="pending-row">
          <div><div class="dl">SoC</div><div class="dv">${this._fmt(p.soc_start, 0)} % → ${this._fmt(p.soc_end, 0)} %</div></div>
          <div><div class="dl">Geschätzt</div><div class="dv">${this._fmt(p.energy_kwh, 1)} kWh</div></div>
          <div><div class="dl">Seit</div><div class="dv">${this._fmtDate(startTs)}</div></div>
        </div>
        <div class="form-row">
          <label>Geladene kWh (Beleg)
            <input type="number" step="0.1" min="0" value="${state.kwh || ''}" class="kwh-input" data-start-ts="${startTs}" id="kwh-input-${safeTs}" />
          </label>
          <label>Preis pro kWh
            <input type="number" step="0.001" min="0" value="${state.price || ''}" class="price-input" data-start-ts="${startTs}" id="price-input-${safeTs}" />
          </label>
        </div>
        <div class="form-actions">
          <button class="btn save" data-start-ts="${startTs}">Speichern</button>
          <button class="btn discard" data-start-ts="${startTs}">Verwerfen</button>
        </div>
        <div class="hint">Quelle der Schätzung: ${p.energy_source || '—'}</div>
      </div>`;
  }

  _renderHistoryRow(rec) {
    const ts = rec.erfasst_ts;
    const editing = this._editState[ts];
    const deleting = this._deleteConfirm[ts];
    if (editing) {
      return `
        <div class="hist-row hist-edit" data-erfasst-ts="${ts}">
          <div class="hist-date">${this._fmtDate(ts)}</div>
          <input type="number" step="0.1" min="0" value="${editing.kwh || ''}" class="hist-kwh-input" data-erfasst-ts="${ts}" />
          <input type="number" step="0.001" min="0" value="${editing.price || ''}" class="hist-price-input" data-erfasst-ts="${ts}" />
          <div class="hist-actions">
            <button class="hist-btn save" data-erfasst-ts="${ts}" title="Speichern">✓</button>
            <button class="hist-btn cancel" data-erfasst-ts="${ts}" title="Abbrechen">✕</button>
          </div>
        </div>`;
    }
    if (deleting) {
      return `
        <div class="hist-row hist-edit hist-delete-confirm" data-erfasst-ts="${ts}">
          <div class="hist-date">${this._fmtDate(ts)}</div>
          <div class="hist-confirm-text">Wirklich löschen? (${this._fmt(rec.kwh, 1)} kWh, ${this._fmt(rec.kosten, 2)} €)</div>
          <div class="hist-actions">
            <button class="hist-btn confirm-delete" data-erfasst-ts="${ts}" title="Ja, löschen">✓</button>
            <button class="hist-btn cancel-delete" data-erfasst-ts="${ts}" title="Abbrechen">✕</button>
          </div>
        </div>`;
    }
    return `
      <div class="hist-row" data-erfasst-ts="${ts}">
        <div class="hist-date">${this._fmtDate(ts)}</div>
        <div class="hist-kwh">${this._fmt(rec.kwh, 1)} kWh</div>
        <div class="hist-price">${this._fmt(rec.preis_kwh, 3)} €/kWh</div>
        <div class="hist-cost">${this._fmt(rec.kosten, 2)} €</div>
        <div class="hist-row-actions">
          <button class="hist-btn edit" data-erfasst-ts="${ts}" title="Korrigieren">✎</button>
          <button class="hist-btn delete" data-erfasst-ts="${ts}" title="Löschen">🗑</button>
        </div>
      </div>`;
  }

  _renderDetail(ents, name, pendingList, historyList) {
    const lastKwh = this._val(ents.last_kwh);
    const lastCost = this._val(ents.last_cost);
    const lastPrice = this._val(ents.last_price);
    const totalKwh = this._val(ents.total_kwh);
    const totalCost = this._val(ents.total_cost);
    const count = this._val(ents.count);

    const eff = this._val(ents.measured_efficiency);
    const effSessions = this._attr(ents.measured_efficiency, 'anzahl_sessions');
    const effNeeded = this._attr(ents.measured_efficiency, 'benoetigte_sessions');
    const effInUse = this._attr(ents.measured_efficiency, 'wird_verwendet');
    const effManual = this._attr(ents.measured_efficiency, 'manueller_wert_prozent');

    const n = pendingList.length;

    return `
      <div class="card detail">
        <div class="dh">
          <div class="hl">
            <div class="iw" style="background:${n ? 'var(--warning-color,#f59e0b)22' : 'var(--success-color,#10b981)22'};color:${n ? 'var(--warning-color,#f59e0b)' : 'var(--success-color,#10b981)'}">${n ? '⚡' : '🔌'}</div>
            <div>
              <div class="name">${name}</div>
              <div class="sub">Fremdladungs-Erfassung</div>
            </div>
          </div>
          ${n ? `<div class="chip warn">⚠ ${n === 1 ? 'Offen' : n + ' offen'}</div>` : '<div class="chip ok">Keine offene Ladung</div>'}
        </div>

        ${pendingList.map((p) => this._renderPendingForm(p, lastPrice)).join('')}

        <div class="div"></div>

        <div class="metrics">
          <div class="metric"><div class="ml">kWh gesamt</div><div class="mv">${this._fmt(totalKwh, 0)}</div></div>
          <div class="metric"><div class="ml">Kosten gesamt</div><div class="mv">${this._fmt(totalCost, 0)} €</div></div>
          <div class="metric"><div class="ml">Anzahl</div><div class="mv">${this._ok(count) ? parseInt(count, 10) : '—'}</div></div>
        </div>

        <div class="div"></div>

        <div class="g2">
          ${this._ok(lastKwh) ? `<div><div class="dl">Letzte kWh</div><div class="dv">${this._fmt(lastKwh, 1)} kWh</div></div>` : ''}
          ${this._ok(lastCost) ? `<div><div class="dl">Letzte Kosten</div><div class="dv">${this._fmt(lastCost, 2)} €</div></div>` : ''}
          ${this._ok(lastPrice) ? `<div><div class="dl">Letzter Preis</div><div class="dv">${this._fmt(lastPrice, 3)} €/kWh</div></div>` : ''}
          ${this._ok(eff) ? `<div><div class="dl">Ladewirkungsgrad ${effInUse ? '(gemessen)' : '(manuell)'}</div><div class="dv">${this._fmt(effInUse ? eff : effManual, 1)} %${!effInUse ? ` <span class="hint-inline">(${effSessions}/${effNeeded} Sessions)</span>` : ''}</div></div>` : ''}
        </div>

        ${historyList.length ? `
          <div class="div"></div>
          <div class="hist-toggle" data-action="toggle-history">${this._historyOpen ? '▾' : '▸'} Historie (${historyList.length}${historyList.length > 10 ? ', letzte 10' : ''})</div>
          ${this._historyOpen ? `<div class="hist-list">${historyList.slice(0, 10).map((rec) => this._renderHistoryRow(rec)).join('')}</div>` : ''}
        ` : ''}
      </div>`;
  }

  _render(ents) {
    const name = this._getDeviceName();
    const pendingList = this._pendingList(ents);
    const historyList = this._historyList(ents);
    const html = this._mode === 'detail'
      ? this._renderDetail(ents, name, pendingList, historyList)
      : this._renderCompact(ents, name, pendingList);

    this.shadowRoot.innerHTML = `<style>
      :host{display:block;container-type:inline-size;container-name:evac}*{box-sizing:border-box;margin:0;padding:0}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--divider-color,rgba(0,0,0,.12));font-family:var(--paper-font-body1_-_font-family,sans-serif);color:var(--primary-text-color);overflow:hidden}
      .compact{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer}
      .ci,.iw{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
      .iw{width:40px;height:40px}
      .ci-info{flex:1 1 120px;min-width:0}
      .name{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sub{font-size:12px;color:var(--secondary-text-color)}
      .chip{font-size:11px;font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap;flex-shrink:0}
      .warn{background:rgba(245,158,11,.15);color:#b45309}.ok{background:rgba(16,185,129,.15);color:#047857}
      .detail{padding:14px 16px;cursor:default}
      .dh{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 10px;margin-bottom:12px;cursor:pointer}
      .hl{display:flex;align-items:center;gap:10px;flex:1 1 160px;min-width:0}
      .pending-box{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:12px;margin-bottom:12px}
      .pending-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:10px}
      .form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
      .form-row label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--secondary-text-color)}
      .form-row input{font-size:14px;padding:8px;border-radius:6px;border:1px solid var(--divider-color,rgba(0,0,0,.2));background:var(--card-background-color,#fff);color:var(--primary-text-color)}
      .form-actions{display:flex;gap:8px}
      .btn{flex:1;padding:8px 12px;border-radius:6px;border:none;font-size:13px;font-weight:500;cursor:pointer}
      .btn.save{background:var(--success-color,#10b981);color:#fff}
      .btn.discard{background:var(--secondary-background-color,rgba(0,0,0,.08));color:var(--primary-text-color)}
      .hint{font-size:11px;color:var(--secondary-text-color);margin-top:8px}
      .hint-inline{font-size:10px;color:var(--secondary-text-color)}
      .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:4px}
      .metric{background:var(--secondary-background-color,rgba(0,0,0,.04));border-radius:8px;padding:10px 12px}
      .ml{font-size:11px;color:var(--secondary-text-color);margin-bottom:2px}.mv{font-size:20px;font-weight:500}
      .div{border:none;border-top:1px solid var(--divider-color,rgba(0,0,0,.08));margin:12px 0}
      .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
      .dl{font-size:11px;color:var(--secondary-text-color);margin-bottom:2px}.dv{font-size:13px;font-weight:500}
      .hist-toggle{font-size:12px;font-weight:500;color:var(--primary-color,#03a9f4);cursor:pointer;user-select:none}
      .hist-list{margin-top:10px;display:flex;flex-direction:column;gap:6px}
      .hist-row{display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--secondary-background-color,rgba(0,0,0,.03));font-size:12px}
      .hist-date{color:var(--secondary-text-color)}
      .hist-kwh,.hist-price,.hist-cost{font-weight:500}
      .hist-btn{border:none;background:transparent;color:var(--secondary-text-color);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px}
      .hist-btn:hover{background:rgba(0,0,0,.06);color:var(--primary-text-color)}
      .hist-edit{display:flex;flex-wrap:wrap;align-items:center}
      .hist-edit .hist-date{flex:1 1 100%;margin-bottom:4px}
      .hist-edit input{flex:1 1 80px;min-width:0;font-size:12px;padding:5px 6px;border-radius:4px;border:1px solid var(--divider-color,rgba(0,0,0,.2));background:var(--card-background-color,#fff);color:var(--primary-text-color)}
      .hist-actions{display:flex;gap:2px;flex:0 0 auto}
      .hist-actions .save{color:var(--success-color,#10b981)}
      .hist-actions .cancel{color:var(--error-color,#db4437)}
      .hist-row-actions{display:flex;gap:2px;justify-self:end}
      .hist-delete-confirm{background:rgba(219,68,55,.08)}
      .hist-confirm-text{flex:1 1 100%;font-size:12px;color:var(--primary-text-color)}
      .hist-actions .confirm-delete{color:var(--error-color,#db4437)}
      .hist-actions .cancel-delete{color:var(--secondary-text-color)}

      @container evac (max-width: 340px) {
        .compact{padding:10px 12px;gap:8px}
        .ci,.iw{width:32px;height:32px;font-size:17px}
        .name{font-size:13px}.sub{font-size:11px}
        .detail{padding:12px}
        .pending-row,.metrics{grid-template-columns:repeat(2,1fr)}
        .form-row,.g2{grid-template-columns:1fr}
        .hist-row{grid-template-columns:1fr 1fr;grid-template-areas:"date date" "kwh price" "cost edit"}
        .hist-row .hist-date{grid-area:date}.hist-row .hist-kwh{grid-area:kwh}.hist-row .hist-price{grid-area:price}.hist-row .hist-cost{grid-area:cost}.hist-row .hist-row-actions{grid-area:edit;justify-self:end}
      }
      @container evac (min-width: 561px) {
        .metrics{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}
        .g2{gap:12px 20px}
      }
    </style>${html}`;

    const cardEl = this.shadowRoot.querySelector('.card');
    if (this._mode === 'compact') {
      cardEl.addEventListener('click', () => this._toggleMode());
    } else {
      this.shadowRoot.querySelector('.dh').addEventListener('click', () => this._toggleMode());
      // Mehrere Formulare moeglich (eines pro offener Ladung) — jedes traegt
      // sein start_ts als data-Attribut, um Eingaben/Aktionen zuzuordnen.
      this.shadowRoot.querySelectorAll('.kwh-input').forEach((el) => {
        el.addEventListener('input', (e) => this._onInput(parseFloat(el.dataset.startTs), 'kwh', e));
      });
      this.shadowRoot.querySelectorAll('.price-input').forEach((el) => {
        el.addEventListener('input', (e) => this._onInput(parseFloat(el.dataset.startTs), 'price', e));
      });
      this.shadowRoot.querySelectorAll('.btn.save').forEach((el) => {
        el.addEventListener('click', (e) => this._save(e, parseFloat(el.dataset.startTs)));
      });
      this.shadowRoot.querySelectorAll('.btn.discard').forEach((el) => {
        el.addEventListener('click', (e) => this._discard(e, parseFloat(el.dataset.startTs)));
      });

      const histToggle = this.shadowRoot.querySelector('.hist-toggle');
      if (histToggle) histToggle.addEventListener('click', (e) => this._toggleHistory(e));
      this.shadowRoot.querySelectorAll('.hist-btn.edit').forEach((el) => {
        el.addEventListener('click', (e) => {
          const ts = parseFloat(el.dataset.erfasstTs);
          const rec = historyList.find((r) => r.erfasst_ts === ts);
          if (rec) this._startEditHistory(e, rec);
        });
      });
      this.shadowRoot.querySelectorAll('.hist-btn.cancel').forEach((el) => {
        el.addEventListener('click', (e) => this._cancelEditHistory(e, parseFloat(el.dataset.erfasstTs)));
      });
      this.shadowRoot.querySelectorAll('.hist-btn.save').forEach((el) => {
        el.addEventListener('click', (e) => this._saveHistoryEdit(e, parseFloat(el.dataset.erfasstTs)));
      });
      this.shadowRoot.querySelectorAll('.hist-kwh-input').forEach((el) => {
        el.addEventListener('input', (e) => this._onHistoryInput(parseFloat(el.dataset.erfasstTs), 'kwh', e));
      });
      this.shadowRoot.querySelectorAll('.hist-price-input').forEach((el) => {
        el.addEventListener('input', (e) => this._onHistoryInput(parseFloat(el.dataset.erfasstTs), 'price', e));
      });
      this.shadowRoot.querySelectorAll('.hist-btn.delete').forEach((el) => {
        el.addEventListener('click', (e) => this._askDeleteHistory(e, parseFloat(el.dataset.erfasstTs)));
      });
      this.shadowRoot.querySelectorAll('.hist-btn.cancel-delete').forEach((el) => {
        el.addEventListener('click', (e) => this._cancelDeleteHistory(e, parseFloat(el.dataset.erfasstTs)));
      });
      this.shadowRoot.querySelectorAll('.hist-btn.confirm-delete').forEach((el) => {
        el.addEventListener('click', (e) => this._confirmDeleteHistory(e, parseFloat(el.dataset.erfasstTs)));
      });
    }
  }

  getCardSize() {
    return this._mode === 'detail' ? 4 : 1;
  }
}

customElements.define('ev-assistant-card', EvAssistantCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ev-assistant-card',
  name: 'EV Assistant Card',
  description: 'Zeigt Fremdladungen an und erfasst kWh/Preis direkt in der Karte.',
});

console.log('[ev-assistant-card] v1.3.0 geladen');

// ============================================================================
// Config-Editor (Kartenauswahl-UI)
// ============================================================================
class EvAssistantCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._rendered = false;
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._rendered) this._syncValues();
    else this._tryRender();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._tryRender();
  }

  _tryRender() {
    if (!this._hass) return;
    this._render();
    this._rendered = true;
  }

  _fire(config) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config }, bubbles: true, composed: true,
    }));
  }

  _devices() {
    if (!this._hass) return [];
    const seen = new Set();
    const result = [];
    Object.values(this._hass.entities || {}).forEach((e) => {
      if (e.platform !== 'ev_assistant' || !e.device_id || seen.has(e.device_id)) return;
      seen.add(e.device_id);
      const device = this._hass.devices ? this._hass.devices[e.device_id] : null;
      result.push({ id: e.device_id, name: device ? device.name : e.device_id });
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  _syncValues() {
    const cfg = this._config;
    const d = this.shadowRoot.querySelector('#device_id');
    const n = this.shadowRoot.querySelector('#name');
    const m = this.shadowRoot.querySelector('#mode');
    if (d) d.value = cfg.device_id || '';
    if (n) n.value = cfg.name || '';
    if (m) m.value = cfg.mode || 'compact';
  }

  _render() {
    const cfg = this._config;
    const devices = this._devices();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .field { margin-bottom: 16px; }
        label {
          display: block;
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-bottom: 6px;
        }
        select, input[type="text"] {
          width: 100%;
          height: 48px;
          padding: 0 12px;
          font-size: 14px;
          color: var(--primary-text-color);
          background: var(--input-fill-color, rgba(0,0,0,0.04));
          border: none;
          border-bottom: 1px solid var(--secondary-text-color);
          border-radius: 4px 4px 0 0;
          box-sizing: border-box;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
        }
        select:focus, input[type="text"]:focus {
          border-bottom: 2px solid var(--primary-color);
        }
        .select-wrap { position: relative; }
        .select-wrap::after {
          content: '▾';
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: var(--secondary-text-color);
          font-size: 16px;
        }
      </style>

      <div class="field">
        <label>EV-Assistant-Fahrzeug</label>
        <div class="select-wrap">
          <select id="device_id">
            <option value="">— Fahrzeug wählen —</option>
            ${devices.map((d) => `<option value="${d.id}"${cfg.device_id === d.id ? ' selected' : ''}>${d.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Anzeigename (optional)</label>
        <input type="text" id="name" value="${cfg.name || ''}" placeholder="Leer = Gerätename">
      </div>
      <div class="field">
        <label>Startmodus</label>
        <div class="select-wrap">
          <select id="mode">
            <option value="compact"${(cfg.mode || 'compact') === 'compact' ? ' selected' : ''}>Kompakt</option>
            <option value="detail"${cfg.mode === 'detail' ? ' selected' : ''}>Detail</option>
          </select>
        </div>
      </div>
    `;

    this.shadowRoot.querySelector('#device_id').addEventListener('change', (e) => {
      this._config = { ...this._config, device_id: e.target.value };
      this._fire(this._config);
    });
    this.shadowRoot.querySelector('#name').addEventListener('change', (e) => {
      const val = e.target.value.trim();
      this._config = { ...this._config };
      if (val) this._config.name = val; else delete this._config.name;
      this._fire(this._config);
    });
    this.shadowRoot.querySelector('#mode').addEventListener('change', (e) => {
      this._config = { ...this._config, mode: e.target.value };
      this._fire(this._config);
    });
  }
}

customElements.define('ev-assistant-card-editor', EvAssistantCardEditor);
