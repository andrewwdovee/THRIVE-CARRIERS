/**
 * Thrive Companies — lead capture for Google Sheets
 *
 * Receives applications from the funnel and adds one row per lead.
 * When the applicant books in Calendly, their row is marked "Booked: Yes".
 *
 * SETUP
 *  1. Create a Google Sheet. Extensions → Apps Script.
 *  2. Delete what's there, paste this whole file, click Save.
 *  3. Deploy → New deployment → gear icon → Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     Click Deploy, approve the permissions, and copy the Web app URL
 *     (it ends in /exec). Put it in FORM_ENDPOINT in sales-position.html.
 *  4. If you change this script later: Deploy → Manage deployments →
 *     pencil icon → Version: New version → Deploy (the URL stays the same).
 */

const SHEET_NAME = 'Leads';

// Column order in the sheet: [header, key sent by the form]
const COLUMNS = [
  ['Submitted At',      'submitted_at'],
  ['First Name',        'first_name'],
  ['Last Name',         'last_name'],
  ['Email',             'email'],
  ['Phone',             'phone'],
  ['State',             'state'],
  ['Licensed',          'licensed'],
  ['Sales Experience',  'experience'],
  ['With Another IMO',  'current_imo'],
  ['Full-Time 5–7 Calls', 'full_time'],
  ['Income Goal',       'income_goal'],
  ['Lead Budget / Mo',  'lead_budget'],
  ['Contact Consent',   'consent'],
  ['Booked Interview',  'booked'],
  ['Booked At',         'booked_at'],
  ['UTM Source',        'utm_source'],
  ['UTM Medium',        'utm_medium'],
  ['UTM Campaign',      'utm_campaign'],
  ['UTM Content',       'utm_content'],
  ['UTM Term',          'utm_term'],
  ['Pipeline',          'pipeline'],
  ['EL',                'el'],
  ['FB Click ID',       'fbclid'],
  ['Google Click ID',   'gclid'],
  ['Page',              'page'],
];
const KEYS = COLUMNS.map(c => c[1]);

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sheet = getSheet_();
    if (data.action === 'booked') {
      markBooked_(sheet, data);
    } else {
      const row = KEYS.map(k => {
        if (k === 'booked') return 'No';
        if (k === 'submitted_at') return data.submitted_at ? new Date(data.submitted_at) : new Date();
        return clean_(data[k]);
      });
      sheet.appendRow(row);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Visit the /exec URL in a browser to check the script is live.
function doGet() {
  return json_({ ok: true, message: 'Thrive Companies lead webhook is running.' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNS.map(c => c[0]));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#0F0D0A').setFontColor('#E2C36E');
    sh.getRange(2, KEYS.indexOf('phone') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'); // keep phone numbers as text
  }
  return sh;
}

// Find the most recent row with this email and mark it booked.
function markBooked_(sh, data) {
  const email = String(data.email || '').trim().toLowerCase();
  const last = sh.getLastRow();
  if (!email || last < 2) return;
  const emailCol = KEYS.indexOf('email') + 1;
  const values = sh.getRange(2, emailCol, last - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).trim().toLowerCase() === email) {
      const row = i + 2;
      sh.getRange(row, KEYS.indexOf('booked') + 1).setValue('Yes');
      sh.getRange(row, KEYS.indexOf('booked_at') + 1).setValue(data.booked_at ? new Date(data.booked_at) : new Date());
      return;
    }
  }
}

// Stops values like "=..." or "+1 555..." being treated as formulas.
function clean_(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
