import type { Vector3 } from 'three'

export type CameraView  = 'catcher' | 'right-batter' | 'left-batter'
export type Handedness  = 'right' | 'left'

export interface StoredTrajectory {
  id: number
  positions: Vector3[]
  color: string
  label: string
  flightTimeSec: number
  spinRate: number
  spinAxis: number
  pitchType: string
}

export interface CsvPitch {
  pitchType: string
  speedKmh: number
  spinRate: number
  spinAxis: number
  releasePosX: number
  releasePosZ: number
  releaseExtension: number
  activeSpin: number
  vx0?: number
  vy0?: number
  vz0?: number
  // Statcast追加フィールド
  pThrows?: 'R' | 'L'   // p_throws: 投手利き腕
  stand?:   'R' | 'L'   // stand: 打席
  szTop?:   number       // sz_top: ストライクゾーン上端 (ft)
  szBot?:   number       // sz_bot: ストライクゾーン下端 (ft)
}

// リスト表示用 (ゾーン付き)
export interface CsvListEntry {
  i: number
  cp: CsvPitch
  pitchType: string
  zone: number   // 1-9 = ストライク, 11=高め, 12=低め, 13=内角, 14=外角
  color: string
}
