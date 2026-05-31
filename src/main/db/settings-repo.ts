import { getDatabase, saveToFile } from './connection';

export interface Settings {
  profile_id: string;
  view_mode: string;
  sort_by: string;
  theme_mode: string;
  accent_color: string;
  bg_image: string | null;
  bg_blur: number;
  bg_opacity: number;
  sidebar_width: number;
  sidebar_opacity: number;
  draw_count: number;
  card_opacity: number;
  card_blur: number;
  sidebar_font: number;
}

const DEFAULT_SETTINGS: Omit<Settings, 'profile_id'> = {
  view_mode: 'grid',
  sort_by: 'name-asc',
  theme_mode: 'dark',
  accent_color: '#6D79F6',
  bg_image: null,
  bg_blur: 20,
  bg_opacity: 0,
  sidebar_width: 270,
  sidebar_opacity: 0.82,
  draw_count: 3,
  card_opacity: 1,
  card_blur: 0,
  sidebar_font: 14,
};

function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const existed = stmt.step();
  const row = existed ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params);
  saveToFile();
}

export function getSettings(profileId: string): Settings {
  const row = queryOne('SELECT * FROM settings WHERE profile_id = ?', [profileId]);
  if (!row) {
    run(
      `INSERT INTO settings (profile_id, view_mode, sort_by, theme_mode, accent_color,
        bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity, draw_count,
        card_opacity, card_blur, sidebar_font)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profileId,
        DEFAULT_SETTINGS.view_mode, DEFAULT_SETTINGS.sort_by, DEFAULT_SETTINGS.theme_mode, DEFAULT_SETTINGS.accent_color,
        DEFAULT_SETTINGS.bg_image, DEFAULT_SETTINGS.bg_blur, DEFAULT_SETTINGS.bg_opacity,
        DEFAULT_SETTINGS.sidebar_width, DEFAULT_SETTINGS.sidebar_opacity, DEFAULT_SETTINGS.draw_count,
        DEFAULT_SETTINGS.card_opacity, DEFAULT_SETTINGS.card_blur, DEFAULT_SETTINGS.sidebar_font,
      ]
    );
    return { profile_id: profileId, ...DEFAULT_SETTINGS };
  }
  return row as unknown as Settings;
}

export function saveSettings(profileId: string, updates: Partial<Settings>): void {
  const current = getSettings(profileId);
  const merged = { ...current, ...updates };

  run(
    `UPDATE settings SET
      view_mode = ?, sort_by = ?, theme_mode = ?, accent_color = ?,
      bg_image = ?, bg_blur = ?, bg_opacity = ?,
      sidebar_width = ?, sidebar_opacity = ?, draw_count = ?,
      card_opacity = ?, card_blur = ?, sidebar_font = ?
    WHERE profile_id = ?`,
    [
      merged.view_mode, merged.sort_by, merged.theme_mode, merged.accent_color,
      merged.bg_image, merged.bg_blur, merged.bg_opacity,
      merged.sidebar_width, merged.sidebar_opacity, merged.draw_count,
      merged.card_opacity ?? 1, merged.card_blur ?? 0, merged.sidebar_font ?? 14,
      profileId,
    ]
  );
}
