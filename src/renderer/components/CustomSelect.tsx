import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check } from 'lucide-react';

export interface CustomSelectOption<T extends string | number> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps<T extends string | number> {
  value: T;
  onChange: (val: T) => void;
  options: CustomSelectOption<T>[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'md';
}

export function CustomSelect<T extends string | number>({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  placeholder = 'Select option...',
  size = 'md'
}: CustomSelectProps<T>): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (val: T, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(val);
    setIsOpen(false);
  };

  const isSmall = size === 'sm';

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      {/* Trigger Button */}
      <motion.button
        type="button"
        whileTap={disabled ? undefined : { scale: 0.98 }}
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl transition-all duration-150 border cursor-pointer ${
          isSmall ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-2 text-xs'
        } ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-neutral-900/50 border-white/5 text-neutral-500'
            : isOpen
            ? 'bg-neutral-800/90 border-white/30 text-white shadow-[0_0_16px_rgba(255,255,255,0.1)]'
            : 'bg-neutral-900/80 hover:bg-neutral-800/80 border-white/10 hover:border-white/20 text-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 truncate">
          {selectedOption?.icon && (
            <span className="shrink-0 text-neutral-400">{selectedOption.icon}</span>
          )}
          <span className="truncate font-medium">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.sublabel && (
            <span className="text-[10px] text-neutral-400 font-mono truncate">
              {selectedOption.sublabel}
            </span>
          )}
        </div>

        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="shrink-0 text-neutral-400"
        >
          <ChevronDown className={isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </motion.div>
      </motion.button>

      {/* Floating Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 p-1 rounded-xl bg-neutral-900/95 backdrop-blur-2xl border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.6),0_0_1px_1px_rgba(255,255,255,0.08)] space-y-0.5 overflow-hidden max-h-56 overflow-y-auto custom-scrollbar"
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <motion.button
                  key={String(opt.value)}
                  type="button"
                  whileHover={{ x: 2, backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={(e) => handleSelect(opt.value, e)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    isSmall ? 'text-[11px]' : 'text-xs'
                  } ${
                    isSelected
                      ? 'bg-white/15 text-white font-semibold'
                      : 'text-neutral-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 truncate">
                    {opt.icon && <span className="shrink-0 text-neutral-400">{opt.icon}</span>}
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="text-[10px] text-neutral-400 font-mono truncate">
                        {opt.sublabel}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="shrink-0 text-white"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </motion.span>
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
