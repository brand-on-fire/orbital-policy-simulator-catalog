// Pure build of the app's catalog:active columnar file from CelesTrak GP (GROUP=active, JSON) joined to the bulk
// SATCAT CSV. No network or git here, so the offline tests run it on fixtures. The output exactly matches the
// columnar shape the app's parseCatalog reads (fields = the 13 OMM fields then the 4 SATCAT fields; rows are
// arrays aligned to fields). Real CelesTrak-derived elements only; no satellite is invented.

export const OMM_FIELDS = Object.freeze(['NORAD_CAT_ID', 'OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT']);
export const SATCAT_FIELDS = Object.freeze(['OWNER', 'OBJECT_TYPE', 'OPS_STATUS_CODE', 'DECAY_DATE']);
export const FIELDS = Object.freeze([...OMM_FIELDS, ...SATCAT_FIELDS]);
// Withheld near-Earth-asteroid tracking objects, mirrored from the data repo. GROUP=active would omit them anyway
// (they have no active-payload elements), but they are dropped here defensively so one can never leak in.
export const NEA_DENYLIST = Object.freeze(new Set([37348, 39232, 43941, 43866, 63156, 36608, 45860, 56083, 65432]));
export const GP_CITATION = 'GP/SATCAT: USSPACECOM via Space-Track.org, distributed by CelesTrak (celestrak.org)';

/** Split one CSV line, honouring double-quoted fields (CelesTrak quotes names that contain commas). */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Index the bulk SATCAT CSV by NORAD id, keeping the four classification columns. Throws if a column is missing. */
export function parseSatcat(csvText) {
  const lines = csvText.split('\n').filter(line => line.length > 0);
  if (lines.length === 0) throw new Error('SATCAT is empty');
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const key of ['NORAD_CAT_ID', ...SATCAT_FIELDS]) if (!(key in col)) throw new Error(`SATCAT is missing the ${key} column`);
  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const id = Number(row[col.NORAD_CAT_ID]);
    if (!Number.isInteger(id)) continue;
    map.set(id, { OWNER: row[col.OWNER] ?? '', OBJECT_TYPE: row[col.OBJECT_TYPE] ?? '', OPS_STATUS_CODE: row[col.OPS_STATUS_CODE] ?? '', DECAY_DATE: row[col.DECAY_DATE] ?? '' });
  }
  return map;
}

/**
 * Build the catalog:active value from the GP active array and a SATCAT map. Deduplicates by NORAD id keeping the
 * newest epoch, drops the NEA denylist, sorts by id, and joins the SATCAT classification columns (blank when a row
 * has no SATCAT match). nowIso stamps generatedAt/retrievedAt.
 */
export function buildCatalog(gp, satcatMap, nowIso) {
  if (!Array.isArray(gp)) throw new Error('GROUP=active payload is not an array');
  const omms = new Map();
  for (const omm of gp) {
    const id = omm?.NORAD_CAT_ID;
    if (typeof id !== 'number' || !Number.isInteger(id) || NEA_DENYLIST.has(id)) continue;
    const prev = omms.get(id);
    if (!prev || Date.parse(omm.EPOCH) > Date.parse(prev.EPOCH)) omms.set(id, omm);
  }
  const ids = [...omms.keys()].sort((a, b) => a - b);
  const rows = ids.map(id => {
    const omm = omms.get(id);
    const sat = satcatMap.get(id) ?? {};
    return FIELDS.map(field => {
      const value = field in omm ? omm[field] : sat[field];
      return value === undefined || value === null ? '' : value;
    });
  });
  return {
    schemaVersion: 1, kind: 'catalog', generatedAt: nowIso, retrievedAt: nowIso,
    source: 'CelesTrak GP GROUP=active joined to SATCAT', citation: GP_CITATION,
    objectCount: rows.length, fields: [...FIELDS], rows,
  };
}
