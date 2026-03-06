'use client';

import {
  useAccount,
  useAuthModal,
  useLogout,
  useSignerStatus,
  useUser,
} from '@account-kit/react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { alchemyConfig } from '@/config/alchemy';

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface WalletConnectButtonProps {
  /** Override label when not connected (e.g. "Get Started" on homepage) */
  connectLabel?: string;
  /** Size variant for the button */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Show as icon-only on small screens when true */
  compact?: boolean;
  className?: string;
}

/**
 * Connect wallet button for navbar/toolbar. Renders nothing when Alchemy is not configured.
 * When connected, shows truncated address with a disconnect dropdown.
 */
export function WalletConnectButton({
  connectLabel = 'Connect wallet',
  size = 'sm',
  compact = false,
  className,
}: WalletConnectButtonProps) {
  if (!alchemyConfig) return null;

  return (
    <WalletConnectButtonInner
      connectLabel={connectLabel}
      size={size}
      compact={compact}
      className={className}
    />
  );
}

function WalletConnectButtonInner({
  connectLabel,
  size,
  compact,
  className,
}: WalletConnectButtonProps) {
  const navigate = useNavigate();
  const user = useUser();
  const { openAuthModal } = useAuthModal();
  const signerStatus = useSignerStatus();
  const { logout } = useLogout();
  const { address } = useAccount({ type: 'LightAccount' });

  const handleDisconnect = async () => {
    await logout();
    navigate({ to: '/' });
  };

  const isInitializing = signerStatus.isInitializing;
  const isConnected = Boolean(user && !isInitializing);

  if (isInitializing) {
    return (
      <Button variant="outline" size={size} className={className} disabled>
        Loading…
      </Button>
    );
  }

  if (!isConnected) {
    return (
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={() => openAuthModal()}
        aria-label={connectLabel}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        {!compact && <span className="hidden sm:inline">{connectLabel}</span>}
      </Button>
    );
  }

  const displayText = address ? truncateAddress(address) : 'Connected';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className={className} aria-label="Wallet">
          <Wallet className="h-4 w-4 shrink-0" />
          {!compact && <span className="hidden sm:inline">{displayText}</span>}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {address && (
          <DropdownMenuItem disabled className="font-mono text-xs">
            {address}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleDisconnect}>Disconnect</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
