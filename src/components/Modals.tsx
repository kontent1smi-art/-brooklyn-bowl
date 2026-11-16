import React from 'react';
import { RotateCcw, Trophy, X } from 'lucide-react';
import { HighScoreEntry } from '../types/bowling';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/15 bg-[#14141A] p-6 text-[#F5F2EB]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 id="rules-title" className="font-display text-2xl font-bold tracking-wide uppercase">
            Как играть
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#9A968E] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Закрыть правила"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ol className="mt-4 space-y-3 text-sm leading-relaxed text-[#D5D0C7]">
          <li>
            <span className="font-semibold text-[#FFB020]">1. Наведение:</span> двигайте курсор по дорожке, используйте ползунок прицела или клавиши <span className="font-mono text-white">←</span> / <span className="font-mono text-white">→</span>.
          </li>
          <li>
            <span className="font-semibold text-[#FFB020]">2. Выбор силы:</span> зажмите кнопку <span className="text-white font-medium">«Держи и бросай»</span> (или клавишу <span className="font-mono text-white">Пробел</span>) — шкала силы начнёт движение.
          </li>
          <li>
            <span className="font-semibold text-[#FFB020]">3. Бросок:</span> отпустите кнопку в нужный момент. Высокая сила даёт мощный разлёт кеглей, но остерегайтесь желоба по краям.
          </li>
          <li>
            <span className="font-semibold text-[#FFB020]">4. Подсчёт очков:</span> классические правила — Страйк (<span className="font-mono text-[#FFB020]">X</span>) удваивает два следующих броска, Спэр (<span className="font-mono text-[#E52B2B]">/</span>) прибавляет один следующий бросок.
          </li>
        </ol>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#E52B2B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#cc2222] transition-colors whitespace-nowrap"
          >
            Понятно, на дорожку
          </button>
        </div>
      </div>
    </div>
  );
};

interface LeaderboardModalProps {
  open: boolean;
  onClose: () => void;
  scores: HighScoreEntry[];
  onClear: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  open,
  onClose,
  scores,
  onClear,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="records-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/15 bg-[#14141A] p-6 text-[#F5F2EB]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 id="records-title" className="font-display text-2xl font-bold tracking-wide uppercase">
            Таблица рекордов
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#9A968E] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Закрыть таблицу рекордов"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {scores.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#9A968E]">
            Пока нет завершённых партий. Сыграйте хотя бы одну игру, чтобы зафиксировать рекорд.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#1B1B22] text-xs text-[#9A968E]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Очки</th>
                  <th className="px-3 py-2.5 font-medium">Формат</th>
                  <th className="px-3 py-2.5 font-medium">Страйки / Спэры</th>
                  <th className="px-3 py-2.5 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 font-mono tabular-nums">
                {scores.map((entry, idx) => (
                  <tr key={entry.id} className="bg-[#14141A]">
                    <td className="px-3 py-2.5 text-[#9A968E]">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-bold text-[#FFB020]">{entry.score}</td>
                    <td className="px-3 py-2.5 font-sans text-xs text-[#D5D0C7]">
                      {entry.frames} фр.
                    </td>
                    <td className="px-3 py-2.5 text-[#F5F2EB]">
                      {entry.strikes} / {entry.spares}
                    </td>
                    <td className="px-3 py-2.5 font-sans text-xs text-[#9A968E]">
                      {entry.date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          {scores.length > 0 ? (
            <button
              onClick={onClear}
              className="text-xs text-[#9A968E] hover:text-[#E52B2B] transition-colors"
            >
              Очистить историю
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-white/15 bg-[#1D1D25] px-4 py-2 text-sm font-medium text-white hover:bg-[#262630] transition-colors whitespace-nowrap"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

interface GameOverModalProps {
  open: boolean;
  totalScore: number;
  strikes: number;
  spares: number;
  totalFrames: number;
  isNewBest: boolean;
  onPlayAgain: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  open,
  totalScore,
  strikes,
  spares,
  totalFrames,
  isNewBest,
  onPlayAgain,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gameover-title"
    >
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#14141A] p-6 text-center text-[#F5F2EB]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#251A14] text-[#FFB020]">
          <Trophy className="h-6 w-6" />
        </div>

        <h2 id="gameover-title" className="mt-4 font-display text-3xl font-bold uppercase tracking-wide">
          Партия завершена
        </h2>
        <p className="mt-1 text-sm text-[#9A968E]">
          {isNewBest
            ? 'Новый личный рекорд на дорожке Brooklyn Bowl'
            : `Сыграно фреймов: ${totalFrames}`}
        </p>

        <div className="mt-6 grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-[#1A1A22] py-4">
          <div>
            <div className="text-xs text-[#9A968E]">Итоговый счёт</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#FFB020]">
              {totalScore}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#9A968E]">Страйки (X)</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#F5F2EB]">
              {strikes}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#9A968E]">Спэры (/)</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#E52B2B]">
              {spares}
            </div>
          </div>
        </div>

        <button
          onClick={onPlayAgain}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#E52B2B] px-5 py-3 text-sm font-semibold text-white hover:bg-[#cc2222] transition-colors whitespace-nowrap"
        >
          <RotateCcw className="h-4 w-4" />
          Сыграть ещё раз
        </button>
      </div>
    </div>
  );
};
