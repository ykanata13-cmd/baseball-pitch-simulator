import { useRef, useState } from 'react'
import Papa from 'papaparse'
import type { PitchParams } from '../PhysicsEngine'
import type { CameraView, StoredTrajectory, CsvPitch, CsvListEntry, Handedness } from '../types'
import { PITCH_PRESET_NAMES, PITCH_PRESETS, PITCH_COLORS, parseCsvRow } from '../presets'

// ─── スライダー定義 (releasePosX は利き腕トグルで管理するため除外) ──
interface SliderDef { key: keyof PitchParams; label: string; min: number; max: number; step: number; unit: string }

const SLIDERS: SliderDef[] = [
  { key: 'speedKmh',         label: '球速',            min: 90,  max: 170, step: 1,    unit: 'km/h' },
  { key: 'spinRate',         label: '回転数',          min: 500, max: 3500,step: 50,   unit: 'rpm'  },
  { key: 'spinAxis',         label: '回転軸',          min: 0,   max: 360, step: 5,    unit: '°'    },
  { key: 'releasePosZ',      label: 'リリース高さ',    min: 4,   max: 8,   step: 0.1,  unit: 'ft'   },
  { key: 'releaseExtension', label: 'エクステンション',min: 4,   max: 8,   step: 0.1,  unit: 'ft'   },
  { key: 'activeSpin',       label: '有効回転率',      min: 0.3, max: 1.0, step: 0.01, unit: ''     },
]

function spinAxisHint(deg: number): string {
  if (deg <= 20 || deg >= 340)  return 'トップスピン'
  if (deg >= 160 && deg <= 200) return 'バックスピン (4シーム)'
  if (deg >= 80 && deg <= 100)  return 'サイドスピン'
  if (deg >= 200 && deg <= 230) return 'シュート系'
  if (deg >= 120 && deg <= 160) return 'カット/スライド系'
  if (deg >= 30 && deg <= 80)   return 'カーブ系'
  return ''
}

const formatVal = (key: keyof PitchParams, val: number): string => {
  if (key === 'activeSpin') return `${(val * 100).toFixed(0)}%`
  if (key === 'speedKmh')   return `${val.toFixed(0)} km/h`
  if (Number.isInteger(val) || key === 'spinRate' || key === 'spinAxis') return val.toFixed(0)
  return val.toFixed(1)
}

function zoneLabel(z: number): string {
  if (z === 11) return '高'
  if (z === 12) return '低'
  if (z === 13) return '内'
  if (z === 14) return '外'
  return `Z${z}`
}

// ─── ゾーンボタン ────────────────────────────────────────────
function ZoneBtn({
  zone, label, selected, onClick, className = '',
}: {
  zone: number; label?: string; selected: boolean
  onClick: (z: number) => void; className?: string
}) {
  return (
    <button
      onClick={() => onClick(zone)}
      title={`ゾーン ${zone}`}
      className={`text-xs rounded transition-all select-none flex items-center justify-center leading-tight
        ${selected
          ? 'bg-cyan-500 text-black font-bold shadow-[0_0_6px_rgba(34,211,238,0.6)]'
          : 'bg-white/10 text-white/45 hover:bg-white/20 hover:text-white/70'}
        ${className}`}
    >
      {label ?? String(zone)}
    </button>
  )
}

// ─── カメラボタン ────────────────────────────────────────────
const CAM_LABELS: { view: CameraView; label: string }[] = [
  { view: 'catcher',      label: 'キャッチャー' },
  { view: 'right-batter', label: '右バッター'   },
  { view: 'left-batter',  label: '左バッター'   },
]

// ─── Props ──────────────────────────────────────────────────
interface Props {
  params: PitchParams
  pitchLabel: string
  cameraView: CameraView
  isAnimating: boolean
  pitchResult: string
  stored: StoredTrajectory[]
  handedness: Handedness
  onChange: (p: PitchParams) => void
  onLabelChange: (label: string) => void
  onCameraChange: (v: CameraView) => void
  onHandednessChange: (h: Handedness) => void
  onThrow: () => void
  onAddToComparison: () => void
  onClearComparison: () => void
  onRemoveFromComparison: (id: number) => void
  onCsvLoaded: (pitches: CsvPitch[]) => void
  availablePitchTypes: string[]
  typeFilter: string[]
  zoneFilter: number[]
  filteredListEntries: CsvListEntry[]
  selectedCsvIdx: number | null
  onTypeFilterChange: (t: string[]) => void
  onZoneFilterChange: (z: number[]) => void
  onCsvPitchSelect: (idx: number) => void
  csvTotalCount: number
  targetPos: { x: number; y: number } | null
}

// ─── メインコンポーネント ────────────────────────────────────
export default function ControlPanel({
  params, pitchLabel, cameraView, isAnimating, pitchResult, stored,
  handedness, onChange, onLabelChange, onCameraChange, onHandednessChange,
  onThrow, onAddToComparison, onClearComparison, onRemoveFromComparison, onCsvLoaded,
  availablePitchTypes, typeFilter, zoneFilter,
  filteredListEntries, selectedCsvIdx,
  onTypeFilterChange, onZoneFilterChange, onCsvPitchSelect,
  csvTotalCount,
  targetPos,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [csvMsg,       setCsvMsg]       = useState<{ text: string; ok: boolean } | null>(null)
  const [showZoneGrid, setShowZoneGrid] = useState(false)

  // スライダー変化時は Statcast 速度成分をクリア
  const set = (key: keyof PitchParams, val: number) =>
    onChange({ ...params, [key]: val, vx0: undefined, vy0: undefined, vz0: undefined })

  const handlePreset = (name: string) => {
    const preset = PITCH_PRESETS[name]
    if (preset) { onChange({ ...preset, vx0: undefined, vy0: undefined, vz0: undefined }); onLabelChange(name) }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvMsg(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h: string) => h.replace(/^﻿/, '').trim(),
      complete: ({ data, meta }) => {
        console.log('[CSV] ヘッダー:', meta.fields)
        console.log('[CSV] 先頭行:', data[0])
        const pitches = data.map(parseCsvRow).filter(Boolean) as CsvPitch[]
        console.log('[CSV] パース結果:', pitches.length, '件')
        if (pitches.length === 0) {
          setCsvMsg({ text: 'データを読み込めませんでした。カラム名を確認してください。', ok: false })
          return
        }
        onCsvLoaded(pitches)
        setCsvMsg({ text: `${pitches.length}件の投球データを読み込みました`, ok: true })
      },
      error: (err: Papa.ParseError) => {
        console.error('[CSV] パースエラー:', err)
        setCsvMsg({ text: `読み込みエラー: ${err.message}`, ok: false })
      },
    })
    e.target.value = ''
  }

  const toggleType = (pt: string) =>
    onTypeFilterChange(typeFilter.includes(pt) ? typeFilter.filter(t => t !== pt) : [...typeFilter, pt])

  const toggleZone = (z: number) =>
    onZoneFilterChange(zoneFilter.includes(z) ? zoneFilter.filter(n => n !== z) : [...zoneFilter, z])

  const isZoneSel = (z: number) => zoneFilter.includes(z)

  const dotColor  = PITCH_COLORS[pitchLabel] ?? '#ffffff'
  const hasCSV    = csvTotalCount > 0

  return (
    <div
      className="flex flex-col h-full bg-black/75 backdrop-blur-sm border-r border-white/10 text-white overflow-y-auto"
      style={{ width: '300px' }}
    >
      {/* ─── ヘッダー ─── */}
      <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
        <h1 className="text-sm font-bold tracking-widest text-cyan-400">⚾ 投球軌道シミュレーター</h1>
        <p className="text-xs text-white/35 mt-0.5">Statcast × 空気力学モデル (RK4)</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">

        {/* ─── ① 視点切り替え ─── */}
        <section>
          <p className="text-xs text-white/50 mb-1.5 tracking-wider">視点</p>
          <div className="flex gap-1">
            {CAM_LABELS.map(({ view, label }) => (
              <button
                key={view}
                onClick={() => onCameraChange(view)}
                className={`flex-1 py-1.5 text-xs rounded transition-all font-medium
                  ${cameraView === view
                    ? 'bg-cyan-500 text-black'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* ─── ② 利き腕 ─── */}
        <section>
          <p className="text-xs text-white/50 mb-1.5 tracking-wider">利き腕</p>
          <div className="flex gap-1">
            {(['right', 'left'] as Handedness[]).map(hand => (
              <button
                key={hand}
                onClick={() => onHandednessChange(hand)}
                className={`flex-1 py-2 text-xs rounded font-bold tracking-wider transition-all
                  ${handedness === hand
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
              >
                {hand === 'right' ? '右投げ (RHP)' : '左投げ (LHP)'}
              </button>
            ))}
          </div>
        </section>

        {/* ─── ③ CSV データ ─── */}
        <section>
          <p className="text-xs text-white/50 mb-1.5 tracking-wider">
            CSV データ
            {hasCSV && <span className="ml-1 text-white/30">{csvTotalCount}件読み込み済み</span>}
          </p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full py-2 text-xs rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
          >
            📂 CSVファイルを読み込む
          </button>
          {csvMsg && (
            <p className={`text-xs mt-1.5 leading-relaxed px-2 py-1.5 rounded ${
              csvMsg.ok
                ? 'text-green-400 bg-green-900/30 border border-green-500/30'
                : 'text-red-400 bg-red-900/30 border border-red-500/30'
            }`}>
              {csvMsg.text}
            </p>
          )}
          {!hasCSV && (
            <p className="text-xs text-white/25 mt-1">英語(Statcast)・日本語カラム名対応</p>
          )}
          <p className="text-xs text-amber-400/65 mt-1.5 leading-relaxed">
            💡 ストライクゾーンの枠付近をクリックすると、そこに投げ込みます
          </p>
          {targetPos && (
            <div className="text-xs text-amber-300 mt-1 px-2 py-1 rounded bg-amber-900/30 border border-amber-500/30 flex items-center gap-1.5">
              <span>🎯</span>
              <span>目標設定済み</span>
              <span className="text-white/35 font-mono ml-auto tabular-nums">
                ({targetPos.x > 0 ? '+' : ''}{targetPos.x.toFixed(2)}, {targetPos.y.toFixed(2)}m)
              </span>
            </div>
          )}

          {/* CSV フィルター & リスト (データ読み込み後のみ) */}
          {hasCSV && (
            <div className="mt-3 space-y-2">
              {/* 球種フィルター chips */}
              {availablePitchTypes.length > 1 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/40">球種で絞り込む</span>
                    {typeFilter.length > 0 && (
                      <button
                        onClick={() => onTypeFilterChange([])}
                        className="text-xs text-white/30 hover:text-cyan-400 transition-colors"
                      >
                        全て
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {availablePitchTypes.map(pt => {
                      const active = typeFilter.length === 0 || typeFilter.includes(pt)
                      return (
                        <button
                          key={pt}
                          onClick={() => toggleType(pt)}
                          className={`text-xs px-2 py-0.5 rounded-full border transition-all
                            ${active
                              ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
                              : 'bg-white/5 border-white/15 text-white/30 line-through'}`}
                        >
                          {pt}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* コースフィルター (折りたたみ) */}
              <div>
                <button
                  onClick={() => setShowZoneGrid(v => !v)}
                  className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  <span>{showZoneGrid ? '▾' : '▸'}</span>
                  <span>コースで絞り込む</span>
                  {zoneFilter.length > 0 && (
                    <span className="ml-1 text-cyan-400 font-mono">({zoneFilter.length})</span>
                  )}
                </button>
                {showZoneGrid && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="flex gap-0.5">
                      <div className="w-7 flex-shrink-0" />
                      <ZoneBtn zone={11} label="高め" selected={isZoneSel(11)} onClick={toggleZone}
                        className="flex-1 py-1" />
                      <div className="w-7 flex-shrink-0" />
                    </div>
                    <div className="flex gap-0.5">
                      <ZoneBtn zone={13} label="内" selected={isZoneSel(13)} onClick={toggleZone}
                        className="w-7 flex-shrink-0" />
                      <div className="flex-1 grid grid-cols-3 gap-0.5">
                        {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(z => (
                          <ZoneBtn key={z} zone={z} selected={isZoneSel(z)} onClick={toggleZone}
                            className="aspect-square text-sm font-mono" />
                        ))}
                      </div>
                      <ZoneBtn zone={14} label="外" selected={isZoneSel(14)} onClick={toggleZone}
                        className="w-7 flex-shrink-0" />
                    </div>
                    <div className="flex gap-0.5">
                      <div className="w-7 flex-shrink-0" />
                      <ZoneBtn zone={12} label="低め" selected={isZoneSel(12)} onClick={toggleZone}
                        className="flex-1 py-1" />
                      <div className="w-7 flex-shrink-0" />
                    </div>
                    {zoneFilter.length > 0 && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => onZoneFilterChange([])}
                          className="text-xs text-white/30 hover:text-cyan-400 transition-colors"
                        >
                          ゾーンをリセット
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 投球リスト */}
              <div>
                <p className="text-xs text-white/40 mb-1">
                  投球を選択して▶投球開始
                  <span className="ml-1 text-white/25">({filteredListEntries.length}件)</span>
                </p>
                <div className="space-y-0.5 max-h-52 overflow-y-auto pr-0.5">
                  {filteredListEntries.map(entry => {
                    const isSel = selectedCsvIdx === entry.i
                    const z = entry.zone
                    const isStrike = z >= 1 && z <= 9
                    return (
                      <button
                        key={entry.i}
                        onClick={() => onCsvPitchSelect(entry.i)}
                        className={`w-full text-left px-2 py-1.5 rounded transition-all border
                          ${isSel
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-white'
                            : 'bg-white/5 border-transparent hover:bg-white/10 text-white/70'}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                          <span className="text-xs font-semibold truncate">{entry.pitchType}</span>
                          <span className="text-xs text-white/45 ml-auto tabular-nums flex-shrink-0">
                            {(entry.cp.speedKmh / 1.60934).toFixed(1)} mph
                          </span>
                          <span className={`text-xs px-1 rounded flex-shrink-0 ${
                            isStrike ? 'bg-green-900/60 text-green-400' : 'bg-orange-900/60 text-orange-400'
                          }`}>
                            {zoneLabel(z)}
                          </span>
                        </div>
                        <div className="text-xs text-white/25 mt-0.5 ml-3.5 tabular-nums">
                          #{entry.i + 1} · {entry.cp.spinRate.toFixed(0)} rpm · 軸{entry.cp.spinAxis.toFixed(0)}°
                        </div>
                      </button>
                    )
                  })}
                  {filteredListEntries.length === 0 && (
                    <p className="text-xs text-white/25 text-center py-3">
                      フィルター条件に一致する投球がありません
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ─── ④ パラメータ調整 ─── */}
        <section>
          <p className="text-xs text-white/50 mb-2 tracking-wider">パラメータ調整</p>

          {/* 球種プリセット */}
          <div className="mb-3">
            <div className="relative">
              <select
                value={pitchLabel === 'カスタム' ? '' : pitchLabel}
                onChange={e => handlePreset(e.target.value)}
                className="w-full bg-white/10 text-white text-sm rounded px-3 py-2 appearance-none border border-white/20 focus:border-cyan-400 outline-none cursor-pointer"
              >
                <option value="" disabled className="bg-gray-900">球種プリセットを選択...</option>
                {PITCH_PRESET_NAMES.map(name => (
                  <option key={name} value={name} className="bg-gray-900">{name}</option>
                ))}
              </select>
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none">▼</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
              <span className="text-sm font-medium" style={{ color: dotColor }}>{pitchLabel}</span>
              <span className="text-xs text-white/35 ml-auto">{(params.speedKmh / 1.60934).toFixed(1)} mph</span>
            </div>
          </div>

          {/* スライダー群 */}
          <div className="space-y-3.5">
            {SLIDERS.map(({ key, label, min, max, step, unit }) => (
              <div key={key}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs text-white/65">{label}</span>
                  <span className="text-xs font-mono text-cyan-300 tabular-nums">
                    {formatVal(key, params[key] as number)}{unit && key !== 'speedKmh' && key !== 'activeSpin' ? ` ${unit}` : ''}
                  </span>
                </div>
                {key === 'spinAxis' && (
                  <p className="text-xs text-yellow-400/70 mb-1 -mt-0.5">{spinAxisHint(params.spinAxis)}</p>
                )}
                <input
                  type="range" min={min} max={max} step={step}
                  value={params[key] as number}
                  onChange={e => { set(key, parseFloat(e.target.value)); onLabelChange('カスタム') }}
                  className="w-full h-1.5 appearance-none rounded-full bg-white/20 accent-cyan-400 cursor-pointer"
                />
              </div>
            ))}
          </div>
        </section>

        {/* ─── ⑤ 軌道比較 (手動追加のみ) ─── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-white/50 tracking-wider">
              軌道比較
              {stored.length > 0 && <span className="ml-1 text-white/30">({stored.length}件)</span>}
            </p>
            {stored.length > 0 && (
              <button
                onClick={onClearComparison}
                className="text-xs text-red-400/80 hover:text-red-300 transition-colors"
              >
                全クリア
              </button>
            )}
          </div>
          <button
            onClick={onAddToComparison}
            className="w-full py-2 text-xs rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
          >
            ＋ 現在の軌道を追加
          </button>
          {stored.length > 0 && (
            <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
              {stored.map(traj => (
                <div key={traj.id} className="flex items-center gap-2 py-0.5 px-2 bg-white/5 rounded text-xs group">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: traj.color }} />
                  <span className="text-white/60 truncate flex-1">{traj.label}</span>
                  <button
                    onClick={() => onRemoveFromComparison(traj.id)}
                    title="削除"
                    className="text-white/20 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 leading-none"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      {/* ─── フッター (投球ボタン) ─── */}
      <div className="px-4 pb-4 pt-2 border-t border-white/10 flex-shrink-0 space-y-2">
        {pitchResult && (
          <div className={`text-center text-xs py-1.5 px-2 rounded font-bold tracking-widest
            ${pitchResult.includes('STRIKE')
              ? 'bg-red-900/60 text-red-300 border border-red-500/40'
              : 'bg-blue-900/60 text-blue-300 border border-blue-500/40'}`}>
            {pitchResult}
          </div>
        )}
        <button
          onClick={onThrow}
          disabled={isAnimating}
          className="w-full py-3 rounded-lg font-bold text-sm tracking-widest transition-all
            active:scale-95 text-black
            disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: isAnimating ? '#888' : dotColor }}
        >
          {isAnimating ? '再生中...' : '▶  投球開始'}
        </button>
      </div>
    </div>
  )
}
