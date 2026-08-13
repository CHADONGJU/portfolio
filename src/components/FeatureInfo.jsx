import { useEffect, useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

const FeatureInfo = ({ text, label = '기능 설명 보기', align = 'left' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const descriptionId = `feature-info-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((previous) => !previous);
        }}
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? descriptionId : undefined}
        className={`w-7 h-7 inline-grid place-items-center rounded-full transition-colors ${isOpen ? 'bg-ink text-surface' : 'bg-line-soft text-ink-mute hover:text-ink hover:bg-line'}`}
      >
        <Info size={14} aria-hidden="true" />
      </button>

      {isOpen && (
        <span
          id={descriptionId}
          role="note"
          className={`absolute z-[80] top-[calc(100%+0.5rem)] w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 text-left shadow-modal ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="text-xs md:text-sm font-bold leading-relaxed text-ink-soft">{text}</span>
            <button type="button" onClick={() => setIsOpen(false)} className="p-1 rounded-lg text-ink-mute hover:text-ink" aria-label="기능 설명 닫기">
              <X size={14} />
            </button>
          </span>
        </span>
      )}
    </span>
  );
};

export default FeatureInfo;
