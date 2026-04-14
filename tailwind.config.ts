import { withAccountKitUi, getAccountKitContentPath } from '@account-kit/react/tailwind';
import type { Config } from 'tailwindcss';

/**
 * Tailwind config: app content + Account Kit UI so the connect-wallet auth modal
 * is styled. Account Kit plugin only adds .akui-* components and its own CSS
 * variables; we do not import @account-kit/react/styles.css (its global
 * preflight would affect the whole app).
 */
const config: Config = withAccountKitUi(
  {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', getAccountKitContentPath()],
  },
  {
    // Align modal with app theme (modal body uses light text on dark background)
    colors: {
      'btn-primary': { dark: 'var(--primary)', light: 'var(--primary)' },
      'fg-primary': { dark: 'var(--foreground)', light: 'var(--foreground)' },
      'fg-secondary': { dark: 'var(--foreground)', light: 'var(--foreground)' },
      'fg-tertiary': { dark: 'var(--muted-foreground)', light: 'var(--muted-foreground)' },
      'bg-surface-default': { dark: 'var(--card)', light: 'var(--card)' },
    },
    borderRadius: 'md',
  }
);

export default config;
