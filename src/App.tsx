import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BowlingLaneCanvas,
  createInitialPins,
} from './components/BowlingLaneCanvas';
import {
  GameOverModal,
  LeaderboardModal,
  RulesModal,
} from './components/Modals';
import { Scoreboard } from './components/Scoreboard';
import {
  BallStyle,
  FrameData,
  GamePhase,
  HighScoreEntry,
  PinState,
  ThrowOutcome,
} from './types/bowling';
import {
  countGameHighlights,
  createEmptyFrames,
  isFrameComplete,
  recalculateScores,
  shouldResetPinsAfterRoll,
} from './utils/bowlingScore';
import { soundEngine } from './utils/sound';

const BALL_STYLES: BallStyle[] = [
  {
    id: 'crimson',
    name: 'Рубин',
    primaryColor: '#D92626',
    highlightColor: '#FF7070',
    stripeColor: '#FFB020',
  },
  {
    id: 'obsidian',
    name: 'Обсидиан',
    primaryColor: '#252632',
    highlightColor: '#6C708A',
    stripeColor: '#E52B2B',
  },
  {
    id: 'amber',
    name: 'Янтарь',
    primaryColor: '#D98A16',
    highlightColor: '#FFD670',
    stripeColor: '#14141A',
  },
];

const STORAGE_KEY = 'brooklyn_bowl_records_v1';

function loadRecords(): HighScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [totalFrames, setTotalFrames] = useState<5 | 10>(10);
  const [frames, setFrames] = useState<FrameData[]>(() => createEmptyFrames(10));
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [phase, setPhase] = useState<GamePhase>('AIMING');
  const [aim, setAim] = useState<number>(0);
  const [power, setPower] = useState<number>(0.65);
  const [throwPower, setThrowPower] = useState<number>(0.65);
  const [throwRequestNonce, setThrowRequestNonce] = useState<number>(0);
  const [pins, setPins] = useState<PinState[]>(() => createInitialPins());
  const [ballStyle, setBallStyle] = useState<BallStyle>(BALL_STYLES[0]);
  const [lastOutcome, setLastOutcome] = useState<ThrowOutcome | null>(null);
  const [muted, setMuted] = useState<boolean>(false);

  const [rulesOpen, setRulesOpen] = useState<boolean>(false);
  const [recordsOpen, setRecordsOpen] = useState<boolean>(false);
  const [records, setRecords] = useState<HighScoreEntry[]>(() => loadRecords());
  const [isNewBest, setIsNewBest] = useState<boolean>(false);

  const chargePowerRef = useRef<number>(0.2);
  const chargeDirRef = useRef<1 | -1>(1);
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const timersRef = useRef<number[]>([]);

  const clearScheduledTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearScheduledTimers();
  }, [clearScheduledTimers]);

  const startNewGame = useCallback(
    (frameCount: 5 | 10 = totalFrames) => {
      clearScheduledTimers();
      soundEngine.stopRollSound();
      setTotalFrames(frameCount);
      setFrames(createEmptyFrames(frameCount));
      setCurrentFrameIndex(0);
      setPhase('AIMING');
      setAim(0);
      setPower(0.65);
      setPins(createInitialPins());
      setLastOutcome(null);
      setIsNewBest(false);
    },
    [clearScheduledTimers, totalFrames]
  );

  // Power oscillation while CHARGING
  useEffect(() => {
    if (phase !== 'CHARGING') return;

    chargePowerRef.current = 0.18;
    chargeDirRef.current = 1;
    setPower(0.18);

    let rafId = 0;
    let lastTime = performance.now();
    let tickAccumulator = 0;

    const animateCharge = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const speed = 1.48; // full sweep ~0.58s
      let next = chargePowerRef.current + chargeDirRef.current * speed * dt;
      if (next >= 1) {
        next = 1;
        chargeDirRef.current = -1;
      } else if (next <= 0.15) {
        next = 0.15;
        chargeDirRef.current = 1;
      }
      chargePowerRef.current = next;
      setPower(next);

      tickAccumulator += dt;
      if (tickAccumulator >= 0.09) {
        tickAccumulator = 0;
        soundEngine.playChargeTick(next);
      }

      rafId = requestAnimationFrame(animateCharge);
    };

    rafId = requestAnimationFrame(animateCharge);
    return () => cancelAnimationFrame(rafId);
  }, [phase]);

  const beginCharge = useCallback(() => {
    if (phaseRef.current !== 'AIMING') return;
    setLastOutcome(null);
    setPhase('CHARGING');
  }, []);

  const releaseThrow = useCallback(() => {
    if (phaseRef.current !== 'CHARGING') return;
    const finalPower = Math.max(0.15, Math.min(1, chargePowerRef.current));
    setThrowPower(finalPower);
    setPower(finalPower);
    setPhase('ROLLING');
    setThrowRequestNonce((n) => n + 1);
    soundEngine.startRollSound(finalPower);
  }, []);

  // Global pointerup fallback if user releases pointer outside the throw button
  useEffect(() => {
    if (phase !== 'CHARGING') return;
    const handleGlobalPointerUp = () => {
      releaseThrow();
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerUp);
    };
  }, [phase, releaseThrow]);

  // Keyboard controls: Left/Right arrows to aim, Spacebar to hold & release
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (rulesOpen || recordsOpen) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        if (phaseRef.current === 'AIMING') {
          e.preventDefault();
          setAim((prev) => Math.max(-1, Number((prev - 0.08).toFixed(2))));
        }
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        if (phaseRef.current === 'AIMING') {
          e.preventDefault();
          setAim((prev) => Math.min(1, Number((prev + 0.08).toFixed(2))));
        }
      } else if (e.code === 'Space') {
        if (e.repeat) return;
        if (phaseRef.current === 'AIMING') {
          e.preventDefault();
          beginCharge();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && phaseRef.current === 'CHARGING') {
        e.preventDefault();
        releaseThrow();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [beginCharge, recordsOpen, releaseThrow, rulesOpen]);

  const handleRollImpact = useCallback((pinsHit: number) => {
    soundEngine.playPinImpact(pinsHit);
  }, []);

  const handleGutter = useCallback(() => {
    soundEngine.stopRollSound();
    soundEngine.playGutterThud();
  }, []);

  const handleThrowComplete = useCallback(
    (knockedCount: number, isGutter: boolean) => {
      soundEngine.stopRollSound();

      const updatedFrames = frames.map((f, idx) =>
        idx === currentFrameIndex
          ? { ...f, rolls: [...f.rolls, knockedCount] }
          : f
      );
      const scoredFrames = recalculateScores(updatedFrames);
      const currentFrame = scoredFrames[currentFrameIndex];
      const isFinalFrame = currentFrameIndex === totalFrames - 1;
      const rollIdx = currentFrame.rolls.length - 1;

      const isStrike =
        (!isFinalFrame && rollIdx === 0 && knockedCount === 10) ||
        (isFinalFrame &&
          ((rollIdx === 0 && knockedCount === 10) ||
            (rollIdx === 1 && currentFrame.rolls[0] === 10 && knockedCount === 10) ||
            (rollIdx === 2 &&
              (currentFrame.rolls[1] === 10 ||
                currentFrame.rolls[0] + currentFrame.rolls[1] === 10) &&
              knockedCount === 10)));

      const isSpare =
        !isStrike &&
        ((!isFinalFrame &&
          rollIdx === 1 &&
          currentFrame.rolls[0] + knockedCount === 10) ||
          (isFinalFrame &&
            ((rollIdx === 1 &&
              currentFrame.rolls[0] < 10 &&
              currentFrame.rolls[0] + knockedCount === 10) ||
              (rollIdx === 2 &&
                currentFrame.rolls[0] === 10 &&
                currentFrame.rolls[1] < 10 &&
                currentFrame.rolls[1] + knockedCount === 10))));

      let label = `СБИТО: ${knockedCount}`;
      if (isGutter && knockedCount === 0) {
        label = 'ЖЁЛОБ · 0';
      } else if (isStrike) {
        label = 'СТРАЙК! X';
        soundEngine.playStrikeFanfare();
      } else if (isSpare) {
        label = 'СПЭР! /';
        soundEngine.playSpareChime();
      } else if (knockedCount === 0) {
        label = 'МИМО · 0';
      }

      setFrames(scoredFrames);
      setLastOutcome({
        pinsKnocked: knockedCount,
        isStrike,
        isSpare,
        isGutter,
        label,
      });
      setPhase('PIN_SETTLE');

      const frameComplete = isFrameComplete(currentFrame.rolls, isFinalFrame);
      const needResetRack = shouldResetPinsAfterRoll(
        currentFrame.rolls,
        isFinalFrame
      );
      const gameFinished = isFinalFrame && frameComplete;

      const t1 = window.setTimeout(() => {
        if (gameFinished) {
          const highlights = countGameHighlights(scoredFrames);
          const prevBest = records.reduce(
            (max, r) => Math.max(max, r.score),
            0
          );
          const newEntry: HighScoreEntry = {
            id: `${Date.now()}`,
            score: highlights.totalScore,
            frames: totalFrames,
            strikes: highlights.strikes,
            spares: highlights.spares,
            date: new Date().toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
            }),
          };
          const nextRecords = [newEntry, ...records]
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
          setRecords(nextRecords);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
          } catch {
            // ignore storage quota errors
          }
          setIsNewBest(highlights.totalScore > prevBest && highlights.totalScore > 0);
          setPhase('GAME_OVER');
          return;
        }

        setPhase('SWEEPING');

        const t2 = window.setTimeout(() => {
          if (needResetRack) {
            setPins(createInitialPins());
          } else {
            // Clear fallen pins and keep only standing pins
            setPins((prev) =>
              prev.map((p) =>
                p.standing
                  ? { ...p, knockedThisThrow: false }
                  : { ...p, opacity: 0, knockedThisThrow: false }
              )
            );
          }

          if (frameComplete) {
            setCurrentFrameIndex((idx) => idx + 1);
          }
          setPhase('AIMING');
        }, 540);

        timersRef.current.push(t2);
      }, 1050);

      timersRef.current.push(t1);
    },
    [currentFrameIndex, frames, records, totalFrames]
  );

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  const handleClearRecords = () => {
    setRecords([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const currentFrameRolls = frames[currentFrameIndex]?.rolls ?? [];
  const currentRollNumber = currentFrameRolls.length + 1;
  const standingCount = pins.filter((p) => p.standing).length;
  const powerPercent = Math.round(power * 100);
  const gameHighlights = countGameHighlights(frames);

  return (
    <div className="min-h-screen flex flex-col bg-[#0C0C10] text-[#F5F2EB]">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-white/10 bg-[#111116]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single-element Brand wordmark */}
          <a
            href="#lane"
            className="font-display text-2xl font-bold tracking-wider uppercase text-[#F5F2EB] whitespace-nowrap shrink-0"
          >
            BROOKLYN BOWL
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#B8B3AA]">
            <a
              href="#lane"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Дорожка
            </a>
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Правила
            </button>
            <button
              type="button"
              onClick={() => setRecordsOpen(true)}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Рекорды
            </button>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => startNewGame(totalFrames)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E52B2B] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#cc2222] transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Новая игра
            </button>
          </div>
        </div>
      </header>

      {/* Main Alley Workspace */}
      <main id="lane" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 sm:px-6">
        {/* Overhead Scoreboard */}
        <Scoreboard
          frames={frames}
          currentFrameIndex={currentFrameIndex}
          isGameOver={phase === 'GAME_OVER'}
        />

        {/* Lane + Control Console Split */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] items-stretch">
          {/* Left: 2.5D Perspective Bowling Alley */}
          <div className="flex flex-col justify-between gap-3">
            <BowlingLaneCanvas
              phase={phase}
              aim={aim}
              onAimChange={setAim}
              power={power}
              ballStyle={ballStyle}
              pins={pins}
              setPins={setPins}
              throwRequestNonce={throwRequestNonce}
              throwPower={throwPower}
              lastOutcome={lastOutcome}
              onThrowComplete={handleThrowComplete}
              onRollImpact={handleRollImpact}
              onGutter={handleGutter}
            />

            {/* Quiet 1-line helper strip below lane */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#9A968E]">
              <span>
                Двигайте курсор по дорожке для прицела · Зажмите кнопку броска или Пробел
              </span>
              <div className="flex items-center gap-4 md:hidden">
                <button
                  type="button"
                  onClick={() => setRulesOpen(true)}
                  className="text-[#D5D0C7] underline underline-offset-2"
                >
                  Правила
                </button>
                <button
                  type="button"
                  onClick={() => setRecordsOpen(true)}
                  className="text-[#D5D0C7] underline underline-offset-2"
                >
                  Рекорды
                </button>
              </div>
            </div>
          </div>

          {/* Right: Tactile Alley Control Console */}
          <aside className="flex flex-col justify-between rounded-xl border border-white/10 bg-[#14141A] p-5">
            <div className="space-y-5">
              {/* Frame & Pins metadata (clean unboxed text) */}
              <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
                <div>
                  <div className="font-display text-lg font-bold uppercase tracking-wide text-[#F5F2EB]">
                    Фрейм {currentFrameIndex + 1} из {totalFrames}
                  </div>
                  <div className="mt-0.5 text-xs text-[#9A968E] tabular-nums">
                    Бросок {currentRollNumber} · На дорожке кеглей: {standingCount}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-lg border border-white/10 bg-[#1B1B22] p-2.5 text-[#D5D0C7] hover:bg-[#23232C] hover:text-white transition-colors"
                  aria-label={muted ? 'Включить звук' : 'Выключить звук'}
                  title={muted ? 'Включить звук' : 'Выключить звук'}
                >
                  {muted ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Aim Control */}
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-[#D5D0C7]">
                  <span>1. Наведение шара</span>
                  <span className="font-mono tabular-nums text-[#9A968E]">
                    {aim === 0
                      ? 'Центр'
                      : `${aim > 0 ? '+' : ''}${Math.round(aim * 100)}%`}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={phase !== 'AIMING'}
                    onClick={() =>
                      setAim((prev) => Math.max(-1, Number((prev - 0.12).toFixed(2))))
                    }
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1B22] text-[#F5F2EB] hover:bg-[#25252F] disabled:opacity-40 transition-colors"
                    aria-label="Сместить прицел влево"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={aim}
                    disabled={phase !== 'AIMING'}
                    onChange={(e) => setAim(parseFloat(e.target.value))}
                    aria-label="Позиция прицела на дорожке"
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-[#24242E] accent-[#E52B2B] disabled:opacity-50"
                  />

                  <button
                    type="button"
                    disabled={phase !== 'AIMING'}
                    onClick={() =>
                      setAim((prev) => Math.min(1, Number((prev + 0.12).toFixed(2))))
                    }
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1B22] text-[#F5F2EB] hover:bg-[#25252F] disabled:opacity-40 transition-colors"
                    aria-label="Сместить прицел вправо"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Power Gauge */}
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-[#D5D0C7]">
                  <span>2. Сила броска</span>
                  <span className="font-mono font-bold tabular-nums text-[#FFB020]">
                    {powerPercent}%
                  </span>
                </div>

                <div className="relative mt-2.5 h-5 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0C0C10]">
                  {/* Sweet spot marker (75% - 95%) */}
                  <div
                    className="absolute inset-y-0 border-x border-[#FFB020]/40 bg-[#FFB020]/10"
                    style={{ left: '75%', width: '20%' }}
                  />
                  {/* Active fill bar */}
                  <div
                    className="h-full transition-[width] duration-75"
                    style={{
                      width: `${powerPercent}%`,
                      background:
                        power > 0.78
                          ? 'linear-gradient(90deg, #FFB020 0%, #E52B2B 100%)'
                          : 'linear-gradient(90deg, #D98A16 0%, #FFB020 100%)',
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-[#848078]">
                  <span>Слабо</span>
                  <span>Ударная зона</span>
                  <span>Макс</span>
                </div>
              </div>

              {/* Primary Hold-and-Release Throw Button */}
              <div>
                <button
                  type="button"
                  disabled={phase !== 'AIMING' && phase !== 'CHARGING'}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    beginCharge();
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    releaseThrow();
                  }}
                  className={`w-full select-none rounded-xl py-4 px-5 font-display text-xl font-bold uppercase tracking-wider transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
                    phase === 'CHARGING'
                      ? 'bg-[#FFB020] text-[#0C0C10]'
                      : 'bg-[#E52B2B] text-white hover:bg-[#d12323]'
                  }`}
                >
                  {phase === 'CHARGING'
                    ? 'Отпускай!'
                    : phase === 'AIMING'
                    ? 'Держи и бросай'
                    : 'Шар в пути...'}
                </button>
              </div>

              {/* Last Throw Outcome Strip */}
              <div className="border-t border-white/10 pt-4">
                <div className="text-xs text-[#9A968E]">Последний бросок</div>
                <div className="mt-1 font-display text-lg font-semibold tracking-wide text-[#F5F2EB]">
                  {lastOutcome ? lastOutcome.label : 'Готов к броску'}
                </div>
              </div>
            </div>

            {/* Bottom Console Settings: Ball Style + Frame Count */}
            <div className="mt-6 space-y-4 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#9A968E]">Шар</span>
                <div className="flex items-center gap-2">
                  {BALL_STYLES.map((style) => {
                    const selected = style.id === ballStyle.id;
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setBallStyle(style)}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                          selected
                            ? 'bg-[#252530] text-white ring-1 ring-[#FFB020]'
                            : 'bg-[#1A1A22] text-[#9A968E] hover:text-white'
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: style.primaryColor }}
                        />
                        {style.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-[#9A968E]">Формат партии</span>
                <div className="flex items-center gap-1 rounded-lg bg-[#0C0C10] p-1 border border-white/10">
                  {([5, 10] as const).map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => startNewGame(count)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        totalFrames === count
                          ? 'bg-[#252530] text-white'
                          : 'text-[#9A968E] hover:text-white'
                      }`}
                    >
                      {count} фреймов
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Modals */}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <LeaderboardModal
        open={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        scores={records}
        onClear={handleClearRecords}
      />
      <GameOverModal
        open={phase === 'GAME_OVER'}
        totalScore={gameHighlights.totalScore}
        strikes={gameHighlights.strikes}
        spares={gameHighlights.spares}
        totalFrames={totalFrames}
        isNewBest={isNewBest}
        onPlayAgain={() => startNewGame(totalFrames)}
      />
    </div>
  );
}
