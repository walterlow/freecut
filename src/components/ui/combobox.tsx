"use client"

import { Check, ChevronsUpDown } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/shared/ui/cn"

export interface ComboboxOption {
  value: string
  label: string
  keywords?: readonly string[]
}

interface ComboboxProps {
  value: string
  options: readonly ComboboxOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
}

export function Combobox({
  value,
  options,
  onValueChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const deferredQuery = React.useDeferredValue(query)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [contentWidth, setContentWidth] = React.useState<number>()

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  )

  React.useEffect(() => {
    if (!open) {
      setQuery("")
      return
    }

    const trigger = triggerRef.current
    if (!trigger) {
      return
    }

    const updateWidth = () => {
      setContentWidth(trigger.offsetWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(trigger)

    return () => {
      observer.disconnect()
    }
  }, [open])

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return options
    }

    return options.filter((option) => {
      const haystacks = [option.label, option.value, ...(option.keywords ?? [])]
      return haystacks.some((entry) =>
        entry.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [deferredQuery, options])

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-between bg-transparent px-3 font-normal shadow-sm",
              "hover:bg-transparent",
              !selectedOption && "text-muted-foreground",
              triggerClassName
            )}
          >
            <span className="truncate">
              {selectedOption?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn("p-0", contentClassName)}
          style={contentWidth ? { width: contentWidth } : undefined}
        >
          <div className="border-b p-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
            />
          </div>
          <ScrollArea className="max-h-72">
            <div className="p-1">
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = option.value === value

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                        "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                      )}
                      onClick={() => {
                        onValueChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{option.label}</span>
                      <Check
                        className={cn(
                          "ml-2 h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
