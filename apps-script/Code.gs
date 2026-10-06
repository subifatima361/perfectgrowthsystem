/**
 * PGS Meta Ads Tracker
 *
 * Pulls ad-level performance from the Meta Marketing API into Google Sheets,
 * in the same layout as the manual tracker (Yesterday / Last 3 / 7 / 14 Days / Max
 * per ad, with Spend, Leads, CPL, Impr., Link Clicks, CTR, CPC, Freq).
 *
 * Tabs it manages:
 *   Config   - one row per clinic (you fill this in)
 *   Summary  - account totals per clinic per period
 *   History  - one row per ad per day (appended daily, never overwritten)
 *   <Clinic> - one tab per clinic with the per-ad blocks
 *
 * The Meta access token lives in Project Settings > Script properties as META_TOKEN.
 */

const API_VERSION = 'v26.0'; // https://developers.facebook.com/docs/graph-api/changelog/versions

const PERIODS = [
  ['Yesterday', 'yesterday'],
  ['Last 3 Days', 'last_3d'],
  ['Last 7 Days', 'last_7d'],
  ['Last 14 Days', 'last_14d'],
  ['Max', 'maximum'],
];

// Checked in order; the first one present is used so leads are never double counted.
// 'lead' is Meta's combined lead count (instant forms + website pixel leads).
const LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
];

const FREQ_WARN = 2.5;        // frequency at or above this is flagged as possible fatigue
const CPL_WARN_RATIO = 1.3;   // CPL more than 30% over target is flagged red

const CONFIG_SHEET = 'Config';
const SUMMARY_SHEET = 'Summary';
const HISTORY_SHEET = 'History';
const CONFIG_HEADERS = ['Clinic', 'Ad Account ID', 'Target CPL', 'Active ads only (TRUE/FALSE)'];
const BLOCK_HEADERS = ['', 'Spend', 'Leads', 'CPL', 'Impr.', 'Link Clicks', 'CTR', 'CPC', 'Freq', 'Signal'];
const HISTORY_HEADERS = ['Date', 'Clinic', 'Campaign', 'Ad Set', 'Ad', 'Ad ID', 'Spend', 'Leads', 'CPL',
  'Impr.', 'Reach', 'Link Clicks', 'CTR', 'CPC', 'Freq'];

const COLOR_GOOD = '#d9ead3';
const COLOR_BAD = '#f4cccc';
const COLOR_WARN = '#fff2cc';
const COLOR_HEADER = '#efefef';

// ---------------------------------------------------------------- menu & triggers

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Meta Ads')
    .addItem('Refresh now', 'refreshAll')
    .addSeparator()
    .addItem('Set up Config tab', 'setupConfig')
    .addItem('Turn on daily auto-refresh', 'installDailyTrigger')
    .addItem('Turn off daily auto-refresh', 'removeTriggers')
    .addToUi();
}

function setupConfig() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG_SHEET) || ss.insertSheet(CONFIG_SHEET, 0);
  sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS])
    .setFontWeight('bold').setBackground(COLOR_HEADER);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 1, 4).setValues([['Example Clinic', 'act_1234567890', 20, true]]);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, CONFIG_HEADERS.length);
}

function installDailyTrigger() {
  removeTriggers();
  // Runs between 6 and 7am in the spreadsheet's time zone (File > Settings).
  ScriptApp.newTrigger('refreshAll').timeBased().everyDays(1).atHour(6).create();
  SpreadsheetApp.getActive().toast('Daily refresh is on (6-7am).', 'Meta Ads');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'refreshAll'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// ---------------------------------------------------------------- main

function refreshAll() {
  const token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Add META_TOKEN under Project Settings > Script properties.');

  const ss = SpreadsheetApp.getActive();
  const clinics = readConfig_(ss);
  const summaryRows = [];
  const errors = [];

  clinics.forEach(function (clinic) {
    try {
      const ads = fetchClinic_(clinic, token);
      writeClinicTab_(ss, clinic, ads);
      appendHistory_(ss, clinic, ads);
      summaryRows.push(summarize_(clinic, ads));
    } catch (e) {
      errors.push(clinic.name + ': ' + e.message);
    }
  });

  writeSummary_(ss, summaryRows, errors);
  if (errors.length) throw new Error('Some clinics failed:\n' + errors.join('\n'));
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Fill in the Config tab first (Meta Ads > Set up Config tab).');
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      const id = String(r[1]).trim().replace(/^act_/, '');
      return {
        name: String(r[0]).trim(),
        accountId: 'act_' + id,
        targetCpl: Number(r[2]) || 0,
        activeOnly: r[3] === '' ? true : r[3] === true || String(r[3]).toUpperCase() === 'TRUE',
      };
    });
}

// ---------------------------------------------------------------- Meta API

/** Returns [{id, name, campaign, adset, periods: {yesterday: metrics, ...}}] sorted by lifetime spend. */
function fetchClinic_(clinic, token) {
  const ads = {};
  PERIODS.forEach(function (p) {
    fetchInsights_(clinic, p[1], token).forEach(function (row) {
      const ad = ads[row.ad_id] || (ads[row.ad_id] = {
        id: row.ad_id, name: row.ad_name, campaign: row.campaign_name, adset: row.adset_name, periods: {},
      });
      ad.periods[p[1]] = toMetrics_(row);
    });
  });
  // An ad with no delivery in a window gets no row from Meta; show it as zeros.
  return Object.keys(ads).map(function (k) {
    const ad = ads[k];
    PERIODS.forEach(function (p) { if (!ad.periods[p[1]]) ad.periods[p[1]] = toMetrics_({}); });
    return ad;
  }).sort(function (a, b) { return b.periods.maximum.spend - a.periods.maximum.spend; });
}

function fetchInsights_(clinic, datePreset, token) {
  const params = {
    level: 'ad',
    date_preset: datePreset,
    fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,actions',
    limit: 500,
    access_token: token,
  };
  if (clinic.activeOnly) {
    params.filtering = JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]);
  }
  let url = 'https://graph.facebook.com/' + API_VERSION + '/' + clinic.accountId + '/insights?' + toQuery_(params);
  const rows = [];
  while (url) {
    const body = getJson_(url);
    Array.prototype.push.apply(rows, body.data || []);
    url = body.paging && body.paging.next;
  }
  return rows;
}

function getJson_(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // The only call to Meta in this script, and it is a read (GET). Nothing is ever created, edited or paused.
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    const body = JSON.parse(res.getContentText());
    if (!body.error) return body;
    // 4, 17, 613, 80000-80014: rate limits. Back off and retry.
    const code = body.error.code;
    const rateLimited = code === 4 || code === 17 || code === 613 || (code >= 80000 && code <= 80014);
    if (!rateLimited || attempt === 3) throw new Error('Meta API: ' + body.error.message);
    Utilities.sleep(5000 * Math.pow(2, attempt));
  }
}

function toQuery_(params) {
  return Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function toMetrics_(row) {
  const spend = Number(row.spend) || 0;
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.inline_link_clicks) || 0;
  const leads = leadsFrom_(row.actions);
  return {
    spend: spend,
    leads: leads,
    impressions: impressions,
    reach: Number(row.reach) || 0,
    clicks: clicks,
    frequency: Number(row.frequency) || 0,
    // Derived from the raw counts so every row uses the same definitions.
    cpl: leads ? spend / leads : null,
    ctr: impressions ? clicks / impressions : null,
    cpc: clicks ? spend / clicks : null,
  };
}

function leadsFrom_(actions) {
  if (!actions) return 0;
  for (let i = 0; i < LEAD_ACTION_TYPES.length; i++) {
    const match = actions.filter(function (a) { return a.action_type === LEAD_ACTION_TYPES[i]; })[0];
    if (match) return Number(match.value) || 0;
  }
  return 0;
}

// ---------------------------------------------------------------- output

function writeClinicTab_(ss, clinic, ads) {
  const sheet = ss.getSheetByName(clinic.name) || ss.insertSheet(clinic.name);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  sheet.getRange(1, 1, 1, 3).setValues([[clinic.name, 'Updated ' + now_(ss),
    clinic.targetCpl ? 'Target CPL $' + clinic.targetCpl : '']]);
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sheet.getRange(1, 2, 1, 2).setFontColor('#666666');

  if (!ads.length) {
    sheet.getRange(3, 1).setValue(clinic.activeOnly ? 'No active ads with delivery.' : 'No ads with delivery.');
    return;
  }

  let r = 3;
  ads.forEach(function (ad) {
    sheet.getRange(r, 1, 1, 2).setValues([[ad.name, ad.campaign + ' › ' + ad.adset]]);
    sheet.getRange(r, 1).setFontWeight('bold');
    sheet.getRange(r, 2).setFontColor('#666666').setFontSize(9);
    sheet.getRange(r + 1, 1, 1, BLOCK_HEADERS.length).setValues([BLOCK_HEADERS])
      .setFontWeight('bold').setBackground(COLOR_HEADER);

    const values = [];
    const backgrounds = [];
    PERIODS.forEach(function (p) {
      const m = ad.periods[p[1]];
      values.push([p[0], m.spend, m.leads, m.cpl === null ? '—' : m.cpl, m.impressions, m.clicks,
        m.ctr === null ? '—' : m.ctr, m.cpc === null ? '—' : m.cpc, m.frequency, signal_(clinic, p[1], m)]);
      backgrounds.push(rowColors_(clinic, m));
    });
    const body = sheet.getRange(r + 2, 1, PERIODS.length, BLOCK_HEADERS.length);
    body.setValues(values).setBackgrounds(backgrounds);
    sheet.getRange(r + 2, 2, PERIODS.length, 1).setNumberFormat('$#,##0.00');
    sheet.getRange(r + 2, 3, PERIODS.length, 1).setNumberFormat('0');
    sheet.getRange(r + 2, 4, PERIODS.length, 1).setNumberFormat('$#,##0.00');
    sheet.getRange(r + 2, 5, PERIODS.length, 2).setNumberFormat('#,##0');
    sheet.getRange(r + 2, 7, PERIODS.length, 1).setNumberFormat('0.00%');
    sheet.getRange(r + 2, 8, PERIODS.length, 1).setNumberFormat('$#,##0.00');
    sheet.getRange(r + 2, 9, PERIODS.length, 1).setNumberFormat('0.00');
    r += PERIODS.length + 4;
  });

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidths(2, 8, 85);
  sheet.setColumnWidth(10, 220);
}

function rowColors_(clinic, m) {
  const colors = BLOCK_HEADERS.map(function () { return null; });
  if (clinic.targetCpl && m.cpl !== null) {
    colors[3] = m.cpl > clinic.targetCpl * CPL_WARN_RATIO ? COLOR_BAD
      : m.cpl <= clinic.targetCpl ? COLOR_GOOD : COLOR_WARN;
  }
  if (m.frequency >= FREQ_WARN) colors[8] = COLOR_WARN;
  return colors;
}

/** Short plain-English flags. Skipped for Max, which is lifetime context rather than something to act on. */
function signal_(clinic, period, m) {
  if (period === 'maximum') return '';
  const flags = [];
  if (clinic.targetCpl && m.leads === 0 && m.spend >= clinic.targetCpl * 2) {
    flags.push('Spent 2x target CPL, no leads');
  } else if (clinic.targetCpl && m.cpl !== null && m.cpl > clinic.targetCpl * CPL_WARN_RATIO) {
    flags.push('CPL over target');
  }
  if (m.frequency >= FREQ_WARN) flags.push('High frequency');
  if (m.impressions >= 1000 && m.ctr !== null && m.ctr < 0.007) flags.push('Low CTR');
  return flags.join(' · ');
}

function summarize_(clinic, ads) {
  const row = [clinic.name];
  PERIODS.forEach(function (p) {
    let spend = 0;
    let leads = 0;
    ads.forEach(function (ad) { spend += ad.periods[p[1]].spend; leads += ad.periods[p[1]].leads; });
    row.push(spend, leads, leads ? spend / leads : '—');
  });
  return row;
}

function writeSummary_(ss, rows, errors) {
  const sheet = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 1);
  sheet.clear();
  const top = ['Clinic'];
  const sub = [''];
  PERIODS.forEach(function (p) { top.push(p[0], '', ''); sub.push('Spend', 'Leads', 'CPL'); });
  sheet.getRange(1, 1).setValue('Updated ' + now_(ss)).setFontColor('#666666');
  sheet.getRange(2, 1, 2, top.length).setValues([top, sub]).setFontWeight('bold').setBackground(COLOR_HEADER);
  if (rows.length) {
    sheet.getRange(4, 1, rows.length, top.length).setValues(rows);
    for (let c = 2; c <= top.length; c += 3) {
      sheet.getRange(4, c, rows.length, 1).setNumberFormat('$#,##0.00');
      sheet.getRange(4, c + 1, rows.length, 1).setNumberFormat('0');
      sheet.getRange(4, c + 2, rows.length, 1).setNumberFormat('$#,##0.00');
    }
  }
  if (errors.length) {
    sheet.getRange(rows.length + 5, 1, errors.length, 1)
      .setValues(errors.map(function (e) { return ['ERROR ' + e]; })).setFontColor('#cc0000');
  }
  sheet.setFrozenRows(3);
}

/** Appends yesterday's numbers per ad, once per day, so you build a real day-by-day history. */
function appendHistory_(ss, clinic, ads) {
  const sheet = ss.getSheetByName(HISTORY_SHEET) || ss.insertSheet(HISTORY_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HISTORY_HEADERS);
    sheet.getRange(1, 1, 1, HISTORY_HEADERS.length).setFontWeight('bold').setBackground(COLOR_HEADER);
    sheet.setFrozenRows(1);
  }
  const yesterday = Utilities.formatDate(new Date(Date.now() - 864e5), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues().forEach(function (r) {
      existing[r[0] + '|' + r[5]] = true;
    });
  }

  const rows = ads
    .filter(function (ad) { return ad.periods.yesterday.spend > 0 && !existing[yesterday + '|' + ad.id]; })
    .map(function (ad) {
      const m = ad.periods.yesterday;
      return [yesterday, clinic.name, ad.campaign, ad.adset, ad.name, "'" + ad.id, m.spend, m.leads,
        m.cpl === null ? '' : m.cpl, m.impressions, m.reach, m.clicks,
        m.ctr === null ? '' : m.ctr, m.cpc === null ? '' : m.cpc, m.frequency];
    });
  if (!rows.length) return;
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, HISTORY_HEADERS.length).setValues(rows);
  sheet.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd'); // must match the dedupe key format
  sheet.getRange(start, 7, rows.length, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(start, 9, rows.length, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(start, 13, rows.length, 1).setNumberFormat('0.00%');
  sheet.getRange(start, 14, rows.length, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(start, 15, rows.length, 1).setNumberFormat('0.00');
}

function now_(ss) {
  return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM d, yyyy h:mm a');
}
