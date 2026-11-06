import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIELDS, buildCatalog, parseSatcat } from '../scripts/lib/build.mjs';

const omm = over => ({
  NORAD_CAT_ID: 0, OBJECT_NAME: 'X', OBJECT_ID: '2020-001A', EPOCH: '2026-11-04T00:00:00', MEAN_MOTION: 15,
  ECCENTRICITY: 0.0005, INCLINATION: 50, RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30,
  BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0, ...over,
});

test('buildCatalog joins SATCAT, drops the NEA denylist, sorts by id and shapes every row to FIELDS', () => {
  const gp = [
    omm({ NORAD_CAT_ID: 25544, OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-11-04T21:00:00' }),
    omm({ NORAD_CAT_ID: 37348, OBJECT_NAME: 'WITHHELD NEA' }), // on the deny list: excluded
    omm({ NORAD_CAT_ID: 20580, OBJECT_NAME: 'HST', OBJECT_ID: '1990-037B' }),
  ];
  const satcat = parseSatcat('NORAD_CAT_ID,OWNER,OBJECT_TYPE,OPS_STATUS_CODE,DECAY_DATE\n25544,ISS,PAY,+,\n20580,US,PAY,+,');
  const catalog = buildCatalog(gp, satcat, '2026-11-05T00:00:00Z');

  assert.equal(catalog.kind, 'catalog');
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.fields, [...FIELDS]);
  assert.equal(catalog.objectCount, 2, 'the NEA object is excluded');
  assert.equal(catalog.rows.length, 2);
  assert.equal(catalog.rows[0][0], 20580, 'rows are sorted by NORAD id');
  assert.equal(catalog.rows[1][0], 25544);
  assert.equal(catalog.rows[1][FIELDS.indexOf('OWNER')], 'ISS', 'SATCAT owner is joined');
  assert.equal(catalog.rows[1][FIELDS.indexOf('OBJECT_TYPE')], 'PAY');
  assert.ok(!catalog.rows.some(row => row[0] === 37348), 'no withheld id leaks in');
  assert.ok(catalog.rows.every(row => row.length === FIELDS.length), 'every row is the full width');
});

test('buildCatalog keeps the newest epoch when an id repeats, and blanks missing SATCAT columns', () => {
  const gp = [
    omm({ NORAD_CAT_ID: 100, EPOCH: '2026-11-01T00:00:00', MEAN_ANOMALY: 11 }),
    omm({ NORAD_CAT_ID: 100, EPOCH: '2026-11-04T00:00:00', MEAN_ANOMALY: 99 }), // newer: wins
  ];
  const catalog = buildCatalog(gp, new Map(), '2026-11-05T00:00:00Z');
  assert.equal(catalog.objectCount, 1);
  assert.equal(catalog.rows[0][FIELDS.indexOf('MEAN_ANOMALY')], 99);
  assert.equal(catalog.rows[0][FIELDS.indexOf('OWNER')], '', 'no SATCAT match leaves the column blank');
});

test('parseSatcat honours quoted names and rejects a missing column', () => {
  const map = parseSatcat('NORAD_CAT_ID,OWNER,OBJECT_TYPE,OPS_STATUS_CODE,DECAY_DATE\n500,"ACME, LLC",PAY,+,2020-01-02');
  assert.equal(map.get(500).OWNER, 'ACME, LLC');
  assert.equal(map.get(500).DECAY_DATE, '2020-01-02');
  assert.throws(() => parseSatcat('NORAD_CAT_ID,OWNER\n1,US'), /missing the OBJECT_TYPE column/);
});

test('buildCatalog rejects a non-array GP payload', () => {
  assert.throws(() => buildCatalog({}, new Map(), '2026-11-05T00:00:00Z'), /not an array/);
});
