import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { avatarUrl } from '../../utils/avatar';

interface AvatarPickerModalProps {
  open: boolean;
  // forced=true: no dismiss via Cancel, Escape, or outside click (first login)
  // forced=false: standard dismiss behavior (profile edit)
  forced: boolean;
  currentAvatarId: number;
  onConfirm: (avatarId: number) => Promise<void>;
  onCancel?: () => void;
}

const GRID_SIZE = 12;


function generateUniqueSeeds(count: number): number[] {
  const seeds: number[] = [];
  while (seeds.length < count) {
    const seed = Math.floor(Math.random() * 9000) + 1000;
    if (!seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

export function AvatarPickerModal({
  open,
  forced,
  onConfirm,
  onCancel
}: AvatarPickerModalProps) {
  const [seeds, setSeeds] = useState<number[]>(() => generateUniqueSeeds(GRID_SIZE));
  const [selectedSeed, setSelectedSeed] = useState<number>(() => generateUniqueSeeds(1)[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Block Escape key when modal is in forced mode.
  useEffect(() => {
    if (!open || !forced) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, forced]);

  const handleRandomize = useCallback(() => {
    const newSeeds = generateUniqueSeeds(GRID_SIZE);
    setSeeds(newSeeds);
    // Keep the selected seed if it appears in the new grid; otherwise auto-select first.
    if (!newSeeds.includes(selectedSeed)) {
      setSelectedSeed(newSeeds[0]);
    }
  }, [selectedSeed]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(selectedSeed);
    } catch {
      // onConfirm handles its own error toasts; stop the spinner and keep modal open.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = () => {
    if (!forced) onCancel?.();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Avatar selection"
    >
      {/* Stop click propagation so clicks inside the card do not dismiss the modal */}
      <div
        className="card-purple max-w-lg w-full p-8 rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-bold text-2xl mb-1">Choose Your Avatar</h2>
        <p className="text-gray-300 text-sm mb-6">Pick one that represents you</p>

        <div className="grid grid-cols-4 gap-3" role="listbox" aria-label="Avatar options">
          {seeds.map((seed) => {
            const isSelected = seed === selectedSeed;
            return (
              <button
                key={seed}
                role="option"
                aria-selected={isSelected}
                aria-label={`Avatar option ${seed}`}
                onClick={() => setSelectedSeed(seed)}
                className={`aspect-square rounded-2xl bg-[#3A3552] overflow-hidden cursor-pointer border-2 transition-all ${
                  isSelected
                    ? 'border-[#E8B995] scale-105'
                    : 'border-transparent hover:border-[#E8B995]/50'
                }`}
              >
                <img
                  src={avatarUrl(seed)}
                  alt={`Avatar ${seed}`}
                  className="w-full h-full"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>

        <button
          onClick={handleRandomize}
          disabled={isSubmitting}
          className="text-white w-fit m-auto mt-4 mb-4 flex items-center justify-center gap-2 hover:text-[#E8B995] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Randomize
        </button>

        <div className="flex gap-3 justify-end">
          {!forced && (
            <button onClick={onCancel} className="btn-primary flex-1">
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}
