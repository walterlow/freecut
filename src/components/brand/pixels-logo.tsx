import { cn } from '@/shared/ui/cn';

interface PixelsLogoProps {
  variant?: 'full' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeConfig = {
  sm: {
    icon: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-1.5',
  },
  md: {
    icon: 'w-7 h-7',
    text: 'text-xl',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-10 h-10',
    text: 'text-3xl',
    gap: 'gap-3',
  },
};

const LOGO_SRC = '/assets/landing/pixels-logo.svg';

function LogoImage({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Pixels"
      className={cn('object-contain', className)}
    />
  );
}

export function PixelsLogo({ variant = 'full', size = 'md', className }: PixelsLogoProps) {
  const config = sizeConfig[size];

  if (variant === 'icon') {
    return <LogoImage className={cn(config.icon, className)} />;
  }

  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <LogoImage className={cn(config.icon, 'flex-shrink-0')} />
      <span
        className={cn(
          config.text,
          'font-semibold tracking-tight text-foreground'
        )}
      >
        Pixels
      </span>
    </div>
  );
}
