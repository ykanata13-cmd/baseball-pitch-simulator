import { useRef, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Trail, Line } from '@react-three/drei'
import * as THREE from 'three'
import { FEET_TO_M } from '../PhysicsEngine'
import type { SimResult } from '../PhysicsEngine'
import type { CameraView, StoredTrajectory, Handedness } from '../types'

// ─── 座標定数 ────────────────────────────────────────────────
const MOUND_Z           = -18.44
const PLATE_HW          = 0.2159
const PLATE_D1          = 0.2159
const PLATE_D2          = 0.2151
const SZ_WIDTH          = 0.4318
const DEFAULT_SZ_BOTTOM = 1.5 * FEET_TO_M
const DEFAULT_SZ_TOP    = 3.5 * FEET_TO_M
const DEFAULT_SZ_MID    = (DEFAULT_SZ_BOTTOM + DEFAULT_SZ_TOP) / 2

// MLB公式球: 直径 2.9inch = 0.0737m → 半径 0.0369m
const BALL_RADIUS = 0.037

// ─── カメラ設定 ──────────────────────────────────────────────
const CAMERA_CONFIGS: Record<CameraView, { position: [number, number, number]; target: [number, number, number] }> = {
  catcher:        { position: [0,     1.05, 1.90], target: [0,  DEFAULT_SZ_MID, 0]               },
  'right-batter': { position: [0.55,  1.68, 0.65], target: [0,  DEFAULT_SZ_MID, MOUND_Z * 0.38] },
  'left-batter':  { position: [-0.55, 1.68, 0.65], target: [0,  DEFAULT_SZ_MID, MOUND_Z * 0.38] },
}

// ─── スムーズカメラ切り替え ───────────────────────────────────
function CameraController({ view }: { view: CameraView }) {
  const { camera } = useThree()
  const lookRef      = useRef(new THREE.Vector3(0, DEFAULT_SZ_MID, 0))
  const targetPosRef = useRef(new THREE.Vector3(...CAMERA_CONFIGS.catcher.position))
  const targetLokRef = useRef(new THREE.Vector3(...CAMERA_CONFIGS.catcher.target))

  useEffect(() => {
    camera.position.set(...CAMERA_CONFIGS.catcher.position)
    camera.lookAt(...CAMERA_CONFIGS.catcher.target)
  }, [camera])

  useEffect(() => {
    const cfg = CAMERA_CONFIGS[view]
    targetPosRef.current.set(...cfg.position)
    targetLokRef.current.set(...cfg.target)
  }, [view])

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-7 * delta)
    camera.position.lerp(targetPosRef.current, alpha)
    lookRef.current.lerp(targetLokRef.current, alpha)
    camera.lookAt(lookRef.current)
  })
  return null
}

// ─── フィールド (動的ストライクゾーン) ─────────────────────────
interface FieldProps { szTop: number; szBottom: number }

function Field({ szTop, szBottom }: FieldProps) {
  const plateShape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-PLATE_HW, -PLATE_D1)
    s.lineTo( PLATE_HW, -PLATE_D1)
    s.lineTo( PLATE_HW,  0)
    s.lineTo( 0,         PLATE_D2)
    s.lineTo(-PLATE_HW,  0)
    s.closePath()
    return s
  }, [])

  const szLinePoints = useMemo(() => {
    const hw = SZ_WIDTH / 2
    return [
      new THREE.Vector3(-hw, szBottom, 0), new THREE.Vector3( hw, szBottom, 0),
      new THREE.Vector3( hw, szBottom, 0), new THREE.Vector3( hw, szTop,    0),
      new THREE.Vector3( hw, szTop,    0), new THREE.Vector3(-hw, szTop,    0),
      new THREE.Vector3(-hw, szTop,    0), new THREE.Vector3(-hw, szBottom, 0),
    ]
  }, [szTop, szBottom])

  const szMid = (szTop + szBottom) / 2

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, -9]}>
        <planeGeometry args={[30, 22]} />
        <meshLambertMaterial color="#1a4a0a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, -9]}>
        <planeGeometry args={[14, 20]} />
        <meshLambertMaterial color="#8B6A3A" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, MOUND_Z]}>
        <planeGeometry args={[0.61, 0.152]} />
        <meshLambertMaterial color="#f0f0f0" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <shapeGeometry args={[plateShape]} />
        <meshLambertMaterial color="#f0f0f0" side={THREE.DoubleSide} />
      </mesh>
      <Line points={szLinePoints} color="#00ffff" lineWidth={2} segments />
      <mesh position={[0, szMid, 0.001]}>
        <planeGeometry args={[SZ_WIDTH, szTop - szBottom]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {([-1, 1] as const).flatMap(sx =>
        [szBottom, szTop].map((sy, i) => (
          <mesh key={`${sx}-${i}`} position={[(sx as number) * SZ_WIDTH / 2, sy, 0]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#00ffff" />
          </mesh>
        ))
      )}
      <Line
        points={[
          new THREE.Vector3(-0.6, szBottom, MOUND_Z / 2),
          new THREE.Vector3( 0.6, szBottom, MOUND_Z / 2),
          new THREE.Vector3( 0.6, szTop,    MOUND_Z / 2),
          new THREE.Vector3(-0.6, szTop,    MOUND_Z / 2),
          new THREE.Vector3(-0.6, szBottom, MOUND_Z / 2),
        ]}
        color="#ffffff" lineWidth={0.5} transparent opacity={0.15}
      />
    </group>
  )
}

// ─── ターゲット平面 (クリックで着弾点を指定) ─────────────────
interface TargetPlaneProps {
  szTop: number
  szBottom: number
  targetPos: { x: number; y: number } | null
  onTargetClick: (x: number, y: number) => void
}

function TargetPlane({ szTop, szBottom, targetPos, onTargetClick }: TargetPlaneProps) {
  const szMid  = (szTop + szBottom) / 2
  const planeH = (szTop - szBottom) + 0.80
  const planeW = 1.20

  return (
    <group>
      <mesh
        position={[0, szMid, 0.015]}
        onPointerEnter={() => { document.body.style.cursor = 'crosshair' }}
        onPointerLeave={() => { document.body.style.cursor = 'default'   }}
        onClick={e => {
          e.stopPropagation()
          onTargetClick(e.point.x, e.point.y)
        }}
      >
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {targetPos && (
        <group position={[targetPos.x, targetPos.y, 0.016]}>
          {/* 細いリング */}
          <mesh>
            <ringGeometry args={[0.022, 0.028, 32]} />
            <meshBasicMaterial color="#ffaa44" transparent opacity={0.85} />
          </mesh>
          {/* 水平クロスヘア (短め・細め) */}
          <Line
            points={[new THREE.Vector3(-0.045, 0, 0.001), new THREE.Vector3(0.045, 0, 0.001)]}
            color="#ffaa44" lineWidth={1.0} transparent opacity={0.60}
          />
          {/* 垂直クロスヘア (短め・細め) */}
          <Line
            points={[new THREE.Vector3(0, -0.045, 0.001), new THREE.Vector3(0, 0.045, 0.001)]}
            color="#ffaa44" lineWidth={1.0} transparent opacity={0.60}
          />
        </group>
      )}
    </group>
  )
}

// ─── 投手モデル (4フェーズ全身アニメーション) ────────────────
interface PitcherModelProps {
  handedness: Handedness
  pitchKey: number
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
}

// Phase 0.00-0.28: 足上げ + 腕を軽く挙上・外旋
// Phase 0.28-0.55: フルテイクバック (肘先行・前腕折れ)
// Phase 0.55-0.78: 腕振り・胴体回旋・前腕スナップ
// Phase 0.78-1.00: フォロースルーへの収束

function torsYRot(p: number): number {
  if (p < 0.55) return -0.40
  return -0.40 + 0.54 * easeInOut((p - 0.55) / 0.45)
}

function armXRot(p: number): number {
  if (p < 0.28)  return -0.5 * easeInOut(p / 0.28)
  if (p < 0.55)  return -0.5 - 1.1 * easeInOut((p - 0.28) / 0.27)   // → -1.6
  if (p < 0.78)  return -1.6 + 1.75 * easeInOut((p - 0.55) / 0.23)  // → +0.15
  return 0.15 * (1 - easeInOut((p - 0.78) / 0.22))
}

function armZRot(p: number): number {
  if (p < 0.28)  return 0.28 * easeInOut(p / 0.28)
  if (p < 0.55)  return 0.28
  if (p < 0.78)  return 0.28 * (1 - easeInOut((p - 0.55) / 0.23))
  return 0
}

function forearmXRot(p: number): number {
  if (p < 0.28)  return 0
  if (p < 0.55)  return 0.40 * easeInOut((p - 0.28) / 0.27)         // 前腕折れる
  if (p < 0.78)  return 0.40 - 0.58 * easeInOut((p - 0.55) / 0.23) // スナップ → -0.18
  return -0.18 * (1 - easeInOut((p - 0.78) / 0.22))
}

function legXRot(p: number): number {
  if (p < 0.28)  return -1.0 * easeInOut(p / 0.28)   // 素早く足上げ
  if (p < 0.55)  return -1.0                          // ホールド
  if (p < 0.78)  return -1.0 * (1 - easeInOut((p - 0.55) / 0.23))  // ストライド
  return 0
}

function PitcherModel({ handedness, pitchKey }: PitcherModelProps) {
  const torsoGroupRef   = useRef<THREE.Group>(null)
  const armGroupRef     = useRef<THREE.Group>(null)
  const forearmGroupRef = useRef<THREE.Group>(null)
  const strideLegRef    = useRef<THREE.Group>(null)
  const phaseRef        = useRef(1.0)

  const mat  = { color: '#1a3050' as const, transparent: true as const, opacity: 0.82 }
  const dark = { color: '#0f1e35' as const, transparent: true as const, opacity: 0.88 }

  useEffect(() => {
    phaseRef.current = 0
    if (torsoGroupRef.current)   torsoGroupRef.current.rotation.y   = torsYRot(0)
    if (armGroupRef.current)   { armGroupRef.current.rotation.x     = armXRot(0); armGroupRef.current.rotation.z = armZRot(0) }
    if (forearmGroupRef.current) forearmGroupRef.current.rotation.set(0, 0, 0)
    if (strideLegRef.current)    strideLegRef.current.rotation.x    = legXRot(0)
  }, [pitchKey])

  useFrame((_, delta) => {
    if (phaseRef.current >= 1) return
    phaseRef.current = Math.min(phaseRef.current + delta * 2.2, 1)
    const p = phaseRef.current
    if (torsoGroupRef.current)   torsoGroupRef.current.rotation.y   = torsYRot(p)
    if (armGroupRef.current) {
      armGroupRef.current.rotation.x = armXRot(p)
      armGroupRef.current.rotation.z = armZRot(p)
    }
    if (forearmGroupRef.current) forearmGroupRef.current.rotation.x = forearmXRot(p)
    if (strideLegRef.current)    strideLegRef.current.rotation.x    = legXRot(p)
  })

  const mirror = handedness === 'left' ? -1 : 1

  const torsoY = 0.55, torsoZ = 0.05
  const sx = -0.22, sy = 1.55 - torsoY, sz = 0.12 - torsoZ
  const hipX = 0.10, hipY = 0.82, hipZ = 0.08

  return (
    <group position={[0, 0, MOUND_Z]} scale={[mirror, 1, 1]}>

      <group ref={torsoGroupRef} position={[0, torsoY, torsoZ]}>
        {/* 頭 */}
        <mesh position={[0, 1.17, 0.13]}>
          <sphereGeometry args={[0.115, 12, 10]} />
          <meshBasicMaterial {...mat} />
        </mesh>
        <mesh position={[0, 1.28, 0.13]}>
          <sphereGeometry args={[0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial {...dark} />
        </mesh>
        <mesh position={[0, 1.22, 0.26]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.10, 0.045, 10]} />
          <meshBasicMaterial {...dark} />
        </mesh>
        {/* 胴体 */}
        <mesh position={[-0.02, 0.65, 0.05]} rotation={[-0.22, 0, 0.04]}>
          <cylinderGeometry args={[0.170, 0.190, 0.72, 10]} />
          <meshBasicMaterial {...mat} />
        </mesh>

        {/* 投球腕: 肩ピボット */}
        <group ref={armGroupRef} position={[sx, sy, sz]}>
          {/* 上腕 */}
          <mesh position={[-0.03, -0.07, 0.01]} rotation={[0.32, 0.14, -0.88]}>
            <cylinderGeometry args={[0.062, 0.055, 0.40, 8]} />
            <meshBasicMaterial {...mat} />
          </mesh>
          {/* 前腕サブグループ: 肘ピボット */}
          <group ref={forearmGroupRef} position={[-0.15, -0.20, 0.05]}>
            <mesh position={[-0.05, -0.08, 0.07]} rotation={[0.52, 0.10, -0.72]}>
              <cylinderGeometry args={[0.050, 0.042, 0.36, 8]} />
              <meshBasicMaterial {...mat} />
            </mesh>
            <mesh position={[-0.15, -0.25, 0.21]}>
              <sphereGeometry args={[0.06, 8, 6]} />
              <meshBasicMaterial {...mat} />
            </mesh>
          </group>
        </group>

        {/* グラブ腕 (静的) */}
        <mesh position={[0.28, 0.87, 0.00]} rotation={[0.08, -0.08, 0.88]}>
          <cylinderGeometry args={[0.062, 0.055, 0.38, 8]} />
          <meshBasicMaterial {...mat} />
        </mesh>
        <mesh position={[0.46, 0.77, 0.02]}>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshBasicMaterial {...dark} />
        </mesh>
      </group>

      {/* 軸脚 (静的) */}
      <mesh position={[-0.12, 0.55, -0.10]} rotation={[0.12, -0.04, -0.08]}>
        <cylinderGeometry args={[0.093, 0.080, 0.55, 8]} />
        <meshBasicMaterial {...mat} />
      </mesh>
      <mesh position={[-0.15, 0.18, 0.02]} rotation={[-0.26, 0, -0.04]}>
        <cylinderGeometry args={[0.076, 0.063, 0.45, 8]} />
        <meshBasicMaterial {...mat} />
      </mesh>
      <mesh position={[-0.15, -0.04, 0.10]} rotation={[-0.10, 0, 0]}>
        <boxGeometry args={[0.10, 0.065, 0.20]} />
        <meshBasicMaterial {...dark} />
      </mesh>

      {/* 踏み出し脚: 股関節ピボット */}
      <group ref={strideLegRef} position={[hipX, hipY, hipZ]}>
        <mesh position={[0, -0.19, 0.22]} rotation={[-0.36, 0.05, 0.04]}>
          <cylinderGeometry args={[0.093, 0.080, 0.60, 8]} />
          <meshBasicMaterial {...mat} />
        </mesh>
        <mesh position={[0, -0.61, 0.42]} rotation={[0.12, 0.02, 0.02]}>
          <cylinderGeometry args={[0.076, 0.063, 0.52, 8]} />
          <meshBasicMaterial {...mat} />
        </mesh>
        <mesh position={[0, -0.86, 0.54]} rotation={[-0.22, 0, 0]}>
          <boxGeometry args={[0.10, 0.065, 0.22]} />
          <meshBasicMaterial {...dark} />
        </mesh>
      </group>
    </group>
  )
}

// ─── 汎用アニメーションボール ────────────────────────────────
interface AnimBallProps {
  positions: THREE.Vector3[]
  flightTimeSec: number
  color: string
  spinRate: number
  spinAxis: number
  pitchKey: number
  isAnimating?: boolean
  useTexture?: boolean
  trailWidth?: number
  onAnimEnd?: () => void
}

function AnimBall({
  positions, flightTimeSec, color, spinRate, spinAxis, pitchKey,
  isAnimating, useTexture = false, trailWidth = 0.16, onAnimEnd,
}: AnimBallProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const timeRef = useRef(0)
  const doneRef = useRef(isAnimating === undefined)

  // 回転軸: PhysicsEngine の spinDir = (cos θ, 0, +sin θ) を toThree 変換 (sim.z→Y) で (cos θ, +sin θ, 0)
  const spinVec = useMemo(() => {
    const rad = (spinAxis * Math.PI) / 180
    return new THREE.Vector3(Math.cos(rad), Math.sin(rad), 0).normalize()
  }, [spinAxis])

  useEffect(() => {
    timeRef.current = 0
    doneRef.current = false
    if (positions.length > 0 && meshRef.current) {
      meshRef.current.position.copy(positions[0])
      meshRef.current.rotation.set(0, 0, 0)  // 各投球でリセット
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchKey])

  useEffect(() => {
    if (isAnimating === false && positions.length > 0 && meshRef.current) {
      meshRef.current.position.copy(positions[0])
    }
  }, [positions, isAnimating])

  useFrame((_, delta) => {
    if (!meshRef.current || positions.length < 2) return
    // rotateOnWorldAxis: 世界座標系で固定軸を保ってスピン (rotateOnAxis は局所軸なので誤差が生じる)
    meshRef.current.rotateOnWorldAxis(spinVec, (spinRate / 60) * 2 * Math.PI * delta)

    const active = isAnimating !== undefined
      ? isAnimating && !doneRef.current
      : !doneRef.current
    if (!active) return

    timeRef.current += delta
    const t    = Math.min(timeRef.current / flightTimeSec, 1)
    const idxF = t * (positions.length - 1)
    const i0   = Math.floor(idxF)
    const i1   = Math.min(i0 + 1, positions.length - 1)
    meshRef.current.position.copy(
      positions[i0].clone().lerp(positions[i1], idxF - i0)
    )
    if (t >= 1) {
      doneRef.current = true
      onAnimEnd?.()
    }
  })

  const initPos = positions[0] ?? new THREE.Vector3(-0.15, 1.80, -16.5)
  // TorusGeometry の引数: [major-r, tube-r, radialSeg, tubularSeg, arc]
  const sr = BALL_RADIUS   // seam 用の参照半径

  return (
    <Trail key={pitchKey} width={trailWidth} length={14} color={color} attenuation={t => t * t * t}>
      <mesh ref={meshRef} position={initPos}>
        <sphereGeometry args={[BALL_RADIUS, useTexture ? 22 : 10, useTexture ? 18 : 10]} />
        {useTexture
          ? <meshStandardMaterial color="#f5efe8" roughness={0.88} metalness={0} />
          : <meshBasicMaterial color={color} />
        }
        {/* 縫い目: 2本のハーフトーラス (図8縫い目を近似) */}
        {useTexture && (
          <>
            {/* 縫い目 A: 右上→左下弧 */}
            <mesh rotation={[0.48, 0, 0.44]}>
              <torusGeometry args={[sr * 0.74, sr * 0.088, 4, 40, Math.PI]} />
              <meshBasicMaterial color="#c42020" />
            </mesh>
            {/* 縫い目 B: 反対側 (180°回転) */}
            <mesh rotation={[0.48 + Math.PI, 0, 0.44 + Math.PI]}>
              <torusGeometry args={[sr * 0.74, sr * 0.088, 4, 40, Math.PI]} />
              <meshBasicMaterial color="#c42020" />
            </mesh>
          </>
        )}
      </mesh>
    </Trail>
  )
}

// ─── 比較軌道: 静的ライン + 同期アニメーションボール ──────────
function StoredBalls({ stored, pitchKey }: { stored: StoredTrajectory[]; pitchKey: number }) {
  return (
    <>
      {stored.map(traj =>
        traj.positions.length >= 2 ? (
          <group key={traj.id}>
            <Line points={traj.positions} color={traj.color} lineWidth={2.0} transparent opacity={0.55} />
            <AnimBall
              positions={traj.positions} flightTimeSec={traj.flightTimeSec}
              color={traj.color} spinRate={traj.spinRate} spinAxis={traj.spinAxis}
              pitchKey={pitchKey} trailWidth={0.16}
            />
          </group>
        ) : null
      )}
    </>
  )
}

// ─── リリースポイントマーカー ────────────────────────────────
function ReleaseMarker({ pos }: { pos: THREE.Vector3 }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshBasicMaterial color="#00ffff" transparent opacity={0.75} />
    </mesh>
  )
}

// ─── 照明 ────────────────────────────────────────────────────
function Lights() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[10, 20, 5]}   intensity={0.85} />
      <directionalLight position={[-10, 15, -5]} intensity={0.40} color="#ffe8a0" />
      <pointLight position={[ 8, 12, -9]} intensity={30} color="#fff5e0" distance={35} />
      <pointLight position={[-8, 12, -9]} intensity={30} color="#fff5e0" distance={35} />
    </>
  )
}

// ─── メインコンポーネント ────────────────────────────────────
interface PitchSceneProps {
  result: SimResult | null
  isAnimating: boolean
  spinRate: number
  spinAxis: number
  pitchColor: string
  pitchKey: number
  cameraView: CameraView
  stored: StoredTrajectory[]
  handedness: Handedness
  szTop: number
  szBottom: number
  targetPos: { x: number; y: number } | null
  onTargetClick: (x: number, y: number) => void
  onAnimEnd: () => void
}

export default function PitchScene({
  result, isAnimating, spinRate, spinAxis,
  pitchColor, pitchKey, cameraView, stored, handedness,
  szTop, szBottom, targetPos, onTargetClick, onAnimEnd,
}: PitchSceneProps) {
  const stableAnimEnd = useCallback(onAnimEnd, [onAnimEnd])

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ fov: 47, near: 0.01, far: 200 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <CameraController view={cameraView} />
      <Lights />
      <fog attach="fog" args={['#080812', 22, 65]} />

      <Field szTop={szTop} szBottom={szBottom} />
      <TargetPlane szTop={szTop} szBottom={szBottom} targetPos={targetPos} onTargetClick={onTargetClick} />
      <PitcherModel handedness={handedness} pitchKey={pitchKey} />

      <StoredBalls stored={stored} pitchKey={pitchKey} />

      {/* 現在の軌道プレビューライン (薄い白) */}
      {result && result.positions.length >= 2 && (
        <Line
          points={result.positions}
          color="#ffffff"
          lineWidth={1.0}
          transparent
          opacity={0.18}
        />
      )}

      {result && <ReleaseMarker pos={result.positions[0]} />}

      {/* メインボール: テクスチャ付き + やや太いトレイル */}
      <AnimBall
        positions={result?.positions ?? []}
        flightTimeSec={result?.flightTimeSec ?? 0.5}
        color={pitchColor}
        spinRate={spinRate}
        spinAxis={spinAxis}
        pitchKey={pitchKey}
        isAnimating={isAnimating}
        useTexture={true}
        trailWidth={0.22}
        onAnimEnd={stableAnimEnd}
      />
    </Canvas>
  )
}
