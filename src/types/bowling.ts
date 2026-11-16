export type GamePhase =
  | 'AIMING'
  | 'CHARGING'
  | 'ROLLING'
  | 'PIN_SETTLE'
  | 'SWEEPING'
  | 'GAME_OVER';

export type BallStyleId = 'crimson' | 'obsidian' | 'amber';

export interface BallStyle {
  id: BallStyleId;
  name: string;
  primaryColor: string;
  highlightColor: string;
  stripeColor: string;
}

export interface PinState {
  id: number; // 1..10
  row: number; // 0..3 (row 0 = headpin #1)
  // Normalized deck coordinates: x in [-1, 1], z in [0, 1] inside pin deck
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  angularVel: number;
  standing: boolean;
  knockedThisThrow: boolean;
  opacity: number;
}

export interface FrameData {
  rolls: number[];
  isComplete: boolean;
  cumulativeScore: number | null;
}

export interface HighScoreEntry {
  id: string;
  score: number;
  frames: number;
  strikes: number;
  spares: number;
  date: string;
}

export interface ThrowOutcome {
  pinsKnocked: number;
  isStrike: boolean;
  isSpare: boolean;
  isGutter: boolean;
  label: string;
}
