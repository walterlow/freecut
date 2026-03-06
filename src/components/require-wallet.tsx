'use client';

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSignerStatus, useUser } from '@account-kit/react';
import { alchemyConfig } from '@/config/alchemy';

interface RequireWalletProps {
  children: React.ReactNode;
}

/**
 * When Alchemy is configured, requires a connected wallet before rendering children.
 * Redirects to / when not connected (after signer has finished initializing).
 * When Alchemy is not configured, renders children with no guard.
 *
 * Alchemy hooks (useUser, useSignerStatus) are only used in RequireWalletGuard, which
 * is mounted only when alchemyConfig exists — i.e. when AlchemyAccountProvider wraps the app.
 */
export function RequireWallet({ children }: RequireWalletProps) {
  if (!alchemyConfig) {
    return <>{children}</>;
  }
  return <RequireWalletGuard>{children}</RequireWalletGuard>;
}

function RequireWalletGuard({ children }: RequireWalletProps) {
  const navigate = useNavigate();
  const user = useUser();
  const signerStatus = useSignerStatus();

  const isInitializing = signerStatus.isInitializing;
  const isConnected = Boolean(user && !isInitializing);

  useEffect(() => {
    if (!isInitializing && !user) {
      navigate({ to: '/' });
    }
  }, [user, isInitializing, navigate]);

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isConnected) {
    return null;
  }

  return <>{children}</>;
}
