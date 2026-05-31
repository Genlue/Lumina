/**
 * Automated test suite — validates data layer, settings persistence, profile isolation.
 * Run: node test.js
 */
const fs = require('fs');
const path = require('path');

const TEST_DB = path.join(__dirname, 'test-photo-album.db');
let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${msg}`); }
}

function section(name) { console.log(`\n${'='.repeat(50)}\n  ${name}\n${'='.repeat(50)}`); }

// ====== Setup ======
section('Setup');

// Clean test DB
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');

// Use a test folder
const TEST_FOLDER_1 = path.join(__dirname, 'test-folder-1');
const TEST_FOLDER_2 = path.join(__dirname, 'test-folder-2');
if (!fs.existsSync(TEST_FOLDER_1)) fs.mkdirSync(TEST_FOLDER_1, { recursive: true });
if (!fs.existsSync(TEST_FOLDER_2)) fs.mkdirSync(TEST_FOLDER_2, { recursive: true });
// Create a test image
fs.writeFileSync(path.join(TEST_FOLDER_1, 'test.jpg'), Buffer.alloc(100));
fs.writeFileSync(path.join(TEST_FOLDER_2, 'test.jpg'), Buffer.alloc(100));
// Create backgrounds folder with test bg
const bgDir = path.join(TEST_FOLDER_1, 'backgrounds');
if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
fs.writeFileSync(path.join(bgDir, 'bg1.jpg'), Buffer.alloc(200));

console.log('  Test folders created');

// ====== DB Init & Migration ======
section('1. Database Init & Migration');

const { initDatabase, closeDatabase, getDatabase } = require('./dist/main/db/connection');
const { createProfile, listProfiles, getProfileById, removeProfile } = require('./dist/main/db/profiles-repo');
const { getSettings, saveSettings } = require('./dist/main/db/settings-repo');

(async () => {
  await initDatabase(TEST_DB);

  const db = getDatabase();
  assert(db !== null, 'Database initialized');

  // Verify V2 migration ran
  const result = db.exec('SELECT MAX(version) FROM _schema_version');
  const version = result[0].values[0][0];
  assert(version >= 2, `Schema version >= 2 (got ${version})`);

  // Verify new columns exist
  const cols = db.exec("PRAGMA table_info('settings')")[0].values.map(r => r[1]);
  assert(cols.includes('card_opacity'), 'card_opacity column exists');
  assert(cols.includes('card_blur'), 'card_blur column exists');

  // ====== Profile CRUD ======
  section('2. Profile CRUD');

  const p1 = createProfile(TEST_FOLDER_1, 'Test Folder 1');
  assert(p1.id.length > 0, 'Profile 1 created with UUID');
  assert(p1.folder_path === TEST_FOLDER_1, 'Profile 1 path correct');

  const p2 = createProfile(TEST_FOLDER_2, 'Test Folder 2');
  assert(p2.id.length > 0, 'Profile 2 created');

  const profiles = listProfiles();
  assert(profiles.length === 2, '2 profiles listed');
  assert(profiles[0].last_access >= profiles[1].last_access, 'Profiles sorted by last_access desc');

  const found = getProfileById(p1.id);
  assert(found !== null, 'Profile 1 found by ID');

  removeProfile(p2.id);
  assert(listProfiles().length === 1, 'Profile 2 deleted');

  // Recreate p2
  const p2b = createProfile(TEST_FOLDER_2, 'Test Folder 2');

  // ====== Settings Persistence ======
  section('3. Settings Persistence');

  // Default settings
  const s1 = getSettings(p1.id);
  assert(s1.theme_mode === 'dark', 'Default theme is dark');
  assert(s1.bg_blur === 20, 'Default bg_blur is 20');
  assert(s1.bg_opacity === 0, 'Default bg_opacity is 0');
  assert(s1.card_opacity === 1, 'Default card_opacity is 1');
  assert(s1.card_blur === 0, 'Default card_blur is 0');
  assert(s1.draw_count === 3, 'Default draw_count is 3');
  assert(s1.sidebar_width === 270, 'Default sidebar_width is 270');
  assert(s1.sidebar_opacity === 0.82, 'Default sidebar_opacity is 0.82');

  // Save custom settings
  saveSettings(p1.id, {
    theme_mode: 'light',
    accent_color: '#FF5500',
    bg_image: 'bg1.jpg',
    bg_blur: 10,
    bg_opacity: 0.3,
    sidebar_width: 300,
    sidebar_opacity: 0.5,
    draw_count: 5,
    card_opacity: 0.7,
    card_blur: 15,
  });

  // Reload and verify
  const s1b = getSettings(p1.id);
  assert(s1b.theme_mode === 'light', 'Theme saved/loaded: light');
  assert(s1b.accent_color === '#FF5500', 'Accent saved/loaded: #FF5500');
  assert(s1b.bg_image === 'bg1.jpg', 'bg_image saved/loaded');
  assert(s1b.bg_blur === 10, 'bg_blur saved/loaded: 10');
  assert(s1b.bg_opacity === 0.3, 'bg_opacity saved/loaded: 0.3');
  assert(s1b.sidebar_width === 300, 'sidebar_width saved/loaded: 300');
  assert(s1b.sidebar_opacity === 0.5, 'sidebar_opacity saved/loaded: 0.5');
  assert(s1b.draw_count === 5, 'draw_count saved/loaded: 5');
  assert(s1b.card_opacity === 0.7, 'card_opacity saved/loaded: 0.7');
  assert(s1b.card_blur === 15, 'card_blur saved/loaded: 15');

  // ====== Profile Isolation ======
  section('4. Profile Isolation');

  const s2 = getSettings(p2b.id);
  // Profile 2 should still have defaults
  assert(s2.theme_mode === 'dark', 'Profile 2 theme still dark (isolated)');
  assert(s2.bg_image === null, 'Profile 2 bg_image still null (isolated)');
  assert(s2.card_opacity === 1, 'Profile 2 card_opacity still 1 (isolated)');

  // Modify profile 2 differently
  saveSettings(p2b.id, { theme_mode: 'light', bg_opacity: 0.8, card_blur: 5 });
  const s2b = getSettings(p2b.id);
  assert(s2b.theme_mode === 'light', 'P2 theme changed to light');
  assert(s2b.bg_opacity === 0.8, 'P2 bg_opacity: 0.8');
  assert(s2b.card_blur === 5, 'P2 card_blur: 5');

  // Verify profile 1 is unchanged
  const s1c = getSettings(p1.id);
  assert(s1c.card_blur === 15, 'P1 card_blur still 15 (not leaked from P2)');
  assert(s1c.bg_opacity === 0.3, 'P1 bg_opacity still 0.3 (not leaked from P2)');
  assert(s1c.theme_mode === 'light', 'P1 theme still light (unaffected by P2)');
  assert(s1c.bg_image === 'bg1.jpg', 'P1 bg_image still bg1.jpg');

  // ====== Scanner & Backgrounds ======
  section('5. Scanner & Backgrounds');

  const { scanProfileFolder } = require('./dist/main/services/scanner');
  const scanR = scanProfileFolder(p1.id, TEST_FOLDER_1);
  assert(scanR.rootImages.length >= 1, 'Scanner found root images');
  assert(scanR.albumImages['backgrounds'] !== undefined, 'Backgrounds folder scanned');
  assert(scanR.albumImages['backgrounds'].length >= 1, 'Background image found');
  // backgrounds should NOT be in albumFolders
  assert(!scanR.albumFolders.includes('backgrounds'), 'Backgrounds NOT in album list');

  // ====== IPC Handlers ======
  section('6. IPC Handler Registration');

  const { registerIpcHandlers } = require('./dist/main/ipc/index');
  // Just verify no throw
  try { registerIpcHandlers(); assert(true, 'IPC handlers registered'); }
  catch(e) { assert(false, `IPC registration failed: ${e.message}`); }

  // ====== Cleanup ======
  section('Cleanup');
  closeDatabase();
  fs.unlinkSync(TEST_DB);
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
  fs.rmSync(TEST_FOLDER_1, { recursive: true, force: true });
  fs.rmSync(TEST_FOLDER_2, { recursive: true, force: true });

  // ====== Summary ======
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${'='.repeat(20)}`);
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}`);
  console.log(`  ${failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
