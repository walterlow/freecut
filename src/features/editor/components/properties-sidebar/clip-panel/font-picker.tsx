import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Loader2, Search, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FONT_CATALOG,
  ensureFontsLoaded,
  getGoogleFontsCatalog,
  type FontCatalogEntry,
} from '@/lib/fonts';

interface FontPickerProps {
  value?: string;
  placeholder?: string;
  previewText?: string;
  onValueChange: (fontFamily: string) => void;
}

const DEFAULT_PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog';
const PREVIEW_PREFETCH_LIMIT = 4;
const PREVIEW_PREFETCH_DEBOUNCE_MS = 120;

export function FontPicker({
  value,
  placeholder = 'Select font',
  previewText,
  onValueChange,
}: FontPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fontOptionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredFontValue, setHoveredFontValue] = useState<string | null>(null);
  const [fonts, setFonts] = useState<readonly FontCatalogEntry[]>(FONT_CATALOG);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setSearchQuery('');
    setIsLoading(true);

    void getGoogleFontsCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setFonts(catalog);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredFonts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return fonts;
    }
    return fonts.filter((font) => font.label.toLowerCase().includes(query));
  }, [fonts, searchQuery]);

  const normalizedPreviewText = useMemo(() => {
    const source = previewText?.trim() ? previewText : DEFAULT_PREVIEW_TEXT;
    return source.replace(/\s+/g, ' ').slice(0, 72);
  }, [previewText]);

  const activePreviewFont = useMemo(() => {
    const activeValue = hoveredFontValue ?? value ?? filteredFonts[0]?.value;
    if (!activeValue) {
      return null;
    }
    return fonts.find((font) => font.value === activeValue) ?? null;
  }, [filteredFonts, fonts, hoveredFontValue, value]);

  const previewCandidates = useMemo(() => {
    const candidates = [
      value,
      hoveredFontValue,
      ...filteredFonts.slice(0, PREVIEW_PREFETCH_LIMIT).map((font) => font.value),
    ].filter((font): font is string => typeof font === 'string' && font.trim().length > 0);

    return [...new Set(candidates)];
  }, [filteredFonts, hoveredFontValue, value]);

  useEffect(() => {
    if (!open || previewCandidates.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void ensureFontsLoaded(previewCandidates, [400]);
    }, PREVIEW_PREFETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, previewCandidates]);

  useEffect(() => {
    if (!open) {
      setHoveredFontValue(null);
      return;
    }

    setHoveredFontValue(value ?? null);
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const rootElement = rootRef.current;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && rootRef.current?.contains(relatedTarget)) {
        return;
      }

      setOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    rootElement?.addEventListener('focusout', handleFocusOut);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      rootElement?.removeEventListener('focusout', handleFocusOut);
    };
  }, [open]);

  const handleSelect = useCallback(
    (font: FontCatalogEntry) => {
      void ensureFontsLoaded([font.value], font.weights);
      onValueChange(font.value);
      setOpen(false);
    },
    [onValueChange]
  );

  const focusFontByIndex = useCallback(
    (index: number) => {
      const font = filteredFonts[index];
      if (!font) {
        return;
      }

      const option = fontOptionRefs.current.get(font.value);
      if (option) {
        option.focus();
      }

      setHoveredFontValue(font.value);
      void ensureFontsLoaded([font.value], [400]);
    },
    [filteredFonts]
  );

  const handleOptionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, font: FontCatalogEntry) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }

      if (filteredFonts.length === 0) {
        return;
      }

      const currentIndex = filteredFonts.findIndex((candidate) => candidate.value === font.value);
      if (currentIndex === -1) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusFontByIndex((currentIndex + 1) % filteredFonts.length);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusFontByIndex((currentIndex - 1 + filteredFonts.length) % filteredFonts.length);
          break;
        case 'Home':
          event.preventDefault();
          focusFontByIndex(0);
          break;
        case 'End':
          event.preventDefault();
          focusFontByIndex(filteredFonts.length - 1);
          break;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          handleSelect(font);
          break;
        }
        default:
          break;
      }
    },
    [filteredFonts, focusFontByIndex, handleSelect]
  );

  const triggerLabel = value ?? placeholder;

  return (
    <div ref={rootRef} className="w-full">
      <Button
        type="button"
        variant="outline"
        className="h-7 w-full justify-between px-2 text-xs font-normal"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="truncate"
          style={value ? { fontFamily: `"${value}", sans-serif` } : undefined}
        >
          {triggerLabel}
        </span>
        <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Button>

      {open ? (
        <div className="mt-2 space-y-2 rounded-md border bg-popover p-2 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search fonts..."
              className="h-8 pl-9 text-xs"
              autoFocus
            />
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {activePreviewFont?.label ?? 'Live Preview'}
            </p>
            <p
              className="mt-1 truncate text-lg"
              style={
                activePreviewFont
                  ? { fontFamily: `"${activePreviewFont.family}", sans-serif` }
                  : undefined
              }
            >
              {normalizedPreviewText}
            </p>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>All Fonts</span>
            <span>{filteredFonts.length}</span>
          </div>

          <div
            className="max-h-52 space-y-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
            role="listbox"
            aria-label="Font options"
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : filteredFonts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No fonts match your search.
              </div>
            ) : (
              filteredFonts.map((font) => {
                const isSelected = font.value === value;

                return (
                  <button
                    key={font.value}
                    ref={(node) => {
                      if (node) {
                        fontOptionRefs.current.set(font.value, node);
                      } else {
                        fontOptionRefs.current.delete(font.value);
                      }
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(font)}
                    onPointerEnter={() => {
                      setHoveredFontValue(font.value);
                      void ensureFontsLoaded([font.value], [400]);
                    }}
                    onFocus={() => {
                      setHoveredFontValue(font.value);
                      void ensureFontsLoaded([font.value], [400]);
                    }}
                    onKeyDown={(event) => handleOptionKeyDown(event, font)}
                    className="w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-xs"
                        style={{ fontFamily: `"${font.family}", sans-serif` }}
                      >
                        {font.label}
                      </span>
                      {isSelected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
