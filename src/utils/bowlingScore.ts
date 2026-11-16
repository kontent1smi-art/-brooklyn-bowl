import { FrameData } from '../types/bowling';

export function createEmptyFrames(totalFrames: number): FrameData[] {
  return Array.from({ length: totalFrames }, () => ({
    rolls: [],
    isComplete: false,
    cumulativeScore: null,
  }));
}

export function isFrameComplete(rolls: number[], isFinalFrame: boolean): boolean {
  if (!isFinalFrame) {
    if (rolls.length === 0) return false;
    if (rolls[0] === 10) return true;
    return rolls.length >= 2;
  }

  if (rolls.length < 2) return false;
  if (rolls.length === 2) {
    const first = rolls[0];
    const second = rolls[1];
    // Strike or spare in first two rolls grants a 3rd bonus roll
    if (first === 10 || first + second === 10) {
      return false;
    }
    return true;
  }
  return rolls.length >= 3;
}

export function shouldResetPinsAfterRoll(
  rollsInCurrentFrame: number[],
  isFinalFrame: boolean
): boolean {
  if (!isFinalFrame) {
    // Frame ends on strike or 2nd roll, so if frame is complete pins reset for next frame
    return isFrameComplete(rollsInCurrentFrame, false);
  }

  // Final frame:
  if (rollsInCurrentFrame.length === 1) {
    return rollsInCurrentFrame[0] === 10;
  }
  if (rollsInCurrentFrame.length === 2) {
    const [r1, r2] = rollsInCurrentFrame;
    if (r1 === 10 && r2 === 10) return true;
    if (r1 < 10 && r1 + r2 === 10) return true;
    return isFrameComplete(rollsInCurrentFrame, true);
  }
  return true;
}

export function recalculateScores(frames: FrameData[]): FrameData[] {
  const totalFrames = frames.length;
  const flatRolls: number[] = [];
  const frameStartIndex: number[] = [];

  for (let i = 0; i < totalFrames; i++) {
    frameStartIndex.push(flatRolls.length);
    for (const r of frames[i].rolls) {
      flatRolls.push(r);
    }
  }

  let runningTotal = 0;
  let scoreBroken = false;

  return frames.map((frame, i) => {
    const isFinal = i === totalFrames - 1;
    const complete = isFrameComplete(frame.rolls, isFinal);
    const startIdx = frameStartIndex[i];

    if (scoreBroken || !complete) {
      scoreBroken = true;
      return { ...frame, isComplete: complete, cumulativeScore: null };
    }

    if (!isFinal) {
      const r1 = frame.rolls[0];
      if (r1 === 10) {
        // Strike needs 2 subsequent rolls
        if (startIdx + 2 < flatRolls.length) {
          runningTotal += 10 + flatRolls[startIdx + 1] + flatRolls[startIdx + 2];
          return { ...frame, isComplete: complete, cumulativeScore: runningTotal };
        }
        scoreBroken = true;
        return { ...frame, isComplete: complete, cumulativeScore: null };
      }

      const r2 = frame.rolls[1] ?? 0;
      if (r1 + r2 === 10) {
        // Spare needs 1 subsequent roll
        if (startIdx + 2 < flatRolls.length) {
          runningTotal += 10 + flatRolls[startIdx + 2];
          return { ...frame, isComplete: complete, cumulativeScore: runningTotal };
        }
        scoreBroken = true;
        return { ...frame, isComplete: complete, cumulativeScore: null };
      }

      runningTotal += r1 + r2;
      return { ...frame, isComplete: complete, cumulativeScore: runningTotal };
    } else {
      // Final frame
      const frameSum = frame.rolls.reduce((acc, v) => acc + v, 0);
      runningTotal += frameSum;
      return { ...frame, isComplete: complete, cumulativeScore: runningTotal };
    }
  });
}

export function formatRollSymbol(
  frameRolls: number[],
  rollIndex: number,
  isFinalFrame: boolean
): string {
  if (rollIndex >= frameRolls.length) return '';
  const val = frameRolls[rollIndex];

  if (!isFinalFrame) {
    if (rollIndex === 0) {
      if (val === 10) return 'X';
      if (val === 0) return '-';
      return String(val);
    }
    const prev = frameRolls[0];
    if (prev + val === 10) return '/';
    if (val === 0) return '-';
    return String(val);
  }

  // Final frame formatting
  if (rollIndex === 0) {
    if (val === 10) return 'X';
    if (val === 0) return '-';
    return String(val);
  }
  if (rollIndex === 1) {
    const r0 = frameRolls[0];
    if (r0 === 10) {
      if (val === 10) return 'X';
      if (val === 0) return '-';
      return String(val);
    }
    if (r0 + val === 10) return '/';
    if (val === 0) return '-';
    return String(val);
  }
  // rollIndex === 2
  const r0 = frameRolls[0];
  const r1 = frameRolls[1];
  if (r0 === 10 && r1 < 10 && r1 + val === 10) return '/';
  if (val === 10 && (r1 === 10 || r0 + r1 === 10)) return 'X';
  if (val === 0) return '-';
  return String(val);
}

export function countGameHighlights(frames: FrameData[]): {
  strikes: number;
  spares: number;
  totalScore: number;
} {
  let strikes = 0;
  let spares = 0;
  const totalFrames = frames.length;

  frames.forEach((f, idx) => {
    const isFinal = idx === totalFrames - 1;
    if (!isFinal) {
      if (f.rolls[0] === 10) strikes++;
      else if (f.rolls.length >= 2 && f.rolls[0] + f.rolls[1] === 10) spares++;
    } else {
      f.rolls.forEach((r, rIdx) => {
        const sym = formatRollSymbol(f.rolls, rIdx, true);
        if (sym === 'X') strikes++;
        else if (sym === '/') spares++;
      });
    }
  });

  const lastCompleted = [...frames]
    .reverse()
    .find((f) => f.cumulativeScore !== null);

  return {
    strikes,
    spares,
    totalScore: lastCompleted?.cumulativeScore ?? 0,
  };
}
