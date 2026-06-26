import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { simulatePitch, DEFAULT_PARAMS, FEET_TO_M } from './PhysicsEngine'
import type { PitchParams, SimResult } from './PhysicsEngine'
import type { CameraView, StoredTrajectory, CsvPitch, CsvListEntry, Handedness } from './types'
import { getPitchColor, COMPARISON_COLORS } from './presets'
import PitchScene from './components/PitchScene'
import ControlPanel from './components/ControlPanel'

const DEFAULT_SZ_TOP    = 3.5 * FEET_TO_M  // m
const DEFAULT_SZ_BOTTOM = 1.5 * FEET_TO_M  // m

const SZ_WIDTH = 0.4318

function judgeResult(result: SimResult, szTop: number, szBottom: number): string {
  const last = result.positions[result.positions.length - 1]
  const inZone  = Math.abs(last.x) <= SZ_WIDTH / 2 && last.y >= szBottom && last.y <= szTop
  const nearMiss = Math.abs(last.x) <= SZ_WIDTH / 2 + 0.05
    && last.y >= szBottom - 0.05 && last.y <= szTop + 0.05
  if (inZone)    return 'STRIKE ✓'
  if (nearMiss)  return 'ボーダー'
  return 'BALL'
}

export function classifyZone(x: number, y: number, szTop = DEFAULT_SZ_TOP, szBottom = DEFAULT_SZ_BOTTOM): number {
  const hw = SZ_WIDTH / 2
  const h  = szTop - szBottom
  if (y > szTop)    return 11
  if (y < szBottom) return 12
  if (x < -hw)      return 13
  if (x >  hw)      return 14
  const col = x < -hw / 3 ? 0 : x < hw / 3 ? 1 : 2
  const row = y < szBottom + h / 3 ? 0 : y < szBottom + 2 * h / 3 ? 1 : 2
  return row * 3 + col + 1
}

// ─── 着弾点逆算: 球速の大きさを保ちつつ着弾座標へ向かう初速を反復計算 ──
// tx/ty: Three.js座標で (x = sim.x, y = sim.z = 高さ) at plate (z≈0)
function computeVelocityForTarget(
  p: PitchParams,
  tx: number,
  ty: number,
): { vx0: number; vy0: number; vz0: number } {
  const speed = p.speedKmh / 3.6
  // リリース座標 (simulation 座標系)
  const rx = p.releasePosX * FEET_TO_M
  const ry = (60.5 - p.releaseExtension) * FEET_TO_M  // ≈ 16.5m (ホームへ向かう方向)
  const rz = p.releasePosZ * FEET_TO_M

  // 初期方向: リリース → 着弾点
  const dx = tx - rx, dy = -ry, dz = ty - rz
  const d  = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  let vx0 = speed * dx / d
  let vy0 = speed * dy / d
  let vz0 = speed * dz / d

  // 反復補正 (最大 24 回): 実際の軌道と目標の誤差を比例補正
  for (let i = 0; i < 24; i++) {
    const res  = simulatePitch({ ...p, vx0, vy0, vz0 })
    const last = res.positions[res.positions.length - 1]
    // Three.js 座標: last.x = sim.x, last.y = sim.z (高さ)
    const ex = last.x - tx
    const ey = last.y - ty
    if (Math.abs(ex) < 0.003 && Math.abs(ey) < 0.003) break
    const ft = res.flightTimeSec
    vx0 -= ex / ft * 0.62
    vz0 -= ey / ft * 0.62   // vz0 → sim.z → Three.js y
    const m = Math.sqrt(vx0 * vx0 + vy0 * vy0 + vz0 * vz0)
    if (m > 0.1) { const s = speed / m; vx0 *= s; vy0 *= s; vz0 *= s }
  }
  return { vx0, vy0, vz0 }
}

export default function App() {
  const [params,         setParams]         = useState<PitchParams>(DEFAULT_PARAMS)
  const [pitchLabel,     setPitchLabel]     = useState('フォーシーム')
  const [result,         setResult]         = useState<SimResult | null>(null)
  const [isAnimating,    setIsAnimating]    = useState(false)
  const [pitchResult,    setPitchResult]    = useState('')
  const [cameraView,     setCameraView]     = useState<CameraView>('catcher')
  const [stored,         setStored]         = useState<StoredTrajectory[]>([])
  const [pitchKey,       setPitchKey]       = useState(0)
  const [handedness,     setHandedness]     = useState<Handedness>('right')
  const [selectedCsvIdx, setSelectedCsvIdx] = useState<number | null>(null)

  // 動的ストライクゾーン (ft → m は呼び出し側で変換)
  const [szTopFt,  setSzTopFt]  = useState<number | undefined>(undefined)
  const [szBotFt,  setSzBotFt]  = useState<number | undefined>(undefined)
  const szTop    = (szTopFt  !== undefined ? szTopFt  : 3.5) * FEET_TO_M
  const szBottom = (szBotFt  !== undefined ? szBotFt  : 1.5) * FEET_TO_M

  // クリック着弾点 (Three.js X/Y 座標)
  const [targetPos, setTargetPos] = useState<{ x: number; y: number } | null>(null)

  const nextIdRef   = useRef(1)
  const colorIdxRef = useRef(0)

  // CSV raw data + list filters
  const [rawPitchData, setRawPitchData] = useState<CsvPitch[]>([])
  const [typeFilter,   setTypeFilter]   = useState<string[]>([])
  const [zoneFilter,   setZoneFilter]   = useState<number[]>([])

  // CSV リスト用エントリ (ゾーン付き)
  const csvListEntries = useMemo<CsvListEntry[]>(() =>
    rawPitchData.map((cp, i) => {
      const sim  = simulatePitch({
        speedKmh: cp.speedKmh, spinRate: cp.spinRate, spinAxis: cp.spinAxis,
        activeSpin: cp.activeSpin, releasePosX: cp.releasePosX, releasePosZ: cp.releasePosZ,
        releaseExtension: cp.releaseExtension, vx0: cp.vx0, vy0: cp.vy0, vz0: cp.vz0,
      })
      const last = sim.positions[sim.positions.length - 1]
      const st = cp.szTop !== undefined ? cp.szTop * FEET_TO_M : DEFAULT_SZ_TOP
      const sb = cp.szBot !== undefined ? cp.szBot * FEET_TO_M : DEFAULT_SZ_BOTTOM
      return { i, cp, pitchType: cp.pitchType,
        zone:  classifyZone(last.x, last.y, st, sb),
        color: COMPARISON_COLORS[i % COMPARISON_COLORS.length] }
    })
  , [rawPitchData])

  const filteredListEntries = useMemo(() => {
    let res = csvListEntries
    if (typeFilter.length > 0) res = res.filter(e => typeFilter.includes(e.pitchType))
    if (zoneFilter.length > 0) res = res.filter(e => zoneFilter.includes(e.zone))
    return res
  }, [csvListEntries, typeFilter, zoneFilter])

  const availablePitchTypes = useMemo(
    () => [...new Set(csvListEntries.map(e => e.pitchType))],
    [csvListEntries]
  )

  useEffect(() => { setResult(simulatePitch(DEFAULT_PARAMS)) }, [])

  const handleThrow = useCallback(() => {
    let adjusted = params
    if (targetPos) {
      const vel = computeVelocityForTarget(params, targetPos.x, targetPos.y)
      adjusted = { ...params, ...vel }
    }
    const sim = simulatePitch(adjusted)
    setResult(sim)
    setPitchResult('')
    setIsAnimating(true)
    setPitchKey(k => k + 1)
  }, [params, targetPos])

  const handleAnimEnd = useCallback(() => {
    setIsAnimating(false)
    setResult(prev => {
      if (prev) setPitchResult(judgeResult(prev, szTop, szBottom))
      return prev
    })
  }, [szTop, szBottom])

  const handleAddToComparison = useCallback(() => {
    if (!result) return
    const color = getPitchColor(pitchLabel, colorIdxRef.current++)
    const id    = nextIdRef.current++
    setStored(prev => [...prev, {
      id, positions: [...result.positions], color,
      label: `${pitchLabel} #${id}`, flightTimeSec: result.flightTimeSec,
      spinRate: params.spinRate, spinAxis: params.spinAxis, pitchType: pitchLabel,
    }])
  }, [result, pitchLabel, params])

  const handleClearComparison = useCallback(() => {
    setStored([])
    colorIdxRef.current = 0
  }, [])

  const handleRemoveFromComparison = useCallback((id: number) => {
    setStored(prev => prev.filter(t => t.id !== id))
  }, [])

  const handleCsvLoaded = useCallback((csvPitches: CsvPitch[]) => {
    setRawPitchData(csvPitches)
    setTypeFilter([])
    setZoneFilter([])
    setSelectedCsvIdx(null)
    setTargetPos(null)
  }, [])

  const handleHandednessChange = useCallback((hand: Handedness) => {
    setHandedness(hand)
    setParams(prev => ({
      ...prev,
      releasePosX: hand === 'right' ? -0.5 : 0.5,
      vx0: undefined, vy0: undefined, vz0: undefined,
    }))
  }, [])

  const handleCsvPitchSelect = useCallback((idx: number) => {
    const cp = rawPitchData[idx]
    if (!cp) return
    setSelectedCsvIdx(idx)

    // p_throws 優先, なければ releasePosX の符号で推定
    const hand: Handedness = cp.pThrows === 'R' ? 'right'
      : cp.pThrows === 'L' ? 'left'
      : cp.releasePosX <= 0 ? 'right' : 'left'
    setHandedness(hand)

    // ストライクゾーンを打者別に更新
    setSzTopFt(cp.szTop)
    setSzBotFt(cp.szBot)

    setTargetPos(null)  // 新しい球を選択したらターゲットをリセット

    setParams({
      speedKmh: cp.speedKmh, spinRate: cp.spinRate, spinAxis: cp.spinAxis,
      activeSpin: cp.activeSpin, releasePosX: cp.releasePosX, releasePosZ: cp.releasePosZ,
      releaseExtension: cp.releaseExtension, vx0: cp.vx0, vy0: cp.vy0, vz0: cp.vz0,
    })
    setPitchLabel(cp.pitchType)

    // 軌道プレビューをすぐ更新
    const sim = simulatePitch({
      speedKmh: cp.speedKmh, spinRate: cp.spinRate, spinAxis: cp.spinAxis,
      activeSpin: cp.activeSpin, releasePosX: cp.releasePosX, releasePosZ: cp.releasePosZ,
      releaseExtension: cp.releaseExtension, vx0: cp.vx0, vy0: cp.vy0, vz0: cp.vz0,
    })
    setResult(sim)
    setPitchResult('')
  }, [rawPitchData])

  // ターゲット平面クリック: 着弾点を設定し即座にプレビュー軌道を再計算
  const handleTargetClick = useCallback((x: number, y: number) => {
    setTargetPos({ x, y })
    const vel = computeVelocityForTarget(params, x, y)
    const adjusted = { ...params, ...vel }
    setResult(simulatePitch(adjusted))
    setPitchResult('')
  }, [params])

  const pitchColor = getPitchColor(pitchLabel)

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <div className="absolute inset-0">
        <PitchScene
          result={result}
          isAnimating={isAnimating}
          spinRate={params.spinRate}
          spinAxis={params.spinAxis}
          pitchColor={pitchColor}
          pitchKey={pitchKey}
          cameraView={cameraView}
          stored={stored}
          handedness={handedness}
          szTop={szTop}
          szBottom={szBottom}
          targetPos={targetPos}
          onTargetClick={handleTargetClick}
          onAnimEnd={handleAnimEnd}
        />
      </div>

      <div className="absolute top-0 left-0 h-full z-10">
        <ControlPanel
          params={params}
          pitchLabel={pitchLabel}
          cameraView={cameraView}
          isAnimating={isAnimating}
          pitchResult={pitchResult}
          stored={stored}
          handedness={handedness}
          onChange={setParams}
          onLabelChange={setPitchLabel}
          onCameraChange={setCameraView}
          onHandednessChange={handleHandednessChange}
          onThrow={handleThrow}
          onAddToComparison={handleAddToComparison}
          onClearComparison={handleClearComparison}
          onRemoveFromComparison={handleRemoveFromComparison}
          onCsvLoaded={handleCsvLoaded}
          availablePitchTypes={availablePitchTypes}
          typeFilter={typeFilter}
          zoneFilter={zoneFilter}
          filteredListEntries={filteredListEntries}
          selectedCsvIdx={selectedCsvIdx}
          onTypeFilterChange={setTypeFilter}
          onZoneFilterChange={setZoneFilter}
          onCsvPitchSelect={handleCsvPitchSelect}
          csvTotalCount={rawPitchData.length}
          targetPos={targetPos}
        />
      </div>

      <div className="absolute top-3 right-4 text-right text-white/25 text-xs pointer-events-none select-none">
        <div className="font-medium text-white/40">
          {cameraView === 'catcher'      ? 'Catcher / Umpire View'
           : cameraView === 'right-batter' ? 'Right Batter View'
           : 'Left Batter View'}
        </div>
        <div className="font-mono">60.5 ft mound</div>
        {stored.length > 0 && (
          <div className="text-cyan-400/60 mt-1">{stored.length} pitch(es) in comparison</div>
        )}
      </div>
    </div>
  )
}
