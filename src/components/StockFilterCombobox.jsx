import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { filterStockSearchOptions } from '../utils/stockSearchOptions';

const StockFilterCombobox = ({
  value,
  onChange,
  options = [],
  allLabel = '전체 종목',
  placeholder = '종목명 또는 티커 검색',
  ariaLabel = '종목 필터',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = `stock-filter-${useId().replace(/:/g, '')}`;

  const normalizedOptions = useMemo(() => options.map((option) => {
    if (typeof option === 'string') {
      return { value: option, label: option, description: '', keywords: [] };
    }
    return {
      value: option.value,
      label: option.label || option.value,
      description: option.description || '',
      keywords: Array.isArray(option.keywords) ? option.keywords : [],
    };
  }).filter((option) => option.value), [options]);

  const selectedOption = normalizedOptions.find((option) => option.value === value);
  const filteredOptions = useMemo(() => (
    filterStockSearchOptions(normalizedOptions, query)
  ), [normalizedOptions, query]);
  const visibleOptions = query.trim()
    ? filteredOptions
    : [{ value: 'all', label: allLabel, description: '', keywords: [] }, ...filteredOptions];

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setQuery('');
        setActiveIndex(0);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  const selectOption = (option) => {
    onChange(option.value);
    close();
  };

  const open = () => {
    setIsOpen(true);
    setQuery('');
    setActiveIndex(0);
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleOptions.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className={`relative w-full md:w-[280px] ${className}`}>
      <button
        type="button"
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        className={`w-full h-[52px] pl-4 ${value !== 'all' ? 'pr-20' : 'pr-11'} bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand text-left grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs md:text-sm text-ink-soft`}
      >
        <Search size={16} className="text-ink-mute" />
        <span className="truncate font-bold">{selectedOption?.label || allLabel}</span>
        <ChevronDown
          size={16}
          className={`absolute right-4 text-ink-mute transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {value !== 'all' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onChange('all');
            close();
          }}
          aria-label={`${selectedOption?.label || '선택 종목'} 필터 해제`}
          className="absolute right-10 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-mute hover:text-ink hover:bg-line-soft transition-colors"
        >
          <X size={14} />
        </button>
      )}

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-[calc(100%+0.5rem)] rounded-2xl border border-line bg-surface p-2 shadow-modal">
          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              role="combobox"
              aria-label={placeholder}
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={visibleOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
              placeholder={placeholder}
              className="w-full h-11 pl-9 pr-9 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveIndex(0);
                }}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-mute hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div id={listboxId} role="listbox" className="max-h-64 overflow-y-auto scroll-soft space-y-1">
            {visibleOptions.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`w-full min-h-11 px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${activeIndex === index ? 'bg-canvas' : 'hover:bg-canvas/70'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs md:text-sm font-bold text-ink">{option.label}</span>
                    {option.description && (
                      <span className="block truncate mt-0.5 text-[11px] font-semibold text-ink-mute">{option.description}</span>
                    )}
                  </span>
                  {isSelected && <Check size={16} className="shrink-0 text-up" />}
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <p className="px-3 py-5 text-center text-xs font-bold text-ink-mute">일치하는 종목이 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StockFilterCombobox;
