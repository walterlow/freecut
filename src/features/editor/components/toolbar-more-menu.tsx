import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Compass, Ellipsis, Github, Keyboard, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiscordIcon } from '@/components/brand/discord-icon'
import { DISCORD_INVITE_URL } from '@/config/community'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'

interface MoreMenuProps {
  hasUnseenWhatsNew?: boolean
  onOpenWhatsNew: () => void
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onOpenGuides?: () => void
}

/**
 * Collapses the toolbar's secondary links (socials, docs, settings, shortcuts,
 * language) behind a single "⋯" menu so the primary Edit actions stay front
 * and center for new users.
 */
export const MoreMenu = memo(function MoreMenu({
  hasUnseenWhatsNew = false,
  onOpenWhatsNew,
  onOpenSettings,
  onOpenShortcuts,
  onOpenGuides,
}: MoreMenuProps) {
  const { t } = useTranslation()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            data-tooltip={t('toolbar.moreMenu')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.moreMenu')}
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {t('toolbar.moreMenu')}
          </DropdownMenuLabel>
          <DropdownMenuItem asChild className="gap-2">
            <a
              href="https://github.com/walterlow/freecut"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
              {t('toolbar.viewOnGitHub')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
              <DiscordIcon className="h-4 w-4" />
              {t('toolbar.joinDiscord')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              <BookOpen className="h-4 w-4" />
              {t('toolbar.userGuide')}
            </a>
          </DropdownMenuItem>
          {onOpenGuides && (
            <DropdownMenuItem onClick={onOpenGuides} className="gap-2">
              <Compass className="h-4 w-4" />
              {t('toolbar.showGuides')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenWhatsNew} className="gap-2">
            <span className="relative">
              <Sparkles className="h-4 w-4" />
              {hasUnseenWhatsNew && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </span>
            {t('toolbar.whatsNew')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenSettings} className="gap-2">
            <Settings className="h-4 w-4" />
            {t('toolbar.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenShortcuts} className="gap-2">
            <Keyboard className="h-4 w-4" />
            {t('toolbar.keyboardShortcuts')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-sm text-muted-foreground">{t('language.label')}</span>
            <LanguageSwitcher size="sm" align="end" side="bottom" />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
})
