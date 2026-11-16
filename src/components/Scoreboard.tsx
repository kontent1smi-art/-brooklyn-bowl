import React from 'react';
import { FrameData } from '../types/bowling';
import { formatRollSymbol } from '../utils/bowlingScore';

interface ScoreboardProps {
  frames: FrameData[];
  currentFrameIndex: number;
  isGameOver: boolean;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  frames,
  currentFrameIndex,
  isGameOver,
}) => {
  const totalFrames = frames.length;
  const latestScore =
    [...frames].reverse().find((f) => f.cumulativeScore !== null)?.cumulativeScore ?? 0;

  return (
    <div
      className="w-full rounded-xl border border-white/10 bg-[#14141A] overflow-hidden"
      aria-label="Табло счёта"
    >
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[640px]"
          style={{
            gridTemplateColumns: `repeat(${totalFrames}, minmax(0, 1fr)) 96px`,
          }}
        >
          {frames.map((frame, idx) => {
            const isFinal = idx === totalFrames - 1;
            const isActive = !isGameOver && idx === currentFrameIndex;

            return (
              <div
                key={idx}
                className={`flex flex-col border-r border-white/10 transition-colors ${
                  isActive ? 'bg-[#211518] ring-1 ring-inset ring-[#E52B2B]' : 'bg-[#14141A]'
                }`}
              >
                {/* Frame header */}
                <div
                  className={`py-1 text-center font-mono text-[11px] font-bold tabular-nums border-b border-white/10 ${
                    isActive ? 'bg-[#E52B2B] text-white' : 'bg-[#1A1A22] text-[#9A968E]'
                  }`}
                >
                  {idx + 1}
                </div>

                {/* Roll cells */}
                <div
                  className={`grid border-b border-white/5 ${
                    isFinal ? 'grid-cols-3' : 'grid-cols-2'
                  }`}
                >
                  {(isFinal ? [0, 1, 2] : [0, 1]).map((rollIdx) => {
                    const sym = formatRollSymbol(frame.rolls, rollIdx, isFinal);
                    const isStrike = sym === 'X';
                    const isSpare = sym === '/';

                    return (
                      <div
                        key={rollIdx}
                        className={`h-7 flex items-center justify-center font-mono text-xs font-bold tabular-nums ${
                          rollIdx > 0 ? 'border-l border-white/10 bg-[#101015]' : ''
                        } ${
                          isStrike
                            ? 'text-[#FFB020]'
                            : isSpare
                            ? 'text-[#E52B2B]'
                            : 'text-[#F5F2EB]'
                        }`}
                      >
                        {sym}
                      </div>
                    );
                  })}
                </div>

                {/* Cumulative frame score */}
                <div className="h-9 flex items-center justify-center font-mono text-base font-bold tabular-nums text-[#F5F2EB]">
                  {frame.cumulativeScore !== null ? frame.cumulativeScore : ''}
                </div>
              </div>
            );
          })}

          {/* Total Score Column */}
          <div className="flex flex-col bg-[#1B191E]">
            <div className="py-1 text-center font-display text-[11px] tracking-wider uppercase font-semibold bg-[#252229] text-[#FFB020] border-b border-white/10">
              Итог
            </div>
            <div className="flex-1 flex items-center justify-center font-mono text-2xl font-bold tabular-nums text-[#FFB020] px-2">
              {latestScore}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
