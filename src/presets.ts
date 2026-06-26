import type { PitchParams } from './PhysicsEngine'
import type { CsvPitch } from './types'
import { FEET_TO_M } from './PhysicsEngine'

// ─── 球種プリセット (右投手を想定) ───────────────────────────────
export const PITCH_PRESETS: Record<string, PitchParams> = {
  'フォーシーム': {
    speedKmh: 153, spinRate: 2350, spinAxis: 200, activeSpin: 0.95,
    releasePosX: -0.5, releasePosZ: 5.9, releaseExtension: 6.5,
  },
  'ツーシーム': {
    speedKmh: 148, spinRate: 2100, spinAxis: 218, activeSpin: 0.90,
    releasePosX: -0.6, releasePosZ: 5.8, releaseExtension: 6.3,
  },
  'カーブ': {
    speedKmh: 120, spinRate: 2550, spinAxis: 45, activeSpin: 0.92,
    releasePosX: -0.4, releasePosZ: 5.7, releaseExtension: 5.8,
  },
  'スライダー': {
    speedKmh: 138, spinRate: 2700, spinAxis: 130, activeSpin: 0.78,
    releasePosX: -0.5, releasePosZ: 5.8, releaseExtension: 6.2,
  },
  'スイーパー': {
    speedKmh: 130, spinRate: 2550, spinAxis: 95, activeSpin: 0.68,
    releasePosX: -0.5, releasePosZ: 5.9, releaseExtension: 6.0,
  },
  'チェンジアップ': {
    speedKmh: 129, spinRate: 1650, spinAxis: 192, activeSpin: 0.52,
    releasePosX: -0.5, releasePosZ: 5.9, releaseExtension: 5.9,
  },
  'スプリット': {
    speedKmh: 138, spinRate: 1250, spinAxis: 195, activeSpin: 0.38,
    releasePosX: -0.5, releasePosZ: 5.9, releaseExtension: 6.3,
  },
  'カッター': {
    speedKmh: 145, spinRate: 2400, spinAxis: 158, activeSpin: 0.85,
    releasePosX: -0.4, releasePosZ: 5.9, releaseExtension: 6.3,
  },
}

export const PITCH_PRESET_NAMES = Object.keys(PITCH_PRESETS) as string[]

// ─── 球種カラー ────────────────────────────────────────────────
export const PITCH_COLORS: Record<string, string> = {
  'フォーシーム': '#ff5555',
  'ツーシーム':   '#ff8844',
  'カーブ':       '#5599ff',
  'スライダー':   '#55ff99',
  'スイーパー':   '#88ff44',
  'チェンジアップ': '#cc55ff',
  'スプリット':   '#ff7722',
  'カッター':     '#ffff44',
  'カスタム':     '#ffffff',
}

// 比較リスト用のフォールバックカラー
export const COMPARISON_COLORS = [
  '#ff5555', '#5599ff', '#55ff99', '#ffaa33',
  '#cc55ff', '#ffff44', '#55ffff', '#ff55cc',
]

export function getPitchColor(label: string, index = 0): string {
  return PITCH_COLORS[label] ?? COMPARISON_COLORS[index % COMPARISON_COLORS.length]
}

// ─── Statcastピッチコード → 球種名 ─────────────────────────────
export const STATCAST_PITCH_MAP: Record<string, string> = {
  FF: 'フォーシーム', FA: 'フォーシーム',
  FT: 'ツーシーム',   SI: 'ツーシーム',
  CU: 'カーブ',       KC: 'カーブ',
  SL: 'スライダー',
  ST: 'スイーパー',
  CH: 'チェンジアップ',
  FS: 'スプリット',
  FC: 'カッター',
}

// ─── CSV行 → CsvPitch ─────────────────────────────────────────
// Statcast英語カラム名と日本語カラム名の両方をサポート
function getVal(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && v.trim() !== '') return v.trim()
  }
  return ''
}

export function parseCsvRow(row: Record<string, string>): CsvPitch | null {
  // 球速: Statcast英語 or 日本語CSVどちらにも対応
  const speedStr = getVal(row, 'release_speed', '球速(mph)', '球速')
  const speedMph = parseFloat(speedStr)
  if (isNaN(speedMph) || speedMph < 50) {
    console.debug('[parseCsvRow] スキップ - 無効な球速:', speedStr, Object.keys(row).slice(0, 5))
    return null
  }

  // 球種: Statcastコード優先、次に日本語球種名、どちらもなければカスタム
  const pitchCode  = getVal(row, 'pitch_type', '球種コード').toUpperCase()
  const pitchNameJp = getVal(row, '球種')
  let pitchType: string
  if (STATCAST_PITCH_MAP[pitchCode]) {
    pitchType = STATCAST_PITCH_MAP[pitchCode]
  } else if (pitchNameJp && PITCH_PRESETS[pitchNameJp]) {
    pitchType = pitchNameJp
  } else {
    pitchType = 'カスタム'
  }
  const preset = PITCH_PRESETS[pitchType]

  const toNum = (def: number, ...keys: string[]) => {
    const n = parseFloat(getVal(row, ...keys))
    return isNaN(n) ? def : n
  }

  const vx0Raw = parseFloat(getVal(row, 'vx0'))
  const vy0Raw = parseFloat(getVal(row, 'vy0'))
  const vz0Raw = parseFloat(getVal(row, 'vz0'))

  // Statcast追加フィールド
  const pThrowsRaw = getVal(row, 'p_throws', '投手利き腕')
  const standRaw   = getVal(row, 'stand',    '打席')
  const szTopRaw   = parseFloat(getVal(row, 'sz_top', 'ゾーン上端', 'ストライクゾーン上端'))
  const szBotRaw   = parseFloat(getVal(row, 'sz_bot', 'ゾーン下端', 'ストライクゾーン下端'))

  return {
    pitchType,
    speedKmh:         speedMph * 1.60934,
    spinRate:         toNum(preset?.spinRate ?? 2000,        'release_spin_rate', '回転数(rpm)', '回転数'),
    spinAxis:         toNum(preset?.spinAxis ?? 180,         'spin_axis',         '回転軸(度)', '回転軸'),
    releasePosX:      toNum(preset?.releasePosX ?? 0,        'release_pos_x',     'リリース位置_横'),
    releasePosZ:      toNum(preset?.releasePosZ ?? 6,        'release_pos_z',     'リリース位置_高さ'),
    releaseExtension: toNum(preset?.releaseExtension ?? 6.5, 'release_extension', 'エクステンション(ft)', 'エクステンション'),
    activeSpin:       preset?.activeSpin ?? 0.85,
    vx0: isNaN(vx0Raw) ? undefined : vx0Raw * FEET_TO_M,
    vy0: isNaN(vy0Raw) ? undefined : vy0Raw * FEET_TO_M,
    vz0: isNaN(vz0Raw) ? undefined : vz0Raw * FEET_TO_M,
    pThrows: (pThrowsRaw === 'R' || pThrowsRaw === 'L') ? pThrowsRaw : undefined,
    stand:   (standRaw   === 'R' || standRaw   === 'L') ? standRaw   : undefined,
    szTop:   isNaN(szTopRaw) ? undefined : szTopRaw,
    szBot:   isNaN(szBotRaw) ? undefined : szBotRaw,
  }
}
