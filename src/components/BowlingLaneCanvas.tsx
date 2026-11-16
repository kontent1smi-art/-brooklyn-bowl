import React, { useEffect, useRef } from 'react';
import { BallStyle, GamePhase, PinState, ThrowOutcome } from '../types/bowling';

interface BowlingLaneCanvasProps {
  phase: GamePhase;
  aim: number; // -1..1
  onAimChange: (newAim: number) => void;
  power: number; // 0..1
  ballStyle: BallStyle;
  pins: PinState[];
  setPins: React.Dispatch<React.SetStateAction<PinState[]>>;
  throwRequestNonce: number;
  throwPower: number;
  lastOutcome: ThrowOutcome | null;
  onThrowComplete: (knockedCount: number, isGutter: boolean) => void;
  onRollImpact: (pinsHit: number) => void;
  onGutter: () => void;
}

interface BallRuntime {
  active: boolean;
  x: number; // -1.2 .. 1.2 (lane width is -1..1)
  z: number; // 0 (foul line) .. 1.08 (back of pin deck)
  vx: number;
  vz: number;
  spinAngle: number;
  inGutter: boolean;
  gutterSide: -1 | 1;
  trail: Array<{ x: number; z: number }>;
}

const LOGICAL_W = 780;
const LOGICAL_H = 510;

// Perspective projection constants
const Y_TOP = 108; // Pin deck back line
const Y_FOUL = 426; // Foul line
const Y_BOTTOM = 510;
const HALF_W_TOP = 112;
const HALF_W_FOUL = 228;

function project(xNorm: number, zNorm: number) {
  // Non-linear z mapping for authentic bowling lane foreshortening
  // zNorm: 0 at foul line, 1 at back of pin deck
  const zClamped = Math.max(-0.2, Math.min(1.15, Number.isFinite(zNorm) ? zNorm : 0));
  const xSafe = Number.isFinite(xNorm) ? xNorm : 0;
  const u = 1 - zClamped;
  // Signed power avoids NaN when zNorm > 1 (u < 0)
  const uPow = u >= 0 ? Math.pow(u, 1.38) : -Math.pow(-u, 1.38);
  const p = 1 - uPow;
  const y = Y_FOUL - p * (Y_FOUL - Y_TOP);
  const halfW = Math.max(20, HALF_W_FOUL - p * (HALF_W_FOUL - HALF_W_TOP));
  const scale = halfW / HALF_W_FOUL;
  const cx = LOGICAL_W / 2;
  return {
    x: cx + xSafe * halfW,
    y,
    scale,
    halfW,
  };
}

export function createInitialPins(): PinState[] {
  // Standard 10-pin triangle inside pin deck (z from 0.80 to 0.98)
  const rows: Array<{ z: number; xs: number[] }> = [
    { z: 0.80, xs: [0] }, // #1
    { z: 0.855, xs: [-0.21, 0.21] }, // #2, #3
    { z: 0.91, xs: [-0.42, 0, 0.42] }, // #4, #5, #6
    { z: 0.965, xs: [-0.63, -0.21, 0.21, 0.63] }, // #7, #8, #9, #10
  ];

  const result: PinState[] = [];
  let id = 1;
  rows.forEach((r, rowIdx) => {
    r.xs.forEach((x) => {
      result.push({
        id: id++,
        row: rowIdx,
        homeX: x,
        homeZ: r.z,
        x,
        z: r.z,
        vx: 0,
        vz: 0,
        angle: 0,
        angularVel: 0,
        standing: true,
        knockedThisThrow: false,
        opacity: 1,
      });
    });
  });
  return result;
}

export const BowlingLaneCanvas: React.FC<BowlingLaneCanvasProps> = ({
  phase,
  aim,
  onAimChange,
  power,
  ballStyle,
  pins,
  setPins,
  throwRequestNonce,
  throwPower,
  lastOutcome,
  onThrowComplete,
  onRollImpact,
  onGutter,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pinsRef = useRef<PinState[]>(pins);
  pinsRef.current = pins;

  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const aimRef = useRef<number>(aim);
  aimRef.current = aim;

  const powerRef = useRef<number>(power);
  powerRef.current = power;

  const ballStyleRef = useRef<BallStyle>(ballStyle);
  ballStyleRef.current = ballStyle;

  const lastOutcomeRef = useRef<ThrowOutcome | null>(lastOutcome);
  lastOutcomeRef.current = lastOutcome;

  const ballRef = useRef<BallRuntime>({
    active: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    spinAngle: 0,
    inGutter: false,
    gutterSide: 1,
    trail: [],
  });

  const isDraggingRef = useRef(false);
  const settleTimerRef = useRef<number>(0);
  const sweepProgressRef = useRef<number>(0);
  const impactSoundPlayedRef = useRef<boolean>(false);
  const gutterSoundPlayedRef = useRef<boolean>(false);
  const prevThrowNonceRef = useRef<number>(throwRequestNonce);

  // Launch ball when throwRequestNonce increments
  useEffect(() => {
    if (throwRequestNonce === prevThrowNonceRef.current) return;
    prevThrowNonceRef.current = throwRequestNonce;

    const startX = aimRef.current * 0.56;
    const targetX = aimRef.current * 0.96;
    // Slight organic lane drift/randomness so pin outcomes stay lively
    const randomDrift = (Math.random() - 0.5) * 0.085;
    const speedZ = 0.011 + throwPower * 0.0145; // z units per frame (~60fps)
    const travelFrames = 1.0 / speedZ;
    const vx = (targetX - startX + randomDrift) / travelFrames;

    ballRef.current = {
      active: true,
      x: startX,
      z: -0.04,
      vx,
      vz: speedZ,
      spinAngle: 0,
      inGutter: false,
      gutterSide: 1,
      trail: [],
    };
    settleTimerRef.current = 0;
    impactSoundPlayedRef.current = false;
    gutterSoundPlayedRef.current = false;
  }, [throwRequestNonce, throwPower]);

  // Sweep animation reset
  useEffect(() => {
    if (phase === 'SWEEPING') {
      sweepProgressRef.current = 0;
    }
  }, [phase]);

  // Main animation & physics loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const stepPhysics = (dtScale: number) => {
      const currentPhase = phaseRef.current;
      const ball = ballRef.current;
      const livePins = pinsRef.current;

      if (currentPhase === 'ROLLING' && ball.active) {
        ball.z += ball.vz * dtScale;
        ball.spinAngle += (0.14 + ball.vz * 11) * dtScale;

        if (!ball.inGutter) {
          // Subtle mid-lane hook / oil variance
          const curveBias = Math.sin(ball.z * Math.PI) * 0.00055 * (aimRef.current >= 0 ? -1 : 1);
          ball.x += (ball.vx + curveBias) * dtScale;

          if (Math.abs(ball.x) > 0.94 && ball.z > 0.06) {
            ball.inGutter = true;
            ball.gutterSide = ball.x > 0 ? 1 : -1;
            ball.x = ball.gutterSide * 1.07;
            ball.vx = 0;
            if (!gutterSoundPlayedRef.current) {
              gutterSoundPlayedRef.current = true;
              onGutter();
            }
          }
        } else {
          ball.x = ball.gutterSide * 1.07;
        }

        ball.trail.push({ x: ball.x, z: ball.z });
        if (ball.trail.length > 14) ball.trail.shift();

        // Ball <-> Pin collisions
        if (!ball.inGutter && ball.z >= 0.72 && ball.z <= 1.06) {
          const ballRadiusX = 0.145;
          const ballRadiusZ = 0.045;
          let newlyHit = 0;

          for (let i = 0; i < livePins.length; i++) {
            const p = livePins[i];
            if (!p.standing) continue;

            const dx = p.x - ball.x;
            const dz = p.z - ball.z;
            const normDist = Math.hypot(dx / ballRadiusX, dz / ballRadiusZ);

            if (normDist < 1.12) {
              p.standing = false;
              p.knockedThisThrow = true;
              newlyHit++;

              // Randomized deflection physics scaled by ball velocity
              const powerBoost = 0.7 + ball.vz * 42;
              const scatter = (Math.random() - 0.5) * 0.055;
              p.vx = (dx * 0.24 + ball.vx * 1.4 + scatter) * powerBoost;
              p.vz = (0.015 + Math.random() * 0.014) * powerBoost;
              p.angularVel = (dx >= 0 ? 1 : -1) * (0.14 + Math.random() * 0.22);

              // Ball deflects slightly on impact
              ball.vx += -dx * 0.012;
            }
          }

          if (newlyHit > 0 && !impactSoundPlayedRef.current) {
            impactSoundPlayedRef.current = true;
            onRollImpact(newlyHit);
          }
        }

        // Pin <-> Pin chain collisions (creates organic randomized pin knock cascade)
        let chainHits = 0;
        for (let i = 0; i < livePins.length; i++) {
          const mover = livePins[i];
          if (mover.standing) continue;

          mover.x += mover.vx * dtScale;
          mover.z += mover.vz * dtScale;
          mover.angle += mover.angularVel * dtScale;
          mover.vx *= Math.pow(0.95, dtScale);
          mover.vz *= Math.pow(0.94, dtScale);

          // Bounce off side kickbacks and keep within pit depth
          if (mover.x < -0.92) {
            mover.x = -0.92;
            mover.vx = Math.abs(mover.vx) * 0.65;
          } else if (mover.x > 0.92) {
            mover.x = 0.92;
            mover.vx = -Math.abs(mover.vx) * 0.65;
          }
          if (mover.z > 1.03) {
            mover.z = 1.03;
            mover.vz = 0;
          }

          const speed = Math.hypot(mover.vx, mover.vz * 2.5);
          if (speed < 0.008) continue;

          for (let j = 0; j < livePins.length; j++) {
            if (i === j) continue;
            const target = livePins[j];
            if (!target.standing) continue;

            const dx = target.x - mover.x;
            const dz = target.z - mover.z;
            const dist = Math.hypot(dx / 0.19, dz / 0.052);
            // Randomize threshold slightly so glancing pins sometimes topple, sometimes wobble
            const hitThreshold = 0.92 + Math.random() * 0.26;
            if (dist < hitThreshold) {
              target.standing = false;
              target.knockedThisThrow = true;
              chainHits++;
              const randAngle = (Math.random() - 0.5) * 0.045;
              target.vx = dx * 0.16 + mover.vx * 0.65 + randAngle;
              target.vz = 0.01 + Math.random() * 0.012;
              target.angularVel = (dx >= 0 ? 1 : -1) * (0.12 + Math.random() * 0.2);
            }
          }
        }

        if (chainHits > 0 && !impactSoundPlayedRef.current) {
          impactSoundPlayedRef.current = true;
          onRollImpact(chainHits);
        }

        if (ball.z > 1.07) {
          ball.active = false;
          settleTimerRef.current = 1;
        }
      } else if (currentPhase === 'ROLLING' && !ball.active) {
        // Continue pin tumble for ~45 frames before finalizing throw
        let extraHits = 0;
        for (let i = 0; i < livePins.length; i++) {
          const p = livePins[i];
          if (!p.standing) {
            p.x += p.vx * dtScale;
            p.z += p.vz * dtScale;
            p.angle += p.angularVel * dtScale;
            p.vx *= Math.pow(0.93, dtScale);
            p.vz *= Math.pow(0.92, dtScale);
            p.angularVel *= Math.pow(0.95, dtScale);
            if (p.z > 1.03) {
              p.z = 1.03;
              p.vz = 0;
            }

            const speed = Math.hypot(p.vx, p.vz * 2.5);
            if (speed > 0.008) {
              for (let j = 0; j < livePins.length; j++) {
                if (i === j) continue;
                const t = livePins[j];
                if (!t.standing) continue;
                const dx = t.x - p.x;
                const dz = t.z - p.z;
                const dist = Math.hypot(dx / 0.18, dz / 0.05);
                if (dist < 0.98) {
                  t.standing = false;
                  t.knockedThisThrow = true;
                  extraHits++;
                  t.vx = dx * 0.14 + p.vx * 0.55 + (Math.random() - 0.5) * 0.03;
                  t.vz = 0.008 + Math.random() * 0.01;
                  t.angularVel = (dx >= 0 ? 1 : -1) * (0.12 + Math.random() * 0.16);
                }
              }
            }
          }
        }
        if (extraHits > 0) {
          onRollImpact(extraHits);
        }

        settleTimerRef.current += dtScale;
        if (settleTimerRef.current > 46) {
          const knockedCount = livePins.filter((p) => p.knockedThisThrow).length;
          setPins(livePins.map((p) => ({ ...p })));
          onThrowComplete(knockedCount, ball.inGutter);
        }
      } else if (currentPhase === 'SWEEPING') {
        sweepProgressRef.current = Math.min(1, sweepProgressRef.current + 0.038 * dtScale);
      }
    };

    const drawScene = (ctx: CanvasRenderingContext2D) => {
      const currentPhase = phaseRef.current;
      const livePins = pinsRef.current;
      const ball = ballRef.current;
      const cx = LOGICAL_W / 2;

      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // 1. Industrial loft dark backdrop behind alley
      const bgGrad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
      bgGrad.addColorStop(0, '#09090D');
      bgGrad.addColorStop(0.35, '#111117');
      bgGrad.addColorStop(1, '#0B0B10');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Subtle architectural brick/loft columns on left and right
      ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
      for (let row = 0; row < 12; row++) {
        const y = row * 44;
        ctx.fillRect(0, y, LOGICAL_W, 1);
      }

      // Warm stage spotlight cone over the pins
      const spotGrad = ctx.createRadialGradient(cx, Y_TOP + 30, 10, cx, Y_TOP + 35, 210);
      spotGrad.addColorStop(0, 'rgba(255, 176, 32, 0.22)');
      spotGrad.addColorStop(0.5, 'rgba(229, 43, 43, 0.08)');
      spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(cx - 240, 20, 480, 260);

      // 2. Pin Deck Dark Pit Back Wall
      const pTopL = project(-1.2, 1.05);
      const pTopR = project(1.2, 1.05);
      const pBotL = project(-1.2, -0.2);
      const pBotR = project(1.2, -0.2);

      // Outer gutters & dark channel rails
      ctx.beginPath();
      ctx.moveTo(pTopL.x, pTopL.y);
      ctx.lineTo(pTopR.x, pTopR.y);
      ctx.lineTo(pBotR.x, pBotR.y);
      ctx.lineTo(pBotL.x, pBotL.y);
      ctx.closePath();
      ctx.fillStyle = '#07070A';
      ctx.fill();

      // Gutter inner highlight rails
      const gTopL = project(-0.98, 1.04);
      const gTopR = project(0.98, 1.04);
      const gBotL = project(-0.98, -0.18);
      const gBotR = project(0.98, -0.18);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pTopL.x, pTopL.y);
      ctx.lineTo(pBotL.x, pBotL.y);
      ctx.moveTo(pTopR.x, pTopR.y);
      ctx.lineTo(pBotR.x, pBotR.y);
      ctx.stroke();

      // 3. Maple Wood Bowling Lane Surface
      const laneGrad = ctx.createLinearGradient(0, Y_TOP, 0, Y_BOTTOM);
      laneGrad.addColorStop(0, '#A56A33');
      laneGrad.addColorStop(0.28, '#C98A49');
      laneGrad.addColorStop(0.75, '#DE9F5C');
      laneGrad.addColorStop(1, '#B8783A');

      ctx.beginPath();
      ctx.moveTo(gTopL.x, gTopL.y);
      ctx.lineTo(gTopR.x, gTopR.y);
      ctx.lineTo(gBotR.x, gBotR.y);
      ctx.lineTo(gBotL.x, gBotL.y);
      ctx.closePath();
      ctx.fillStyle = laneGrad;
      ctx.fill();

      // Wood plank converging lines (16 planks across lane)
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(72, 36, 10, 0.22)';
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i++) {
        const xn = i / 8.2;
        const t = project(xn, 1.04);
        const b = project(xn, -0.18);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Oil sheen reflection down center of lane
      const sheenGrad = ctx.createLinearGradient(cx - 120, Y_TOP, cx + 120, Y_FOUL);
      sheenGrad.addColorStop(0, 'rgba(255, 245, 220, 0.05)');
      sheenGrad.addColorStop(0.5, 'rgba(255, 240, 200, 0.16)');
      sheenGrad.addColorStop(1, 'rgba(255, 245, 220, 0.02)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(cx - 240, Y_TOP, 480, Y_BOTTOM - Y_TOP);

      // Pin deck darker maple apron (z >= 0.74)
      const deckTL = project(-0.98, 1.04);
      const deckTR = project(0.98, 1.04);
      const deckBL = project(-0.98, 0.74);
      const deckBR = project(0.98, 0.74);
      ctx.beginPath();
      ctx.moveTo(deckTL.x, deckTL.y);
      ctx.lineTo(deckTR.x, deckTR.y);
      ctx.lineTo(deckBR.x, deckBR.y);
      ctx.lineTo(deckBL.x, deckBL.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(30, 14, 4, 0.18)';
      ctx.fill();

      // 7 Targeting Chevron Arrows (at z = 0.26)
      const arrowXs = [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6];
      arrowXs.forEach((ax, idx) => {
        const tip = project(ax, 0.285);
        const left = project(ax - 0.036, 0.245);
        const right = project(ax + 0.036, 0.245);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(right.x, right.y);
        ctx.strokeStyle = idx === 3 ? '#E52B2B' : 'rgba(55, 26, 8, 0.65)';
        ctx.lineWidth = idx === 3 ? 2.5 : 1.8;
        ctx.stroke();
      });

      // Rangefinder approach dots (at z = 0.05)
      arrowXs.forEach((ax) => {
        const pt = project(ax, 0.045);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(48, 22, 6, 0.6)';
        ctx.fill();
      });

      // Foul Line (z = 0)
      const foulL = project(-0.98, 0);
      const foulR = project(0.98, 0);
      ctx.beginPath();
      ctx.moveTo(foulL.x, foulL.y);
      ctx.lineTo(foulR.x, foulR.y);
      ctx.strokeStyle = '#18100B';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(foulL.x, foulL.y - 2);
      ctx.lineTo(foulR.x, foulR.y - 2);
      ctx.strokeStyle = '#E52B2B';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      // Neon red side rail trim (Brooklyn Bowl club glow)
      ctx.strokeStyle = 'rgba(229, 43, 43, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gTopL.x, gTopL.y);
      ctx.lineTo(gBotL.x, gBotL.y);
      ctx.moveTo(gTopR.x, gTopR.y);
      ctx.lineTo(gBotR.x, gBotR.y);
      ctx.stroke();

      // 4. Overhead Brooklyn Bowl Masking Unit (Back Wall Marquee)
      const mL = gTopL.x - 18;
      const mR = gTopR.x + 18;
      const mW = mR - mL;
      ctx.fillStyle = '#15151C';
      ctx.fillRect(mL, 20, mW, 88);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mL, 20, mW, 88);

      // Red accent bar across marquee
      ctx.fillStyle = '#E52B2B';
      ctx.fillRect(mL, 20, mW, 5);

      ctx.fillStyle = '#F5F2EB';
      ctx.font = '700 20px "Oswald", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BROOKLYN BOWL', cx, 55);

      ctx.fillStyle = '#FFB020';
      ctx.font = '600 10px "Manrope", sans-serif';
      ctx.fillText('КЕГЛИ  ·  КУХНЯ  ·  РОК-Н-РОЛЛ', cx, 75);

      // Lane pit opening shadow below marquee
      ctx.fillStyle = '#07070A';
      ctx.fillRect(gTopL.x - 6, 86, gTopR.x - gTopL.x + 12, 24);

      // 5. Aiming Sightline (when AIMING or CHARGING)
      if (currentPhase === 'AIMING' || currentPhase === 'CHARGING') {
        const startX = aimRef.current * 0.56;
        const targetX = aimRef.current * 0.96;
        const pStart = project(startX, -0.02);
        const pEnd = project(targetX, 0.95);

        ctx.save();
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.lineTo(pEnd.x, pEnd.y);
        ctx.strokeStyle =
          currentPhase === 'CHARGING'
            ? 'rgba(255, 176, 32, 0.85)'
            : 'rgba(245, 242, 235, 0.68)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // Target reticle at pin deck
        ctx.beginPath();
        ctx.arc(pEnd.x, pEnd.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = currentPhase === 'CHARGING' ? '#FFB020' : '#E52B2B';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 6. Draw Pins (back-to-front by z so closer pins overlap back pins)
      const sortedPins = [...livePins].sort((a, b) => b.z - a.z);
      sortedPins.forEach((pin) => {
        if (pin.opacity <= 0.02) return;
        const pt = project(pin.x, pin.z);
        const h = 46 * pt.scale;
        const w = 15 * pt.scale;

        ctx.save();
        ctx.globalAlpha = pin.opacity;
        ctx.translate(pt.x, pt.y);

        // Shadow on lane
        ctx.beginPath();
        ctx.ellipse(0, 2, w * 0.65, w * 0.25, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
        ctx.fill();

        // Rotate fallen pin
        if (!pin.standing) {
          ctx.rotate(pin.angle);
        }

        // Pin silhouette
        ctx.beginPath();
        ctx.moveTo(-w * 0.42, 0);
        ctx.bezierCurveTo(-w * 0.62, -h * 0.35, -w * 0.24, -h * 0.64, -w * 0.22, -h * 0.78);
        ctx.bezierCurveTo(-w * 0.24, -h * 0.94, -w * 0.16, -h, 0, -h);
        ctx.bezierCurveTo(w * 0.16, -h, w * 0.24, -h * 0.94, w * 0.22, -h * 0.78);
        ctx.bezierCurveTo(w * 0.24, -h * 0.64, w * 0.62, -h * 0.35, w * 0.42, 0);
        ctx.closePath();

        const pinGrad = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
        pinGrad.addColorStop(0, '#DCD6CA');
        pinGrad.addColorStop(0.45, '#FFFFFF');
        pinGrad.addColorStop(1, '#BFB8AA');
        ctx.fillStyle = pinGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(20, 16, 12, 0.45)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Twin Brooklyn Bowl red neck stripes
        ctx.fillStyle = '#E52B2B';
        ctx.fillRect(-w * 0.21, -h * 0.77, w * 0.42, h * 0.065);
        ctx.fillRect(-w * 0.22, -h * 0.67, w * 0.44, h * 0.055);

        ctx.restore();
      });

      // 7. Pinsetter Sweep Bar during SWEEPING
      if (currentPhase === 'SWEEPING') {
        const prog = sweepProgressRef.current;
        const barY = Y_TOP + Math.sin(prog * Math.PI) * 58;
        const barLeft = gTopL.x - 4;
        const barRight = gTopR.x + 4;
        ctx.fillStyle = '#1E1E26';
        ctx.fillRect(barLeft, barY - 6, barRight - barLeft, 12);
        ctx.fillStyle = '#E52B2B';
        ctx.fillRect(barLeft, barY + 4, barRight - barLeft, 2);
      }

      // 8. Draw Bowling Ball
      const style = ballStyleRef.current;
      let drawBallX = aimRef.current * 0.56;
      let drawBallZ = -0.04;
      let spin = 0;

      if (currentPhase === 'ROLLING' && (ball.active || ball.z > 0)) {
        drawBallX = ball.x;
        drawBallZ = ball.z;
        spin = ball.spinAngle;

        // Subtle speed trail
        if (ball.trail.length > 1) {
          for (let i = 0; i < ball.trail.length - 1; i++) {
            const tp = project(ball.trail[i].x, ball.trail[i].z);
            const alpha = ((i + 1) / ball.trail.length) * 0.22;
            const tr = 24 * tp.scale * ((i + 1) / ball.trail.length);
            ctx.beginPath();
            ctx.arc(tp.x, tp.y - tr * 0.5, tr, 0, Math.PI * 2);
            ctx.fillStyle = style.primaryColor;
            ctx.globalAlpha = alpha;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }

      if (currentPhase !== 'SWEEPING' && currentPhase !== 'GAME_OVER') {
        const bp = project(drawBallX, drawBallZ);
        const radius = 25 * bp.scale;

        // Charging energy ring around ball
        if (currentPhase === 'CHARGING') {
          const pwr = powerRef.current;
          ctx.beginPath();
          ctx.arc(bp.x, bp.y - radius * 0.65, radius + 7 + pwr * 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pwr);
          ctx.strokeStyle = pwr > 0.78 ? '#E52B2B' : '#FFB020';
          ctx.lineWidth = 4;
          ctx.stroke();
        }

        // Ball drop shadow
        ctx.beginPath();
        ctx.ellipse(bp.x, bp.y + 3, radius * 0.92, radius * 0.34, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        ctx.fill();

        // Ball sphere
        const bCy = bp.y - radius * 0.65;
        const sphereGrad = ctx.createRadialGradient(
          bp.x - radius * 0.3,
          bCy - radius * 0.35,
          radius * 0.12,
          bp.x,
          bCy,
          radius
        );
        sphereGrad.addColorStop(0, style.highlightColor);
        sphereGrad.addColorStop(0.55, style.primaryColor);
        sphereGrad.addColorStop(1, '#08080B');

        ctx.beginPath();
        ctx.arc(bp.x, bCy, radius, 0, Math.PI * 2);
        ctx.fillStyle = sphereGrad;
        ctx.fill();

        // Rotating finger holes / emblem stripe to show spin
        ctx.save();
        ctx.translate(bp.x, bCy);
        ctx.rotate(spin);
        ctx.fillStyle = 'rgba(10, 10, 14, 0.75)';
        ctx.beginPath();
        ctx.arc(-radius * 0.22, -radius * 0.28, radius * 0.12, 0, Math.PI * 2);
        ctx.arc(radius * 0.18, -radius * 0.32, radius * 0.12, 0, Math.PI * 2);
        ctx.arc(0, -radius * 0.05, radius * 0.13, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = style.stripeColor;
        ctx.lineWidth = Math.max(1.5, radius * 0.1);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.72, 0.3, 1.4);
        ctx.stroke();
        ctx.restore();
      }

      // 9. Outcome Callout Banner inside top marquee/lane area when settling
      const outcome = lastOutcomeRef.current;
      if (outcome && (currentPhase === 'PIN_SETTLE' || currentPhase === 'SWEEPING')) {
        ctx.save();
        const bannerW = 240;
        const bannerH = 44;
        const bx = cx - bannerW / 2;
        const by = 132;
        ctx.fillStyle = 'rgba(14, 14, 19, 0.92)';
        ctx.strokeStyle = outcome.isStrike
          ? '#FFB020'
          : outcome.isSpare
          ? '#E52B2B'
          : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, bannerW, bannerH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = outcome.isStrike
          ? '#FFB020'
          : outcome.isSpare
          ? '#E52B2B'
          : '#F5F2EB';
        ctx.font = '700 22px "Oswald", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(outcome.label, cx, by + bannerH / 2 + 1);
        ctx.restore();
      }
    };

    const tick = (now: number) => {
      const dtMs = Math.min(36, now - lastTime);
      lastTime = now;
      const dtScale = dtMs / 16.6667;

      stepPhysics(dtScale);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const targetW = LOGICAL_W * dpr;
          const targetH = LOGICAL_H * dpr;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          ctx.save();
          ctx.scale(dpr, dpr);
          drawScene(ctx);
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [onGutter, onRollImpact, onThrowComplete, setPins]);

  const updateAimFromClientX = (clientX: number) => {
    if (phaseRef.current !== 'AIMING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = (clientX - rect.left) / rect.width; // 0..1
    // Map middle 62% of canvas width to -1..1 aim range
    const centered = (relX - 0.5) / 0.31;
    const clamped = Math.max(-1, Math.min(1, centered));
    onAimChange(clamped);
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0B10]">
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (phase !== 'AIMING') return;
          isDraggingRef.current = true;
          updateAimFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (phase !== 'AIMING') return;
          if (e.pointerType === 'mouse' || isDraggingRef.current) {
            updateAimFromClientX(e.clientX);
          }
        }}
        onPointerUp={() => {
          isDraggingRef.current = false;
        }}
        onPointerLeave={() => {
          isDraggingRef.current = false;
        }}
        className="block w-full h-auto aspect-[780/510] cursor-crosshair touch-pan-y select-none"
        aria-label="Игровая дорожка для боулинга"
      />
    </div>
  );
};
