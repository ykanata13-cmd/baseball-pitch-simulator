import * as THREE from 'three'

// ─── 物理定数 ───────────────────────────────────────────────
const MASS    = 0.145   // kg
const GRAVITY = 9.81    // m/s²
const RHO     = 1.225   // kg/m³
const AREA    = 0.00426 // m²
const CD      = 0.33

export const FEET_TO_M = 0.3048

// ─── 型定義 ─────────────────────────────────────────────────
export interface PitchParams {
  speedKmh: number
  spinRate: number
  spinAxis: number
  activeSpin: number
  releasePosX: number
  releasePosZ: number
  releaseExtension: number
  // Statcast CSV から取得した実際の初速度 (m/s)。指定時は speedKmh より優先
  vx0?: number
  vy0?: number
  vz0?: number
}

export interface SimResult {
  positions: THREE.Vector3[]
  flightTimeSec: number
}

interface State {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
}

// ─── 運動方程式 ──────────────────────────────────────────────
function derivatives(s: State, spinDir: [number, number, number], Cl: number): State {
  const { vx, vy, vz } = s
  const vMag = Math.sqrt(vx*vx + vy*vy + vz*vz)
  if (vMag < 1e-9) return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: -GRAVITY }

  const inv = 1 / vMag
  const udx = vx*inv, udy = vy*inv, udz = vz*inv

  const fd = -0.5 * RHO * AREA * CD * vMag * vMag
  const fdx = fd*udx, fdy = fd*udy, fdz = fd*udz

  const [sx, sy, sz] = spinDir
  const fm = 0.5 * RHO * AREA * Cl * vMag * vMag
  const fmx = fm*(sy*udz - sz*udy)
  const fmy = fm*(sz*udx - sx*udz)
  const fmz = fm*(sx*udy - sy*udx)

  return {
    x: vx, y: vy, z: vz,
    vx: (fdx + fmx) / MASS,
    vy: (fdy + fmy) / MASS,
    vz: -GRAVITY + (fdz + fmz) / MASS,
  }
}

// ─── RK4 ────────────────────────────────────────────────────
function rk4(s: State, spin: [number, number, number], Cl: number, dt: number): State {
  const add = (a: State, d: State, h: number): State => ({
    x:  a.x  + h*d.x,  y:  a.y  + h*d.y,  z:  a.z  + h*d.z,
    vx: a.vx + h*d.vx, vy: a.vy + h*d.vy, vz: a.vz + h*d.vz,
  })
  const k1 = derivatives(s,             spin, Cl)
  const k2 = derivatives(add(s,k1,dt/2), spin, Cl)
  const k3 = derivatives(add(s,k2,dt/2), spin, Cl)
  const k4 = derivatives(add(s,k3,dt),  spin, Cl)
  return {
    x:  s.x  + (dt/6)*(k1.x  + 2*k2.x  + 2*k3.x  + k4.x),
    y:  s.y  + (dt/6)*(k1.y  + 2*k2.y  + 2*k3.y  + k4.y),
    z:  s.z  + (dt/6)*(k1.z  + 2*k2.z  + 2*k3.z  + k4.z),
    vx: s.vx + (dt/6)*(k1.vx + 2*k2.vx + 2*k3.vx + k4.vx),
    vy: s.vy + (dt/6)*(k1.vy + 2*k2.vy + 2*k3.vy + k4.vy),
    vz: s.vz + (dt/6)*(k1.vz + 2*k2.vz + 2*k3.vz + k4.vz),
  }
}

// Statcast → Three.js 座標変換
function toThree(s: State): THREE.Vector3 {
  return new THREE.Vector3(s.x, s.z, -s.y)
}

// ─── メインシミュレーション関数 ──────────────────────────────
export function simulatePitch(params: PitchParams): SimResult {
  const speedMs = params.speedKmh / 3.6

  // 初期位置 (Statcast座標系・メートル)
  const x0 = params.releasePosX * FEET_TO_M
  const y0 = (60.5 - params.releaseExtension) * FEET_TO_M
  const z0 = params.releasePosZ * FEET_TO_M

  // 初速度: CSV由来があればそれを優先、なければ速度から導出
  const vx0 = params.vx0 ?? 0.914
  const vy0 = params.vy0 ?? -speedMs
  const vz0 = params.vz0 ?? -0.610

  // スピン方向ベクトル (Statcast spin_axis 定義に基づく XZ 平面単位ベクトル)
  // 座標定義: X<0=3塁側(右打者・右投手リリース), X>0=1塁側(左打者)
  // fmx = fm*(sy*udz - sz*udy) ≈ fm*sz (vy<0 なので udy≈-1, udz≈0 より)
  // ∴ sz = +sin(θ) とすることで:
  //   スライダー(θ≈130°): sz=+0.766 → fmx>0 → X>0(1塁側・右打者から逃げる) ✓
  //   ツーシーム(θ≈218°): sz=-0.616 → fmx<0 → X<0(3塁側・右打者の内角)    ✓
  const theta = (params.spinAxis * Math.PI) / 180
  const rawSx = Math.cos(theta), rawSz = Math.sin(theta)
  const norm  = Math.sqrt(rawSx*rawSx + rawSz*rawSz) || 1
  const spinDir: [number, number, number] = [rawSx/norm, 0, rawSz/norm]

  const Cl = 0.15 * (params.spinRate * params.activeSpin / 2200)

  let state: State = { x: x0, y: y0, z: z0, vx: vx0, vy: vy0, vz: vz0 }
  const positions: THREE.Vector3[] = [toThree(state)]

  const dt = 0.002
  const SAMPLE_INTERVAL = 0.01
  let elapsed    = 0
  let lastSample = 0

  while (elapsed < 2.0 && state.y > 0) {
    state    = rk4(state, spinDir, Cl, dt)
    elapsed += dt
    if (elapsed - lastSample >= SAMPLE_INTERVAL) {
      positions.push(toThree(state))
      lastSample = elapsed
    }
  }
  positions.push(toThree(state))

  return { positions, flightTimeSec: elapsed }
}

export const DEFAULT_PARAMS: PitchParams = {
  speedKmh: 153, spinRate: 2350, spinAxis: 200, activeSpin: 0.95,
  releasePosX: -0.5, releasePosZ: 5.9, releaseExtension: 6.5,
}
